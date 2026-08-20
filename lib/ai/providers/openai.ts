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
 * Unlike the Claude path, `temperature: 0` IS accepted here, so tech spec §7's
 * second determinism mechanism applies on this provider. Use a non-reasoning
 * multimodal model: reasoning models reject temperature.
 */

const DEFAULT_MODEL = 'gpt-4.1'

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
        temperature: 0,
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
