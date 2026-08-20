import type { Analysis } from './schemas.js'

/**
 * The provider boundary (tech spec §7).
 *
 * One switch point, getProvider(), keyed off AI_PROVIDER. Prompts and output
 * shape are shared, so every provider extracts identically and adding one is a
 * file plus a case.
 */

export interface ImageInput {
  /** Raw base64, with no data: URL prefix. */
  base64: string
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
}

export interface AnalyzeRequest {
  /** The full system prompt: scoring_prompt, with image_analysis_prompt prepended when an image is attached. */
  systemPrompt: string
  /** The user's typed description, when there is one. Authoritative: the model must not rewrite it. */
  description?: string
  isHomemade: boolean
  image?: ImageInput
}

export interface ProviderUsage {
  inputTokens: number | null
  outputTokens: number | null
}

export interface ProviderResult {
  analysis: Analysis
  model: string
  usage: ProviderUsage
  /** Wall-clock milliseconds for the provider call. */
  latencyMs: number
}

export interface AIProvider {
  readonly name: string
  readonly model: string
  /**
   * One model request. Returns validated output or throws.
   *
   * Implementations must not retry: analyze.ts owns the single retry, so the
   * retry budget is in one place rather than multiplied per provider.
   */
  analyze(request: AnalyzeRequest): Promise<ProviderResult>
}

/** What gets logged for every analysis (tech spec §9). */
export interface AnalysisLogEntry {
  provider: string
  model: string
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  cached: boolean
  score: number
  modifierSum: number
  foodDetected: boolean
  /**
   * The LENGTH and a HASH of the description, never the text.
   *
   * The description is the user's food data, and administrators read logs but
   * must never see food data (functional spec §2). A hash still lets a repeated
   * dish be correlated across log lines while tuning prompts.
   */
  descriptionLength: number
  descriptionHash: string
  /** True when the model claimed both trans fat and whole-plant-only. */
  contradiction: boolean
}
