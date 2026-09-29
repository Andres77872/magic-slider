import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'reveal.js/plugin/highlight/monokai.css'

import { effectivePlugins } from '../domain/presentationSchema'
import type { ValidatedPresentationConfig } from '../domain/presentationTypes'
import { createAppError, type RenderError } from '../lib/errors'
import { logger, type Logger } from '../lib/logger'
import { buildRevealConfig, type RevealConfigDiagnostic, type SafeRevealConfig } from '../presentation/revealConfig'
import { resolveRevealPlugins } from '../presentation/pluginRegistry'
import { buildSafeSlideDom, type RenderDiagnostic } from '../presentation/safeSlideRenderer'
import { useRevealDeck, type RevealDeckLike } from '../presentation/useRevealDeck'
import { createRevealDeck } from '../presentation/createRevealDeck'
import { RevealUrlConfigError } from '../presentation/revealUrlBoundary'

interface RevealSliderProps {
  config: ValidatedPresentationConfig
  onReady?: (deck: RevealDeckLike) => void
  onError?: (error: RenderError) => void
  onLoading?: (loading: boolean) => void
  onSlideChange?: (event: unknown) => void
  onRenderDiagnostics?: (diagnostics: RenderDiagnostic[]) => void
  createDeck?: (element: HTMLElement, config: SafeRevealConfig) => RevealDeckLike
  log?: Logger
}

function useLatestCallback<Args extends unknown[]>(
  callback: ((...args: Args) => void) | undefined,
): ((...args: Args) => void) | undefined {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useCallback((...args: Args) => {
    callbackRef.current?.(...args)
  }, [])
}

const RevealSlider: React.FC<RevealSliderProps> = ({
  config,
  onReady,
  onError,
  onLoading,
  onSlideChange,
  onRenderDiagnostics,
  createDeck = createRevealDeck,
  log = logger,
}) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const revealElementRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null)

  const pluginNames = effectivePlugins(config).join(',')
  const pluginResult = useMemo(() => resolveRevealPlugins(pluginNames ? pluginNames.split(',') : []), [pluginNames])
  const stableOnReady = useLatestCallback(onReady)
  const stableOnError = useLatestCallback(onError)
  const stableOnSlideChange = useLatestCallback(onSlideChange)
  const stableOnLoading = useLatestCallback(onLoading)
  const stableOnRenderDiagnostics = useLatestCallback(onRenderDiagnostics)

  const revealConfig = useMemo(
    () =>
      buildRevealConfig({
        generatedOptions: config.revealOptions,
        plugins: pluginResult.plugins,
        onDiagnostics: (diagnostics: RevealConfigDiagnostic[]) => {
          log.warn('RevealSlider config diagnostics', { diagnostics })
        },
      }),
    [config.revealOptions, pluginResult.plugins, log],
  )

  const renderError = (cause: unknown): RenderError =>
    createAppError({
      category: cause instanceof Error && cause.message.includes('unsafe legacy content') ? 'unsafe-legacy-content' : 'render',
      diagnostics: [{ code: 'safe-render-failed', message: 'RevealSlider could not build a safe deck DOM.' }],
      cause,
    }) as RenderError

  useEffect(() => {
    if (!hostRef.current) return undefined

    setPhase('loading')
    setRenderErrorMessage(null)

    try {
      const { element, diagnostics } = buildSafeSlideDom(config)
      hostRef.current.replaceChildren(element)
      revealElementRef.current = element as HTMLDivElement

      if (diagnostics.length > 0) {
        log.warn('RevealSlider render diagnostics', { diagnostics })
        stableOnRenderDiagnostics?.(diagnostics)
      }
    } catch (cause) {
      hostRef.current.replaceChildren()
      revealElementRef.current = null
      const error = renderError(cause)
      log.error('RevealSlider safe rendering failed', { slideCount: config.slides.length }, error)
      setPhase('error')
      setRenderErrorMessage('Magic Slider could not build a safe Reveal deck from this presentation.')
      stableOnError?.(error)
      stableOnLoading?.(false)
    }

    return () => {
      revealElementRef.current = null
    }
  }, [config, log, stableOnError, stableOnLoading, stableOnRenderDiagnostics])

  const handleReady = useCallback((deck: RevealDeckLike) => {
    setPhase('ready')
    setRenderErrorMessage(null)
    stableOnReady?.(deck)
  }, [stableOnReady])

  const handleError = useCallback((error: RenderError) => {
    setPhase('error')
    setRenderErrorMessage(error.cause instanceof RevealUrlConfigError
      ? error.cause.message
      : 'Reveal could not initialize this deck. Retry by editing your prompt or generating again.')
    stableOnError?.(error)
  }, [stableOnError])

  const handleSlideChange = useCallback((event: unknown) => {
    stableOnSlideChange?.(event)
  }, [stableOnSlideChange])

  useEffect(() => {
    if (pluginResult.diagnostics.length === 0) return
    log.warn('RevealSlider plugin diagnostics', { diagnostics: pluginResult.diagnostics })
  }, [log, pluginResult.diagnostics])

  const deckOptions = useMemo(
    () => ({
      containerRef: revealElementRef,
      config: revealConfig,
      contentKey: config,
      onReady: handleReady,
      onError: handleError,
      onLoading: stableOnLoading,
      onSlideChange: handleSlideChange,
      createDeck,
    }),
    [config, createDeck, handleError, handleReady, stableOnLoading, handleSlideChange, revealConfig],
  )

  useRevealDeck(deckOptions)

  const className = ['reveal-container', `reveal-container--${phase}`].filter(Boolean).join(' ')

  return (
    <div className={className} data-testid="reveal-slider" aria-busy={phase === 'loading'}>
      <div className="reveal-mount" ref={hostRef} hidden={phase === 'error'} />
      {phase === 'error' && (
        <div className="reveal-error-state" role="alert">
          <h2>Presentation preview failed</h2>
          <p>{renderErrorMessage ?? 'The Reveal viewer could not render this deck safely.'}</p>
        </div>
      )}
    </div>
  )
}

export default RevealSlider
