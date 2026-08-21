import { analyze } from '../lib/ai/analyze.js'
import { localDayFromOffset } from '../lib/dates.js'
import { assertImageBytes } from '../lib/server/images.js'
import { assertMethod, handleError } from '../lib/server/errors.js'
import type { ApiRequest, ApiResponse } from '../lib/server/http.js'
import { zAnalyze, zTzOffset } from '../lib/requests.js'
import { requireUser } from '../lib/server/session.js'
import { assertBurst, assertWithinBudget } from '../lib/server/usage.js'

/**
 * Analyze an image and/or a description. STORES NOTHING.
 *
 * This is also the "quick check" (functional spec §6.2): because nothing is
 * written, an analysis the user discards leaves no trace, and there is no save
 * path for it to reach accidentally. That is why quick check needed no code.
 *
 * The score returned here is a PREVIEW. It never travels the other way:
 * POST /api/entries recomputes it server-side and accepts no score from any
 * request body.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['POST'])
    const user = await requireUser(req, res)

    const body = zAnalyze.parse(req.body)

    // tz_offset_minutes is optional here, since nothing is dated. It is used
    // only so the durable daily budget resets at the caller's own midnight.
    const rawOffset = (req.body as { tz_offset_minutes?: unknown }).tz_offset_minutes
    const offset = rawOffset === undefined ? 0 : zTzOffset.parse(rawOffset)
    const localDay = localDayFromOffset(offset)

    assertBurst(user.email)
    await assertWithinBudget(user.email, localDay)

    if (body.image) {
      // A declared content type is only a claim; check the actual bytes.
      assertImageBytes(Buffer.from(body.image.data_base64, 'base64'), body.image.content_type)
    }

    const result = await analyze({
      ...(body.description !== undefined ? { description: body.description } : {}),
      isHomemade: body.is_homemade,
      ...(body.image
        ? { image: { base64: body.image.data_base64, contentType: body.image.content_type } }
        : {}),
      email: user.email,
      localDay,
    })

    res.status(200).json({
      description: result.description,
      score: result.score,
      rationale: result.rationale,
      positive_factors: result.positiveFactors,
      negative_factors: result.negativeFactors,
      food_detected: result.foodDetected,
      cached: result.cached,
      modifier_sum: result.modifierSum,
      has_trans_fat: result.hasTransFat,
      whole_plant_only: result.wholePlantOnly,
      proxy_ultra_processed: result.proxyUltraProcessed,
      proxy_unidentified_fat: result.proxyUnidentifiedFat,
    })
  } catch (err) {
    return handleError(res, err, 'POST /api/analyze')
  }
}
