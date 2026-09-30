import { describe, expect, it } from 'vitest'

import { normalizeDeck } from './normalize'
import { applyOperations, parseOperations } from './operations'
import type { Deck } from './deckSchema'

function baseDeck(): Deck {
  return normalizeDeck({
    title: 'Base',
    theme: { preset: 'midnight', colors: { accent: '#ff0066' } },
    slides: [
      { id: 'cover', align: 'center', blocks: [{ type: 'heading', id: 'cover-title', text: 'Hello', level: 1 }] },
      {
        id: 'body',
        blocks: [
          { type: 'heading', id: 'body-title', text: 'Points' },
          { type: 'grid', id: 'cards', children: [{ type: 'box', id: 'card-a', children: [{ type: 'text', id: 'card-a-text', text: 'A' }] }] },
        ],
      },
      { id: 'end', blocks: [{ type: 'heading', text: 'Bye' }] },
    ],
  }).deck!
}

function run(operations: unknown) {
  const parsed = parseOperations({ operations })
  expect(parsed.failed).toEqual([])
  return applyOperations(baseDeck(), parsed.operations)
}

describe('deck operations', () => {
  it('adds slides after an anchor, at the start, and at the end', () => {
    const result = run([
      { op: 'add_slides', after: 'cover', slides: [{ id: 'agenda', blocks: [{ type: 'text', text: 'Agenda' }] }] },
      { op: 'add_slides', after: null, slides: [{ blocks: [{ type: 'text', text: 'First' }] }] },
      { op: 'add_slides', slides: [{ blocks: [{ type: 'text', text: 'Last' }] }] },
    ])
    expect(result.failed).toEqual([])
    expect(result.deck.slides.map((slide) => slide.id)).toEqual(['s5', 'cover', 'agenda', 'body', 'end', 's6'])
  })

  it('updates a block by id with a shallow merge where null removes a prop', () => {
    const result = run([{ op: 'update_block', blockId: 'body-title', set: { text: 'Sharper points', tone: 'accent' } }])
    const title = result.deck.slides[1].blocks[0]
    expect(title).toMatchObject({ id: 'body-title', type: 'heading', text: 'Sharper points', tone: 'accent' })
    const cleared = applyOperations(result.deck, parseOperations({ operations: [{ op: 'update_block', blockId: 'body-title', set: { tone: null } }] }).operations)
    expect(cleared.deck.slides[1].blocks[0]).not.toHaveProperty('tone')
  })

  it('keeps nested ids when a container is updated', () => {
    const result = run([{ op: 'update_block', blockId: 'cards', set: { columns: 2, gap: 'lg' } }])
    const grid = result.deck.slides[1].blocks[1]
    expect(grid).toMatchObject({ id: 'cards', columns: 2, gap: 'lg' })
    expect(grid.children?.[0].id).toBe('card-a')
    expect(grid.children?.[0].children?.[0].id).toBe('card-a-text')
  })

  it('inserts blocks into a container and at a slide root index', () => {
    const result = run([
      { op: 'insert_blocks', slideId: 'body', parentId: 'cards', blocks: [{ type: 'box', children: [{ type: 'text', text: 'B' }] }] },
      { op: 'insert_blocks', slideId: 'body', index: 0, blocks: [{ type: 'text', variant: 'eyebrow', text: 'Section' }] },
    ])
    const slide = result.deck.slides[1]
    expect(slide.blocks[0]).toMatchObject({ type: 'text', variant: 'eyebrow' })
    expect(slide.blocks[2].children).toHaveLength(2)
    const ids = JSON.stringify(result.deck).match(/"id":"[^"]+"/g)!
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('replaces, removes and moves blocks', () => {
    const result = run([
      { op: 'replace_block', blockId: 'card-a-text', block: { type: 'stat', value: '9', label: 'Nine' } },
      { op: 'move_block', blockId: 'body-title', toSlideId: 'end', index: 0 },
      { op: 'remove_blocks', blockIds: ['cover-title'] },
    ])
    expect(result.failed).toEqual([])
    expect(result.deck.slides[1].blocks[0].children?.[0].children?.[0]).toMatchObject({ id: 'card-a-text', type: 'stat' })
    expect(result.deck.slides[2].blocks[0].id).toBe('body-title')
    expect(result.deck.slides[0].blocks).toEqual([])
  })

  it('moves, duplicates, updates and removes slides', () => {
    const result = run([
      { op: 'move_slide', slideId: 'end', after: 'cover' },
      { op: 'duplicate_slide', slideId: 'body' },
      { op: 'update_slide', slideId: 'cover', set: { tone: 'accent', notes: 'Say hi', align: null } },
      { op: 'remove_slides', slideIds: ['end'] },
    ])
    expect(result.failed).toEqual([])
    expect(result.deck.slides.map((slide) => slide.id)).toEqual(['cover', 'body', 's4'])
    expect(result.deck.slides[0]).toMatchObject({ tone: 'accent', notes: 'Say hi' })
    expect(result.deck.slides[0]).not.toHaveProperty('align')
    expect(result.deck.slides[0].blocks[0].id).toBe('cover-title')
    const copyIds = JSON.stringify(result.deck.slides[2]).match(/"id":"[^"]+"/g)!
    const originalIds = JSON.stringify(result.deck.slides[1]).match(/"id":"[^"]+"/g)!
    expect(copyIds.some((id) => originalIds.includes(id))).toBe(false)
  })

  it('merges deck theme updates and resets colors when the preset changes', () => {
    const merged = run([{ op: 'update_deck', set: { theme: { fonts: { heading: 'serif' } }, settings: { slideNumber: true } } }])
    expect(merged.deck.theme).toEqual({ preset: 'midnight', colors: { accent: '#ff0066' }, fonts: { heading: 'serif' } })
    expect(merged.deck.settings).toEqual({ slideNumber: true })
    const switched = applyOperations(merged.deck, parseOperations({ operations: [{ op: 'update_deck', set: { theme: 'paper', title: 'New' } }] }).operations)
    expect(switched.deck.theme).toEqual({ preset: 'paper', fonts: { heading: 'serif' } })
    expect(switched.deck.title).toBe('New')
  })

  it('skips failing operations, reports them and still applies the rest', () => {
    const result = run([
      { op: 'update_block', blockId: 'missing', set: { text: 'x' } },
      { op: 'remove_slides', slideIds: ['cover', 'body', 'end'] },
      { op: 'insert_blocks', slideId: 'cover', parentId: 'cover-title', blocks: [{ type: 'text', text: 'x' }] },
      { op: 'update_slide', slideId: 'end', set: { name: 'Closing' } },
    ])
    expect(result.applied.map((operation) => operation.op)).toEqual(['update_slide'])
    expect(result.failed.map((failure) => failure.message)).toEqual([
      'Block "missing" does not exist.',
      'A deck must keep at least one slide.',
      'Block "cover-title" is not a container (stack, grid or box).',
    ])
    expect(result.deck.slides[2].name).toBe('Closing')
  })

  it('accepts common envelopes and reports malformed operations', () => {
    expect(parseOperations([{ op: 'remove_slides', slideIds: ['end'] }]).operations).toHaveLength(1)
    expect(parseOperations({ changes: [{ action: 'remove_slides', slideIds: ['end'] }] }).operations).toHaveLength(1)
    const bad = parseOperations({ operations: [{ op: 'explode' }, { op: 'update_block' }] })
    expect(bad.operations).toEqual([])
    expect(bad.failed).toHaveLength(2)
  })
})
