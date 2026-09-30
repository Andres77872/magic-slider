import type { Deck } from '../domain/deckSchema'
import { CANVAS, applyThemeVariables, renderSlide } from './renderDeck'
import type { ResolvedTheme } from './theme'

/**
 * Auto-fit: generated slides sometimes hold more than a 16:9 canvas shows.
 * Each slide is laid out off-screen at canvas size; if its content overflows,
 * the content box is enlarged and scaled down uniformly until it fits, so
 * nothing is ever clipped. Scales are reported back to the agent as layout
 * feedback. Environments without layout (tests, SSR) measure nothing and
 * return an empty map.
 */

export const MIN_FIT_SCALE = 0.55

export type FitScales = Record<string, number>

/** Clipping containers inside a slide; their hidden overflow also counts as overflow. */
const CLIPPING_SELECTOR = '.ms-box, .ms-diagram__node, .ms-diagram__quadrant, .ms-callout, .ms-table'

function overflowRatio(content: HTMLElement): number {
  const height = content.clientHeight
  const width = content.clientWidth
  if (!height || !width) return 1
  // scrollHeight ignores children that only spill into the end padding (the band
  // reserved for the sources footer), so measure the children's own edges too.
  const style = content.ownerDocument.defaultView?.getComputedStyle(content)
  const paddingBottom = Number.parseFloat(style?.paddingBottom ?? '') || 0
  const paddingRight = Number.parseFloat(style?.paddingRight ?? '') || 0
  let bottom = 0
  let right = 0
  for (const child of content.children) {
    if (!(child instanceof HTMLElement)) continue
    bottom = Math.max(bottom, child.offsetTop + child.offsetHeight)
    right = Math.max(right, child.offsetLeft + child.offsetWidth)
  }
  const neededHeight = Math.max(content.scrollHeight, bottom ? bottom + paddingBottom : 0)
  const neededWidth = Math.max(content.scrollWidth, right ? right + paddingRight : 0)
  let ratio = Math.max(neededHeight / height, neededWidth / width, 1)
  for (const node of content.querySelectorAll<HTMLElement>(CLIPPING_SELECTOR)) {
    if (node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 2) ratio = Math.max(ratio, node.scrollHeight / node.clientHeight)
  }
  return ratio
}

export function measureFitScales(deck: Deck, theme: ResolvedTheme, doc: Document = document): FitScales {
  if (deck.settings?.autoFit === false || !doc.body) return {}
  const canvas = CANVAS[deck.settings?.aspectRatio ?? '16:9']
  const host = doc.createElement('div')
  host.className = 'ms-deck ms-measure'
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${canvas.width}px;height:${canvas.height}px;visibility:hidden;pointer-events:none;contain:layout style;`
  applyThemeVariables(host, theme)
  doc.body.appendChild(host)
  const scales: FitScales = {}
  try {
    for (const slide of deck.slides) {
      const { element } = renderSlide(slide, deck, theme, 'thumbnail', doc)
      element.style.cssText += `position:relative;width:${canvas.width}px;height:${canvas.height}px;`
      host.replaceChildren(element)
      const content = element.querySelector<HTMLElement>('.ms-slide__content')
      if (!content) continue
      // Measure from the top so centered content cannot hide overflow above the box.
      content.style.justifyContent = 'flex-start'
      const initial = overflowRatio(content)
      if (initial <= 1.005) continue
      content.classList.add('ms-fit')
      const fits = (scale: number) => {
        content.style.setProperty('--ms-fit', String(scale))
        return overflowRatio(content) <= 1.005
      }
      // Text reflows as the box widens, so the fitting scale is not simply 1/ratio:
      // find the largest scale that fits by bisection between a fitting and an
      // overflowing bound, never shrinking more than necessary.
      let high = 1
      let low = Math.max(MIN_FIT_SCALE, 1 / initial)
      if (!fits(low)) {
        high = low
        low = MIN_FIT_SCALE
        if (!fits(low)) {
          scales[slide.id] = MIN_FIT_SCALE
          continue
        }
      }
      for (let pass = 0; pass < 7 && high - low > 0.005; pass += 1) {
        const middle = (low + high) / 2
        if (fits(middle)) low = middle
        else high = middle
      }
      scales[slide.id] = Math.max(MIN_FIT_SCALE, Math.floor(low * 1000) / 1000)
    }
  } finally {
    host.remove()
  }
  return scales
}

/** Applies measured scales to rendered slides (preview, thumbnails and export share this). */
export function applyFitScales(root: ParentNode, scales: FitScales): void {
  for (const section of root.querySelectorAll<HTMLElement>('[data-slide-id]')) {
    const scale = scales[section.getAttribute('data-slide-id') ?? '']
    const content = section.querySelector<HTMLElement>(':scope > .ms-slide__content')
    if (!content || scale === undefined || scale >= 1) continue
    content.classList.add('ms-fit')
    content.style.setProperty('--ms-fit', String(scale))
  }
}
