import { getPrimitive } from '../catalog/registry'
import { colorCss, isHexColor, spaceScale, type ColorValue } from '../catalog/tokens'
import type { Block, RenderContext, RenderDiagnostic } from '../catalog/types'
import { el } from '../catalog/dom'
import { isSafeLinkUrl, linkHost } from '../../presentation/imageUrl'
import { isSafeImageUrl } from './urls'
import type { Deck, Slide } from '../domain/deckSchema'
import {
  gradientCss, mix, resolveTheme, themeVariables, toneBackground, toneVariables, type GradientPreset, type ResolvedTheme,
} from './theme'

/**
 * Framework-agnostic deck renderer. It turns a validated deck into plain DOM
 * for three hosts: the live Reveal preview, static thumbnails and the HTML
 * export. Text only ever enters the DOM as text nodes.
 */

export type RenderMode = 'reveal' | 'thumbnail' | 'export'

export const CANVAS = { '16:9': { width: 1280, height: 720 }, '4:3': { width: 1024, height: 768 } } as const

const fragmentClasses: Record<string, string[]> = {
  'fade-in': [],
  'fade-up': ['fade-up'],
  'fade-down': ['fade-down'],
  'fade-left': ['fade-left'],
  'fade-right': ['fade-right'],
  'zoom-in': ['zoom-in'],
  grow: ['grow'],
  shrink: ['shrink'],
  highlight: ['ms-fragment-highlight'],
  strike: ['strike'],
  'blur-in': ['ms-fragment-blur'],
}

function resolveColor(theme: ResolvedTheme, value: ColorValue): string {
  if (isHexColor(value)) return value
  return theme.colors[value as keyof ResolvedTheme['colors']] ?? theme.colors.background
}

export interface BackgroundSpec {
  color?: string
  gradient?: string
  image?: { src: string; size: string; position: string; opacity?: number }
  scrim?: 'gradient' | null
}

const imagePositions = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' } as const

/** Resolves a slide background to concrete CSS values shared by Reveal and static renderers. */
export function slideBackground(slide: Slide, theme: ResolvedTheme): BackgroundSpec {
  const tone = slide.tone ?? 'default'
  const background = slide.background
  const base = background?.color ? resolveColor(theme, background.color) : toneBackground(theme, tone)
  const spec: BackgroundSpec = {}
  if (background?.color || tone !== 'default') spec.color = base
  if (background?.gradient) {
    if (typeof background.gradient === 'string') {
      spec.gradient = gradientCss(theme, background.gradient as GradientPreset, base)
      // Named gradients layer translucent color over the slide's base color.
      spec.color = spec.color ?? base
    } else {
      const { from, to, angle, kind } = background.gradient
      spec.gradient = kind === 'radial'
        ? `radial-gradient(circle at 30% 20%, ${resolveColor(theme, from)} 0%, ${resolveColor(theme, to)} 100%)`
        : `linear-gradient(${angle ?? 135}deg, ${resolveColor(theme, from)} 0%, ${resolveColor(theme, to)} 100%)`
    }
  }
  const image = background?.image
  if (image && isSafeImageUrl(image.src)) {
    const overlay = image.overlay ?? 'gradient'
    const size = image.fit ?? 'cover'
    const position = imagePositions[image.position ?? 'center']
    if (overlay === 'dim') {
      spec.color = spec.color ?? base
      spec.image = { src: image.src, size, position, opacity: 0.45 }
    } else if (overlay === 'dark') {
      spec.color = mix(base, '#000000', theme.mode === 'dark' ? 0.4 : 0.85)
      spec.image = { src: image.src, size, position, opacity: 0.35 }
    } else if (overlay === 'light') {
      spec.color = mix(base, '#ffffff', theme.mode === 'light' ? 0.3 : 0.9)
      spec.image = { src: image.src, size, position, opacity: 0.3 }
    } else if (overlay === 'accent') {
      spec.color = theme.colors.accent
      spec.image = { src: image.src, size, position, opacity: 0.28 }
    } else {
      spec.image = { src: image.src, size, position }
      spec.scrim = overlay === 'gradient' ? 'gradient' : null
    }
  }
  return spec
}

function applyRevealBackground(section: HTMLElement, spec: BackgroundSpec): void {
  if (spec.color) section.setAttribute('data-background-color', spec.color)
  if (spec.gradient && !spec.image) section.setAttribute('data-background-gradient', spec.gradient)
  if (spec.image) {
    section.setAttribute('data-background-image', spec.image.src)
    section.setAttribute('data-background-size', spec.image.size)
    section.setAttribute('data-background-position', spec.image.position)
    if (spec.image.opacity !== undefined) section.setAttribute('data-background-opacity', String(spec.image.opacity))
  }
}

/** Static hosts (thumbnails) paint the background on the slide itself. */
function applyInlineBackground(section: HTMLElement, spec: BackgroundSpec): void {
  const layers: string[] = []
  if (spec.gradient && !spec.image) layers.push(spec.gradient)
  if (spec.color) section.style.backgroundColor = spec.color
  if (layers.length) section.style.backgroundImage = layers.join(', ')
  if (spec.image) {
    const image = el({ doc: section.ownerDocument }, 'div', 'ms-slide__bg-image')
    image.style.backgroundImage = `url("${spec.image.src.replace(/"/g, '%22')}")`
    image.style.backgroundSize = spec.image.size
    image.style.backgroundPosition = spec.image.position
    if (spec.image.opacity !== undefined) image.style.opacity = String(spec.image.opacity)
    section.prepend(image)
  }
}

function makeContext(doc: Document, theme: ResolvedTheme, slideId: string, diagnostics: RenderDiagnostic[]): RenderContext {
  const context: RenderContext = {
    doc,
    theme,
    slideId,
    path: '',
    diagnostics,
    report(code, message) {
      diagnostics.push({ code, message, path: context.path, slideId })
    },
    renderBlock(block, path) {
      return renderBlock(block, context, path)
    },
    renderChildren(children, parent) {
      const parentPath = context.path
      children.forEach((child, index) => parent.appendChild(renderBlock(child, context, `${parentPath}.children.${index}`)))
      context.path = parentPath
    },
  }
  return context
}

export function renderBlock(block: Block, context: RenderContext, path: string): HTMLElement {
  const previousPath = context.path
  context.path = path
  const primitive = getPrimitive(block.type)
  let node: HTMLElement
  try {
    if (!primitive) throw new Error(`Unknown primitive ${block.type}`)
    node = primitive.render(block as never, context)
  } catch (cause) {
    context.report(primitive ? 'render-failed' : 'unknown-primitive', cause instanceof Error ? cause.message : 'Block failed to render.')
    node = el(context, 'div', 'ms-block-error')
    node.setAttribute('aria-hidden', 'true')
  }
  context.path = previousPath
  node.classList.add('ms-block')
  if (block.id) node.setAttribute('data-block-id', block.id)
  if (typeof block.morphId === 'string') node.setAttribute('data-id', block.morphId)
  if (typeof block.reveal === 'string') {
    node.classList.add('fragment', ...(fragmentClasses[block.reveal] ?? []))
    if (typeof block.revealOrder === 'number') node.setAttribute('data-fragment-index', String(block.revealOrder))
  }
  if (typeof block.span === 'number') node.style.gridColumn = `span ${block.span}`
  if (typeof block.rowSpan === 'number') node.style.gridRow = `span ${block.rowSpan}`
  if (block.grow) node.classList.add('ms-grow')
  if (typeof block.maxWidth === 'string') {
    node.classList.add(`ms-maxw-${block.maxWidth}`)
    // A capped block keeps its own alignment inside a stretching column or grid cell.
    if (block.maxWidth !== 'full' && block.align === 'center') node.style.marginInline = 'auto'
    else if (block.maxWidth !== 'full' && block.align === 'end') node.style.marginInlineStart = 'auto'
  }
  return node
}

export function speakerNotes(slide: Slide): string | undefined {
  const sources = slide.sources?.map((source, index) => `${index + 1}. ${source.title} — ${source.url}`) ?? []
  const parts = [slide.notes?.trim(), sources.length ? `Sources:\n${sources.join('\n')}` : undefined].filter(Boolean)
  return parts.length ? parts.join('\n\n') : undefined
}

export interface RenderedSlide {
  element: HTMLElement
  diagnostics: RenderDiagnostic[]
}

export function renderSlide(slide: Slide, deck: Deck, theme: ResolvedTheme, mode: RenderMode, doc: Document = document): RenderedSlide {
  const diagnostics: RenderDiagnostic[] = []
  const context = makeContext(doc, theme, slide.id, diagnostics)
  const tone = slide.tone ?? 'default'
  const section = el(context, 'section', `ms-slide ms-slide--align-${slide.align ?? 'top'} ms-tone-${tone}`)
  section.setAttribute('data-slide-id', slide.id)
  if (slide.name) section.setAttribute('aria-label', slide.name)
  for (const [key, value] of Object.entries(toneVariables(theme, tone))) section.style.setProperty(key, value)

  const background = slideBackground(slide, theme)
  if (mode === 'thumbnail') applyInlineBackground(section, background)
  else applyRevealBackground(section, background)
  if (background.scrim) section.classList.add('ms-slide--scrim')
  const decoration = slide.background?.pattern ?? (background.image ? 'none' : theme.decoration)
  if (decoration !== 'none') section.classList.add(`ms-deco-${decoration}`)
  if (background.image) section.classList.add('ms-slide--image')

  if (slide.transition) section.setAttribute('data-transition', slide.transition)
  if (slide.autoAnimate) section.setAttribute('data-auto-animate', '')

  const content = el(context, 'div', 'ms-slide__content')
  // Set on the section so the content and the sources footer share the same inset.
  section.style.setProperty('--ms-slide-padding', spaceScale[slide.padding ?? 'xl'])
  section.style.setProperty('--ms-slide-gap', spaceScale[slide.gap ?? 'md'])
  slide.blocks.forEach((block, index) => content.appendChild(renderBlock(block, context, `blocks.${index}`)))
  section.appendChild(content)

  if (slide.sources?.length) {
    const footer = el(context, 'footer', 'ms-slide__sources')
    footer.appendChild(el(context, 'span', 'ms-slide__sources-label', slide.sources.length === 1 ? 'Source' : 'Sources'))
    const list = el(context, 'ol', 'ms-slide__sources-list')
    for (const source of slide.sources) {
      const item = el(context, 'li')
      if (isSafeLinkUrl(source.url)) {
        const link = el(context, 'a', 'ms-link', source.title)
        link.href = source.url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.referrerPolicy = 'no-referrer'
        const host = linkHost(source.url)
        if (host) link.title = host
        item.appendChild(link)
      } else {
        item.textContent = source.title
      }
      list.appendChild(item)
    }
    footer.appendChild(list)
    section.appendChild(footer)
  }

  if (mode !== 'thumbnail') {
    const notes = speakerNotes(slide)
    if (notes) section.appendChild(el(context, 'aside', 'notes', notes))
  }
  void deck
  return { element: section, diagnostics }
}

export interface RenderedDeck {
  element: HTMLElement
  theme: ResolvedTheme
  diagnostics: RenderDiagnostic[]
}

/** Builds the `.reveal > .slides` tree for a deck. */
export function buildDeckElement(deck: Deck, mode: RenderMode = 'reveal', doc: Document = document): RenderedDeck {
  const theme = resolveTheme(deck.theme)
  const diagnostics: RenderDiagnostic[] = []
  const root = el({ doc }, 'div', `reveal ms-deck ms-mode-${theme.mode}`)
  applyThemeVariables(root, theme)
  if (deck.language) root.lang = deck.language
  const slides = el({ doc }, 'div', 'slides')
  for (const slide of deck.slides) {
    const rendered = renderSlide(slide, deck, theme, mode, doc)
    diagnostics.push(...rendered.diagnostics)
    slides.appendChild(rendered.element)
  }
  root.appendChild(slides)
  return { element: root, theme, diagnostics }
}

export function applyThemeVariables(node: HTMLElement, theme: ResolvedTheme): void {
  for (const [key, value] of Object.entries(themeVariables(theme))) node.style.setProperty(key, value)
}

/**
 * Static hosts (thumbnails, the edit canvas) have no Reveal lazy loader:
 * resolve image data-src themselves and keep videos to their poster.
 */
export function hydrateStaticMedia(root: ParentNode): void {
  for (const image of root.querySelectorAll('img[data-src]')) {
    image.setAttribute('loading', 'lazy')
    image.setAttribute('src', image.getAttribute('data-src')!)
  }
  for (const video of root.querySelectorAll('video')) video.removeAttribute('data-src')
}

/** Whether any slide needs Reveal's highlight plugin. */
export function deckUsesCode(deck: Deck): boolean {
  const visit = (blocks: readonly Block[]): boolean => blocks.some((block) => block.type === 'code' || (block.children ? visit(block.children) : false))
  return deck.slides.some((slide) => visit(slide.blocks))
}

export { colorCss }
