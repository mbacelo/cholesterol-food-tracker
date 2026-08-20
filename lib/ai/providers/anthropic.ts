import Anthropic from '@anthropic-ai/sdk'
import { requireEnv } from '../../server/errors.js'
import { ANALYSIS_JSON_SCHEMA, zAnalysis } from '../schemas.js'
import type { AIProvider, AnalyzeRequest, ProviderResult } from '../types.js'

/**
 * Claude provider.
 *
 * Note on determinism: tech spec §7 lists `temperature: 0` as a determinism
 * mechanism, but temperature, top_p and top_k are REJECTED WITH A 400 on current
 * Claude models -- they were removed from the request surface. So this provider
 * omits them, and determinism rests on the two mechanisms that do work here:
 * `score_cache` (which makes a repeat byte-identical, a zero-point difference)
 * and a rubric prompt that accumulates modifiers step by step.
 */

const DEFAULT_MODEL = 'claude-sonnet-5'

/**
 * Thinking is on by default on current Claude models and `max_tokens` caps
 * thinking PLUS response text together, so this has to leave room for both. A
 * value sized only for the JSON would truncate the answer mid-object.
 */
const MAX_TOKENS = 16_000

/**
 * Reasoning depth, and the main latency lever.
 *
 * Functional spec §1 asks for "photo, confirm, done, in a few seconds". Measured
 * on this rubric, one uncached analysis takes roughly:
 *
 *     high (the API default) ~17s     medium ~11s     low ~6s
 *
 * `low` is the default here because the quality did not visibly suffer: at `low`
 * the model still infers a chivito's unnamed panceta, jamón, muzzarella and
 * mayonesa from the dish name alone, applies the bought-food assumption, and
 * answers in the description's language. The rubric is mechanical accumulation
 * against an explicit list rather than open-ended reasoning, so depth buys much
 * less here than it costs.
 *
 * Raise it with AI_EFFORT where scoring unusual dishes matters more than speed.
 * Either way, a repeat is a cache hit at ~0.1s.
 */
const DEFAULT_EFFORT = 'low'
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Effort = (typeof EFFORT_LEVELS)[number]

function effort(): Effort {
  const raw = process.env.AI_EFFORT
  return (EFFORT_LEVELS as readonly string[]).includes(raw ?? '')
    ? (raw as Effort)
    : DEFAULT_EFFORT
}

let client: Anthropic | undefined

export function anthropicProvider(): AIProvider {
  const model = process.env.AI_MODEL ?? DEFAULT_MODEL

  return {
    name: 'anthropic',
    model,

    async analyze(request: AnalyzeRequest): Promise<ProviderResult> {
      const apiKey = requireEnv('ANTHROPIC_API_KEY')
      client ??= new Anthropic({ apiKey })

      const started = Date.now()
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: request.systemPrompt,
        // Structured output. Re-validated with Zod below regardless: a provider's
        // strict mode is a strong hint, not a guarantee we should build on.
        output_config: {
          format: { type: 'json_schema', schema: ANALYSIS_JSON_SCHEMA },
          effort: effort(),
        },
        messages: [{ role: 'user', content: buildContent(request) }],
      })
      const latencyMs = Date.now() - started

      if (response.stop_reason === 'refusal') {
        throw new Error('anthropic declined the request')
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')

      if (!text.trim()) {
        throw new Error(
          response.stop_reason === 'max_tokens'
            ? 'anthropic returned no text (max_tokens reached)'
            : 'anthropic returned no text',
        )
      }

      const analysis = zAnalysis.parse(JSON.parse(text))

      return {
        analysis,
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens ?? null,
          outputTokens: response.usage.output_tokens ?? null,
        },
        latencyMs,
      }
    },
  }
}

function buildContent(request: AnalyzeRequest): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = []

  if (request.image) {
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: request.image.contentType,
        data: request.image.base64,
      },
    })
  }

  blocks.push({ type: 'text', text: renderUserTurn(request) })
  return blocks
}

/**
 * The user turn carries only the facts, never instructions -- all behaviour lives
 * in the administrator-editable prompts (functional spec §3.4).
 */
export function renderUserTurn(request: AnalyzeRequest): string {
  const lines = [`is_homemade: ${request.isHomemade}`]
  if (request.description !== undefined) {
    lines.push(`description: ${request.description}`)
  } else {
    lines.push('description: (none supplied; read it from the image)')
  }
  return lines.join('\n')
}

/** Resets the memoized client. Tests only. */
export function resetAnthropicClient(): void {
  client = undefined
}
