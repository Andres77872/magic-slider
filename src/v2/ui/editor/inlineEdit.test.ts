import { describe, expect, it } from 'vitest'

import type { Block } from '../../catalog/types'
import { normalizeDeck } from '../../domain/normalize'
import { renderSlide } from '../../render/renderDeck'
import { resolveTheme } from '../../render/theme'
import { primitives } from '../../catalog/registry'
import { resolveInlineTarget, supportsInlineEdit } from './inlineEdit'
import { blockFields, groupFields, newListItem } from '../inspector/fieldModel'

function rendered(block: Record<string, unknown>) {
  const deck = normalizeDeck({ slides: [{ id: 's', blocks: [{ id: 'b', ...block }] }] }).deck!
  const { element } = renderSlide(deck.slides[0], deck, resolveTheme(undefined), 'thumbnail')
  document.body.replaceChildren(element)
  return { block: deck.slides[0].blocks[0] as Block, root: element.querySelector<HTMLElement>('[data-block-id="b"]')! }
}

describe('inline editing targets', () => {
  it('edits a heading as its raw rich-text source', () => {
    const { block, root } = rendered({ type: 'heading', text: 'Solar is **cheap**' })
    const target = resolveInlineTarget(block, root, null)!
    expect(target.value).toBe('Solar is **cheap**')
    expect(target.commit('Solar is ==cheaper==')).toEqual({ set: { text: 'Solar is ==cheaper==' } })
    expect(target.commit('Solar is **cheap**')).toBeNull()
    expect(target.commit('   ')).toMatchObject({ error: expect.stringContaining('cannot be empty') })
  })

  it('edits the stat part under the pointer and removes an emptied optional part', () => {
    const { block, root } = rendered({ type: 'stat', value: '38%', label: 'Lower cost', description: 'Since 2020' })
    expect(resolveInlineTarget(block, root, root.querySelector('.ms-stat__label'))!.value).toBe('Lower cost')
    expect(resolveInlineTarget(block, root, null)!.value).toBe('38%')
    const description = resolveInlineTarget(block, root, root.querySelector('.ms-stat__description'))!
    expect(description.commit('')).toEqual({ set: { description: null } })
  })

  it('edits one list item, keeping string and object items intact', () => {
    const { block, root } = rendered({ type: 'list', items: ['One', { text: 'Two', description: 'Detail' }, 'Three'] })
    const second = resolveInlineTarget(block, root, root.querySelectorAll('.ms-list__text')[1])!
    expect(second.value).toBe('Two')
    expect(second.commit('Deux')).toEqual({ set: { items: ['One', { text: 'Deux', description: 'Detail' }, 'Three'] } })
    const third = resolveInlineTarget(block, root, root.querySelectorAll('.ms-list__text')[2])!
    expect(third.commit('Trois')).toEqual({ set: { items: ['One', { text: 'Two', description: 'Detail' }, 'Trois'] } })
  })

  it('edits table cells and headers, keeping numbers numeric', () => {
    const { block, root } = rendered({ type: 'table', columns: ['Metric', 'Value'], rows: [['Seats', 3], ['SSO', 'Yes']] })
    const cell = resolveInlineTarget(block, root, root.querySelectorAll('tbody td')[0])!
    expect(cell.value).toBe('3')
    expect(cell.commit('5')).toEqual({ set: { rows: [['Seats', 5], ['SSO', 'Yes']] } })
    const header = resolveInlineTarget(block, root, root.querySelectorAll('thead th')[1])!
    expect(header.commit('Amount')).toEqual({ set: { columns: ['Metric', 'Amount'] } })
  })

  it('edits timeline and diagram items by position', () => {
    const timeline = rendered({ type: 'timeline', items: [{ label: 'Q1', title: 'Pilot' }, { label: 'Q2', title: 'Rollout' }] })
    const title = resolveInlineTarget(timeline.block, timeline.root, timeline.root.querySelectorAll('.ms-timeline__title')[1])!
    expect(title.commit('Launch')).toEqual({ set: { items: [{ label: 'Q1', title: 'Pilot' }, { label: 'Q2', title: 'Launch' }] } })
    const diagram = rendered({ type: 'diagram', kind: 'flow', items: [{ label: 'Plan' }, { label: 'Build' }, { label: 'Ship' }] })
    const label = resolveInlineTarget(diagram.block, diagram.root, diagram.root.querySelectorAll('.ms-diagram__label')[2])!
    expect(label.value).toBe('Ship')
  })

  it('declares which primitives support inline editing', () => {
    expect(supportsInlineEdit('heading')).toBe(true)
    expect(supportsInlineEdit('table')).toBe(true)
    expect(supportsInlineEdit('divider')).toBe(false)
    expect(supportsInlineEdit('grid')).toBe(false)
  })
})

describe('schema-driven fields', () => {
  it('derives an editor for every prop of every primitive', () => {
    for (const primitive of primitives) {
      const fields = blockFields(primitive.type)
      expect(fields.length).toBeGreaterThan(0)
      for (const field of fields) expect(field.kind).toBeTruthy()
    }
  })

  it('maps props to controls and groups', () => {
    const heading = Object.fromEntries(blockFields('heading').map((field) => [field.key, field]))
    expect(heading.text).toMatchObject({ kind: 'text', group: 'content', required: true, rich: true })
    expect(heading.level).toMatchObject({ kind: 'enum', options: [1, 2, 3, 4] })
    expect(heading.tone).toMatchObject({ kind: 'enum', group: 'style' })
    expect(heading.reveal).toMatchObject({ kind: 'enum', group: 'animation' })
    const box = Object.fromEntries(blockFields('box').map((field) => [field.key, field]))
    expect(box.color.kind).toBe('color')
    const image = Object.fromEntries(blockFields('image').map((field) => [field.key, field]))
    expect(image.src.kind).toBe('url')
    const list = Object.fromEntries(blockFields('list').map((field) => [field.key, field]))
    expect(list.items).toMatchObject({ kind: 'object-list', itemMayBeString: true })
    expect(newListItem(list.items, 2)).toBe('New item 3')
    const grid = Object.fromEntries(blockFields('grid').map((field) => [field.key, field]))
    expect(grid.columns).toMatchObject({ kind: 'loose', group: 'layout' })
    expect(groupFields(blockFields('chart')).map((group) => group.group)).toEqual(['content', 'layout', 'style', 'animation'])
  })
})
