import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import 'reveal.js/plugin/highlight/monokai.css'

import { useRevealDeck, type RevealDeckLike } from '../../presentation/useRevealDeck'
import type { SafeRevealConfig } from '../../presentation/revealConfig'
import type { Deck } from '../domain/deckSchema'
import { applyFitScales, type FitScales } from '../render/fit'
import { buildDeckElement } from '../render/renderDeck'
import { createV2RevealDeck, revealOptionsFor, revealPluginsFor, type V2RevealConfig } from '../render/revealDeck'
import { ensureDeckFonts } from '../render/fonts'
import { logger } from '../../lib/logger'
import type { RenderError } from '../../lib/errors'

export interface StageNavigation {
  index: number
  nonce: number
}

interface DeckStageProps {
  deck: Deck
  fitScales: FitScales
  navigation?: StageNavigation | null
  selectedBlockId?: string | null
  building?: boolean
  onSlideChange?: (index: number) => void
  onBlockSelect?: (blockId: string | null, slideId: string | null) => void
  onError?: (message: string) => void
}

const SHOW_ALL_FRAGMENTS = 1_000

export default function DeckStage({ deck, fitScales, navigation, selectedBlockId, building, onSlideChange, onBlockSelect, onError }: DeckStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const revealRef = useRef<HTMLDivElement | null>(null)
  const deckApiRef = useRef<RevealDeckLike | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const callbacks = useRef({ onSlideChange, onError })
  callbacks.current = { onSlideChange, onError }

  const config = useMemo<V2RevealConfig>(() => ({ options: revealOptionsFor(deck), plugins: revealPluginsFor(deck) }), [deck])
  const renderKey = useMemo(() => ({ deck, fitScales }), [deck, fitScales])

  // Build the slide DOM before Reveal initializes on it (effects run in order).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    try {
      const rendered = buildDeckElement(deck, 'reveal')
      applyFitScales(rendered.element, fitScales)
      ensureDeckFonts(rendered.theme)
      host.replaceChildren(rendered.element)
      revealRef.current = rendered.element as HTMLDivElement
      if (rendered.diagnostics.length) logger.warn('v2 render diagnostics', { diagnostics: rendered.diagnostics })
    } catch (cause) {
      host.replaceChildren()
      revealRef.current = null
      setPhase('error')
      callbacks.current.onError?.('This presentation could not be rendered.')
      logger.error('v2 render failed', undefined, cause)
    }
    return () => {
      revealRef.current = null
    }
  }, [deck, fitScales])

  const handleReady = useCallback((api: RevealDeckLike) => {
    deckApiRef.current = api
    setPhase('ready')
    const index = api.getIndices?.().h
    if (typeof index === 'number') callbacks.current.onSlideChange?.(index)
  }, [])
  const handleError = useCallback((error: RenderError) => {
    setPhase('error')
    callbacks.current.onError?.(error.cause instanceof Error && error.cause.name === 'RevealUrlConfigError' ? error.cause.message : 'The presentation viewer could not start.')
  }, [])
  const handleSlideChange = useCallback((event: unknown) => {
    const index = (event as { indexh?: unknown } | null)?.indexh
    if (typeof index === 'number') callbacks.current.onSlideChange?.(index)
  }, [])
  const handleLoading = useCallback((loading: boolean) => {
    if (loading) setPhase('loading')
  }, [])

  useRevealDeck({
    containerRef: revealRef,
    config: config as unknown as SafeRevealConfig,
    contentKey: renderKey,
    onReady: handleReady,
    onError: handleError,
    onLoading: handleLoading,
    onSlideChange: handleSlideChange,
    createDeck: createV2RevealDeck as unknown as (element: HTMLElement, config: SafeRevealConfig) => RevealDeckLike,
  })

  // Each navigation request applies once. Re-initialising the viewer (after an
  // edit) restores the user's own position instead of replaying an old jump.
  const appliedNavigation = useRef<number | null>(null)
  useEffect(() => {
    if (!navigation || phase !== 'ready' || appliedNavigation.current === navigation.nonce) return
    appliedNavigation.current = navigation.nonce
    try {
      deckApiRef.current?.slide?.(navigation.index, 0, SHOW_ALL_FRAGMENTS)
    } catch {
      // The viewer may be re-initializing; the next render keeps the position.
    }
  }, [navigation, phase])

  useEffect(() => {
    const root = revealRef.current
    if (!root) return
    for (const node of root.querySelectorAll('.ms-selected')) node.classList.remove('ms-selected')
    if (selectedBlockId) {
      for (const node of root.querySelectorAll('[data-block-id]')) {
        if (node.getAttribute('data-block-id') === selectedBlockId) node.classList.add('ms-selected')
      }
    }
  }, [selectedBlockId, renderKey, phase])

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onBlockSelect) return
    const target = event.target as Element
    if (target.closest('a, .controls, .progress')) return
    const block = target.closest('[data-block-id]')
    const slide = target.closest('[data-slide-id]')
    onBlockSelect(block?.getAttribute('data-block-id') ?? null, slide?.getAttribute('data-slide-id') ?? null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const api = deckApiRef.current
    if (!api || api.isFocused?.() || event.target !== event.currentTarget) return
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault()
      api.next?.()
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
      event.preventDefault()
      api.prev?.()
    }
  }

  return (
    <div
      className={`v2-stage v2-stage--${phase}${building ? ' v2-stage--building' : ''}${deck.settings?.aspectRatio === '4:3' ? ' v2-stage--4x3' : ''}`}
      data-testid="v2-stage"
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-busy={phase === 'loading'}
    >
      <div className="v2-stage__mount" ref={hostRef} hidden={phase === 'error'} />
      {phase === 'error' && <p className="v2-stage__error" role="alert">The preview could not be displayed. Try another edit or export the JSON.</p>}
    </div>
  )
}
