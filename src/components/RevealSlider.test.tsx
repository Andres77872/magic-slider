import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { ValidatedPresentationConfig } from '../domain/presentationTypes'
import type { Logger } from '../lib/logger'
import type { RevealDeckLike } from '../presentation/useRevealDeck'
import RevealSlider from './RevealSlider'

const safeConfig: ValidatedPresentationConfig = {
  slides: [{ title: '<img src=x onerror=alert(1)>', content: 'Safe text', attributes: { 'data-transition': 'fade' } }],
  plugins: ['highlight'],
  revealOptions: { transition: 'fade', controls: true },
}

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

type TestRevealDeck = RevealDeckLike & {
  initialize: ReturnType<typeof vi.fn<() => Promise<void>>>
  destroy: ReturnType<typeof vi.fn<() => void>>
  on: ReturnType<typeof vi.fn<(eventName: 'slidechanged', handler: (event: unknown) => void) => void>>
  off: ReturnType<typeof vi.fn<(eventName: 'slidechanged', handler: (event: unknown) => void) => void>>
}

function createDeck(overrides: Partial<TestRevealDeck> = {}): TestRevealDeck {
  return {
    initialize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    destroy: vi.fn<() => void>(),
    on: vi.fn<(eventName: 'slidechanged', handler: (event: unknown) => void) => void>(),
    off: vi.fn<(eventName: 'slidechanged', handler: (event: unknown) => void) => void>(),
    ...overrides,
  }
}

describe('RevealSlider', () => {
  // Reveal's bundled fitty module debounces resize work for 100 ms. Let that
  // global callback finish before jsdom closes its window and removes RAF.
  afterAll(() => new Promise<void>((resolve) => window.setTimeout(resolve, 120)))

  afterEach(() => {
    cleanup()
  })

  it('renders a valid deck through the safe renderer and initializes Reveal with safe config', async () => {
    const deck = createDeck()
    const createDeckFn = vi.fn(() => deck)
    const onReady = vi.fn()
    const onLoading = vi.fn()

    render(<RevealSlider config={safeConfig} createDeck={createDeckFn} onReady={onReady} onLoading={onLoading} log={createLogger()} />)

    expect(screen.getByTestId('reveal-slider')).toHaveClass('reveal-container--loading')
    expect(onLoading).toHaveBeenCalledWith(true)

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('Safe text')).toBeInTheDocument()

    await waitFor(() => expect(onReady).toHaveBeenCalledWith(deck))
    await waitFor(() => expect(screen.getByTestId('reveal-slider')).toHaveClass('reveal-container--ready'))
    expect(onLoading).toHaveBeenCalledWith(false)
    expect(createDeckFn).toHaveBeenCalledWith(
      expect.objectContaining({ className: 'reveal theme-midnight' }),
      expect.objectContaining({
        embedded: true,
        hash: false,
        respondToHashChanges: false,
        postMessage: false,
        transition: 'fade',
        plugins: expect.any(Array),
      }),
    )
  })

  it('reports safe renderer diagnostics for unsafe generated DOM data', async () => {
    const deck = createDeck()
    const onRenderDiagnostics = vi.fn()
    const logger = createLogger()
    const configWithUnsafeRenderData = {
      slides: [{ title: 'Unsafe background', background: 'javascript:alert(1)', attributes: { onclick: 'alert(1)' } }],
    } as unknown as ValidatedPresentationConfig

    render(
      <RevealSlider
        config={configWithUnsafeRenderData}
        createDeck={() => deck}
        onRenderDiagnostics={onRenderDiagnostics}
        log={logger}
      />,
    )

    await waitFor(() => expect(onRenderDiagnostics).toHaveBeenCalled())
    expect(onRenderDiagnostics).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unsafe-background-url' }),
        expect.objectContaining({ code: 'unsafe-attribute' }),
      ]),
    )
    expect(logger.warn).toHaveBeenCalledWith('RevealSlider render diagnostics', expect.any(Object))
  })

  it('reports legacy raw HTML render errors and does not initialize Reveal', async () => {
    const createDeckFn = vi.fn(() => createDeck())
    const onError = vi.fn()
    const onLoading = vi.fn()
    const logger = createLogger()
    const legacyConfig = {
      slides: [{ title: 'Legacy', content: '<script>alert(1)</script>' }],
    } as unknown as ValidatedPresentationConfig

    render(<RevealSlider config={legacyConfig} createDeck={createDeckFn} onError={onError} onLoading={onLoading} log={logger} />)

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ category: 'unsafe-legacy-content' })))
    expect(createDeckFn).not.toHaveBeenCalled()
    expect(onLoading).toHaveBeenCalledWith(false)
    expect(screen.getByTestId('reveal-slider')).not.toHaveClass('reveal-container--loading')
    expect(logger.error).toHaveBeenCalledWith('RevealSlider safe rendering failed', expect.any(Object), expect.any(Object))
  })

  it('logs plugin diagnostics without treating non-fatal plugin misses as render errors', async () => {
    const onError = vi.fn()
    const logger = createLogger()
    const configWithUnknownPlugin = {
      slides: [{ title: 'Plugin' }],
      plugins: ['speaker-notes-please'],
    } as unknown as ValidatedPresentationConfig

    render(<RevealSlider config={configWithUnknownPlugin} createDeck={() => createDeck()} onError={onError} log={logger} />)

    await waitFor(() => expect(logger.warn).toHaveBeenCalledWith('RevealSlider plugin diagnostics', expect.any(Object)))
    expect(onError).not.toHaveBeenCalled()
    expect(screen.getByTestId('reveal-slider')).toHaveClass('reveal-container--ready')
  })

  it('surfaces Reveal initialization failure through the lifecycle error callback', async () => {
    const deck = createDeck({ initialize: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('boom')) })
    const onError = vi.fn()
    const onLoading = vi.fn()

    render(<RevealSlider config={safeConfig} createDeck={() => deck} onError={onError} onLoading={onLoading} log={createLogger()} />)

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ category: 'reveal-initialization' })))
    expect(onLoading).toHaveBeenCalledWith(false)
    expect(screen.getByTestId('reveal-slider')).toHaveClass('reveal-container--error')
    expect(screen.getByRole('alert')).toHaveTextContent(/preview failed/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/could not initialize/i)
  })

  it('explains conflicting URL settings without initializing a full-page presentation', async () => {
    const originalUrl = window.location.href
    window.history.replaceState(null, '', '?embedded=false')

    try {
      render(<RevealSlider config={safeConfig} log={createLogger()} />)

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/remove these URL parameters and reload: embedded/i))
      expect(document.documentElement).not.toHaveClass('reveal-full-page')
      expect(document.body).not.toHaveClass('reveal-viewport')
      expect(screen.getByTestId('reveal-slider')).toHaveAttribute('aria-busy', 'false')
    } finally {
      window.history.replaceState(null, '', originalUrl)
    }
  })

  it('wires slide-change callback and destroys the deck on unmount', async () => {
    const deck = createDeck()
    const onSlideChange = vi.fn()
    const { unmount } = render(<RevealSlider config={safeConfig} createDeck={() => deck} onSlideChange={onSlideChange} log={createLogger()} />)

    await waitFor(() => expect(deck.on).toHaveBeenCalledWith('slidechanged', expect.any(Function)))
    const handler = deck.on.mock.calls.find(([eventName]) => eventName === 'slidechanged')?.[1]

    handler?.({ indexh: 1 })
    expect(onSlideChange).toHaveBeenCalledWith({ indexh: 1 })

    unmount()
    expect(deck.off).toHaveBeenCalledWith('slidechanged', handler)
    expect(deck.destroy).toHaveBeenCalledTimes(1)
  })

  it('initializes changed slide content even when options and plugins are unchanged', async () => {
    const firstDeck = createDeck()
    const nextDeck = createDeck()
    const createDeckFn = vi.fn().mockReturnValueOnce(firstDeck).mockReturnValueOnce(nextDeck)
    const onReady = vi.fn()
    const log = createLogger()
    const { rerender } = render(<RevealSlider config={safeConfig} createDeck={createDeckFn} onReady={onReady} log={log} />)
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(firstDeck))

    rerender(<RevealSlider config={{ ...safeConfig, slides: [{ title: 'Updated slide' }] }} createDeck={createDeckFn} onReady={onReady} log={log} />)

    await waitFor(() => expect(onReady).toHaveBeenCalledWith(nextDeck))
    expect(firstDeck.destroy).toHaveBeenCalledTimes(1)
    expect(createDeckFn.mock.calls[1][0]).toBe(document.querySelector('.reveal'))
    expect(screen.getByText('Updated slide')).toBeInTheDocument()
    expect(screen.getByTestId('reveal-slider')).toHaveClass('reveal-container--ready')
  })

  it('keeps the active slide after editing, clamps removed slides, and resets for a new session', async () => {
    const onReady = vi.fn<(deck: RevealDeckLike) => void>()
    const log = createLogger()
    const config: ValidatedPresentationConfig = {
      slides: [{ title: 'Opening' }, { title: 'Plan' }, { title: 'Closing', content: 'Original conclusion' }],
    }
    const { rerender } = render(<RevealSlider key="session-a" config={config} onReady={onReady} log={log} />)
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    act(() => onReady.mock.calls[0][0].slide?.(2, 0))
    expect(document.querySelector('.slides > section.present')).toHaveTextContent('Original conclusion')

    const edited = { ...config, slides: [...config.slides.slice(0, 2), { title: 'Closing', content: 'Revised conclusion' }] }
    rerender(<RevealSlider key="session-a" config={edited} onReady={onReady} log={log} />)

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2))
    expect(onReady.mock.calls[1][0].getIndices?.().h).toBe(2)
    expect(document.querySelector('.slides > section.present')).toHaveTextContent('Revised conclusion')

    rerender(<RevealSlider key="session-a" config={{ ...config, slides: config.slides.slice(0, 2) }} onReady={onReady} log={log} />)

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(3))
    expect(onReady.mock.calls[2][0].getIndices?.().h).toBe(1)
    expect(document.querySelector('.slides > section.present')).toHaveTextContent('Plan')

    rerender(<RevealSlider key="session-b" config={config} onReady={onReady} log={log} />)

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(4))
    expect(onReady.mock.calls[3][0].getIndices?.().h).toBe(0)
    expect(document.querySelector('.slides > section.present')).toHaveTextContent('Opening')
  })

  it('keeps the live deck when only diagnostic or event callbacks change', async () => {
    const deck = createDeck()
    const createDeckFn = vi.fn(() => deck)
    const log = createLogger()
    const onReady = vi.fn()
    const nextSlideChange = vi.fn()
    const { rerender } = render(<RevealSlider config={safeConfig} createDeck={createDeckFn} log={log} onReady={onReady} onRenderDiagnostics={vi.fn()} />)
    await waitFor(() => expect(onReady).toHaveBeenCalled())
    const element = document.querySelector('.reveal')

    rerender(<RevealSlider config={safeConfig} createDeck={createDeckFn} log={log} onReady={vi.fn()} onSlideChange={nextSlideChange} onRenderDiagnostics={vi.fn()} />)

    expect(document.querySelector('.reveal')).toBe(element)
    expect(createDeckFn).toHaveBeenCalledTimes(1)
    expect(deck.destroy).not.toHaveBeenCalled()
    deck.on.mock.calls[0][1]({ indexh: 2 })
    expect(nextSlideChange).toHaveBeenCalledWith({ indexh: 2 })
  })

  it('recovers from a render error without removing React-owned error elements', async () => {
    const createDeckFn = vi.fn(() => createDeck())
    const onReady = vi.fn()
    const log = createLogger()
    const invalid = { slides: [{ content: '<script>bad</script>' }] }
    const { rerender } = render(<RevealSlider config={invalid} createDeck={createDeckFn} onReady={onReady} log={log} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    rerender(<RevealSlider config={{ slides: [{ title: 'Recovered' }] }} createDeck={createDeckFn} onReady={onReady} log={log} />)

    await waitFor(() => expect(onReady).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Recovered')).toBeInTheDocument()
  })

})
