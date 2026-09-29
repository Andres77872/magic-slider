import Reveal from 'reveal.js'

import type { SafeRevealConfig } from './revealConfig'
import { loadRevealPlugins } from './pluginRegistry'
import { assertSafeRevealUrl } from './revealUrlBoundary'
import type { RevealDeckLike } from './useRevealDeck'

export function createRevealDeck(element: HTMLElement, config: SafeRevealConfig): RevealDeckLike {
  const deck = new Reveal(element, { ...config, plugins: [] })
  const initialize = deck.initialize.bind(deck)
  const destroy = deck.destroy.bind(deck)
  let disposed = false

  const assertActive = () => {
    if (disposed) throw new DOMException('Presentation initialization was cancelled.', 'AbortError')
  }

  deck.destroy = () => {
    disposed = true
    destroy()
  }

  deck.initialize = (options) => {
    assertActive()
    // Reveal merges URL options last, then immediately chooses its viewport.
    // Check its own parsed values before initialization makes any DOM changes.
    assertSafeRevealUrl(deck.getQueryHash(), window.location.search)
    return loadRevealPlugins(config.plugins).then((plugins) => {
      assertActive()
      // The URL can change while a plugin chunk is downloading.
      assertSafeRevealUrl(deck.getQueryHash(), window.location.search)
      return initialize({ ...options, plugins })
    })
  }

  return deck
}
