import Reveal from 'reveal.js'

import { loadRevealPlugins, resolveRevealPlugins } from '../../presentation/pluginRegistry'
import { assertSafeRevealUrl } from '../../presentation/revealUrlBoundary'
import type { RevealDeckLike } from '../../presentation/useRevealDeck'
import type { Deck } from '../domain/deckSchema'
import { CANVAS, deckUsesCode } from './renderDeck'

/** Reveal options for a v2 deck. Layout is owned by the primitives, so Reveal never centers slides. */
export function revealOptionsFor(deck: Deck): Record<string, unknown> {
  const canvas = CANVAS[deck.settings?.aspectRatio ?? '16:9']
  const settings = deck.settings ?? {}
  return {
    width: canvas.width,
    height: canvas.height,
    margin: 0.02,
    minScale: 0.05,
    maxScale: 4,
    center: false,
    embedded: true,
    keyboard: true,
    keyboardCondition: 'focused',
    hash: false,
    history: false,
    respondToHashChanges: false,
    postMessage: false,
    postMessageEvents: false,
    scrollActivationWidth: 0,
    view: null,
    controls: settings.controls ?? true,
    progress: settings.progress ?? true,
    slideNumber: settings.slideNumber ? 'c/t' : false,
    transition: settings.transition ?? 'slide',
    transitionSpeed: settings.transitionSpeed ?? 'default',
    backgroundTransition: 'fade',
    autoAnimateDuration: 0.7,
    viewDistance: 3,
    fragments: true,
  }
}

export function revealPluginsFor(deck: Deck): string[] {
  return deckUsesCode(deck) ? ['highlight', 'notes'] : ['notes']
}

const INITIALIZE_TIMEOUT_MS = 15_000

export interface V2RevealConfig {
  options: Record<string, unknown>
  plugins: string[]
}

export function createV2RevealDeck(element: HTMLElement, config: V2RevealConfig): RevealDeckLike {
  const { plugins } = resolveRevealPlugins(config.plugins)
  const deck = new Reveal(element, { ...config.options, plugins: [] })
  const initialize = deck.initialize.bind(deck)
  const destroy = deck.destroy.bind(deck)
  let disposed = false

  deck.destroy = () => {
    disposed = true
    destroy()
  }
  deck.initialize = () => {
    if (disposed) throw new DOMException('Presentation initialization was cancelled.', 'AbortError')
    assertSafeRevealUrl(deck.getQueryHash(), window.location.search)
    return loadRevealPlugins(plugins).then((loaded) => {
      if (disposed) throw new DOMException('Presentation initialization was cancelled.', 'AbortError')
      // Reveal's ready promise never settles if a plugin throws during init; surface
      // that as an error instead of a viewer stuck in "loading". Plugin downloads are
      // excluded from the limit so slow networks are not mistaken for a hang.
      let timer: ReturnType<typeof setTimeout> | undefined
      const watchdog = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The presentation viewer did not start in time.')), INITIALIZE_TIMEOUT_MS)
      })
      return Promise.race([initialize({ ...config.options, plugins: loaded }), watchdog]).finally(() => clearTimeout(timer))
    })
  }
  return deck
}
