import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'

import { deckTitle, type Deck } from '../domain/deckSchema'
import { normalizeDeck } from '../domain/normalize'

/**
 * Local-only persistence for v2 sessions (a deck plus its conversation).
 * Stored separately from v1 under its own key; every deck is re-validated on
 * load, so a corrupted or outdated entry degrades to an empty session rather
 * than breaking the studio.
 */

export const STORAGE_KEY = 'magic-slider:v2:sessions'
export const SESSION_LIMIT = 12
export const MESSAGE_LIMIT = 160

export type ChatRole = 'user' | 'assistant' | 'status' | 'error'

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  createdAt: string
  details?: string[]
}

export interface Session {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  deck: Deck | null
  messages: ChatMessage[]
}

interface Store {
  version: 1
  selectedId: string
  sessions: Session[]
}

const messageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'status', 'error']),
  text: z.string().max(20_000),
  createdAt: z.string(),
  details: z.array(z.string().max(1_000)).max(40).optional(),
})

const storedSchema = z.object({
  version: z.literal(1),
  selectedId: z.string(),
  sessions: z.array(z.object({
    id: z.string().min(1),
    title: z.string().max(200),
    createdAt: z.string(),
    updatedAt: z.string(),
    deck: z.unknown(),
    messages: z.array(z.unknown()),
  })).max(100),
})

export function newId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

export function createSession(): Session {
  const now = new Date().toISOString()
  return { id: newId('session'), title: 'Untitled presentation', createdAt: now, updatedAt: now, deck: null, messages: [] }
}

export function createMessage(role: ChatRole, text: string, details?: string[]): ChatMessage {
  return { id: newId('msg'), role, text, createdAt: new Date().toISOString(), ...(details?.length ? { details } : {}) }
}

export function parseStore(raw: string | null): Store | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const result = storedSchema.safeParse(parsed)
  if (!result.success) return null
  const sessions: Session[] = result.data.sessions.map((session) => ({
    ...session,
    deck: session.deck ? normalizeDeck(session.deck).deck : null,
    messages: session.messages.flatMap((message) => {
      const checked = messageSchema.safeParse(message)
      return checked.success ? [checked.data] : []
    }).slice(-MESSAGE_LIMIT),
  }))
  if (!sessions.length) return null
  const selectedId = sessions.some((session) => session.id === result.data.selectedId) ? result.data.selectedId : sessions[0].id
  return { version: 1, selectedId, sessions }
}

function byRecency(left: Session, right: Session): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
}

export function retain(store: Store, limit = SESSION_LIMIT): Store {
  const sorted = [...store.sessions].sort(byRecency)
  const kept = sorted.slice(0, limit)
  if (!kept.some((session) => session.id === store.selectedId)) {
    const selected = store.sessions.find((session) => session.id === store.selectedId)
    if (selected) kept.splice(kept.length - 1, 1, selected)
  }
  return { ...store, sessions: kept }
}

function isEmptySession(session: Session): boolean {
  return !session.deck && session.messages.length === 0
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** Serializes the store, dropping the oldest sessions if the browser quota is exceeded. */
export function writeStore(target: Storage, store: Store): { ok: true; dropped: number } | { ok: false; error: string } {
  const persistable = { ...store, sessions: store.sessions.filter((session) => !isEmptySession(session) || session.id === store.selectedId) }
  let candidate = retain(persistable)
  let dropped = 0
  for (;;) {
    try {
      target.setItem(STORAGE_KEY, JSON.stringify(candidate))
      return { ok: true, dropped }
    } catch (error) {
      if (candidate.sessions.length <= 1) return { ok: false, error: error instanceof Error ? error.message : String(error) }
      candidate = retain(candidate, candidate.sessions.length - 1)
      dropped += 1
    }
  }
}

/**
 * Merges what another tab saved with this tab's store: sessions are matched by
 * id and the most recently updated copy wins; sessions this tab deleted stay
 * deleted, and this tab keeps its own selection.
 */
export function mergeStores(local: Store, stored: Store | null, deleted: ReadonlySet<string> = new Set()): Store {
  if (!stored) return local
  const byId = new Map<string, Session>()
  for (const session of stored.sessions) if (!deleted.has(session.id)) byId.set(session.id, session)
  for (const session of local.sessions) {
    const other = byId.get(session.id)
    if (!other || Date.parse(session.updatedAt) >= Date.parse(other.updatedAt)) byId.set(session.id, session)
  }
  const sessions = [...byId.values()]
  const selectedId = sessions.some((session) => session.id === local.selectedId) ? local.selectedId : sessions[0]?.id ?? local.selectedId
  return { version: 1, selectedId, sessions }
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: string
  slideCount: number
  theme?: string
}

export function useSessions() {
  const [store, setStore] = useState<Store>(() => {
    const target = storage()
    const loaded = target ? parseStore(target.getItem(STORAGE_KEY)) : null
    if (loaded) return loaded
    const session = createSession()
    return { version: 1, selectedId: session.id, sessions: [session] }
  })
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(store)
  latest.current = store
  // Only this tab's own changes are written; other tabs' saves are merged, never overwritten.
  const dirty = useRef(false)
  const deleted = useRef(new Set<string>())
  const change = useCallback((update: (previous: Store) => Store) => {
    dirty.current = true
    setStore(update)
  }, [])

  const flush = useCallback(() => {
    const target = storage()
    if (!target || !dirty.current) return
    const merged = mergeStores(latest.current, parseStore(target.getItem(STORAGE_KEY)), deleted.current)
    const result = writeStore(target, merged)
    if (result.ok) dirty.current = false
    setPersistenceError(!result.ok
      ? `Changes could not be saved in this browser (${result.error}). Export your deck to keep it.`
      : result.dropped
        ? `Browser storage is full: ${result.dropped} older session${result.dropped === 1 ? ' was' : 's were'} not saved. Export decks you want to keep.`
        : null)
  }, [])

  useEffect(() => {
    if (!dirty.current) return undefined
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [store, flush])

  useEffect(() => {
    const onHide = () => flush()
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      const stored = parseStore(event.newValue)
      if (stored) setStore((previous) => mergeStores(previous, stored, deleted.current))
    }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('storage', onStorage)
    }
  }, [flush])

  const current = store.sessions.find((session) => session.id === store.selectedId) ?? store.sessions[0]

  const updateSession = useCallback((sessionId: string, update: (session: Session) => Session) => {
    change((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => {
        if (session.id !== sessionId) return session
        const next = update(session)
        const title = next.deck ? deckTitle(next.deck) : next.title
        return { ...next, title: title.slice(0, 120), updatedAt: new Date().toISOString(), messages: next.messages.slice(-MESSAGE_LIMIT) }
      }),
    }))
  }, [change])

  const setDeck = useCallback((sessionId: string, deck: Deck | null) => updateSession(sessionId, (session) => ({ ...session, deck })), [updateSession])
  const appendMessages = useCallback((sessionId: string, messages: ChatMessage[]) => updateSession(sessionId, (session) => ({ ...session, messages: [...session.messages, ...messages] })), [updateSession])
  const renameFromPrompt = useCallback((sessionId: string, prompt: string) => updateSession(sessionId, (session) => (
    session.title === 'Untitled presentation' && !session.deck ? { ...session, title: prompt.replace(/\s+/g, ' ').trim().slice(0, 60) || session.title } : session
  )), [updateSession])

  const createAndSelect = useCallback((deck: Deck | null = null) => {
    const session = { ...createSession(), deck, ...(deck ? { title: deckTitle(deck) } : {}) }
    change((previous) => ({
      ...previous,
      selectedId: session.id,
      sessions: [session, ...previous.sessions.filter((candidate) => !isEmptySession(candidate))],
    }))
    return session.id
  }, [change])

  const select = useCallback((sessionId: string) => change((previous) => (
    previous.sessions.some((session) => session.id === sessionId) ? { ...previous, selectedId: sessionId } : previous
  )), [change])

  const remove = useCallback((sessionId: string) => {
    deleted.current.add(sessionId)
    change((previous) => {
      const sessions = previous.sessions.filter((session) => session.id !== sessionId)
      // Deleting the open session starts a fresh one rather than silently opening another deck.
      if (!sessions.length || previous.selectedId === sessionId) {
        const fresh = createSession()
        return { ...previous, selectedId: fresh.id, sessions: [fresh, ...sessions] }
      }
      return { ...previous, sessions }
    })
  }, [change])

  const summaries: SessionSummary[] = useMemo(() => [...store.sessions]
    .filter((session) => !isEmptySession(session))
    .sort(byRecency)
    .map((session) => ({ id: session.id, title: session.title, updatedAt: session.updatedAt, slideCount: session.deck?.slides.length ?? 0, theme: session.deck?.theme?.preset })), [store.sessions])

  return { current, summaries, persistenceError, setDeck, appendMessages, renameFromPrompt, createAndSelect, select, remove, flush }
}
