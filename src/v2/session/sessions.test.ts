import { describe, expect, it } from 'vitest'

import { STORAGE_KEY, createMessage, createSession, parseStore, retain, writeStore } from './sessions'
import { normalizeDeck } from '../domain/normalize'

const deck = normalizeDeck({ slides: [{ blocks: [{ type: 'heading', text: 'Stored' }] }] }).deck!

function memoryStorage(limit = Number.POSITIVE_INFINITY): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key) },
    setItem: (key, value) => {
      if (value.length > limit) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      data.set(key, value)
    },
  }
}

describe('v2 session store', () => {
  it('round-trips sessions and re-validates decks on load', () => {
    const session = { ...createSession(), deck, messages: [createMessage('user', 'hello')] }
    const storage = memoryStorage()
    expect(writeStore(storage, { version: 1, selectedId: session.id, sessions: [session] })).toEqual({ ok: true, dropped: 0 })
    const loaded = parseStore(storage.getItem(STORAGE_KEY))
    expect(loaded?.sessions[0].deck).toEqual(deck)
    expect(loaded?.sessions[0].messages[0].text).toBe('hello')
  })

  it('degrades corrupted entries instead of failing', () => {
    expect(parseStore('not json')).toBeNull()
    expect(parseStore(JSON.stringify({ version: 9 }))).toBeNull()
    const loaded = parseStore(JSON.stringify({
      version: 1,
      selectedId: 'missing',
      sessions: [{ id: 'a', title: 't', createdAt: '2026-01-01', updatedAt: '2026-01-01', deck: { slides: 'nope' }, messages: [{ bogus: true }] }],
    }))
    expect(loaded?.selectedId).toBe('a')
    expect(loaded?.sessions[0].deck).toBeNull()
    expect(loaded?.sessions[0].messages).toEqual([])
  })

  it('keeps the selected session when trimming to the limit', () => {
    const sessions = Array.from({ length: 5 }, (_, index) => ({ ...createSession(), deck, updatedAt: new Date(2026, 0, index + 1).toISOString() }))
    const trimmed = retain({ version: 1, selectedId: sessions[0].id, sessions }, 3)
    expect(trimmed.sessions).toHaveLength(3)
    expect(trimmed.sessions.some((session) => session.id === sessions[0].id)).toBe(true)
  })

  it('drops the oldest sessions when the browser quota is exceeded', () => {
    const sessions = Array.from({ length: 4 }, (_, index) => ({ ...createSession(), deck, updatedAt: new Date(2026, 0, index + 1).toISOString() }))
    const single = JSON.stringify({ version: 1, selectedId: sessions[3].id, sessions: [sessions[3]] }).length
    const storage = memoryStorage(single * 2.5)
    const result = writeStore(storage, { version: 1, selectedId: sessions[3].id, sessions })
    expect(result.ok).toBe(true)
    const stored = parseStore(storage.getItem(STORAGE_KEY))!
    expect(stored.sessions.length).toBeLessThan(4)
    expect(stored.sessions.some((session) => session.id === sessions[3].id)).toBe(true)
  })
})
