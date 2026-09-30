import { getAppConfig } from '../config'
import { createAppError } from '../lib/errors'
import type { AgentConfig } from './agent/agentClient'

/**
 * v2 reuses the v1 endpoint validation and credentials but needs its own
 * agent: VITE_AGENT_MODEL_V2 is the public agt-* id of the v2 graph.
 * VITE_API_URL_V2 optionally points v2 at a different endpoint.
 * Generation takes longer (research, images and a richer deck), so the
 * default time limits are higher than v1's.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 480_000
const DEFAULT_IDLE_TIMEOUT_MS = 150_000
// Streamed tool arguments arrive a few characters per SSE event (~300 bytes of framing each).
const DEFAULT_MAX_STREAM_BYTES = 12_000_000

/** Largest delay setTimeout honours; longer values would fire immediately. */
const MAX_TIMER_MS = 2_147_483_647

function positive(env: Record<string, unknown>, key: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const raw = env[key]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw createAppError({ category: 'configuration', diagnostics: [{ code: 'invalid-env-number', path: key, message: `${key} must be a positive integer no greater than ${maximum}.` }] })
  }
  return value
}

export function getV2Config(env: ImportMetaEnv = import.meta.env): AgentConfig {
  const record = env as unknown as Record<string, unknown>
  const model = typeof record.VITE_AGENT_MODEL_V2 === 'string' ? record.VITE_AGENT_MODEL_V2.trim() : ''
  if (!model) {
    throw createAppError({ category: 'configuration', diagnostics: [{ code: 'missing-env', path: 'VITE_AGENT_MODEL_V2', message: 'VITE_AGENT_MODEL_V2 is required for Magic Slider v2.' }] })
  }
  const apiUrlV2 = typeof record.VITE_API_URL_V2 === 'string' && record.VITE_API_URL_V2.trim() ? record.VITE_API_URL_V2.trim() : undefined
  // Validates URL shape and credentials exactly like v1.
  const base = getAppConfig({ ...env, VITE_AGENT_MODEL: model, ...(apiUrlV2 ? { VITE_API_URL: apiUrlV2 } : {}) } as ImportMetaEnv)
  return {
    apiUrl: base.apiUrl,
    agentModel: model,
    apiKey: base.apiKey,
    requestTimeoutMs: positive(record, 'VITE_AGENT_V2_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS, MAX_TIMER_MS),
    idleTimeoutMs: positive(record, 'VITE_AGENT_V2_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS, MAX_TIMER_MS),
    maxStreamBytes: positive(record, 'VITE_AGENT_V2_MAX_STREAM_BYTES', DEFAULT_MAX_STREAM_BYTES),
  }
}
