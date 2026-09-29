import { describe, expect, it, vi } from 'vitest'

import showcase from '../../public/templates/showcase.json'
import type { ValidatedPresentationConfig } from '../domain/presentationTypes'
import { exportPresentationHtml, exportPresentationWithAssets } from './exportPresentation'
import { buildSafeSlideDom, contentLines, resolveSlideLayout, slideDensity, speakerNotesText } from './safeSlideRenderer'

const deck = showcase as ValidatedPresentationConfig

function section(index: number, input: ValidatedPresentationConfig = deck) {
  return buildSafeSlideDom(input).element.querySelectorAll('section')[index] as HTMLElement
}

describe('structured slide rendering', () => {
  it('applies the deck theme and language to the Reveal root', () => {
    const { element } = buildSafeSlideDom(deck)
    expect(element).toHaveClass('reveal', 'theme-ocean')
    expect(element).toHaveAttribute('lang', 'en')
    expect(buildSafeSlideDom({ slides: [{ title: 'x' }] }).element).toHaveClass('theme-midnight')
  })

  it('renders every layout with its own semantic structure', () => {
    const slides = [...buildSafeSlideDom(deck).element.querySelectorAll('section')]
    expect(slides.map((slide) => slide.dataset.layout)).toEqual(deck.slides.map((slide) => slide.layout))
    expect(slides[0].querySelector('h1.slide-title')).toHaveTextContent('Every layout Magic Slider can present')
    expect(slides[0].querySelector('.slide-kicker')).toHaveTextContent('Showcase deck')
    expect(slides[2].querySelectorAll('.slide-list__item.fragment')).toHaveLength(3)
    expect(slides[5].querySelectorAll('.slide-stat')).toHaveLength(3)
    expect(slides[6].querySelectorAll('.slide-column h3')).toHaveLength(2)
    expect(slides[7].querySelectorAll('ol.slide-timeline > li')).toHaveLength(3)
    expect(slides[8].querySelector('figure.slide-quote blockquote')).toHaveTextContent('reveal.js is an open source HTML presentation framework.')
    expect(slides[8].querySelector('figcaption')).toHaveTextContent('reveal.js documentation')
    expect(slides[9].querySelector('pre.slide-code code.language-typescript')).toHaveAttribute('data-trim')
  })

  it('renders split images lazily with alt text, caption and failure fallback', () => {
    const split = section(3)
    const img = split.querySelector('img')!
    expect(split).toHaveClass('slide--has-figure')
    expect(split.querySelector('.slide-split--image-right')).not.toBeNull()
    expect(img).toHaveAttribute('data-src', 'https://v3.fal.media/files/example/detail.jpg')
    expect(img).not.toHaveAttribute('src')
    expect(img).toHaveAttribute('alt', 'Abstract blue shapes arranged like stacked slides')
    expect(img.referrerPolicy).toBe('no-referrer')
    img.dispatchEvent(new Event('error'))
    expect(split.querySelector('figure')).toHaveClass('slide-figure--failed')
  })

  it('renders citations as safe external links and repeats them in speaker notes', () => {
    const stats = section(5)
    const link = stats.querySelector<HTMLAnchorElement>('.slide-sources a')!
    expect(link.href).toBe('https://revealjs.com/')
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
    expect(stats.querySelector('aside.notes')?.textContent).toContain('Sources:\n1. reveal.js documentation — https://revealjs.com/')
  })

  it('keeps every new text field inert', () => {
    const payload = '<img src=x onerror=alert(1)>'
    const { element } = buildSafeSlideDom({
      slides: [{
        kicker: payload, title: payload, subtitle: payload,
        stats: [{ value: payload.slice(0, 24), label: payload }],
        columns: [{ heading: payload, content: payload }, { heading: 'b' }],
        timeline: [{ label: 'a', text: payload }, { label: 'b', text: 'c' }],
        quote: { text: payload, attribution: payload },
        code: { source: '<script>alert(1)</script>' },
        sources: [{ title: payload, url: 'https://example.com/' }],
      }],
    })
    expect(element.querySelector('img, script')).toBeNull()
    expect(element.textContent).toContain(payload)
  })

  it('drops unsafe structured URLs that bypassed validation', () => {
    const { element, diagnostics } = buildSafeSlideDom({
      slides: [{ image: { url: 'javascript:alert(1)', alt: 'x' }, sources: [{ title: 'Bad', url: 'javascript:alert(1)' }] }],
    })
    expect(element.querySelector('img, a')).toBeNull()
    expect(element.querySelector('.slide-sources')).toHaveTextContent('Bad')
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unsafe-image-url', 'unsafe-source-url'])
  })

  it('turns marked lines into lists without duplicating the markers', () => {
    expect(contentLines('- One\n• Two\n\n* Three')).toEqual({ lines: ['One', 'Two', 'Three'], numbered: false })
    expect(contentLines('1. First\n2) Second')).toEqual({ lines: ['First', 'Second'], numbered: true })
    const numbered = buildSafeSlideDom({ slides: [{ content: '1. First\n2. Second' }] }).element
    expect(numbered.querySelector('ol.slide-list')).toHaveTextContent('FirstSecond')
  })

  it('infers layouts for decks created before layouts existed', () => {
    expect(resolveSlideLayout({ title: 'x' })).toBe('content')
    expect(resolveSlideLayout({ stats: [{ value: '1', label: 'x' }] })).toBe('stats')
    expect(resolveSlideLayout({ image: { url: '/a.png', alt: 'a' } })).toBe('split')
  })

  it('steps text-heavy slides down in size', () => {
    expect(slideDensity({ content: 'Short\nPoints' })).toBeNull()
    expect(slideDensity({ content: Array.from({ length: 6 }, (_, index) => `Point ${index}`).join('\n') })).toBe('dense')
    expect(slideDensity({ content: 'x'.repeat(700) })).toBe('compact')
    expect(section(0, { slides: [{ title: 'x'.repeat(80), content: 'x'.repeat(700) }] })).toHaveClass('slide--compact', 'slide--long-title')
  })

  it('omits empty speaker notes', () => {
    expect(speakerNotesText({ title: 'x' })).toBeUndefined()
    expect(section(0, { slides: [{ title: 'x' }] }).querySelector('aside.notes')).toBeNull()
  })
})

describe('self-contained export', () => {
  it('embeds reachable images, keeps unreachable ones linked, and sets document language', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('cover')) return new Response(new Uint8Array([255, 216, 255]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
      if (url.includes('detail')) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
      return new Response('missing', { status: 404 })
    })
    const result = await exportPresentationWithAssets(deck, { baseUrl: 'https://studio.example/', fetch: fetchMock as unknown as typeof fetch })
    const doc = new DOMParser().parseFromString(result.html, 'text/html')

    expect(result).toMatchObject({ embeddedImages: 1, linkedImages: 2 })
    expect(doc.documentElement.lang).toBe('en')
    expect(doc.title).toBe('Magic Slider showcase')
    expect(doc.querySelector('section')?.getAttribute('data-background-image')).toMatch(/^data:image\/jpeg;base64,/)
    expect(doc.querySelector('img')?.getAttribute('data-src')).toBe('https://v3.fal.media/files/example/detail.jpg')
    expect(fetchMock).toHaveBeenCalledWith('https://v3.fal.media/files/example/cover.jpg', expect.objectContaining({ credentials: 'omit' }))
    expect(doc.querySelectorAll('script')).toHaveLength(1)
  })

  it('pre-highlights code without executing markup from the code source', async () => {
    const result = await exportPresentationWithAssets({ slides: [{ code: { language: 'html', source: '<script>alert(1)</script>' } }] }, { baseUrl: 'https://studio.example/', fetch: vi.fn() as unknown as typeof fetch })
    const doc = new DOMParser().parseFromString(result.html, 'text/html')
    const code = doc.querySelector('pre.slide-code code')!
    expect(code.textContent).toBe('<script>alert(1)</script>')
    expect(code.querySelector('span')).not.toBeNull()
    expect(doc.querySelectorAll('script')).toHaveLength(1)
  })

  it('keeps 16:9 canvas and slide numbers in the exported viewer options', () => {
    const html = exportPresentationHtml({ slides: [{ title: 'x' }], revealOptions: { slideNumber: true } }, 'https://studio.example/')
    const script = new DOMParser().parseFromString(html, 'text/html').querySelector('script')!.textContent!
    expect(script).toContain('"width":1280')
    expect(script).toContain('"height":720')
    expect(script).toContain('"slideNumber":true')
  })
})
