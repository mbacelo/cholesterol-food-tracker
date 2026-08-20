import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { devApiPlugin } from './tools/devApiPlugin.js'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Serves the real api/ handlers in-process during `npm run dev`.
    // The endpoint and server-env lists it owns live in tools/devApiPlugin.ts
    // and must be updated in the same commit as any new handler.
    devApiPlugin(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  build: {
    // Every screen is authenticated and unindexable, so there is nothing to
    // pre-render; a plain SPA bundle is the whole output.
    outDir: 'dist',
    sourcemap: true,
  },
})
