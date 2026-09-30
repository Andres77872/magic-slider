import { describe, expect, it } from 'vitest'

import { exportDeckHtml, exportDeckWithAssets, deckFileName } from './exportDeck'
import { normalizeDeck } from '../domain/normalize'
import { deckTemplates } from '../templates'

describe('v2 HTML export', () => {
  const deck = normalizeDeck(deckTemplates[0].deck).deck!

  it('bundles the viewer, styles, theme variables and every slide', () => {
    const html = exportDeckHtml(deck, 'https://studio.example/v2/')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('ms-deck')
    expect(html).toContain('--ms-accent')
    expect(html.match(/<section class="ms-slide/g)).toHaveLength(deck.slides.length)
    expect(html).toContain('fonts.googleapis.com')
    expect(html).toContain('Magic Slider v2')
  })

  it('keeps generated text inert', () => {
    const hostile = normalizeDeck({ title: '</script><script>alert(1)</script>', slides: [{ blocks: [{ type: 'text', text: '</script><img src=x onerror=alert(1)>' }] }] }).deck!
    const html = exportDeckHtml(hostile, 'https://studio.example/')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('embeds images the host allows and reports the rest as linked', async () => {
    const withImages = normalizeDeck({ slides: [{ background: { image: { src: 'https://img.example/a.jpg' } }, blocks: [{ type: 'image', src: 'https://img.example/b.png', alt: 'b' }] }] }).deck!
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
    const fetchImpl = (async (url: string) => ({
      ok: url.endsWith('a.jpg'),
      headers: { get: () => null },
      blob: async () => image,
    })) as unknown as typeof fetch
    const result = await exportDeckWithAssets(withImages, { baseUrl: 'https://studio.example/', fetch: fetchImpl })
    expect(result.embeddedImages).toBe(1)
    expect(result.linkedImages).toBe(1)
    expect(result.html).toContain('data:image/jpeg;base64,')
  })

  it('names files after the deck title', () => {
    expect(deckFileName(deck, 'html')).toBe('Magic-Slider-v2-primitives-tour.html')
  })
})
