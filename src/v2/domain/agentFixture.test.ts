import { describe, expect, it } from 'vitest'

import generated from '../__fixtures__/agent-solar-wind.deck.json'
import technical from '../__fixtures__/agent-rust-go.deck.json'
import { normalizeDeck } from './normalize'
import { buildDeckElement } from '../render/renderDeck'

// A create_presentation payload produced by the real v2 agent graph (research,
// visuals and author stages) through the backend's public-completion adapter.
describe('real agent output', () => {
  it('validates without warnings and renders every slide', () => {
    const { deck, diagnostics } = normalizeDeck(generated)
    expect(diagnostics.filter((diagnostic) => diagnostic.severity !== 'info')).toEqual([])
    expect(deck!.slides.length).toBeGreaterThanOrEqual(6)
    const rendered = buildDeckElement(deck!, 'reveal')
    expect(rendered.diagnostics).toEqual([])
    expect(rendered.element.querySelector('.ms-chart')).not.toBeNull()
    expect(rendered.element.querySelectorAll('.ms-slide__sources').length).toBeGreaterThan(3)
  })

  it('validates a technical deck with code, tables and charts without warnings', () => {
    const { deck, diagnostics } = normalizeDeck(technical)
    expect(diagnostics.filter((diagnostic) => diagnostic.severity !== 'info')).toEqual([])
    const rendered = buildDeckElement(deck!, 'reveal')
    expect(rendered.diagnostics).toEqual([])
    expect(rendered.element.querySelector('.ms-code')).not.toBeNull()
    expect(rendered.element.querySelector('.ms-table__table')).not.toBeNull()
  })
})
