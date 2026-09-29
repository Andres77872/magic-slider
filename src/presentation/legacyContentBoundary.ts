import { createAppError, type AppErrorDiagnostic, type RenderError } from '../lib/errors'

export type LegacyContentDiagnostic = AppErrorDiagnostic

export type LegacyContentResult =
  | { ok: true; text: string; diagnostics?: LegacyContentDiagnostic[] }
  | { ok: false; error: RenderError }

const HTML_TAG_NAMES = [
  'a', 'abbr', 'article', 'aside', 'audio', 'b', 'base', 'blockquote', 'body', 'br', 'button', 'canvas', 'code', 'div', 'em',
  'embed', 'font', 'footer', 'form', 'frame', 'frameset', 'h[1-6]', 'head', 'header', 'hr', 'html', 'i', 'iframe', 'img', 'input',
  'label', 'li', 'link', 'main', 'marquee', 'math', 'meta', 'nav', 'object', 'ol', 'option', 'p', 'pre', 'script', 'section',
  'select', 'small', 'source', 'span', 'strong', 'style', 'sub', 'sup', 'svg', 'table', 'tbody', 'td', 'template', 'textarea',
  'th', 'thead', 'tr', 'u', 'ul', 'video',
].join('|')
// Real markup only: plain-text notation such as Promise<void> or Map<K, V> stays valid content.
const RAW_HTML_PATTERN = new RegExp(`<\\/?(?:${HTML_TAG_NAMES})(?=[\\s/>])[^<>]*>`, 'i')

export function containsLegacyRawHtml(input: string): boolean {
  return RAW_HTML_PATTERN.test(input)
}

export function normalizeLegacyContent(input: string): LegacyContentResult {
  if (!containsLegacyRawHtml(input)) return { ok: true, text: input }

  return {
    ok: false,
    error: createAppError({
      category: 'unsafe-legacy-content',
      message: 'Unsafe legacy content contains raw html and is rejected by the default path.',
      diagnostics: [{ code: 'raw-html', message: 'Legacy raw HTML must be cleaned to text or migrated.' }],
    }) as RenderError,
  }
}

export function containsExecutableLegacyContent(input: string): boolean {
  return /<\s*(script|iframe|object|embed|link|meta)\b/i.test(input)
    || /\son[a-z]+\s*=/i.test(input)
    || /\sstyle\s*=/i.test(input)
    || /(?:href|src)\s*=\s*["']?\s*javascript:/i.test(input)
}
