/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Required frontend agent API endpoint. */
  readonly VITE_API_URL: string
  /** Required provider/agent model identifier sent in the request body. */
  readonly VITE_AGENT_MODEL: string
  /** Optional real API credential; blank/omitted values are not sent as Authorization. */
  readonly VITE_AGENT_API_KEY?: string
  /** Optional positive total request timeout in milliseconds. */
  readonly VITE_AGENT_REQUEST_TIMEOUT_MS?: string
  /** Optional positive idle stream timeout in milliseconds. */
  readonly VITE_AGENT_IDLE_TIMEOUT_MS?: string
  /** Optional positive maximum streamed response size in bytes. */
  readonly VITE_AGENT_MAX_STREAM_BYTES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
