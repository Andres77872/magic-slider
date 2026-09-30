import revealSource from 'reveal.js?raw'
import revealCss from 'reveal.js/reveal.css?raw'
import highlightCss from 'reveal.js/plugin/highlight/monokai.css?raw'
import deckCss from '../styles/deck.css?raw'

import { deckTitle, type Deck } from '../domain/deckSchema'
export { deckFileName, downloadFile } from './download'
import { normalizeDeck } from '../domain/normalize'
import { applyFitScales, type FitScales } from './fit'
import { buildDeckElement, deckUsesCode } from './renderDeck'
import { revealOptionsFor } from './revealDeck'
import { fontStylesheetUrl } from './theme'

/**
 * Self-contained HTML export: the installed Reveal viewer, the primitive
 * stylesheet and the rendered deck in one file. Images are embedded when
 * their host allows cross-origin reads; code is highlighted ahead of time.
 * Application code, chat history and credentials never enter the file.
 */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 20_000
const IMAGE_SELECTOR = '[data-background-image], img[data-src], video[poster]'

export interface ExportAssets {
  embeddedImages?: ReadonlyMap<string, string>
  highlight?: (code: HTMLElement) => void
  fitScales?: FitScales
}

export interface ExportResult {
  html: string
  embeddedImages: number
  linkedImages: number
}

function imageAttribute(node: Element): 'data-background-image' | 'data-src' | 'poster' {
  if (node.hasAttribute('data-background-image')) return 'data-background-image'
  return node.tagName === 'VIDEO' ? 'poster' : 'data-src'
}

function collectImageUrls(element: HTMLElement, baseUrl: string): string[] {
  const urls = new Set<string>()
  for (const node of element.querySelectorAll(IMAGE_SELECTOR)) {
    const attribute = imageAttribute(node)
    const absolute = new URL(node.getAttribute(attribute)!, baseUrl).href
    node.setAttribute(attribute, absolute)
    urls.add(absolute)
  }
  return [...urls]
}

export function exportDeckHtml(input: Deck, baseUrl = window.location.href, assets: ExportAssets = {}): string {
  const { deck } = normalizeDeck(input)
  if (!deck) throw new Error('The presentation has no valid slides to export.')
  const { element, theme } = buildDeckElement(deck, 'export')
  if (assets.fitScales) applyFitScales(element, assets.fitScales)
  collectImageUrls(element, baseUrl)
  for (const node of element.querySelectorAll(IMAGE_SELECTOR)) {
    const attribute = imageAttribute(node)
    const embedded = assets.embeddedImages?.get(node.getAttribute(attribute)!)
    if (embedded) node.setAttribute(attribute, embedded)
  }
  const codeBlocks = element.querySelectorAll<HTMLElement>('.ms-code__pre code')
  if (assets.highlight) codeBlocks.forEach((code) => assets.highlight?.(code))

  const doc = document.implementation.createHTMLDocument(deckTitle(deck))
  doc.documentElement.lang = deck.language ?? 'en'
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  doc.head.prepend(charset)
  const viewport = doc.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  doc.head.appendChild(viewport)
  const generator = doc.createElement('meta')
  generator.name = 'generator'
  generator.content = 'Magic Slider v2'
  doc.head.appendChild(generator)
  const fonts = fontStylesheetUrl(theme)
  if (fonts) {
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = fonts
    doc.head.appendChild(link)
  }
  const style = doc.createElement('style')
  style.textContent = `${revealCss}\n${codeBlocks.length ? highlightCss : ''}\n${deckCss}\n
    html, body { margin: 0; width: 100%; height: 100%; background: ${theme.colors.background}; }
    body > .reveal { width: 100%; height: 100%; }
    .export-notes { position: fixed; z-index: 100; bottom: 18px; left: 18px; max-width: min(620px, 80vw); background: rgb(12 16 18 / 94%); color: #f3f6f5; padding: 10px 16px; border: 1px solid rgb(255 255 255 / 14%); border-radius: 12px; font: 15px/1.55 system-ui, sans-serif; }
    .export-notes summary { cursor: pointer; font-weight: 600; }
    .export-notes p { white-space: pre-wrap; max-height: 35vh; overflow: auto; margin: 10px 0 4px; overflow-wrap: anywhere; }
    #export-error { position: fixed; inset: 20px; z-index: 200; color: #fff; background: #101820; padding: 24px; font: 20px system-ui, sans-serif; }
    @media print { .export-notes { display: none; } }
  `
  doc.head.appendChild(style)
  doc.body.appendChild(doc.importNode(element, true))

  const notes = doc.createElement('details')
  notes.className = 'export-notes'
  const summary = doc.createElement('summary')
  summary.textContent = 'Speaker notes'
  const notesText = doc.createElement('p')
  notesText.id = 'export-notes-text'
  notesText.textContent = 'No notes for this slide.'
  notes.append(summary, notesText)
  doc.body.appendChild(notes)

  const script = doc.createElement('script')
  script.type = 'module'
  const options = { ...revealOptionsFor(deck), keyboardCondition: null, plugins: [] }
  script.textContent = `
    try {
      if (window.location.search) throw new Error('Open the presentation without URL query parameters.');
      const moduleUrl = URL.createObjectURL(new Blob([${JSON.stringify(revealSource)}], { type: 'text/javascript' }));
      let Reveal;
      try { ({ default: Reveal } = await import(moduleUrl)); }
      finally { URL.revokeObjectURL(moduleUrl); }
      for (const image of document.querySelectorAll('.ms-image__img')) {
        image.addEventListener('error', () => image.closest('.ms-image')?.classList.add('ms-image--failed'));
      }
      const deck = new Reveal(document.querySelector('.reveal'), ${JSON.stringify(options)});
      const updateNotes = () => {
        document.getElementById('export-notes-text').textContent = deck.getCurrentSlide()?.querySelector('aside.notes')?.textContent || 'No notes for this slide.';
      };
      deck.on('slidechanged', updateNotes);
      await deck.initialize();
      updateNotes();
    } catch (error) {
      const message = document.createElement('p');
      message.id = 'export-error';
      message.setAttribute('role', 'alert');
      message.textContent = error instanceof Error ? error.message : 'The presentation could not start.';
      document.body.appendChild(message);
    }
  `.replace(/</g, '\\u003c')
  doc.body.appendChild(script)
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

async function toDataUrl(blob: Blob): Promise<string | null> {
  const type = blob.type.split(';')[0].trim().toLowerCase()
  if (!/^image\/[a-z0-9.+-]+$/.test(type)) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return `data:${type};base64,${btoa(binary)}`
}

async function fetchImage(url: string, fetchImpl: typeof fetch): Promise<{ dataUrl: string; bytes: number } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return null
    const blob = await response.blob()
    if (blob.size > MAX_IMAGE_BYTES) return null
    const dataUrl = await toDataUrl(blob)
    return dataUrl ? { dataUrl, bytes: blob.size } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function exportDeckWithAssets(deck: Deck, deps: { baseUrl?: string; fetch?: typeof fetch; fitScales?: FitScales } = {}): Promise<ExportResult> {
  const baseUrl = deps.baseUrl ?? window.location.href
  const fetchImpl = deps.fetch ?? fetch
  const urls = collectImageUrls(buildDeckElement(deck, 'export').element, baseUrl)
  const embeddedImages = new Map<string, string>()
  let total = 0
  const queue = [...urls]
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const image = await fetchImage(url, fetchImpl)
      if (!image || total + image.bytes > MAX_TOTAL_IMAGE_BYTES) continue
      total += image.bytes
      embeddedImages.set(url, image.dataUrl)
    }
  }))
  let highlight: ExportAssets['highlight']
  if (deckUsesCode(deck)) {
    try {
      const { default: hljs } = await import('highlight.js/lib/common')
      highlight = (code) => {
        if (!code.classList.contains('nohighlight')) hljs.highlightElement(code)
      }
    } catch {
      highlight = undefined
    }
  }
  return {
    html: exportDeckHtml(deck, baseUrl, { embeddedImages, highlight, fitScales: deps.fitScales }),
    embeddedImages: embeddedImages.size,
    linkedImages: urls.length - embeddedImages.size,
  }
}
