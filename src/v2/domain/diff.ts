import type { Deck } from './deckSchema'

/**
 * What changed between two versions of a deck, at slide granularity. Chat
 * messages use it to show which slides a turn touched, as links.
 */
export interface DeckChanges {
  added: string[]
  removed: string[]
  changed: string[]
  /** Slide order changed (beyond additions and removals). */
  reordered: boolean
  /** Title, language, theme or settings changed. */
  meta: boolean
}

export function diffDecks(before: Deck | null, after: Deck): DeckChanges {
  const previous = new Map((before?.slides ?? []).map((slide) => [slide.id, JSON.stringify(slide)]))
  const next = new Set(after.slides.map((slide) => slide.id))
  const added: string[] = []
  const changed: string[] = []
  for (const slide of after.slides) {
    const old = previous.get(slide.id)
    if (old === undefined) added.push(slide.id)
    else if (old !== JSON.stringify(slide)) changed.push(slide.id)
  }
  const removed = [...previous.keys()].filter((id) => !next.has(id))
  const keptBefore = (before?.slides ?? []).map((slide) => slide.id).filter((id) => next.has(id))
  const keptAfter = after.slides.map((slide) => slide.id).filter((id) => previous.has(id))
  const meta = JSON.stringify([before?.title, before?.language, before?.theme, before?.settings]) !== JSON.stringify([after.title, after.language, after.theme, after.settings])
  return { added, removed, changed, reordered: keptBefore.join('\n') !== keptAfter.join('\n'), meta: Boolean(before) && meta }
}

export function hasChanges(changes: DeckChanges): boolean {
  return Boolean(changes.added.length || changes.removed.length || changes.changed.length || changes.reordered || changes.meta)
}
