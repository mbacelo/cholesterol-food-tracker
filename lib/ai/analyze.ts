import { finalizeScore } from '../../domain/scoring.js'
import { getPrompts, promptVersionsTag } from '../server/prompts.js'
import * as cache from '../server/scoreCache.js'
import { consume, logAnalysis } from '../server/usage.js'
import { ApiError } from '../server/errors.js'
import { getProvider } from './index.js'
import { zAnalysis, type Analysis } from './schemas.js'
import type { ImageInput } from './types.js'

/**
 * One analysis: image and/or description plus the homemade flag, in; a final
 * score, rationale and factor lists, out.
 *
 * ONE model call, not two (tech spec §7). Collapsing image->description and
 * description->score into a single request halves both the latency and the cost
 * of the primary path, and removes an intermediate state with no user-visible
 * value.
 *
 * This function is stateless with respect to entries: it stores nothing but a
 * cache row. That is what makes "quick check" (functional spec §6.2) require no
 * code -- a discarded analysis leaves no trace because there is no save path for
 * it to reach.
 */

export interface AnalyzeInput {
  /** The user's typed text. Authoritative when present: it is returned unchanged. */
  description?: string
  isHomemade: boolean
  image?: ImageInput
  /** For the durable daily budget, which resets at the user's midnight. */
  email: string
  localDay: string
}

export interface AnalyzeResult {
  /** The description to store: the user's text, or the model's reading of the photo. */
  description: string
  /** The FINAL score, decided by domain/scoring.ts. Never the model's own number. */
  score: number
  rationale: string
  positiveFactors: Analysis['positive_factors']
  negativeFactors: Analysis['negative_factors']
  foodDetected: boolean
  /** True when this came from score_cache: no model call, no budget consumed. */
  cached: boolean
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  const prompts = await getPrompts()
  const provider = getProvider()
  const versions = promptVersionsTag(prompts)

  // With an image, image_analysis_prompt is prepended to scoring_prompt. With
  // typed text only, it is not sent at all -- there is no image to read.
  const systemPrompt = input.image
    ? `${prompts.image_analysis_prompt.body}\n\n---\n\n${prompts.scoring_prompt.body}`
    : prompts.scoring_prompt.body

  // A typed description is scored text-only, with no image, even when the user
  // arrived by photo. The description is the only scored input (functional spec
  // §3.1), and keeping the request text-only makes the cache key complete -- an
  // image in the request would make two identical descriptions cache separately.
  const sendImage = input.description === undefined ? input.image : undefined

  // ---- cache read (text path only) ----------------------------------------
  // A photo with no description has no stable key until the model has named the
  // dish, so the read is skipped and only the write happens, below.
  let key: string | undefined
  if (input.description !== undefined) {
    key = cache.cacheKey({
      description: input.description,
      isHomemade: input.isHomemade,
      provider: provider.name,
      model: provider.model,
      promptVersions: versions,
    })
    const hit = await cache.get(key)
    if (hit) {
      const parsed = zAnalysis.safeParse(hit)
      if (parsed.success) {
        // The CALLER's text, not the stored row's. The cache key normalizes case
        // and whitespace, so a hit can legitimately come from a differently typed
        // variant of the same dish -- and functional spec 6.3 requires the user's
        // text back character for character. The model is never called on a hit,
        // so this is the only place that rule can be enforced.
        return finish(
          parsed.data,
          input.description,
          true,
          provider.name,
          provider.model,
          0,
          null,
          null,
        )
      }
      // A stored row that no longer validates means the schema moved. Evict and
      // re-score rather than serving something the app can no longer read.
      await cache.drop(key)
    }
  }

  // ---- model call ---------------------------------------------------------
  // Budget is consumed HERE, after the cache miss and immediately before the
  // billable request. A cache hit must never cost the user quota.
  await consume(input.email, input.localDay)

  const request = {
    systemPrompt,
    isHomemade: input.isHomemade,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(sendImage ? { image: sendImage } : {}),
  }

  let result
  try {
    result = await provider.analyze(request)
  } catch (firstError) {
    // Invalid output is retried once, then surfaces a clear error. Nothing is
    // ever saved without a valid score.
    console.warn('[analyze] first attempt failed, retrying once:', describeError(firstError))
    try {
      result = await provider.analyze(request)
    } catch (secondError) {
      console.error('[analyze] retry failed:', describeError(secondError))
      throw new ApiError(502, 'ai_unavailable')
    }
  }

  const analysis = result.analysis

  // A typed description must come back unchanged: the model is instructed not to
  // rewrite it, and this enforces it regardless. A rewritten description would
  // miss its own cache entry on the very next request.
  const description =
    input.description !== undefined ? input.description : analysis.description

  // ---- cache write -------------------------------------------------------
  // Keyed on the RESOLVED description, so a photo analysis seeds the cache under
  // the description it produced and a later identical typed description hits it.
  if (analysis.food_detected && description.length > 0) {
    const writeKey = cache.cacheKey({
      description,
      isHomemade: input.isHomemade,
      provider: provider.name,
      model: provider.model,
      promptVersions: versions,
    })
    // The description is deliberately NOT stored. score_cache is global and not
    // user-scoped -- the one table in an otherwise strictly isolated schema -- so
    // keeping food text out of it is what stops it becoming a cross-user record of
    // what people ate (db/migrations/001_init.sql, tech spec 3).
    //
    // Nothing needs it: the description is only ever read back on the text path,
    // where the caller already has it, and the photo path writes this cache
    // without ever reading it.
    await cache.set(writeKey, { ...analysis, description: '' })
  }

  return finish(
    analysis,
    description,
    false,
    provider.name,
    result.model,
    result.latencyMs,
    result.usage.inputTokens,
    result.usage.outputTokens,
  )
}

/**
 * `description` is passed in rather than read off `analysis` on purpose: the
 * cached payload deliberately carries none (see the cache write above), and on a
 * hit the answer must be the caller's own text.
 */
function finish(
  analysis: Analysis,
  description: string,
  cached: boolean,
  providerName: string,
  model: string,
  latencyMs: number,
  inputTokens: number | null,
  outputTokens: number | null,
): AnalyzeResult {
  // The model proposes; our code decides. This is where the -5..+5 integer that
  // actually gets stored comes from.
  const breakdown = finalizeScore({
    modifierSum: analysis.modifier_sum,
    hasTransFat: analysis.has_trans_fat,
    wholePlantOnly: analysis.whole_plant_only,
    proxyUltraProcessed: analysis.proxy_ultra_processed,
    proxyUnidentifiedFat: analysis.proxy_unidentified_fat,
  })

  logAnalysis({
    provider: providerName,
    model,
    latencyMs,
    inputTokens,
    outputTokens,
    cached,
    score: breakdown.score,
    modifierSum: breakdown.modifierSum,
    foodDetected: analysis.food_detected,
    descriptionLength: description.length,
    descriptionHash: cache.descriptionHash(description),
    contradiction: breakdown.contradiction,
  })

  return {
    description,
    score: breakdown.score,
    rationale: analysis.rationale,
    positiveFactors: analysis.positive_factors,
    negativeFactors: analysis.negative_factors,
    foodDetected: analysis.food_detected,
    cached,
  }
}

/** Never let a provider's message reach a response body; this is for logs only. */
function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}
