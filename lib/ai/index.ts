import { ConfigError } from '../server/errors.js'
import { anthropicProvider } from './providers/anthropic.js'
import { mockProvider } from './providers/mock.js'
import { openAIProvider } from './providers/openai.js'
import type { AIProvider } from './types.js'

/**
 * The single provider switch point (tech spec §7).
 *
 * Adding a provider is one file plus one case here. Prompts and output shape are
 * shared, so every provider extracts identically.
 */
export function getProvider(): AIProvider {
  const name = process.env.AI_PROVIDER
  switch (name) {
    case 'anthropic':
      return anthropicProvider()
    case 'openai':
      return openAIProvider()
    case 'mock':
      return mockProvider()
    default:
      // Fail loudly rather than picking one: a silent default would make the
      // difference between a real, billable model and a stub invisible.
      throw new ConfigError(
        `AI_PROVIDER must be one of anthropic, openai, mock (got ${name ?? 'nothing'})`,
      )
  }
}

export type { AIProvider } from './types.js'
