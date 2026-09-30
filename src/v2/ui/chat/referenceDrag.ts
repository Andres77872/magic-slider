/**
 * Drag-and-drop payload for references: slides from the rail and layers from
 * the tree can be dropped on the chat composer. A text/plain "@id" fallback
 * keeps the drop useful in any text field.
 */
export const REFERENCE_MIME = 'application/x-magic-slider-ref'

export function hasReference(types: readonly string[]): boolean {
  return types.includes(REFERENCE_MIME)
}
