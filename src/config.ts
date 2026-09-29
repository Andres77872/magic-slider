import { createAppError } from './lib/errors'

export interface AppConfig {
  apiUrl: string
  agentModel: string
  apiKey?: string
  requestTimeoutMs: number
  idleTimeoutMs: number
  maxStreamBytes: number
}

// Image tools may spend over a minute working before the next public SSE event.
// Keep cancellation immediate while allowing the image + deck generation pipeline.
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000
const DEFAULT_IDLE_TIMEOUT_MS = 120_000
const DEFAULT_MAX_STREAM_BYTES = 1_000_000

function readOptionalNumber(env: Record<string, unknown>, key: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const raw = env[key]
  if (raw === undefined || raw === null || raw === '') return fallback

  const value = Number(raw)
  if ((typeof raw !== 'string' && typeof raw !== 'number') || !Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw createAppError({
      category: 'configuration',
      diagnostics: [{ code: 'invalid-env-number', path: key, message: `${key} must be a positive integer no greater than ${maximum}.` }],
    })
  }

  return value
}

function requireString(env: Record<string, unknown>, key: string): string {
  const value = env[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw createAppError({
      category: 'configuration',
      diagnostics: [{ code: 'missing-env', path: key, message: `${key} is required.` }],
    })
  }

  return value.trim()
}

function requireBrowserReachableApiUrl(apiUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(apiUrl)
  } catch {
    throw createAppError({
      category: 'configuration',
      diagnostics: [{ code: 'invalid-env-url', path: 'VITE_API_URL', message: 'VITE_API_URL must be an absolute URL.' }],
    })
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw createAppError({
      category: 'configuration',
      diagnostics: [{ code: 'invalid-env-url', path: 'VITE_API_URL', message: 'VITE_API_URL must be an HTTP or HTTPS URL without embedded credentials or a fragment.' }],
    })
  }

  if (parsed.hostname === '0.0.0.0' || parsed.hostname === '[::]') {
    throw createAppError({
      category: 'configuration',
      diagnostics: [
        {
          code: 'browser-invalid-localhost',
          path: 'VITE_API_URL',
          message: 'VITE_API_URL must use a browser-reachable host such as localhost, not a wildcard bind address (0.0.0.0 or ::).',
        },
      ],
    })
  }

  return apiUrl
}

export function getAppConfig(env: ImportMetaEnv = import.meta.env): AppConfig {
  const envRecord = env as unknown as Record<string, unknown>
  const apiUrl = requireBrowserReachableApiUrl(requireString(envRecord, 'VITE_API_URL'))
  const agentModel = requireString(envRecord, 'VITE_AGENT_MODEL')
  const apiKeyRaw = envRecord.VITE_AGENT_API_KEY
  const apiKey = typeof apiKeyRaw === 'string' && apiKeyRaw.trim() !== '' ? apiKeyRaw.trim() : undefined

  return {
    apiUrl,
    agentModel,
    apiKey,
    requestTimeoutMs: readOptionalNumber(envRecord, 'VITE_AGENT_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS, 2_147_483_647),
    idleTimeoutMs: readOptionalNumber(envRecord, 'VITE_AGENT_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS, 2_147_483_647),
    maxStreamBytes: readOptionalNumber(envRecord, 'VITE_AGENT_MAX_STREAM_BYTES', DEFAULT_MAX_STREAM_BYTES),
  }
}
