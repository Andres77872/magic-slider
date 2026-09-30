import { fontStylesheetUrl, type ResolvedTheme } from './theme'

const loaded = new Set<string>()

/** Adds the Google Fonts stylesheet a deck needs, once per URL. Text falls back to system fonts meanwhile. */
export function ensureDeckFonts(theme: ResolvedTheme, doc: Document = document): void {
  const url = fontStylesheetUrl(theme)
  if (!url || loaded.has(url) || !doc.head) return
  loaded.add(url)
  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  link.dataset.msFonts = ''
  doc.head.appendChild(link)
}
