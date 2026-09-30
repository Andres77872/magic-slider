import type { z } from 'zod'

import type { ResolvedTheme } from '../render/theme'

/**
 * A block is one primitive instance in a slide: `{ type, id?, ...props }`.
 * Containers (stack, grid, box) nest other blocks in `children`.
 * Blocks are validated one at a time through the primitive registry, so a
 * single malformed block degrades to a diagnostic instead of losing the deck.
 */
export interface Block {
  type: string
  id?: string
  children?: Block[]
  [prop: string]: unknown
}

export type PrimitiveCategory = 'layout' | 'text' | 'media' | 'data' | 'narrative'

export interface RenderDiagnostic {
  code: 'unknown-primitive' | 'invalid-block' | 'unsafe-url' | 'unknown-icon' | 'dropped-prop' | 'limit' | 'render-failed'
  message: string
  path: string
  slideId?: string
  blockId?: string
}

export interface RenderContext {
  doc: Document
  /** The deck's resolved theme, for primitives that derive readable colors. */
  theme: ResolvedTheme
  slideId: string
  path: string
  diagnostics: RenderDiagnostic[]
  /** Renders a list of child blocks into a parent element, keeping paths accurate. */
  renderChildren: (children: readonly Block[], parent: HTMLElement) => void
  /** Renders one nested block; used by primitives that wrap children in extra markup. */
  renderBlock: (block: Block, path: string) => HTMLElement
  /** Adds a diagnostic scoped to the current block. */
  report: (code: RenderDiagnostic['code'], message: string) => void
}

export interface PrimitiveDefinition<Props extends Record<string, unknown> = Record<string, unknown>> {
  type: string
  category: PrimitiveCategory
  /** One sentence for the catalog shown to the agent and the gallery. */
  summary: string
  /** When to reach for this primitive; shown to the agent. */
  guidance?: string
  /** Props schema, excluding `type`, the shared base props and `children`. */
  props: z.ZodType<Props>
  /** Containers accept nested blocks in `children`. */
  container?: boolean
  /** A canonical example used by the catalog prompt, gallery and tests. */
  example: Block
  /**
   * Optional primitive-specific repair applied to raw generated props before
   * validation, e.g. aligning chart series with their labels.
   */
  repair?: (props: Record<string, unknown>, note: (message: string) => void) => Record<string, unknown>
  render: (block: Props & Block, context: RenderContext) => HTMLElement
  /** Short plain-text description of the block for outlines and navigation. */
  outline?: (block: Props & Block) => string
}
