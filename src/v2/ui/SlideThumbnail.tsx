import { memo, useEffect, useRef } from 'react'

import type { Deck, Slide } from '../domain/deckSchema'
import { CANVAS, applyThemeVariables, renderSlide } from '../render/renderDeck'
import type { ResolvedTheme } from '../render/theme'

interface SlideThumbnailProps {
  deck: Deck
  slide: Slide
  theme: ResolvedTheme
  fitScale?: number
  /** Rendered width in CSS pixels. */
  width: number
}

/**
 * A static, non-interactive render of one slide using the same primitive
 * renderer as the live preview, scaled down with a CSS transform.
 */
function SlideThumbnailInner({ deck, slide, theme, fitScale, width }: SlideThumbnailProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvas = CANVAS[deck.settings?.aspectRatio ?? '16:9']
  const slideKey = JSON.stringify(slide)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const root = document.createElement('div')
    root.className = `ms-deck ms-thumb__deck ms-mode-${theme.mode}`
    applyThemeVariables(root, theme)
    root.style.setProperty('--ms-canvas-width', `${canvas.width}px`)
    root.style.setProperty('--ms-canvas-height', `${canvas.height}px`)
    root.style.setProperty('--ms-thumb-scale', String(width / canvas.width))
    const { element } = renderSlide(slide, deck, theme, 'thumbnail')
    const content = element.querySelector<HTMLElement>('.ms-slide__content')
    if (content && fitScale && fitScale < 1) {
      content.classList.add('ms-fit')
      content.style.setProperty('--ms-fit', String(fitScale))
    }
    for (const image of element.querySelectorAll('img[data-src]')) {
      image.setAttribute('loading', 'lazy')
      image.setAttribute('src', image.getAttribute('data-src')!)
    }
    for (const video of element.querySelectorAll('video')) video.removeAttribute('data-src')
    root.appendChild(element)
    host.replaceChildren(root)
    // slideKey stands in for the slide object, whose identity changes on every normalization.
  }, [slideKey, theme, fitScale, width, canvas.width, canvas.height])

  return <div ref={hostRef} className={`ms-thumb${deck.settings?.aspectRatio === '4:3' ? ' ms-thumb--4x3' : ''}`} style={{ width }} aria-hidden="true" />
}

export default memo(SlideThumbnailInner)
