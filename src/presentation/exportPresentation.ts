import revealSource from 'reveal.js?raw'
import revealCss from 'reveal.js/reveal.css?raw'
import highlightCss from 'reveal.js/plugin/highlight/monokai.css?raw'
import presentationCss from '../css/presentation.css?raw'

import { deckTitle, presentationConfigSchema } from '../domain/presentationSchema'
import type { ValidatedPresentationConfig } from '../domain/presentationTypes'
import { appOwnedRevealOptions, normalizeGeneratedRevealOptions } from './revealConfig'
import { buildSafeSlideDom } from './safeSlideRenderer'

const IMAGE_SELECTOR = '[data-background-image], img[data-src]'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 20_000

export interface ExportAssets {
  /** Absolute image URL → data URL, so the exported file works offline. */
  embeddedImages?: ReadonlyMap<string, string>
  /** Applies syntax highlighting to code blocks before serialization. */
  highlight?: (code: HTMLElement) => void
}

export interface ExportResult {
  html: string
  embeddedImages: number
  linkedImages: number
}

function imageAttribute(node: Element): 'data-background-image' | 'data-src' {
  return node.hasAttribute('data-background-image') ? 'data-background-image' : 'data-src'
}

function absoluteImageUrls(element: HTMLElement, baseUrl: string): string[] {
  const urls = new Set<string>()
  for (const node of element.querySelectorAll(IMAGE_SELECTOR)) {
    const attribute = imageAttribute(node)
    const absolute = new URL(node.getAttribute(attribute)!, baseUrl).href
    node.setAttribute(attribute, absolute)
    urls.add(absolute)
  }
  return [...urls]
}

// Only the installed viewer code is embedded. Application code, chat history,
// environment variables, and authentication configuration never enter the file.
export function exportPresentationHtml(input: ValidatedPresentationConfig, baseUrl = window.location.href, assets: ExportAssets = {}): string {
  const config = presentationConfigSchema.parse(input)
  const { element } = buildSafeSlideDom(config)
  absoluteImageUrls(element, baseUrl)
  for (const node of element.querySelectorAll(IMAGE_SELECTOR)) {
    const attribute = imageAttribute(node)
    const embedded = assets.embeddedImages?.get(node.getAttribute(attribute)!)
    if (embedded) node.setAttribute(attribute, embedded)
  }
  const codeBlocks = element.querySelectorAll<HTMLElement>('pre.slide-code code')
  if (assets.highlight) codeBlocks.forEach((code) => assets.highlight?.(code))

  const doc = document.implementation.createHTMLDocument(deckTitle(config))
  doc.documentElement.lang = config.language ?? 'en'
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  doc.head.prepend(charset)
  const viewport = doc.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  doc.head.appendChild(viewport)
  const generator = doc.createElement('meta')
  generator.name = 'generator'
  generator.content = 'Magic Slider'
  doc.head.appendChild(generator)
  const style = doc.createElement('style')
  style.textContent = `${revealCss}\n${codeBlocks.length ? highlightCss : ''}\n${presentationCss}\n
    html, body { margin: 0; width: 100%; height: 100%; background: #050708; }
    body.reveal-container { height: 100%; min-height: 0; border: 0; border-radius: 0; box-shadow: none; }
    .export-notes { position: fixed; z-index: 100; bottom: 20px; left: 20px; max-width: min(620px, 80vw); background: rgb(12 16 18 / 94%); color: #f3f6f5; padding: 10px 16px; border: 1px solid rgb(255 255 255 / 14%); border-radius: 12px; font: 15px/1.55 system-ui, sans-serif; }
    .export-notes summary { cursor: pointer; font-weight: 600; }
    .export-notes p { white-space: pre-wrap; max-height: 35vh; overflow: auto; margin: 10px 0 4px; overflow-wrap: anywhere; }
    #export-error { position: fixed; inset: 20px; z-index: 200; color: #fff; background: #101820; padding: 24px; font: 20px system-ui, sans-serif; }
    @media print { .export-notes { display: none; } }
  `
  doc.head.appendChild(style)
  doc.body.className = 'reveal-container'
  doc.body.appendChild(doc.importNode(element, true))

  const notes = doc.createElement('details')
  notes.className = 'export-notes'
  const summary = doc.createElement('summary')
  summary.textContent = 'Speaker notes'
  notes.appendChild(summary)
  const notesText = doc.createElement('p')
  notesText.id = 'export-notes-text'
  notesText.textContent = 'No notes for this slide.'
  notes.appendChild(notesText)
  doc.body.appendChild(notes)

  const script = doc.createElement('script')
  script.type = 'module'
  const { width, height, margin, hash, history, respondToHashChanges, postMessage, postMessageEvents, scrollActivationWidth, view } = appOwnedRevealOptions
  const options = {
    ...normalizeGeneratedRevealOptions(config.revealOptions).options,
    width, height, margin, hash, history, respondToHashChanges, postMessage, postMessageEvents, scrollActivationWidth, view,
    embedded: true,
    keyboard: true,
    plugins: [],
  }
  script.textContent = `
    try {
      if (window.location.search) throw new Error('Open the presentation without URL query parameters.');
      const moduleUrl = URL.createObjectURL(new Blob([${JSON.stringify(revealSource)}], { type: 'text/javascript' }));
      let Reveal;
      try { ({ default: Reveal } = await import(moduleUrl)); }
      finally { URL.revokeObjectURL(moduleUrl); }
      for (const image of document.querySelectorAll('.slide-figure__image')) {
        image.addEventListener('error', () => image.closest('.slide-figure')?.classList.add('slide-figure--failed'));
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
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${type};base64,${btoa(binary)}`
}

async function fetchImageAsDataUrl(url: string, fetchImpl: typeof fetch): Promise<{ dataUrl: string; bytes: number } | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok) return null
    const declaredBytes = Number(response.headers.get('content-length') ?? 0)
    if (declaredBytes > MAX_IMAGE_BYTES) return null
    const blob = await response.blob()
    if (blob.size > MAX_IMAGE_BYTES) return null
    const dataUrl = await toDataUrl(blob)
    return dataUrl ? { dataUrl, bytes: blob.size } : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * Builds a self-contained export: images are embedded when their host allows
 * cross-origin reads, and code is highlighted ahead of time. Anything that
 * cannot be embedded stays linked, so the export never fails because of assets.
 */
export async function exportPresentationWithAssets(
  input: ValidatedPresentationConfig,
  deps: { baseUrl?: string; fetch?: typeof fetch } = {},
): Promise<ExportResult> {
  const baseUrl = deps.baseUrl ?? window.location.href
  const fetchImpl = deps.fetch ?? fetch
  const config = presentationConfigSchema.parse(input)
  const urls = absoluteImageUrls(buildSafeSlideDom(config).element, baseUrl)

  const embeddedImages = new Map<string, string>()
  let totalBytes = 0
  const queue = [...urls]
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const image = await fetchImageAsDataUrl(url, fetchImpl)
      if (!image || totalBytes + image.bytes > MAX_TOTAL_IMAGE_BYTES) continue
      totalBytes += image.bytes
      embeddedImages.set(url, image.dataUrl)
    }
  })
  await Promise.all(workers)

  let highlight: ExportAssets['highlight']
  if (config.slides.some((slide) => slide.code)) {
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
    html: exportPresentationHtml(config, baseUrl, { embeddedImages, highlight }),
    embeddedImages: embeddedImages.size,
    linkedImages: urls.length - embeddedImages.size,
  }
}
