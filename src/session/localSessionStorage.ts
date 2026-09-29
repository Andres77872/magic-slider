import {
  LOCAL_SESSION_ACTION_LOG_LIMIT,
  LOCAL_SESSION_MESSAGE_LIMIT,
  LOCAL_SESSION_SCHEMA_VERSION,
  LOCAL_SESSION_STORAGE_KEY,
  applySessionRetention,
  type LocalSessionEnvelope,
  type LocalSession,
  localSessionSchema,
  normalizeLocalSessionEnvelope,
  validateLocalSessionEnvelope,
} from './localSessionModel'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type ReadSessionEnvelopeResult =
  | { ok: true; envelope: LocalSessionEnvelope | null; recovered: boolean; recoveryReason?: string }
  | { ok: false; envelope: null; recovered: boolean; error: Error; recoveryReason?: string; rawPreserved: boolean }

export type WriteSessionEnvelopeResult =
  | { ok: true; envelope: LocalSessionEnvelope; pruned: boolean }
  | { ok: false; envelope: LocalSessionEnvelope; pruned: boolean; error: Error }

export function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function salvageCurrentVersionEnvelope(parsed: unknown): { envelope: LocalSessionEnvelope; reason: string } | null {
  if (!isRecord(parsed) || parsed.schemaVersion !== LOCAL_SESSION_SCHEMA_VERSION || typeof parsed.selectedSessionId !== 'string' || !Array.isArray(parsed.sessions)) {
    return null
  }

  const salvagedSessions: LocalSession[] = []
  for (const rawSession of parsed.sessions) {
    if (!isRecord(rawSession) || rawSession.schemaVersion !== LOCAL_SESSION_SCHEMA_VERSION) continue
    const candidate = {
      ...rawSession,
      messages: Array.isArray(rawSession.messages) ? rawSession.messages.slice(-LOCAL_SESSION_MESSAGE_LIMIT) : rawSession.messages,
      actionLog: Array.isArray(rawSession.actionLog) ? rawSession.actionLog.slice(-LOCAL_SESSION_ACTION_LOG_LIMIT) : rawSession.actionLog,
    }
    const result = localSessionSchema.safeParse(candidate)
    if (result.success) salvagedSessions.push(result.data)
  }

  if (salvagedSessions.length === 0) return null
  const selectedSessionId = salvagedSessions.some((session) => session.id === parsed.selectedSessionId)
    ? parsed.selectedSessionId
    : applySessionRetention({ schemaVersion: LOCAL_SESSION_SCHEMA_VERSION, selectedSessionId: salvagedSessions[0].id, sessions: salvagedSessions }).sessions[0].id
  const envelope = normalizeLocalSessionEnvelope({
    schemaVersion: LOCAL_SESSION_SCHEMA_VERSION,
    selectedSessionId,
    sessions: salvagedSessions,
  })
  // Individual sessions can be valid while the collection still has conflicting
  // identities. Preserve that blob instead of reporting a recovery that cannot save.
  if (!validateLocalSessionEnvelope(envelope)) return null
  return { envelope, reason: 'Recovered oversized or partially invalid local session history by trimming histories and repairing the selected session.' }
}

export function readSessionEnvelope(storage: StorageLike | null = getBrowserStorage()): ReadSessionEnvelopeResult {
  if (!storage) return { ok: true, envelope: null, recovered: false }

  let raw: string | null
  try {
    raw = storage.getItem(LOCAL_SESSION_STORAGE_KEY)
  } catch (cause) {
    return { ok: false, envelope: null, recovered: false, error: asError(cause), rawPreserved: true }
  }

  if (!raw) return { ok: true, envelope: null, recovered: false }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
    const envelope = validateLocalSessionEnvelope(parsed)
    if (envelope) return { ok: true, envelope, recovered: false }
  } catch (cause) {
    return {
      ok: false,
      envelope: null,
      recovered: false,
      error: new Error(`Local session history is not valid JSON: ${asError(cause).message}`),
      recoveryReason: 'Unrecoverable corrupt JSON was preserved for explicit user recovery or clear-history action.',
      rawPreserved: true,
    }
  }

  const salvage = salvageCurrentVersionEnvelope(parsed)
  if (salvage) {
    try {
      storage.setItem(LOCAL_SESSION_STORAGE_KEY, serializeEnvelope(salvage.envelope))
    } catch (cause) {
      return { ok: false, envelope: null, recovered: true, error: asError(cause), recoveryReason: salvage.reason, rawPreserved: true }
    }
    return { ok: true, envelope: salvage.envelope, recovered: true, recoveryReason: salvage.reason }
  }

  return {
    ok: false,
    envelope: null,
    recovered: false,
    error: new Error('Local session history could not be validated or safely recovered.'),
    recoveryReason: 'Unrecoverable local history was preserved. Use Retry, Continue Fresh, or explicit Clear History.',
    rawPreserved: true,
  }
}

function serializeEnvelope(envelope: LocalSessionEnvelope): string {
  const normalized = normalizeLocalSessionEnvelope(envelope)
  const validEnvelope = validateLocalSessionEnvelope(normalized)
  if (!validEnvelope) throw new Error('Refusing to persist invalid local session envelope.')
  return JSON.stringify(validEnvelope)
}

function isQuotaError(error: Error): boolean {
  return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(error.message)
}

export function writeSessionEnvelope(
  envelope: LocalSessionEnvelope,
  storage: StorageLike | null = getBrowserStorage(),
): WriteSessionEnvelopeResult {
  const retained = normalizeLocalSessionEnvelope(envelope)
  if (!storage) return { ok: false, envelope: retained, pruned: false, error: new Error('localStorage is unavailable.') }

  let candidate = retained
  let pruned = false
  for (;;) {
    try {
      storage.setItem(LOCAL_SESSION_STORAGE_KEY, serializeEnvelope(candidate))
      return { ok: true, envelope: candidate, pruned }
    } catch (cause) {
      const error = asError(cause)
      const oldestOtherSession = [...candidate.sessions].reverse().find((session) => session.id !== candidate.selectedSessionId)
      if (!isQuotaError(error) || !oldestOtherSession) {
        // Failed writes must not drop history from the caller's in-memory state.
        return { ok: false, envelope: retained, pruned, error }
      }
      candidate = {
        ...candidate,
        sessions: candidate.sessions.filter((session) => session.id !== oldestOtherSession.id),
      }
      pruned = true
    }
  }
}

export function clearSessionEnvelope(storage: StorageLike | null = getBrowserStorage()): { ok: true } | { ok: false; error: Error } {
  if (!storage) return { ok: true }
  try {
    storage.removeItem(LOCAL_SESSION_STORAGE_KEY)
    return { ok: true }
  } catch (cause) {
    return { ok: false, error: asError(cause) }
  }
}
