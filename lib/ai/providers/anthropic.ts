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

const DEFAULT_MODEL = 'claude-opus-5'

/**
 * Thinking is on by default on current Claude models and `max_tokens` caps
 * thinking PLUS response text together, so this has to leave room for both. A
 * value sized only for the JSON would truncate the answer mid-object.
 */
const MAX_TOKENS = 16_000

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
