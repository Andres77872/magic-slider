import type { Block } from '../catalog/types'
import type { Deck, Slide } from './deckSchema'

/**
 * Read-only helpers for navigating a deck's block tree. Slide and block ids
 * are unique across a deck (normalize never lets a block reuse a slide id),
 * so an id alone identifies one node.
 */

export interface LocatedBlock {
  slide: Slide
  slideIndex: number
  block: Block
  /** The container holding the block, or null at the slide root. */
  parent: Block | null
  siblings: readonly Block[]
  index: number
  /** Containers from the slide root down to (not including) the block. */
  ancestors: Block[]
}

export function findBlockIn(blocks: readonly Block[], id: string): Block | null {
  for (const block of blocks) {
    if (block.id === id) return block
    const nested = block.children ? findBlockIn(block.children, id) : null
    if (nested) return nested
  }
  return null
}

function locateIn(blocks: readonly Block[], id: string, ancestors: Block[]): Omit<LocatedBlock, 'slide' | 'slideIndex'> | null {
  for (const [index, block] of blocks.entries()) {
    if (block.id === id) return { block, parent: ancestors[ancestors.length - 1] ?? null, siblings: blocks, index, ancestors }
    if (block.children?.length) {
      const found = locateIn(block.children, id, [...ancestors, block])
      if (found) return found
    }
  }
  return null
}

export function locateBlock(deck: Pick<Deck, 'slides'>, id: string): LocatedBlock | null {
  for (const [slideIndex, slide] of deck.slides.entries()) {
    const found = locateIn(slide.blocks, id, [])
    if (found) return { slide, slideIndex, ...found }
  }
  return null
}

export function findSlide(deck: Pick<Deck, 'slides'>, id: string): { slide: Slide; index: number } | null {
  const index = deck.slides.findIndex((slide) => slide.id === id)
  return index === -1 ? null : { slide: deck.slides[index], index }
}

/** Every block id in a subtree, including the root. */
export function subtreeIds(blocks: readonly Block[], into = new Set<string>()): Set<string> {
  for (const block of blocks) {
    if (block.id) into.add(block.id)
    if (block.children) subtreeIds(block.children, into)
  }
  return into
}

/** A deep copy without ids, so normalize assigns fresh ones (copy, paste, duplicate). */
export function stripBlockIds(block: Block): Block {
  const copy = structuredClone(block)
  const strip = (node: Block) => {
    delete node.id
    delete node.morphId
    node.children?.forEach(strip)
  }
  strip(copy)
  return copy
}

export function stripSlideIds(slide: Slide): Omit<Slide, 'id'> & { id?: string } {
  const copy = structuredClone(slide) as Omit<Slide, 'id'> & { id?: string }
  delete copy.id
  copy.blocks = copy.blocks.map(stripBlockIds)
  return copy
}

/** Total blocks in a list, nested ones included. */
export function countBlocks(blocks: readonly Block[]): number {
  return blocks.reduce((total, block) => total + 1 + (block.children ? countBlocks(block.children) : 0), 0)
}
