import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useRevealDeck } from './useRevealDeck'
import type { SafeRevealConfig } from './revealConfig'
import { buildRevealConfig } from './revealConfig'
import { logger } from '../lib/logger'

const deckConfig: SafeRevealConfig = buildRevealConfig({ plugins: [] })

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('useRevealDeck', () => {
  it('awaits async initialization and calls onReady after success', async () => {
    const deck = {
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }
    const onReady = vi.fn()

    renderHook(() =>
      useRevealDeck({ config: deckConfig, createDeck: () => deck, onReady, containerRef: { current: document.createElement('div') } }),
    )

    await waitFor(() => expect(onReady).toHaveBeenCalledWith(deck))
    expect(deck.initialize).toHaveBeenCalledTimes(1)
  })

  it('classifies initialize rejection through the error callback', async () => {
    const deck = {
      initialize: vi.fn().mockRejectedValue(new Error('boom')),
      destroy: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }
    const onError = vi.fn()

    renderHook(() =>
      useRevealDeck({ config: deckConfig, createDeck: () => deck, onError, containerRef: { current: document.createElement('div') } }),
    )

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ category: 'reveal-initialization' })),
    )
    expect(deck.destroy).toHaveBeenCalledTimes(1)
  })

  it('classifies synchronous Reveal deck creation failures through the error callback', async () => {
    const onError = vi.fn()

    renderHook(() =>
      useRevealDeck({
        config: deckConfig,
        createDeck: () => {
          throw new Error('constructor boom')
        },
        onError,
        containerRef: { current: document.createElement('div') },
      }),
    )

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ category: 'reveal-initialization' })),
    )
  })

  it('handles synchronous initialization failures and releases the failed deck', async () => {
    const deck = {
      initialize: vi.fn(() => { throw new Error('initialize boom') }),
      destroy: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }
    const onError = vi.fn()
    const onLoading = vi.fn()
    const { unmount } = renderHook(() =>
      useRevealDeck({ config: deckConfig, createDeck: () => deck, onError, onLoading, containerRef: { current: document.createElement('div') } }),
    )

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ category: 'reveal-initialization' })))
    expect(onLoading).toHaveBeenLastCalledWith(false)
    expect(deck.destroy).toHaveBeenCalledTimes(1)
    unmount()
    expect(deck.destroy).toHaveBeenCalledTimes(1)
  })

  it('wires slide-change callbacks through the deck adapter', async () => {
    const deck = {
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }
    const onSlideChange = vi.fn()

    renderHook(() =>
      useRevealDeck({
        config: deckConfig,
        createDeck: () => deck,
        onSlideChange,
        containerRef: { current: document.createElement('div') },
      }),
    )

    await waitFor(() => expect(deck.on).toHaveBeenCalledWith('slidechanged', expect.any(Function)))
    const handler = deck.on.mock.calls.find(([eventName]) => eventName === 'slidechanged')?.[1]

    handler?.({ indexh: 1 })
    expect(onSlideChange).toHaveBeenCalledWith({ indexh: 1 })
  })

  it('suppresses stale ready callbacks when unmounted during initialization', async () => {
    const deferred = createDeferred<void>()
    const deck = {
      initialize: vi.fn(() => deferred.promise),
      destroy: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }
    const onReady = vi.fn()
    const { unmount } = renderHook(() =>
      useRevealDeck({ config: deckConfig, createDeck: () => deck, onReady, containerRef: { current: document.createElement('div') } }),
    )

    await waitFor(() => expect(deck.initialize).toHaveBeenCalledTimes(1))
    unmount()
    await act(async () => deferred.resolve())

    expect(onReady).not.toHaveBeenCalled()
    expect(deck.destroy).toHaveBeenCalledTimes(1)
  })

  it('cancels StrictMode initialization replay and destroys each owned deck once', async () => {
    const createDeck = vi.fn(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
    }))
    const onReady = vi.fn()
    const { unmount } = renderHook(() =>
      useRevealDeck({ config: deckConfig, createDeck, onReady, containerRef: { current: document.createElement('div') } }),
      { wrapper: StrictMode },
    )

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    expect(createDeck).toHaveBeenCalledTimes(2)
    const [discarded, active] = createDeck.mock.results.map(({ value }) => value)
    expect(discarded.initialize).not.toHaveBeenCalled()
    expect(discarded.destroy).toHaveBeenCalledTimes(1)
    expect(active.initialize).toHaveBeenCalledTimes(1)
    expect(active.destroy).not.toHaveBeenCalled()
    unmount()
    expect(active.destroy).toHaveBeenCalledTimes(1)
  })

  it('retains the last ready slide position through a superseded initialization', async () => {
    const pending = createDeferred<void>()
    const firstDeck = {
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
      getIndices: vi.fn(() => ({ h: 3, v: 1, f: 2 })),
    }
    const supersededDeck = {
      initialize: vi.fn(() => pending.promise),
      destroy: vi.fn(),
      getIndices: vi.fn(() => ({ h: 0, v: 0 })),
      slide: vi.fn(),
    }
    const finalDeck = {
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
      slide: vi.fn(),
    }
    const createDeck = vi.fn().mockReturnValueOnce(firstDeck).mockReturnValueOnce(supersededDeck).mockReturnValueOnce(finalDeck)
    const containerRef = { current: document.createElement('div') }
    const onReady = vi.fn()
    const { rerender } = renderHook(({ revision }) =>
      useRevealDeck({ config: deckConfig, contentKey: revision, createDeck, onReady, containerRef }),
      { initialProps: { revision: 0 } },
    )
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(firstDeck))

    rerender({ revision: 1 })
    await waitFor(() => expect(supersededDeck.initialize).toHaveBeenCalled())
    expect(firstDeck.getIndices).toHaveBeenCalledBefore(firstDeck.destroy)
    rerender({ revision: 2 })
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(finalDeck))
    await act(async () => pending.resolve())

    expect(finalDeck.slide).toHaveBeenCalledWith(3, 1, 2)
    expect(supersededDeck.getIndices).not.toHaveBeenCalled()
    expect(supersededDeck.slide).not.toHaveBeenCalled()
    expect(onReady).toHaveBeenCalledTimes(2)
  })

  it('contains teardown failures without crashing the app during unmount', async () => {
    const cause = new Error('destroy failed')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const deck = {
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(() => { throw cause }),
    }
    const { unmount } = renderHook(() =>
      useRevealDeck({ config: deckConfig, createDeck: () => deck, containerRef: { current: document.createElement('div') } }),
    )
    await waitFor(() => expect(deck.initialize).toHaveBeenCalledTimes(1))
    expect(unmount).not.toThrow()
    expect(warn).toHaveBeenCalledWith('Reveal deck cleanup failed', { cause })
    warn.mockRestore()
  })

})
