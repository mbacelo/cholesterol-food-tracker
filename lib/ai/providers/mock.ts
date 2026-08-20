import { zAnalysis, type Analysis, type Factor } from '../schemas.js'
import type { AIProvider, AnalyzeRequest, ProviderResult } from '../types.js'

/**
 * A deterministic, offline provider.
 *
 * Exists so the whole app -- every screen, the save path, the re-score path -- can
 * be built and tested without an API key and without spending money. It applies a
 * crude keyword rubric, which is enough to exercise the PLUMBING: that a score
 * flows from analysis to review screen to stored row, that editing a description
 * changes the result, that the cache key behaves.
 *
 * It is explicitly NOT a model-quality substitute. Judging whether the real
 * rubric is applied well is what the fixture suite against a real provider is
 * for. Never make this the default in a real environment; AI_PROVIDER must name
 * it deliberately.
 */

interface Rule {
  pattern: RegExp
  modifier: number
  label: string
  reason: string
}

const NEGATIVE: Rule[] = [
  { pattern: /margarine|pastry|medialuna|croissant|packaged|doughnut/i, modifier: -3, label: 'Commercial pastry', reason: 'industrial trans fat' },
  { pattern: /cream|butter|cheese|coconut|lard|chicharr|dulce de leche/i, modifier: -3, label: 'Saturated fat base', reason: 'saturated fat' },
  { pattern: /mayonnaise|b[ée]chamel|queso/i, modifier: -2, label: 'Cream sauce', reason: 'saturated fat, secondary' },
  { pattern: /bacon|panceta|chorizo|sausage|salami|ham\b|morcilla/i, modifier: -2, label: 'Processed meat', reason: 'saturated fat, processed meat' },
  { pattern: /fried|milanesa|frita|papas fritas|tempura/i, modifier: -2, label: 'Deep fried', reason: 'deep fried' },
  { pattern: /white rice|white bread|pasta|tallarines|white bun|masa/i, modifier: -1, label: 'Refined grain', reason: 'refined carbohydrate' },
  { pattern: /sugar|dessert|cake|soda|syrup|sweetened/i, modifier: -1, label: 'Added sugar', reason: 'added sugar' },
  { pattern: /liver|kidney|tripe/i, modifier: -1, label: 'Organ meat', reason: 'organ meat' },
]

const POSITIVE: Rule[] = [
  { pattern: /lentil|chickpea|garbanzo|bean|oats|barley|frijol|poroto/i, modifier: 2, label: 'Legumes', reason: 'soluble fiber' },
  { pattern: /olive oil|avocado|nuts|seeds|tahini|aceite de oliva/i, modifier: 2, label: 'Olive oil', reason: 'unsaturated fat' },
  { pattern: /salmon|sardine|mackerel|anchov|trout|jurel/i, modifier: 2, label: 'Fatty fish', reason: 'omega-3 fatty fish' },
  { pattern: /apple|pear|citrus|orange|carrot|flaxseed|aubergine/i, modifier: 1, label: 'Fruit fiber', reason: 'soluble fiber' },
  { pattern: /tofu|tempeh|edamame|soy/i, modifier: 1, label: 'Soy protein', reason: 'soy protein' },
  { pattern: /quinoa|brown rice|whole wheat|whole grain|integral/i, modifier: 1, label: 'Whole grain', reason: 'whole grains' },
  { pattern: /broccoli|spinach|tomato|salad|vegetable|verdura|ensalada|lettuce|pepino/i, modifier: 1, label: 'Vegetables', reason: 'vegetables' },
  { pattern: /chicken|pollo|white fish|shellfish|prawn|egg white|turkey/i, modifier: 1, label: 'Lean protein', reason: 'lean protein' },
]

const NO_FOOD = /^(?:a )?(?:photo of a )?(?:cat|dog|keyboard|screen|room|person|receipt|nothing)$/i

/**
 * Any animal product disqualifies whole_plant_only, which requires that there be
 * no animal product of ANY kind -- dairy, egg, honey, stock or fish sauce
 * included. Without this a lean-chicken dish would pick up the +1 plant floor and
 * mask every other modifier, which is both wrong and hides real differences.
 */
const ANIMAL = /chicken|pollo|beef|pork|fish|salmon|trout|cod|hake|tuna|prawn|shrimp|shellfish|egg|milk|cheese|yoghurt|yogurt|butter|cream|honey|ham|bacon|turkey|lamb|meat/i

export function mockProvider(): AIProvider {
  return {
    name: 'mock',
    model: 'mock-deterministic-1',

    async analyze(request: AnalyzeRequest): Promise<ProviderResult> {
      const started = Date.now()
      const analysis = mockAnalysis(request)
      return {
        analysis,
        model: 'mock-deterministic-1',
        usage: { inputTokens: null, outputTokens: null },
        latencyMs: Date.now() - started,
      }
    },
  }
}

/** Exported so tests can assert the mock's own behaviour without a provider round trip. */
export function mockAnalysis(request: AnalyzeRequest): Analysis {
  const description = request.description ?? 'Mock dish from image'

  if (request.description !== undefined && NO_FOOD.test(request.description.trim())) {
    // A typed non-dish is still food_detected: true, scored 0 -- the image
    // fallback is for images (functional spec §6.1), and telling a user who typed
    // something to "type a description" would be a loop.
    return zAnalysis.parse({
      description,
      score: 0,
      modifier_sum: 0,
      rationale: 'The text does not describe a recognisable dish.',
      positive_factors: [],
      negative_factors: [],
      has_trans_fat: false,
      whole_plant_only: false,
      proxy_ultra_processed: false,
      proxy_unidentified_fat: false,
      food_detected: true,
    })
  }

  const negatives = NEGATIVE.filter((rule) => rule.pattern.test(description))
  const positives = POSITIVE.filter((rule) => rule.pattern.test(description))

  let modifierSum = 0
  for (const rule of [...negatives, ...positives]) modifierSum += rule.modifier

  // Bought food with no named fat picks up the proxy penalty, so the homemade
  // flag visibly changes the result -- which is what the re-score tests need.
  const namesFat = /oil|butter|cream|grilled|steamed|boiled|baked|roasted/i.test(description)
  const proxyUnidentifiedFat = !request.isHomemade && !namesFat
  const proxyUltraProcessed = /packaged|ready meal|instant|fast food/i.test(description)
  if (proxyUnidentifiedFat) modifierSum -= 1
  if (proxyUltraProcessed) modifierSum -= 1

  const hasTransFat = NEGATIVE[0]!.pattern.test(description)
  const wholePlantOnly =
    negatives.length === 0 && positives.length > 0 && !hasTransFat && !ANIMAL.test(description)

  const toFactor = (rule: Rule): Factor => ({ label: rule.label, reason: rule.reason })
  const negativeFactors = negatives.slice(0, 4).map(toFactor)
  if (proxyUnidentifiedFat && negativeFactors.length < 4) {
    negativeFactors.push({ label: 'Bought food', reason: 'cooking fat unknown' })
  }

  return zAnalysis.parse({
    description,
    // The mock's own clamp. domain/scoring.ts recomputes the stored value.
    score: Math.max(-5, Math.min(5, modifierSum)),
    modifier_sum: modifierSum,
    rationale: buildRationale(negatives, positives),
    positive_factors: positives.slice(0, 4).map(toFactor),
    negative_factors: negativeFactors,
    has_trans_fat: hasTransFat,
    whole_plant_only: wholePlantOnly,
    proxy_ultra_processed: proxyUltraProcessed,
    proxy_unidentified_fat: proxyUnidentifiedFat,
    food_detected: true,
  })
}

function buildRationale(negatives: Rule[], positives: Rule[]): string {
  if (negatives.length === 0 && positives.length === 0) {
    return 'Nothing in the description points clearly either way for LDL.'
  }
  const parts: string[] = []
  if (negatives.length > 0) {
    parts.push(`${negatives.map((rule) => rule.label.toLowerCase()).join(' and ')} raise LDL`)
  }
  if (positives.length > 0) {
    parts.push(`${positives.map((rule) => rule.label.toLowerCase()).join(' and ')} help lower it`)
  }
  return `${parts.join(', while ')}.`
}
