import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFreshEnvelope, createFreshLocalSession, LOCAL_SESSION_ACTION_LOG_LIMIT, LOCAL_SESSION_MESSAGE_LIMIT } from './localSessionModel'
import { LOCAL_SESSION_STORAGE_KEY } from './localSessionModel'
import type { StorageLike } from './localSessionStorage'
import { useLocalSessions, type UseLocalSessionsResult } from './useLocalSessions'

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: vi.fn((key: string) => data[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { data[key] = value }),
    removeItem: vi.fn((key: string) => { delete data[key] }),
  }
}

function Harness({ storage, onReady }: { storage: StorageLike; onReady: (result: UseLocalSessionsResult) => void }) {
  const result = useLocalSessions({ storage, persistDelayMs: 1 })
  onReady(result)
  return <div data-testid="selected-title">{result.selectedSession.title}</div>
}

describe('useLocalSessions', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('hydrates the selected session from valid multi-session storage', async () => {
    const selected = createFreshLocalSession({ id: 'b', title: 'Selected B', messages: [{ id: 'm', kind: 'user', text: 'B prompt', createdAt: '2026-01-01T00:00:00.000Z', apiRole: 'user' }] })
    const envelope = createFreshEnvelope(createFreshLocalSession({ id: 'a', title: 'A' }))
    envelope.sessions.push(selected)
    envelope.selectedSessionId = 'b'
    const storage = fakeStorage({ [LOCAL_SESSION_STORAGE_KEY]: JSON.stringify(envelope) })

    render(<Harness storage={storage} onReady={() => undefined} />)

    expect(await screen.findByText('Selected B')).toBeInTheDocument()
  })

  it('saves each change once without a recurring autosave loop or hydration rewrite', () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    const { result } = renderHook(() => useLocalSessions({ storage, persistDelayMs: 10 }))

    act(() => { vi.advanceTimersByTime(100) })
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()

    act(() => { result.current.appendMessageToSelected({ kind: 'user', text: 'Save once', apiRole: 'user' }) })
    act(() => { vi.advanceTimersByTime(10) })
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(100) })
    expect(storage.setItem).toHaveBeenCalledTimes(1)

    act(() => { result.current.appendMessageToSelected({ kind: 'assistant', text: 'Immediate save', apiRole: 'assistant' }, { flush: true }) })
    act(() => { vi.advanceTimersByTime(100) })
    expect(storage.setItem).toHaveBeenCalledTimes(2)
  })

  it('keeps new work in memory after a write failure and Retry saves it without rehydrating stale data', () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    const { result } = renderHook(() => useLocalSessions({ storage, persistDelayMs: 10 }))
    act(() => { result.current.appendMessageToSelected({ kind: 'user', text: 'Saved prompt', apiRole: 'user' }, { flush: true }) })
    vi.mocked(storage.setItem).mockImplementationOnce(() => { throw new Error('Storage temporarily unavailable') })

    act(() => { result.current.appendMessageToSelected({ kind: 'assistant', text: 'Unsaved answer', apiRole: 'assistant' }, { flush: true }) })
    expect(result.current.persistenceFailureKind).toBe('write')
    expect(result.current.canMutateLocalHistory).toBe(true)
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).not.toContain('Unsaved answer')

    act(() => { result.current.updateSelectedSession((session) => ({ ...session, currentDeckSnapshot: { slides: [{ title: 'Finished deck' }] } }), { flush: true }) })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current.selectedSession.currentDeckSnapshot?.slides[0].title).toBe('Finished deck')
    expect(result.current.persistenceStatus).toBe('failed')
    expect(storage.setItem).toHaveBeenCalledTimes(2)

    act(() => { result.current.retryPersistenceHydration() })
    expect(result.current.persistenceStatus).toBe('ready')
    expect(result.current.persistenceFailureKind).toBeNull()
    expect(result.current.selectedSession.messages).toHaveLength(2)
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toContain('Unsaved answer')
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toContain('Finished deck')
    expect(storage.getItem).toHaveBeenCalledTimes(1)
  })

  it('preserves the current session on a failed clear and Retry repeats the clear operation', () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    const { result } = renderHook(() => useLocalSessions({ storage }))
    act(() => { result.current.appendMessageToSelected({ kind: 'user', text: 'Keep this until clear succeeds' }, { flush: true }) })
    const selectedId = result.current.selectedSessionId
    vi.mocked(storage.removeItem).mockImplementationOnce(() => { throw new Error('Cannot clear storage') })

    act(() => { expect(result.current.clearHistory()).toBe(false) })
    expect(result.current.persistenceFailureKind).toBe('clear')
    expect(result.current.selectedSessionId).toBe(selectedId)
    expect(result.current.selectedSession.messages).toHaveLength(1)
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toContain('Keep this until clear succeeds')

    act(() => { result.current.retryPersistenceHydration() })
    expect(result.current.persistenceStatus).toBe('ready')
    expect(result.current.selectedSession.messages).toHaveLength(0)
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toBeUndefined()
  })

  it('flushes pending changes when the page is hidden and does not save again when it unloads', () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    const { result } = renderHook(() => useLocalSessions({ storage }))
    act(() => { result.current.appendMessageToSelected({ kind: 'user', text: 'Pending change' }) })
    expect(storage.setItem).not.toHaveBeenCalled()

    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toContain('Pending change')
    act(() => { window.dispatchEvent(new Event('beforeunload')) })
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it('does not evict saved presentations when repeatedly starting empty sessions', () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    const { result } = renderHook(() => useLocalSessions({ storage }))
    act(() => { result.current.appendMessageToSelected({ kind: 'user', text: 'Saved presentation' }, { flush: true }) })
    const savedId = result.current.selectedSessionId

    act(() => {
      for (let index = 0; index < 15; index += 1) result.current.createAndSelectSession()
    })

    expect(result.current.sessions).toHaveLength(2)
    expect(result.current.sessions.some((session) => session.id === savedId)).toBe(true)
  })

  it('keeps an unrecoverable stored blob until the user changes a fresh session', () => {
    vi.useFakeTimers()
    const storage = fakeStorage({ [LOCAL_SESSION_STORAGE_KEY]: '{corrupt' })
    const { result } = renderHook(() => useLocalSessions({ storage, persistDelayMs: 10 }))

    act(() => { result.current.continueFreshAfterPersistenceFailure() })
    act(() => { vi.advanceTimersByTime(100) })
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toBe('{corrupt')
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('creates, switches, clears, and keeps Clear History storage empty for a fresh session', async () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    let current: UseLocalSessionsResult | null = null
    const result = () => {
      if (!current) throw new Error('Hook result was not captured.')
      return current
    }
    render(<Harness storage={storage} onReady={(result) => { current = result }} />)

    await act(async () => { result().appendMessageToSelected({ kind: 'user', text: 'First prompt', apiRole: 'user' }, { flush: true }) })
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toContain('First prompt')

    await act(async () => { result().createAndSelectSession() })
    expect(result().selectedSession.messages).toHaveLength(0)

    await act(async () => { result().clearHistory() })
    expect(result().sessionSummaries).toHaveLength(0)
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toBeUndefined()
  })

  it('caps appended messages before hook state and storage become flushable', async () => {
    const storage = fakeStorage()
    let current: UseLocalSessionsResult | null = null
    const result = () => {
      if (!current) throw new Error('Hook result was not captured.')
      return current
    }
    render(<Harness storage={storage} onReady={(result) => { current = result }} />)

    await act(async () => {
      result().appendMessagesToSession(result().selectedSessionId, Array.from({ length: LOCAL_SESSION_MESSAGE_LIMIT + 2 }, (_, index) => ({
        kind: 'user' as const,
        text: `prompt-${index}`,
        apiRole: 'user' as const,
      })), { flush: true })
    })

    expect(result().selectedSession.messages).toHaveLength(LOCAL_SESSION_MESSAGE_LIMIT)
    expect(result().selectedSession.messages[0].text).toBe('prompt-2')
    const stored = JSON.parse(storage.data[LOCAL_SESSION_STORAGE_KEY])
    expect(stored.sessions[0].messages).toHaveLength(LOCAL_SESSION_MESSAGE_LIMIT)
  })

  it('caps recorded action-log entries before hook state and storage become flushable', async () => {
    const storage = fakeStorage()
    let current: UseLocalSessionsResult | null = null
    const result = () => {
      if (!current) throw new Error('Hook result was not captured.')
      return current
    }
    render(<Harness storage={storage} onReady={(result) => { current = result }} />)

    await act(async () => {
      for (let index = 0; index < LOCAL_SESSION_ACTION_LOG_LIMIT + 2; index += 1) {
        result().recordActionInSelected({
          action: { action: 'add_slide', slide: { title: `Slide ${index}`, content: 'Safe content' } },
          summary: `action-${index}`,
          result: 'applied',
        }, { flush: index === LOCAL_SESSION_ACTION_LOG_LIMIT + 1 })
      }
    })

    expect(result().selectedSession.actionLog).toHaveLength(LOCAL_SESSION_ACTION_LOG_LIMIT)
    expect(result().selectedSession.actionLog[0].summary).toBe('action-2')
    const stored = JSON.parse(storage.data[LOCAL_SESSION_STORAGE_KEY])
    expect(stored.sessions[0].actionLog).toHaveLength(LOCAL_SESSION_ACTION_LOG_LIMIT)
  })

  it('keeps unrecoverable persisted data visible and blocks mutation until explicit recovery action', async () => {
    const storage = fakeStorage({ [LOCAL_SESSION_STORAGE_KEY]: '{nope' })
    let current: UseLocalSessionsResult | null = null
    const result = () => {
      if (!current) throw new Error('Hook result was not captured.')
      return current
    }
    render(<Harness storage={storage} onReady={(result) => { current = result }} />)

    await screen.findByText('Untitled presentation')
    expect(result().persistenceStatus).toBe('failed')
    expect(result().canMutateLocalHistory).toBe(false)

    await act(async () => { result().appendMessageToSelected({ kind: 'user', text: 'Must not overwrite', apiRole: 'user' }, { flush: true }) })

    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toBe('{nope')
    expect(result().selectedSession.messages).toHaveLength(0)

    await act(async () => { result().continueFreshAfterPersistenceFailure() })
    await act(async () => { result().appendMessageToSelected({ kind: 'user', text: 'Fresh prompt', apiRole: 'user' }, { flush: true }) })

    expect(result().canMutateLocalHistory).toBe(true)
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toContain('Fresh prompt')
  })

  it('surfaces explicit clear-history failures instead of claiming deletion succeeded', async () => {
    const storage = fakeStorage({ [LOCAL_SESSION_STORAGE_KEY]: JSON.stringify(createFreshEnvelope(createFreshLocalSession({ id: 'selected' }))) })
    vi.mocked(storage.removeItem).mockImplementation(() => { throw new Error('remove failed') })
    let current: UseLocalSessionsResult | null = null
    const result = () => {
      if (!current) throw new Error('Hook result was not captured.')
      return current
    }
    render(<Harness storage={storage} onReady={(result) => { current = result }} />)

    await screen.findByText('Untitled presentation')
    await act(async () => { result().clearHistory() })

    expect(result().persistenceStatus).toBe('failed')
    expect(result().persistenceError).toMatch(/remove failed/i)
    expect(storage.data[LOCAL_SESSION_STORAGE_KEY]).toBeDefined()
  })

})
