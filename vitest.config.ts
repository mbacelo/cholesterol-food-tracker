import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Kept separate from vite.config.ts on purpose: the unit suites cover pure
 * logic (domain/, lib/, utils/) and have no need for React, Tailwind or the
 * dev API plugin. Loading none of them keeps `npm test` fast.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['domain/**/*.test.ts', 'lib/**/*.test.ts', 'utils/**/*.test.ts'],
    // The fixture suite in lib/ai/ calls the real model and costs money, so it
    // reads RUN_AI_FIXTURES itself and skips unless explicitly enabled.
    passWithNoTests: false,
  },
})
