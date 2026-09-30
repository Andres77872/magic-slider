import { z } from 'zod'

import { layoutPrimitives } from './primitives/layout'
import { textPrimitives } from './primitives/text'
import { mediaPrimitives } from './primitives/media'
import { dataPrimitives } from './primitives/data'
import { narrativePrimitives } from './primitives/narrative'
import { revealEffectSchema } from './tokens'
import type { Block, PrimitiveDefinition } from './types'

/**
 * The primitive catalog. It is the single source of truth for what a v2 deck
 * may contain: validation, repair, rendering, the gallery and the catalog text
 * given to the agent are all derived from these definitions.
 */
export const primitives: readonly PrimitiveDefinition[] = [
  ...layoutPrimitives,
  ...textPrimitives,
  ...mediaPrimitives,
  ...dataPrimitives,
  ...narrativePrimitives,
] as unknown as PrimitiveDefinition[]

export const primitiveRegistry: ReadonlyMap<string, PrimitiveDefinition> = new Map(primitives.map((primitive) => [primitive.type, primitive]))
export const primitiveTypes = primitives.map((primitive) => primitive.type)

export function getPrimitive(type: string): PrimitiveDefinition | undefined {
  return primitiveRegistry.get(type)
}

export const BLOCK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Props every block accepts regardless of its primitive. */
export const blockBaseShape = {
  id: z.string().regex(BLOCK_ID_PATTERN, 'Ids use letters, digits, - and _ (max 64).').optional(),
  reveal: revealEffectSchema.optional(),
  revealOrder: z.number().int().min(0).max(30).optional(),
  morphId: z.string().regex(BLOCK_ID_PATTERN, 'morphId uses letters, digits, - and _.').optional(),
  span: z.number().int().min(1).max(6).optional(),
  rowSpan: z.number().int().min(1).max(4).optional(),
  grow: z.boolean().optional(),
  maxWidth: z.enum(['sm', 'md', 'lg', 'full']).optional(),
}
export const blockBaseSchema = z.strictObject(blockBaseShape)
export const blockBaseKeys = new Set(Object.keys(blockBaseShape))

export const MAX_BLOCK_DEPTH = 6
export const MAX_CHILDREN = 24
export const MAX_BLOCKS_PER_SLIDE = 120

/** Shape keys of a primitive's props schema. */
export function primitivePropKeys(primitive: PrimitiveDefinition): Set<string> {
  const schema = primitive.props as unknown as { shape?: Record<string, unknown>; def?: { in?: { shape?: Record<string, unknown> } } }
  // superRefine wraps the object in a pipe; its input keeps the shape.
  const shape = schema.shape ?? schema.def?.in?.shape ?? {}
  return new Set(Object.keys(shape))
}

export function isContainer(block: Block): boolean {
  return Boolean(getPrimitive(block.type)?.container)
}

/** Walks every block depth-first, including nested children. */
export function walkBlocks(blocks: readonly Block[], visit: (block: Block, parent: Block | null, depth: number) => void, parent: Block | null = null, depth = 0): void {
  for (const block of blocks) {
    visit(block, parent, depth)
    if (block.children?.length) walkBlocks(block.children, visit, block, depth + 1)
  }
}
