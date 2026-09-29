import { useEffect, useRef, type RefObject } from 'react'

import { createAppError, type RenderError } from '../lib/errors'
import { logger } from '../lib/logger'
import type { SafeRevealConfig } from './revealConfig'

interface RevealSlidePosition {
  h: number
  v?: number
  f?: number
}

export interface RevealDeckLike {
  initialize(): Promise<unknown> | unknown
  destroy(): void
  getIndices?(): RevealSlidePosition
  slide?(horizontal: number, vertical?: number, fragment?: number): void
  next?(): void
  prev?(): void
  isFocused?(): boolean
  on?(eventName: 'slidechanged', handler: (event: unknown) => void): void
  off?(eventName: 'slidechanged', handler: (event: unknown) => void): void
}

export interface UseRevealDeckOptions {
  containerRef: RefObject<HTMLDivElement | null>
  config: SafeRevealConfig
  /** Changes whenever the imperative slide DOM is rebuilt. */
  contentKey?: unknown
  onReady?: (deck: RevealDeckLike) => void
  onError?: (error: RenderError) => void
  onLoading?: (loading: boolean) => void
  onSlideChange?: (event: unknown) => void
  createDeck: (element: HTMLElement, config: SafeRevealConfig) => RevealDeckLike
}

export function useRevealDeck(options: UseRevealDeckOptions): void {
  const { containerRef, config, contentKey, createDeck, onReady, onError, onLoading, onSlideChange } = options
  const previousPositionRef = useRef<RevealSlidePosition | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return undefined

    let disposed = false
    let destroyed = false
    let initialized = false
    let deck: RevealDeckLike
    try {
      deck = createDeck(element, config)
    } catch (cause: unknown) {
      onError?.(
        createAppError({
          category: 'reveal-initialization',
          diagnostics: [{ code: 'create-deck-failed', message: 'Reveal deck creation failed.' }],
          cause,
        }) as RenderError,
      )
      onLoading?.(false)
      return undefined
    }

    const destroyOnce = () => {
      if (destroyed) return
      destroyed = true
      try {
        deck.destroy()
      } catch (cause) {
        logger.warn('Reveal deck cleanup failed', { cause })
      }
    }

    const slideChangeHandler = (event: unknown) => {
      if (!disposed && !destroyed) onSlideChange?.(event)
    }

    if (onSlideChange) deck.on?.('slidechanged', slideChangeHandler)
    onLoading?.(true)

    // Defer initialization so a StrictMode cleanup can cancel it before Reveal
    // installs global listeners, and so synchronous throws reach the catch.
    Promise.resolve()
      .then(() => {
        if (!disposed) return deck.initialize()
      })
      .then(() => {
        if (!disposed) {
          const previousPosition = previousPositionRef.current
          if (previousPosition) {
            try {
              // Reveal clamps these coordinates if edits removed the active slide.
              deck.slide?.(previousPosition.h, previousPosition.v, previousPosition.f)
            } catch (cause) {
              logger.warn('Reveal slide position could not be restored', { cause })
            }
          }
          initialized = true
          onReady?.(deck)
          onLoading?.(false)
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          destroyOnce()
          onError?.(
            createAppError({
              category: 'reveal-initialization',
              diagnostics: [{ code: 'initialize-rejected', message: 'Reveal initialization rejected.' }],
              cause,
            }) as RenderError,
          )
          onLoading?.(false)
        }
      })

    return () => {
      disposed = true
      if (initialized && !destroyed) {
        try {
          previousPositionRef.current = deck.getIndices?.() ?? null
        } catch (cause) {
          logger.warn('Reveal slide position could not be saved', { cause })
        }
      }
      onLoading?.(false)
      if (onSlideChange) deck.off?.('slidechanged', slideChangeHandler)
      destroyOnce()
    }
  }, [containerRef, config, contentKey, createDeck, onReady, onError, onLoading, onSlideChange])
}
