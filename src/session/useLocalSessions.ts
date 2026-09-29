import { useEffect, useMemo, useRef, useState } from 'react'

import {
  capLocalSessionActionLog,
  capLocalSessionMessages,
  createFreshEnvelope,
  createFreshLocalSession,
  createLocalSessionMessage,
  createSessionId,
  getSelectedSession,
  hasRestorableLocalSessions,
  isRestorableLocalSession,
  nowIso,
  normalizeLocalSessionEnvelope,
  sortSessionsByRecency,
  summarizeLocalSessions,
  titleFromPrompt,
  type LocalSession,
  type LocalSessionActionLogEntry,
  type LocalSessionEnvelope,
  type LocalSessionMessage,
  type LocalSessionSummary,
} from './localSessionModel'
import { clearSessionEnvelope, getBrowserStorage, readSessionEnvelope, type StorageLike, writeSessionEnvelope } from './localSessionStorage'

export type PersistenceStatus = 'idle' | 'hydrating' | 'ready' | 'recovered' | 'failed'
export type PersistenceFailureKind = 'read' | 'write' | 'clear'

export type UseLocalSessionsResult = {
  selectedSessionId: string
  selectedSession: LocalSession
  sessions: LocalSession[]
  sessionSummaries: LocalSessionSummary[]
  persistenceStatus: PersistenceStatus
  persistenceError: string | null
  persistenceFailureKind: PersistenceFailureKind | null
  canMutateLocalHistory: boolean
  updateSelectedSession: (updater: (session: LocalSession) => LocalSession, options?: { flush?: boolean }) => void
  updateSessionById: (sessionId: string, updater: (session: LocalSession) => LocalSession, options?: { flush?: boolean }) => void
  appendMessageToSelected: (message: Omit<LocalSessionMessage, 'id' | 'createdAt'>, options?: { flush?: boolean }) => void
  appendMessagesToSession: (sessionId: string, messages: Array<Omit<LocalSessionMessage, 'id' | 'createdAt'>>, options?: { flush?: boolean }) => void
  updateLatestAssistantMessageInSelected: (text: string) => void
  recordActionInSelected: (entry: Omit<LocalSessionActionLogEntry, 'id' | 'createdAt'>, options?: { flush?: boolean }) => void
  createAndSelectSession: () => string
  selectSession: (sessionId: string) => void
  clearHistory: () => boolean
  retryPersistenceHydration: () => void
  continueFreshAfterPersistenceFailure: () => void
}

export type UseLocalSessionsOptions = {
  storage?: StorageLike | null
  persistDelayMs?: number
}

function touch(session: LocalSession): LocalSession {
  return { ...session, updatedAt: nowIso() }
}

function statusAllowsMutation(status: PersistenceStatus, failureKind: PersistenceFailureKind | null): boolean {
  return status === 'ready' || status === 'recovered' || (status === 'failed' && failureKind === 'write')
}

export function useLocalSessions(options: UseLocalSessionsOptions = {}): UseLocalSessionsResult {
  const storage = options.storage === undefined ? getBrowserStorage() : options.storage
  const persistDelayMs = options.persistDelayMs ?? 250
  const [envelope, setEnvelope] = useState<LocalSessionEnvelope>(() => createFreshEnvelope())
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('hydrating')
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const [persistenceFailureKind, setPersistenceFailureKind] = useState<PersistenceFailureKind | null>(null)
  const hydratedRef = useRef(false)
  const persistenceWritesAllowedRef = useRef(false)
  const statusRef = useRef<PersistenceStatus>('hydrating')
  const failureKindRef = useRef<PersistenceFailureKind | null>(null)
  const dirtyRef = useRef(false)
  const envelopeRef = useRef(envelope)

  const setPersistenceState = (status: PersistenceStatus, error: string | null, failureKind: PersistenceFailureKind | null = null) => {
    statusRef.current = status
    failureKindRef.current = failureKind
    persistenceWritesAllowedRef.current = status === 'ready' || status === 'recovered'
    setPersistenceStatus(status)
    setPersistenceError(error)
    setPersistenceFailureKind(failureKind)
  }

  const flushEnvelope = (nextEnvelope: LocalSessionEnvelope) => {
    if (!persistenceWritesAllowedRef.current || !dirtyRef.current) return
    if (!hasRestorableLocalSessions(nextEnvelope)) {
      const cleared = clearSessionEnvelope(storage)
      if (cleared.ok) {
        dirtyRef.current = false
        setPersistenceState('ready', null)
      } else {
        setPersistenceState('failed', cleared.error.message, 'write')
      }
      return
    }

    const result = writeSessionEnvelope(nextEnvelope, storage)
    if (result.ok) {
      dirtyRef.current = false
      setPersistenceState(result.pruned ? 'recovered' : 'ready', result.pruned ? 'Saved your current presentation after removing older sessions to free browser storage.' : null)
      envelopeRef.current = result.envelope
      setEnvelope(result.envelope)
      return
    }
    setPersistenceState('failed', result.error.message, 'write')
  }

  const hydrateFromStorage = () => {
    setPersistenceState('hydrating', null)
    persistenceWritesAllowedRef.current = false
    const result = readSessionEnvelope(storage)
    hydratedRef.current = true
    if (result.ok) {
      dirtyRef.current = false
      const next = result.envelope ?? createFreshEnvelope()
      envelopeRef.current = next
      setEnvelope(next)
      setPersistenceState(
        result.recovered ? 'recovered' : 'ready',
        result.recovered ? result.recoveryReason ?? 'Recovered local presentation history.' : null,
      )
      return
    }
    setPersistenceState('failed', result.recoveryReason ? `${result.error.message} ${result.recoveryReason}` : result.error.message, 'read')
  }

  useEffect(() => {
    hydrateFromStorage()
  }, [storage])

  useEffect(() => {
    if (!hydratedRef.current || !dirtyRef.current) return undefined
    const timer = window.setTimeout(() => flushEnvelope(envelopeRef.current), persistDelayMs)
    return () => window.clearTimeout(timer)
  }, [envelope, persistDelayMs])

  useEffect(() => {
    const flushCurrentEnvelope = () => flushEnvelope(envelopeRef.current)
    window.addEventListener('pagehide', flushCurrentEnvelope)
    window.addEventListener('beforeunload', flushCurrentEnvelope)
    return () => {
      window.removeEventListener('pagehide', flushCurrentEnvelope)
      window.removeEventListener('beforeunload', flushCurrentEnvelope)
    }
  }, [storage])

  const mutateEnvelope = (updater: (current: LocalSessionEnvelope) => LocalSessionEnvelope, options?: { flush?: boolean }) => {
    if (!statusAllowsMutation(statusRef.current, failureKindRef.current)) {
      setPersistenceState(statusRef.current, statusRef.current === 'hydrating'
        ? 'Local presentation history is still loading. Wait for recovery before changing sessions or generating.'
        : 'Local presentation history is unavailable. Retry, continue fresh, or explicitly clear history before making changes.', failureKindRef.current)
      return
    }
    const updated = updater(envelopeRef.current)
    if (updated === envelopeRef.current) return
    const next = normalizeLocalSessionEnvelope(updated)
    dirtyRef.current = true
    envelopeRef.current = next
    setEnvelope(next)
    if (options?.flush) flushEnvelope(next)
  }

  const updateSessionById: UseLocalSessionsResult['updateSessionById'] = (sessionId, updater, options) => {
    mutateEnvelope((current) => ({
      ...current,
      sessions: current.sessions.map((session) => session.id === sessionId ? touch(updater(session)) : session),
    }), options)
  }

  const updateSelectedSession: UseLocalSessionsResult['updateSelectedSession'] = (updater, options) => {
    updateSessionById(envelopeRef.current.selectedSessionId, updater, options)
  }

  const appendMessagesToSession: UseLocalSessionsResult['appendMessagesToSession'] = (sessionId, messages, options) => {
    if (messages.length === 0) return
    updateSessionById(sessionId, (session) => {
      const nextMessages = messages.map(createLocalSessionMessage)
      const firstUserMessage = !session.messages.some((message) => message.kind === 'user')
        ? nextMessages.find((message) => message.kind === 'user')
        : undefined
      return {
        ...session,
        title: firstUserMessage ? titleFromPrompt(firstUserMessage.text) : session.title,
        messages: capLocalSessionMessages([...session.messages, ...nextMessages]),
      }
    }, options)
  }

  const appendMessageToSelected: UseLocalSessionsResult['appendMessageToSelected'] = (message, options) => {
    appendMessagesToSession(envelopeRef.current.selectedSessionId, [message], options)
  }

  const updateLatestAssistantMessageInSelected: UseLocalSessionsResult['updateLatestAssistantMessageInSelected'] = (text) => {
    updateSelectedSession((session) => {
      const messages = [...session.messages]
      const index = [...messages].reverse().findIndex((message) => message.kind === 'assistant')
      if (index < 0) return session
      const actualIndex = messages.length - 1 - index
      messages[actualIndex] = { ...messages[actualIndex], text }
      return { ...session, messages: capLocalSessionMessages(messages) }
    })
  }

  const recordActionInSelected: UseLocalSessionsResult['recordActionInSelected'] = (entry, options) => {
    updateSelectedSession((session) => ({
      ...session,
      actionLog: capLocalSessionActionLog([...session.actionLog, { ...entry, id: createSessionId(), createdAt: nowIso() }]),
    }), options)
  }

  const createAndSelectSession = () => {
    if (!statusAllowsMutation(statusRef.current, failureKindRef.current)) {
      setPersistenceState(statusRef.current, statusRef.current === 'hydrating'
        ? 'Local presentation history is still loading. Wait before starting a new presentation.'
        : 'Local presentation history is unavailable. Retry, continue fresh, or explicitly clear history before starting a new presentation.', failureKindRef.current)
      return envelopeRef.current.selectedSessionId
    }
    const session = createFreshLocalSession()
    mutateEnvelope((current) => ({
      ...current,
      selectedSessionId: session.id,
      sessions: sortSessionsByRecency([session, ...current.sessions.filter(isRestorableLocalSession)]),
    }), { flush: true })
    return session.id
  }

  const selectSession = (sessionId: string) => {
    mutateEnvelope((current) => current.sessions.some((session) => session.id === sessionId)
      ? { ...current, selectedSessionId: sessionId }
      : current, { flush: true })
  }

  const clearHistory = () => {
    const cleared = clearSessionEnvelope(storage)
    if (!cleared.ok) {
      setPersistenceState('failed', cleared.error.message, 'clear')
      return false
    }
    const fresh = createFreshEnvelope()
    envelopeRef.current = fresh
    setEnvelope(fresh)
    hydratedRef.current = true
    dirtyRef.current = false
    setPersistenceState('ready', null)
    return true
  }

  const retryPersistenceHydration = () => {
    if (statusRef.current !== 'failed') return
    if (failureKindRef.current === 'write') {
      setPersistenceState('ready', null)
      flushEnvelope(envelopeRef.current)
      return
    }
    if (failureKindRef.current === 'clear') {
      clearHistory()
      return
    }
    hydratedRef.current = false
    hydrateFromStorage()
  }

  const continueFreshAfterPersistenceFailure = () => {
    if (statusRef.current !== 'failed') return
    const fresh = createFreshEnvelope()
    envelopeRef.current = fresh
    setEnvelope(fresh)
    hydratedRef.current = true
    dirtyRef.current = false
    setPersistenceState('ready', 'Continuing with a fresh local history. Export localStorage before continuing if you still need the unrecoverable stored data; future saves may overwrite it.')
  }

  const selectedSession = getSelectedSession(envelope)
  const sessionSummaries = useMemo(() => summarizeLocalSessions(envelope.sessions), [envelope.sessions])

  return {
    selectedSessionId: envelope.selectedSessionId,
    selectedSession,
    sessions: envelope.sessions,
    sessionSummaries,
    persistenceStatus,
    persistenceError,
    persistenceFailureKind,
    canMutateLocalHistory: statusAllowsMutation(persistenceStatus, persistenceFailureKind),
    updateSelectedSession,
    updateSessionById,
    appendMessageToSelected,
    appendMessagesToSession,
    updateLatestAssistantMessageInSelected,
    recordActionInSelected,
    createAndSelectSession,
    selectSession,
    clearHistory,
    retryPersistenceHydration,
    continueFreshAfterPersistenceFailure,
  }
}
