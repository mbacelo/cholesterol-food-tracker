/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth client ID. Public by design. */
  readonly VITE_GOOGLE_CLIENT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
