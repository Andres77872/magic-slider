import type { DeckTheme, SlideLayout } from '../domain/presentationSchema'
import type { ValidatedPresentationConfig, ValidatedSlide } from '../domain/presentationTypes'
import { containsExecutableLegacyContent, containsLegacyRawHtml } from './legacyContentBoundary'
import { isSafeImageUrl, isSafeLinkUrl, linkHost } from './imageUrl'

export interface RenderDiagnostic {
  code: 'unsafe-attribute' | 'unsafe-background-url' | 'background-image-alias-collision' | 'unsafe-image-url' | 'unsafe-source-url'
  message: string
  slideIndex: number
  key?: string
}

type RenderableDeck = Pick<ValidatedPresentationConfig, 'slides'> & Partial<Pick<ValidatedPresentationConfig, 'theme' | 'language'>>

const ALLOWED_ATTRIBUTES = new Set(['data-auto-animate', 'data-transition', 'data-background-color'])
const REVEAL_BACKGROUND_IMAGE_ATTRIBUTE = 'data-background-image'
const LIST_MARKER = /^(?:[-*•▪◦–—]|\d{1,2}[.)])\s+/
const NUMBERED_MARKER = /^\d{1,2}[.)]\s+/
const PARAGRAPH_LAYOUTS = new Set<SlideLayout>(['title', 'section', 'closing', 'statement', 'quote'])

export const DEFAULT_THEME: DeckTheme = 'midnight'

/** Older decks carry no layout; infer one from the structured fields present. */
export function resolveSlideLayout(slide: ValidatedSlide): SlideLayout {
  if (slide.layout) return slide.layout
  if (slide.stats) return 'stats'
  if (slide.columns) return 'comparison'
  if (slide.timeline) return 'timeline'
  if (slide.quote) return 'quote'
  if (slide.image) return 'split'
  return 'content'
}

function element<K extends keyof HTMLElementTagNameMap>(tagName: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Splits plain text into lines, dropping bullet or number markers the renderer draws itself. */
export function contentLines(content: string): { lines: string[]; numbered: boolean } {
  const rawLines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const numbered = rawLines.length > 1 && rawLines.every((line) => NUMBERED_MARKER.test(line))
  return { lines: rawLines.map((line) => line.replace(LIST_MARKER, '')), numbered }
}

function fragmentClass(enabled: boolean | undefined): string {
  return enabled ? ' fragment fade-up' : ''
}

/** Renders newline-separated plain text as a list, or as paragraphs. */
function textBlock(content: string, options: { className: string; fragments?: boolean; asParagraphs?: boolean }): HTMLElement {
  const container = element('div', options.className)
  const { lines, numbered } = contentLines(content)
  if (lines.length <= 1 || options.asParagraphs) {
    for (const line of lines) container.appendChild(element('p', 'slide-lead', line))
    return container
  }
  const list = element(numbered ? 'ol' : 'ul', 'slide-list')
  for (const line of lines) list.appendChild(element('li', `slide-list__item${fragmentClass(options.fragments)}`, line))
  container.appendChild(list)
  return container
}

function renderStats(slide: ValidatedSlide): HTMLElement {
  const stats = element('div', `slide-stats slide-stats--${slide.stats?.length ?? 0}`)
  for (const stat of slide.stats ?? []) {
    const item = element('div', `slide-stat${fragmentClass(slide.fragments)}`)
    item.append(element('span', 'slide-stat__value', stat.value), element('span', 'slide-stat__label', stat.label))
    stats.appendChild(item)
  }
  return stats
}

function renderColumns(slide: ValidatedSlide): HTMLElement {
  const columns = element('div', `slide-columns slide-columns--${slide.columns?.length ?? 0}`)
  for (const column of slide.columns ?? []) {
    const card = element('div', `slide-column${fragmentClass(slide.fragments)}`)
    card.appendChild(element('h3', 'slide-column__heading', column.heading))
    if (column.content) card.appendChild(textBlock(column.content, { className: 'slide-column__body' }))
    columns.appendChild(card)
  }
  return columns
}

function renderTimeline(slide: ValidatedSlide): HTMLElement {
  const timeline = element('ol', `slide-timeline slide-timeline--${slide.timeline?.length ?? 0}`)
  for (const step of slide.timeline ?? []) {
    const item = element('li', `slide-timeline__item${fragmentClass(slide.fragments)}`)
    item.append(element('span', 'slide-timeline__label', step.label), element('span', 'slide-timeline__text', step.text))
    timeline.appendChild(item)
  }
  return timeline
}

function renderQuote(slide: ValidatedSlide): HTMLElement {
  const figure = element('figure', 'slide-quote')
  const blockquote = element('blockquote', 'slide-quote__text')
  blockquote.appendChild(element('p', undefined, slide.quote?.text ?? ''))
  figure.appendChild(blockquote)
  if (slide.quote?.attribution) figure.appendChild(element('figcaption', 'slide-quote__attribution', slide.quote.attribution))
  return figure
}

function renderCode(slide: ValidatedSlide): HTMLElement {
  const pre = element('pre', 'slide-code')
  const code = element('code', slide.code?.language ? `language-${slide.code.language}` : 'nohighlight', slide.code?.source ?? '')
  code.setAttribute('data-trim', '')
  pre.appendChild(code)
  return pre
}

function renderFigure(slide: ValidatedSlide, slideIndex: number, diagnostics: RenderDiagnostic[]): HTMLElement | null {
  const image = slide.image
  if (!image) return null
  if (!isSafeImageUrl(image.url)) {
    diagnostics.push({ code: 'unsafe-image-url', message: 'Unsafe generated image URL omitted.', slideIndex })
    return null
  }
  const figure = element('figure', 'slide-figure')
  const img = element('img', 'slide-figure__image')
  // Reveal lazy-loads data-src for slides near the current one.
  img.setAttribute('data-src', image.url)
  img.alt = image.alt
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  img.addEventListener('error', () => figure.classList.add('slide-figure--failed'))
  figure.appendChild(img)
  if (image.caption) figure.appendChild(element('figcaption', 'slide-figure__caption', image.caption))
  return figure
}

function renderSources(slide: ValidatedSlide, slideIndex: number, diagnostics: RenderDiagnostic[]): HTMLElement | null {
  if (!slide.sources?.length) return null
  const footer = element('footer', 'slide-sources')
  footer.appendChild(element('span', 'slide-sources__label', slide.sources.length === 1 ? 'Source' : 'Sources'))
  const list = element('ol', 'slide-sources__list')
  for (const source of slide.sources) {
    const item = element('li', 'slide-sources__item')
    if (isSafeLinkUrl(source.url)) {
      const link = element('a', 'slide-sources__link', source.title)
      link.href = source.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.referrerPolicy = 'no-referrer'
      const host = linkHost(source.url)
      if (host) link.title = host
      item.appendChild(link)
    } else {
      diagnostics.push({ code: 'unsafe-source-url', message: 'Unsafe source URL omitted.', slideIndex })
      item.textContent = source.title
    }
    list.appendChild(item)
  }
  footer.appendChild(list)
  return footer
}

/** Text-heavy slides step down in size so they still fit the fixed 16:9 canvas. */
export function slideDensity(slide: ValidatedSlide): 'dense' | 'compact' | null {
  const { lines } = contentLines(slide.content ?? '')
  const structured = [
    ...(slide.columns ?? []).map((column) => `${column.heading} ${column.content ?? ''}`),
    ...(slide.timeline ?? []).map((step) => `${step.label} ${step.text}`),
  ]
  const characters = lines.join('').length + structured.join('').length + (slide.code ? slide.code.source.length / 2 : 0)
  const items = lines.length + structured.length + (slide.code?.source.split('\n').length ?? 0) / 3
  if (items >= 8 || characters > 620) return 'compact'
  if (items >= 6 || characters > 380) return 'dense'
  return null
}

/** Speaker notes carry the full citation list so presenters can read URLs aloud or share them. */
export function speakerNotesText(slide: ValidatedSlide): string | undefined {
  const sources = slide.sources?.map((source, index) => `${index + 1}. ${source.title} — ${source.url}`) ?? []
  const parts = [slide.notes?.trim(), sources.length ? `Sources:\n${sources.join('\n')}` : undefined].filter(Boolean)
  return parts.length ? parts.join('\n\n') : undefined
}

function renderLayoutBody(slide: ValidatedSlide, layout: SlideLayout): HTMLElement[] {
  const parts: HTMLElement[] = []
  if (slide.kicker) parts.push(element('p', 'slide-kicker', slide.kicker))
  if (slide.title) parts.push(element(layout === 'title' ? 'h1' : 'h2', 'slide-title', slide.title))
  if (slide.subtitle) parts.push(element('p', 'slide-subtitle', slide.subtitle))

  if (slide.content) {
    if (containsLegacyRawHtml(slide.content) && containsExecutableLegacyContent(slide.content)) {
      throw new Error('unsafe legacy content: raw html is rejected by the default rendering path')
    }
    parts.push(textBlock(slide.content, { className: 'slide-content', fragments: slide.fragments, asParagraphs: PARAGRAPH_LAYOUTS.has(layout) }))
  }

  if (slide.stats) parts.push(renderStats(slide))
  if (slide.columns) parts.push(renderColumns(slide))
  if (slide.timeline) parts.push(renderTimeline(slide))
  if (slide.quote) parts.push(renderQuote(slide))
  if (slide.code) parts.push(renderCode(slide))
  return parts
}

export function buildSafeSlideDom(input: RenderableDeck): { element: HTMLElement; diagnostics: RenderDiagnostic[] } {
  const diagnostics: RenderDiagnostic[] = []
  const revealEl = element('div', `reveal theme-${input.theme ?? DEFAULT_THEME}`)
  if (input.language) revealEl.lang = input.language
  const slidesEl = element('div', 'slides')

  input.slides.forEach((slide, slideIndex) => {
    const layout = resolveSlideLayout(slide)
    const section = element('section', `slide slide--${layout}`)
    section.setAttribute('data-layout', layout)
    const density = slideDensity(slide)
    if (density) section.classList.add(`slide--${density}`)
    if ((slide.title?.length ?? 0) > 64) section.classList.add('slide--long-title')
    const background = slide.backgroundImage ?? slide.background

    if (slide.background && slide.backgroundImage && slide.background !== slide.backgroundImage) {
      diagnostics.push({
        code: 'background-image-alias-collision',
        message: 'Both background and backgroundImage were provided; backgroundImage was used as the URL image source.',
        slideIndex,
      })
    }

    if (background) {
      if (isSafeImageUrl(background)) {
        section.setAttribute(REVEAL_BACKGROUND_IMAGE_ATTRIBUTE, background)
        section.classList.add('slide--image-background')
      } else {
        diagnostics.push({ code: 'unsafe-background-url', message: 'Unsafe generated background URL omitted.', slideIndex })
      }
    }

    if (slide.attributes) {
      for (const [key, value] of Object.entries(slide.attributes)) {
        if (ALLOWED_ATTRIBUTES.has(key) && !/^on/i.test(key) && !/javascript:/i.test(value)) {
          section.setAttribute(key, value)
        } else {
          diagnostics.push({ code: 'unsafe-attribute', message: 'Unsafe generated attribute omitted.', slideIndex, key })
        }
      }
    }

    const body = element('div', `slide-body slide-body--${layout}`)
    const parts = renderLayoutBody(slide, layout)
    const figure = renderFigure(slide, slideIndex, diagnostics)
    if (figure) {
      section.classList.add('slide--has-figure')
      const split = element('div', `slide-split slide-split--image-${slide.image?.position ?? 'right'}`)
      const text = element('div', 'slide-split__text')
      text.append(...parts)
      split.append(text, figure)
      body.appendChild(split)
    } else {
      body.append(...parts)
    }
    section.appendChild(body)

    const sources = renderSources(slide, slideIndex, diagnostics)
    if (sources) section.appendChild(sources)

    const notes = speakerNotesText(slide)
    if (notes) section.appendChild(element('aside', 'notes', notes))

    slidesEl.appendChild(section)
  })

  revealEl.appendChild(slidesEl)
  return { element: revealEl, diagnostics }
}
