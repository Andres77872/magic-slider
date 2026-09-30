import { describe, expect, it } from 'vitest'

import { primitives } from '../catalog/registry'
import type { Deck } from './deckSchema'
import { diffDecks, hasChanges } from './diff'
import {
  addSlide, deleteBlock, deleteSlide, duplicateBlock, duplicateSlide, insertPrimitive, insertionPoint, moveBlockBy, moveSlideBy, moveSlideTo,
  pasteBlocks, setBlockProps, setSlideProps, uniqueId, type EditorCommand,
} from './editorCommands'
import { normalizeDeck } from './normalize'
import { applyOperations } from './operations'
import { slideStarters } from './slideStarters'
import { locateBlock, stripBlockIds } from './tree'

function deckOf(input: unknown): Deck {
  const { deck } = normalizeDeck(input)
  if (!deck) throw new Error('invalid deck')
  return deck
}

function run(deck: Deck, command: EditorCommand | null): Deck {
  expect(command).not.toBeNull()
  const result = applyOperations(deck, command!.operations)
  expect(result.failed).toEqual([])
  return result.deck
}

const base = () => deckOf({
  slides: [
    {
      id: 'a',
      blocks: [
        { type: 'heading', id: 'title', text: 'Title' },
        { type: 'grid', id: 'cards', children: [
          { type: 'box', id: 'card-1', children: [{ type: 'text', id: 'c1-text', text: 'one' }, { type: 'text', id: 'c1-more', text: 'more' }] },
          { type: 'box', id: 'card-2', children: [{ type: 'text', id: 'c2-text', text: 'two' }] },
        ] },
        { type: 'text', id: 'footer', text: 'Footer' },
      ],
    },
    { id: 'b', blocks: [{ type: 'text', id: 'b-text', text: 'B' }] },
    { id: 'c', blocks: [{ type: 'text', id: 'c-text', text: 'C' }] },
  ],
})

const ids = (deck: Deck, slideIndex = 0) => deck.slides[slideIndex].blocks.map((block) => block.id)

describe('uniqueId', () => {
  it('returns readable ids that no slide or block uses', () => {
    const deck = base()
    expect(uniqueId(deck, 'chart')).toBe('chart')
    expect(uniqueId(deck, 'title')).toBe('title-2')
    expect(uniqueId(deck, 'A b!')).toBe('a-b')
    expect(uniqueId(deck, 'a')).toBe('a-2')
  })
})

describe('insertion', () => {
  it('inserts inside a selected container, after a selected block, or at the end', () => {
    const deck = base()
    expect(insertionPoint(deck, { slideId: 'a', blockId: 'card-1' })).toEqual({ slideId: 'a', parentId: 'card-1' })
    expect(insertionPoint(deck, { slideId: 'a', blockId: 'c1-text' })).toEqual({ slideId: 'a', parentId: 'card-1', index: 1 })
    expect(insertionPoint(deck, { slideId: 'a', blockId: 'title' })).toEqual({ slideId: 'a', parentId: null, index: 1 })
    expect(insertionPoint(deck, { slideId: 'a' })).toEqual({ slideId: 'a', parentId: null })
  })

  it('inserts every primitive from its catalog example and selects it', () => {
    let deck = deckOf({ slides: [{ id: 's', blocks: [] }] })
    for (const primitive of primitives) {
      const command = insertPrimitive(deck, { slideId: 's' }, primitive.type)!
      deck = run(deck, command)
      expect(locateBlock(deck, command.select!.blockId!)?.block.type).toBe(primitive.type)
    }
    expect(deck.slides[0].blocks).toHaveLength(primitives.length)
  })

  it('inserts images with a same-origin placeholder instead of the example URL', () => {
    const deck = run(base(), insertPrimitive(base(), { slideId: 'a', blockId: 'title' }, 'image'))
    expect(deck.slides[0].blocks[1]).toMatchObject({ type: 'image', src: '/placeholders/image.svg' })
  })

  it('pastes copied blocks with fresh ids', () => {
    const deck = base()
    const copy = stripBlockIds(locateBlock(deck, 'card-1')!.block)
    const next = run(deck, pasteBlocks(deck, { slideId: 'b' }, [copy]))
    const pasted = next.slides[1].blocks[1]
    expect(pasted.type).toBe('box')
    expect(pasted.id).not.toBe('card-1')
    expect(pasted.children?.map((child) => child.text)).toEqual(['one', 'more'])
  })
})

describe('block commands', () => {
  it('moves blocks among siblings and steps out of containers at the edges', () => {
    let deck = base()
    deck = run(deck, moveBlockBy(deck, 'c1-more', -1))
    expect(locateBlock(deck, 'card-1')!.block.children!.map((block) => block.id)).toEqual(['c1-more', 'c1-text'])
    deck = run(deck, moveBlockBy(deck, 'c1-more', -1))
    expect(locateBlock(deck, 'cards')!.block.children!.map((block) => block.id)).toEqual(['c1-more', 'card-1', 'card-2'])
    deck = run(deck, moveBlockBy(deck, 'footer', -1))
    expect(ids(deck)).toEqual(['title', 'footer', 'cards'])
    expect(moveBlockBy(deck, 'title', -1)).toBeNull()
  })

  it('duplicates a block right after the original and selects the copy', () => {
    const deck = base()
    const command = duplicateBlock(deck, 'card-2')!
    const next = run(deck, command)
    const siblings = locateBlock(next, 'cards')!.block.children!
    expect(siblings.map((block) => block.id)).toEqual(['card-1', 'card-2', command.select!.blockId])
    expect(siblings[2].children?.[0].text).toBe('two')
  })

  it('deletes a block and selects a neighbour', () => {
    const deck = base()
    const command = deleteBlock(deck, 'title')!
    expect(command.select).toEqual({ slideId: 'a', blockId: 'cards' })
    expect(ids(run(deck, command))).toEqual(['cards', 'footer'])
  })

  it('sets and removes props through update_block', () => {
    const deck = base()
    const next = run(deck, setBlockProps(deck, 'title', { level: 1, text: 'New' }))
    expect(next.slides[0].blocks[0]).toMatchObject({ level: 1, text: 'New' })
    expect(run(next, setBlockProps(next, 'title', { level: null })).slides[0].blocks[0]).not.toHaveProperty('level')
  })

  it('reports invalid props instead of applying them', () => {
    const deck = base()
    const result = applyOperations(deck, setBlockProps(deck, 'title', { text: '' })!.operations)
    expect(result.failed).toHaveLength(1)
    expect(result.deck.slides[0].blocks[0].text).toBe('Title')
  })

  it('duplicates blocks through the shared duplicate_block operation', () => {
    const deck = base()
    const result = applyOperations(deck, [{ op: 'duplicate_block', blockId: 'c1-text' }])
    expect(result.failed).toEqual([])
    const children = locateBlock(result.deck, 'card-1')!.block.children!
    expect(children.map((child) => child.text)).toEqual(['one', 'one', 'more'])
    expect(new Set(children.map((child) => child.id)).size).toBe(3)
  })
})

describe('slide commands', () => {
  it('adds every starter layout as a valid slide', () => {
    let deck = base()
    for (const starter of slideStarters) {
      const command = addSlide(deck, starter.build() as never, deck.slides[deck.slides.length - 1].id)
      deck = run(deck, command)
      expect(deck.slides[deck.slides.length - 1].id).toBe(command.select!.slideId)
    }
    expect(deck.slides).toHaveLength(3 + slideStarters.length)
  })

  it('duplicates, moves and deletes slides', () => {
    let deck = base()
    const duplicate = duplicateSlide(deck, 'a')!
    deck = run(deck, duplicate)
    expect(deck.slides.map((slide) => slide.id)).toEqual(['a', duplicate.select!.slideId, 'b', 'c'])
    deck = run(deck, moveSlideBy(deck, 'c', -1))
    expect(deck.slides.map((slide) => slide.id)).toEqual(['a', 'a-copy', 'c', 'b'])
    deck = run(deck, moveSlideBy(deck, 'a', 1))
    expect(deck.slides.map((slide) => slide.id)).toEqual(['a-copy', 'a', 'c', 'b'])
    deck = run(deck, moveSlideTo(deck, 'b', 0))
    expect(deck.slides.map((slide) => slide.id)).toEqual(['b', 'a-copy', 'a', 'c'])
    expect(moveSlideBy(deck, 'b', -1)).toBeNull()
    const remove = deleteSlide(deck, 'a')!
    expect(remove.select).toEqual({ slideId: 'c', blockId: null })
    deck = run(deck, remove)
    expect(deck.slides.map((slide) => slide.id)).toEqual(['b', 'a-copy', 'c'])
  })

  it('never deletes the last slide', () => {
    const deck = deckOf({ slides: [{ id: 'only', blocks: [{ type: 'text', text: 'x' }] }] })
    expect(deleteSlide(deck, 'only')).toBeNull()
  })

  it('edits slide fields', () => {
    const deck = base()
    const next = run(deck, setSlideProps(deck, 'b', { tone: 'accent', notes: 'Say hi' }))
    expect(next.slides[1]).toMatchObject({ tone: 'accent', notes: 'Say hi' })
  })
})

describe('diffDecks', () => {
  it('reports added, removed, changed and reordered slides', () => {
    const before = base()
    let after = run(before, setBlockProps(before, 'b-text', { text: 'Changed' }))
    after = run(after, deleteSlide(after, 'c'))
    after = run(after, addSlide(after, { blocks: [{ type: 'text', text: 'new' }] } as never, null))
    const changes = diffDecks(before, after)
    expect(changes).toMatchObject({ changed: ['b'], removed: ['c'], meta: false })
    expect(changes.added).toHaveLength(1)
    expect(hasChanges(changes)).toBe(true)
    expect(hasChanges(diffDecks(before, before))).toBe(false)
    const moved = run(before, moveSlideBy(before, 'a', 1))
    expect(diffDecks(before, moved)).toMatchObject({ reordered: true, changed: [] })
  })
})
