import { describe, expect, it } from 'vitest'

import type { ValidatedPresentationConfig } from '../domain/presentationTypes'
import { DECK_CONTEXT_MAX_CHARS, formatDeckContext } from './deckContextFormatter'

const deckFixture: ValidatedPresentationConfig = {
  slides: [
    {
      title: 'Opening',
      content: 'Safe opening content',
      notes: 'Speaker notes for opening',
      background: '#112233',
      backgroundImage: 'https://example.test/opening.png',
      attributes: { 'data-transition': 'fade', 'data-auto-animate': 'true' },
    },
    { title: 'Pricing', content: 'Safe pricing content' },
    { title: 'Conclusion', content: 'Safe closing content' },
  ],
  plugins: ['highlight', 'notes'],
  revealOptions: { controls: true, transition: 'slide' },
}

describe('formatDeckContext', () => {
  it('includes a current validated deck header, slide count, and zero-based slide indices', () => {
    const context = formatDeckContext(deckFixture)

    expect(context).toContain('Current validated deck context')
    expect(context).toContain('slideCount: 3')
    expect(context).toContain('slideIndex: 0')
    expect(context).toContain('slideIndex: 1')
    expect(context).toContain('slideIndex: 2')
    expect(context).not.toContain('first slide')
  })

  it('includes incremental tool guidance and reserves create_deck for explicit new deck requests', () => {
    const context = formatDeckContext(deckFixture)

    expect(context).toContain('edit_slide')
    expect(context).toContain('add_slide')
    expect(context).toContain('delete_slide')
    expect(context).toContain('reorder_slides')
    expect(context).toContain('zero-based slideIndex, afterIndex, fromIndex, and toIndex')
    expect(context).toContain('Use create_deck only when the user explicitly asks for a completely new deck')
  })

  it('serializes selected safe deck fields deterministically', () => {
    const context = formatDeckContext(deckFixture)

    expect(context).toContain('title: Opening')
    expect(context).toContain('content: Safe opening content')
    expect(context).toContain('notes: Speaker notes for opening')
    expect(context).toContain('background: #112233')
    expect(context).toContain('backgroundImage: https://example.test/opening.png')
    expect(context).toContain('attributes: data-auto-animate="true", data-transition="fade"')
    expect(context).toContain('plugins: highlight, notes')
    expect(context).toContain('revealOptions: controls: true, transition: slide')
  })

  it('bounds oversized deck context deterministically without mutating input', () => {
    const oversizedDeck: ValidatedPresentationConfig = {
      slides: Array.from({ length: 20 }, (_, index) => ({
        title: `Large slide ${index}`,
        content: `Long safe content ${index} `.repeat(500),
        notes: `Long safe notes ${index} `.repeat(500),
      })),
      plugins: ['notes'],
    }
    const before = structuredClone(oversizedDeck)

    const context = formatDeckContext(oversizedDeck)

    expect(context).not.toBeNull()
    expect(context?.length).toBeLessThanOrEqual(DECK_CONTEXT_MAX_CHARS)
    expect(context).toContain('slideCount: 20')
    expect(context).toContain('zero-based slideIndex')
    expect(context).toContain('[Deck content truncated: every slide index/title is listed; edit only fields requested by the user.]')
    expect(oversizedDeck).toEqual(before)
  })

  it('retains every targetable index and title when verbose content exceeds the budget', () => {
    const context = formatDeckContext({
      slides: Array.from({ length: 50 }, (_, index) => ({
        title: `Section ${index}`,
        content: 'Detailed slide content '.repeat(200),
        notes: 'Detailed speaker notes '.repeat(200),
      })),
    })!

    expect(context.length).toBeLessThanOrEqual(DECK_CONTEXT_MAX_CHARS)
    for (let index = 0; index < 50; index += 1) {
      expect(context).toContain(`slideIndex: ${index}; title: Section ${index}`)
    }
  })

  it('keeps the maximum-sized title inventory bounded and on separate lines', () => {
    const context = formatDeckContext({
      slides: Array.from({ length: 50 }, () => ({ title: 'very long title\n'.repeat(30) })),
    })!

    expect(context.length).toBeLessThanOrEqual(DECK_CONTEXT_MAX_CHARS)
    expect(context.split('\n').filter((line) => /^- slideIndex: \d+; title:/.test(line))).toHaveLength(50)
    expect(context).toContain('slideIndex: 49; title:')
  })

  it('does not introduce raw HTML parsing, DOM state, DOMPurify, or schema relaxation assumptions', () => {
    const context = formatDeckContext(deckFixture)

    expect(context).not.toContain('innerHTML')
    expect(context).not.toContain('outerHTML')
    expect(context).not.toContain('DOMPurify')
    expect(context).not.toContain('document.')
    expect(context).not.toContain('window.')
  })
})
