import OpenAI from 'openai'
import { requireEnv } from '../../server/errors.js'
import { ANALYSIS_JSON_SCHEMA, zAnalysis } from '../schemas.js'
import type { AIProvider, AnalyzeRequest, ProviderResult } from '../types.js'
import { renderUserTurn } from './anthropic.js'

/**
 * OpenAI provider, on the Responses API.
 *
 * `store: false` because a food photo and its description are the user's private
 * data and must not be retained by the provider for any purpose the user has not
 * agreed to (functional spec §6.10).
 *
 * On determinism: `temperature: 0` (tech spec §7's second mechanism) is NOT sent
 * here. Current gpt-5.x models accept it only while reasoning effort is `none`,
 * and reasoning buys more scoring quality than temperature buys stability -- so
 * this provider reasons and drops the temperature, exactly as the Claude path
 * does. Determinism rests on `score_cache` and the step-by-step rubric.
 */

const DEFAULT_MODEL = 'gpt-5.6-luna'

/**
 * Reasoning depth, and the main latency and cost lever. `low` by default, to
 * match the Claude path: enough reasoning to work the rubric, without paying for
 * depth this mechanical accumulation does not need. Effort is always sent
 * explicitly, since these models otherwise default to `medium`. `none` is a legal
 * value here and not on the Claude path.
 */
const DEFAULT_EFFORT = 'low'
const EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const
type Effort = (typeof EFFORT_LEVELS)[number]

function effort(): Effort {
  const raw = process.env.AI_EFFORT
  return (EFFORT_LEVELS as readonly string[]).includes(raw ?? '')
    ? (raw as Effort)
    : DEFAULT_EFFORT
}

let client: OpenAI | undefined

export function openAIProvider(): AIProvider {
  const model = process.env.AI_MODEL ?? DEFAULT_MODEL

  return {
    name: 'openai',
    model,

    async analyze(request: AnalyzeRequest): Promise<ProviderResult> {
      const apiKey = requireEnv('OPENAI_API_KEY')
      client ??= new OpenAI({ apiKey })

      const content: OpenAI.Responses.ResponseInputContent[] = []
      if (request.image) {
        content.push({
          type: 'input_image',
          detail: 'auto',
          // The Responses API takes a data URL here; the wire format elsewhere in
          // this app is raw base64, so it is wrapped only at the boundary.
          image_url: `data:${request.image.contentType};base64,${request.image.base64}`,
        })
      }
      content.push({ type: 'input_text', text: renderUserTurn(request) })

      const started = Date.now()
      const response = await client.responses.create({
        model,
        reasoning: { effort: effort() },
        store: false,
        instructions: request.systemPrompt,
        input: [{ role: 'user', content }],
        text: {
          format: {
            type: 'json_schema',
            name: 'food_analysis',
            strict: true,
            schema: ANALYSIS_JSON_SCHEMA,
          },
        },
      })
      const latencyMs = Date.now() - started

      const text = response.output_text
      if (!text?.trim()) throw new Error('openai returned no text')

      const analysis = zAnalysis.parse(JSON.parse(text))

      return {
        analysis,
        model: response.model,
        usage: {
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
        },
        latencyMs,
      }
    },
  }
}

/** Resets the memoized client. Tests only. */
export function resetOpenAIClient(): void {
  client = undefined
}
