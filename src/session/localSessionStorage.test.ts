import { describe, expect, it, vi } from 'vitest'

import { LOCAL_SESSION_ACTION_LOG_LIMIT, LOCAL_SESSION_MESSAGE_LIMIT, LOCAL_SESSION_STORAGE_KEY, createFreshEnvelope, createFreshLocalSession } from './localSessionModel'
import { clearSessionEnvelope, readSessionEnvelope, type StorageLike, writeSessionEnvelope } from './localSessionStorage'

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: vi.fn((key: string) => data[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { data[key] = value }),
    removeItem: vi.fn((key: string) => { delete data[key] }),
  }
}

describe('local session storage', () => {
  it('round trips multiple independent sessions under the versioned key', () => {
    const storage = fakeStorage()
    const envelope = createFreshEnvelope(createFreshLocalSession({ id: 'a', title: 'A' }))
    envelope.sessions.push(createFreshLocalSession({ id: 'b', title: 'B' }))

    expect(writeSessionEnvelope(envelope, storage).ok).toBe(true)
    const read = readSessionEnvelope(storage)

    expect(storage.setItem).toHaveBeenCalledWith(LOCAL_SESSION_STORAGE_KEY, expect.any(String))
    expect(read).toMatchObject({ ok: true, recovered: false })
    if (read.ok) expect(read.envelope?.sessions.map((session) => session.id).sort()).toEqual(['a', 'b'])
  })

  it('surfaces corrupt JSON, schema-invalid data, and unsupported versions without silently removing the blob', () => {
    for (const raw of ['{nope', JSON.stringify({ schemaVersion: 1, selectedSessionId: 'missing', sessions: [] }), JSON.stringify({ schemaVersion: 999, selectedSessionId: 'x', sessions: [] })]) {
      const storage = fakeStorage({ [LOCAL_SESSION_STORAGE_KEY]: raw })
      const read = readSessionEnvelope(storage)

      expect(read).toMatchObject({ ok: false, envelope: null, recovered: false, rawPreserved: true })
      expect(storage.removeItem).not.toHaveBeenCalled()
      expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toBe(raw)
    }
  })

  it('writes only normalized schema-valid histories within message and action-log caps', () => {
    const storage = fakeStorage()
    const session = createFreshLocalSession({
      id: 'selected',
      messages: Array.from({ length: LOCAL_SESSION_MESSAGE_LIMIT + 1 }, (_, index) => ({
        id: `m-${index}`,
        kind: 'user' as const,
        text: `message-${index}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        apiRole: 'user' as const,
      })),
      actionLog: Array.from({ length: LOCAL_SESSION_ACTION_LOG_LIMIT + 1 }, (_, index) => ({
        id: `a-${index}`,
        action: { action: 'add_slide' as const, slide: { title: `Slide ${index}`, content: 'Safe content' } },
        summary: `action-${index}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        result: 'applied' as const,
      })),
    })

    const result = writeSessionEnvelope(createFreshEnvelope(session), storage)

    expect(result.ok).toBe(true)
    const serialized = JSON.parse(storage.data[LOCAL_SESSION_STORAGE_KEY])
    expect(serialized.sessions[0].messages).toHaveLength(LOCAL_SESSION_MESSAGE_LIMIT)
    expect(serialized.sessions[0].messages[0].id).toBe('m-1')
    expect(serialized.sessions[0].actionLog).toHaveLength(LOCAL_SESSION_ACTION_LOG_LIMIT)
    expect(serialized.sessions[0].actionLog[0].id).toBe('a-1')
    expect(readSessionEnvelope(storage)).toMatchObject({ ok: true, recovered: false })
  })

  it('salvages oversized current-version history and repairs selected session without deleting all sessions', () => {
    const oversized = createFreshLocalSession({
      id: 'selected',
      messages: Array.from({ length: LOCAL_SESSION_MESSAGE_LIMIT + 3 }, (_, index) => ({
        id: `m-${index}`,
        kind: 'assistant' as const,
        text: `message-${index}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        apiRole: 'assistant' as const,
      })),
    })
    const raw = JSON.stringify({ schemaVersion: 1, selectedSessionId: 'missing', sessions: [oversized] })
    const storage = fakeStorage({ [LOCAL_SESSION_STORAGE_KEY]: raw })

    const read = readSessionEnvelope(storage)

    expect(read).toMatchObject({ ok: true, recovered: true })
    expect(storage.removeItem).not.toHaveBeenCalled()
    if (read.ok) {
      expect(read.envelope?.selectedSessionId).toBe('selected')
      expect(read.envelope?.sessions[0].messages).toHaveLength(LOCAL_SESSION_MESSAGE_LIMIT)
      expect(read.envelope?.sessions[0].messages[0].id).toBe('m-3')
    }
  })

  it('keeps at most ten sessions and preserves the selected session on write', () => {
    const storage = fakeStorage()
    const sessions = Array.from({ length: 12 }, (_, index) => createFreshLocalSession({
      id: `session-${index}`,
      updatedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      createdAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }))

    const result = writeSessionEnvelope({ schemaVersion: 1, selectedSessionId: 'session-0', sessions }, storage)

    expect(result.ok).toBe(true)
    const serialized = JSON.parse(storage.data[LOCAL_SESSION_STORAGE_KEY])
    expect(serialized.sessions).toHaveLength(10)
    expect(serialized.sessions.map((session: { id: string }) => session.id)).toContain('session-0')
  })

  it('clears all sessions without backend involvement', () => {
    const storage = fakeStorage({ [LOCAL_SESSION_STORAGE_KEY]: JSON.stringify(createFreshEnvelope()) })

    expect(clearSessionEnvelope(storage)).toEqual({ ok: true })

    expect(storage.removeItem).toHaveBeenCalledWith(LOCAL_SESSION_STORAGE_KEY)
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toBeUndefined()
  })

  it('reports active selected-session write failure after quota retry cannot persist', () => {
    const storage = fakeStorage()
    vi.mocked(storage.setItem).mockImplementation(() => { throw Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' }) })
    const envelope = createFreshEnvelope(createFreshLocalSession({ id: 'selected' }))

    const result = writeSessionEnvelope(envelope, storage)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/quota/i)
  })

  it('prunes oldest nonselected sessions until quota permits a save even below the retention limit', () => {
    const storage = fakeStorage()
    const envelope = createFreshEnvelope(createFreshLocalSession({ id: 'selected', updatedAt: '2026-01-01T00:00:00.000Z' }))
    envelope.sessions.push(
      createFreshLocalSession({ id: 'old', updatedAt: '2026-01-02T00:00:00.000Z' }),
      createFreshLocalSession({ id: 'new', updatedAt: '2026-01-03T00:00:00.000Z' }),
    )
    vi.mocked(storage.setItem).mockImplementation((key, value) => {
      if (JSON.parse(value).sessions.length > 1) throw Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' })
      storage.data[key] = value
    })

    const result = writeSessionEnvelope(envelope, storage)

    expect(result).toMatchObject({ ok: true, pruned: true, envelope: { selectedSessionId: 'selected' } })
    expect(result.envelope.sessions.map((session) => session.id)).toEqual(['selected'])
    const attempts = vi.mocked(storage.setItem).mock.calls.map(([, value]) => JSON.parse(value).sessions.map((session: { id: string }) => session.id))
    expect(attempts).toEqual([['new', 'old', 'selected'], ['new', 'selected'], ['selected']])
  })

  it('preserves all in-memory sessions when every quota retry fails', () => {
    const storage = fakeStorage()
    vi.mocked(storage.setItem).mockImplementation(() => { throw Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' }) })
    const envelope = createFreshEnvelope(createFreshLocalSession({ id: 'selected' }))
    envelope.sessions.push(createFreshLocalSession({ id: 'other' }))

    const result = writeSessionEnvelope(envelope, storage)

    expect(result.ok).toBe(false)
    expect(result.envelope.sessions).toHaveLength(2)
    expect(storage.setItem).toHaveBeenCalledTimes(2)
  })

  it('preserves duplicate session identities instead of claiming successful salvage', () => {
    const session = createFreshLocalSession({ id: 'duplicate' })
    const raw = JSON.stringify({ ...createFreshEnvelope(session), sessions: [session, session] })
    const storage = fakeStorage({ [LOCAL_SESSION_STORAGE_KEY]: raw })

    expect(readSessionEnvelope(storage)).toMatchObject({ ok: false, recovered: false, rawPreserved: true })
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toBe(raw)
  })
})
