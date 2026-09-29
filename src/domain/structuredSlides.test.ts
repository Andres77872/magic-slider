import { describe, expect, it } from 'vitest'

import showcase from '../../public/templates/showcase.json'
import { applyPresentationAction } from '../agent/presentationActionReducer'
import { parsePresentationToolCall, parsePresentationToolCalls } from './presentationActions'
import { deckTitle, effectivePlugins, validatePresentation } from './presentationSchema'

const image = { url: 'https://v3.fal.media/files/example/detail.jpg', alt: 'Abstract shapes' }

function toolCall(name: string, args: unknown) {
  return { type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

describe('structured slide contract', () => {
  it('accepts the showcase deck shared with the agent contract tests', () => {
    const result = validatePresentation(showcase)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.data.theme).toBe('ocean')
    expect(new Set(result.data.slides.map((slide) => slide.layout))).toEqual(new Set(['title', 'section', 'content', 'split', 'statement', 'stats', 'comparison', 'timeline', 'quote', 'closing']))
  })

  it.each([
    ['unknown layout', { layout: 'hero' }],
    ['image without alt text', { image: { url: image.url } }],
    ['image with empty alt text', { image: { ...image, alt: '' } }],
    ['unsafe image URL', { image: { ...image, url: 'javascript:alert(1)' } }],
    ['protocol-relative image URL', { image: { ...image, url: '//tracker.test/x.png' } }],
    ['too many stats', { stats: Array.from({ length: 5 }, () => ({ value: '1', label: 'x' })) }],
    ['single comparison column', { columns: [{ heading: 'Only' }] }],
    ['single timeline step', { timeline: [{ label: '2024', text: 'Start' }] }],
    ['quote without text', { quote: { attribution: 'Someone' } }],
    ['script source URL', { sources: [{ title: 'Bad', url: 'javascript:alert(1)' }] }],
    ['relative source URL', { sources: [{ title: 'Bad', url: '/internal' }] }],
    ['source URL with credentials', { sources: [{ title: 'Bad', url: 'https://user:pass@example.com' }] }],
    ['code language markup', { code: { language: 'js"><script>', source: 'x' } }],
    ['unknown field', { html: '<b>x</b>' }],
  ])('rejects %s', (_label, slide) => {
    expect(validatePresentation({ slides: [slide] })).toMatchObject({ ok: false })
  })

  it('rejects unknown deck themes and malformed languages', () => {
    expect(validatePresentation({ slides: [{ title: 'x' }], theme: 'neon' })).toMatchObject({ ok: false })
    expect(validatePresentation({ slides: [{ title: 'x' }], language: 'english<script>' })).toMatchObject({ ok: false })
    expect(validatePresentation({ slides: [{ title: 'x' }], language: 'es-MX', theme: 'paper' })).toMatchObject({ ok: true })
  })

  it('derives a deck title and adds the highlight plugin for code slides', () => {
    expect(deckTitle({ slides: [{ content: 'x' }, { title: ' Second ' }] })).toBe('Second')
    expect(deckTitle({ title: 'Explicit', slides: [{ title: 'First' }] })).toBe('Explicit')
    expect(effectivePlugins({ plugins: ['notes'], slides: [{ code: { source: 'x' } }] })).toEqual(['notes', 'highlight'])
  })
})

describe('structured slide actions', () => {
  const deck = {
    title: 'Deck',
    theme: 'midnight' as const,
    revealOptions: { controls: true, transition: 'slide' as const },
    slides: [{ title: 'Intro', image, subtitle: 'Sub' }, { title: 'Next' }],
  }

  it('removes fields with null patch values and keeps the others', () => {
    const action = parsePresentationToolCall(toolCall('edit_slide', { slideIndex: 0, patch: { image: null, layout: 'statement' } }))
    const result = applyPresentationAction(deck, action)
    expect(result).toMatchObject({ ok: true })
    expect(result.deck?.slides[0]).toEqual({ title: 'Intro', subtitle: 'Sub', layout: 'statement' })
    expect(deck.slides[0].image).toEqual(image)
  })

  it('rejects empty slide patches', () => {
    expect(() => parsePresentationToolCall(toolCall('edit_slide', { slideIndex: 0, patch: {} }))).toThrow()
  })

  it('keeps field refinements in patches and validates the patched deck as a whole', () => {
    expect(() => parsePresentationToolCall(toolCall('edit_slide', { slideIndex: 0, patch: { content: '<iframe src="x"></iframe>' } }))).toThrow(/raw HTML/)
    const result = applyPresentationAction(deck, { action: 'edit_slide', slideIndex: 1, patch: { stats: [] } })
    expect(result).toMatchObject({ ok: false, deck })
  })

  it('updates deck settings and merges reveal options without touching slides', () => {
    const action = parsePresentationToolCall(toolCall('update_deck', { theme: 'paper', revealOptions: { slideNumber: true } }))
    const result = applyPresentationAction(deck, action)
    expect(result).toMatchObject({ ok: true })
    expect(result.deck).toEqual({ ...deck, theme: 'paper', revealOptions: { controls: true, transition: 'slide', slideNumber: true } })
  })

  it('rejects empty or unsafe deck updates', () => {
    expect(() => parsePresentationToolCall(toolCall('update_deck', {}))).toThrow()
    expect(() => parsePresentationToolCall(toolCall('update_deck', { slides: [] }))).toThrow()
    expect(() => parsePresentationToolCall(toolCall('update_deck', { theme: 'neon' }))).toThrow()
    expect(applyPresentationAction(null, { action: 'update_deck', theme: 'paper' })).toMatchObject({ ok: false })
  })

  it('creates decks with deck-level settings', () => {
    const action = parsePresentationToolCall(toolCall('create_deck', showcase))
    const result = applyPresentationAction(null, action)
    expect(result).toMatchObject({ ok: true, deck: { title: 'Magic Slider showcase', theme: 'ocean', language: 'en' } })
  })
})

describe('apply_changes batches', () => {
  const deck = {
    theme: 'midnight' as const,
    slides: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }, { title: 'Four' }, { title: 'Five' }],
  }

  it('expands one call into ordered actions that apply like separate calls', () => {
    const actions = parsePresentationToolCalls(toolCall('apply_changes', { changes: [
      { action: 'edit_slide', slideIndex: 1, patch: { title: 'Second' } },
      { action: 'reorder_slides', fromIndex: 4, toIndex: 4 },
      { action: 'add_slide', afterIndex: 2, slide: { layout: 'timeline', title: 'Milestones', timeline: [{ label: '2023', text: 'A' }, { label: '2024', text: 'B' }] } },
      { action: 'update_deck', theme: 'forest', revealOptions: { postMessage: true, slideNumber: true } },
    ] }))
    expect(actions.map((action) => action.action)).toEqual(['edit_slide', 'reorder_slides', 'add_slide', 'update_deck'])
    let current: typeof deck | null = deck
    for (const action of actions) {
      const result = applyPresentationAction(current, action)
      expect(result).toMatchObject({ ok: true })
      current = result.deck as typeof deck
    }
    expect(current?.slides.map((slide) => slide.title)).toEqual(['One', 'Second', 'Three', 'Milestones', 'Four', 'Five'])
    expect(current).toMatchObject({ theme: 'forest', revealOptions: { slideNumber: true } })
    expect((current as { revealOptions?: Record<string, unknown> }).revealOptions).not.toHaveProperty('postMessage')
  })

  it('keeps single tool calls working and rejects unsafe batches', () => {
    expect(parsePresentationToolCalls(toolCall('delete_slide', { slideIndex: 0 }))).toEqual([{ action: 'delete_slide', slideIndex: 0 }])
    for (const args of [
      {},
      { changes: [] },
      { changes: [{ action: 'create_deck', slides: [{ title: 'x' }] }] },
      { changes: [{ action: 'apply_changes', changes: [] }] },
      { changes: [{ action: 'edit_slide', slideIndex: 0, patch: {} }] },
      { changes: [{ action: 'edit_slide', slideIndex: 0, patch: { content: '<p>x</p>' } }] },
      { changes: [{ slideIndex: 0 }] },
      { changes: [{ action: 'delete_slide', slideIndex: 0 }], extra: true },
      { changes: Array.from({ length: 51 }, () => ({ action: 'delete_slide', slideIndex: 0 })) },
    ]) {
      expect(() => parsePresentationToolCalls(toolCall('apply_changes', args))).toThrow()
    }
    expect(() => parsePresentationToolCall(toolCall('apply_changes', { changes: [] }))).toThrow(/Unsupported presentation tool/)
  })
})

describe('generated slide repair', () => {
  it('rejoins a multi-line content string that the model split into a key', () => {
    const slide = {
      layout: 'content',
      title: 'Un salto del jitomate no equivale a la inflación total',
      content: 'Inflación general anual de la quincena: 3.42%.',
      'La inflación subyacente anual de la quincena fue 3.79%. Jitomate: precio +22.79%.': '',
    }
    const [action] = parsePresentationToolCalls(toolCall('create_deck', { slides: [{ title: 'Portada' }, slide] }))
    expect(action).toMatchObject({ action: 'create_deck' })
    if (action.action !== 'create_deck') return
    expect(action.slides[1].content).toBe('Inflación general anual de la quincena: 3.42%.\nLa inflación subyacente anual de la quincena fue 3.79%. Jitomate: precio +22.79%.')
  })

  it('drops unknown top-level fields but keeps nested and safety validation strict', () => {
    const [action] = parsePresentationToolCalls(toolCall('add_slide', { slide: { title: 'Kept', html: '<b>x</b>', layoutHint: 'wide' } }))
    expect(action).toEqual({ action: 'add_slide', slide: { title: 'Kept' } })
    expect(() => parsePresentationToolCalls(toolCall('add_slide', { slide: { title: 'x', image: { url: '/a.png', alt: 'a', extra: 1 } } }))).toThrow()
    expect(() => parsePresentationToolCalls(toolCall('add_slide', { slide: { content: '<script>alert(1)</script>' } }))).toThrow()
    expect(() => parsePresentationToolCalls(toolCall('add_slide', { slide: { backgroundImage: 'javascript:alert(1)' } }))).toThrow()
  })
})
