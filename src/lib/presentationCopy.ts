import type { PresentationAction, ValidatedPresentationConfig } from '../domain/presentationTypes'

export function describePresentationAction(action: PresentationAction): string {
  switch (action.action) {
    case 'create_deck':
      return `Created presentation with ${action.slides.length} slides.`
    case 'add_slide':
      if (action.afterIndex === undefined) return 'Added slide at the end.'
      return action.afterIndex < 0
        ? 'Added slide at the beginning.'
        : `Added slide after slide ${action.afterIndex + 1}.`
    case 'edit_slide':
      return `Updated slide ${action.slideIndex + 1}.`
    case 'delete_slide':
      return `Deleted slide ${action.slideIndex + 1}.`
    case 'reorder_slides':
      return `Moved slide ${action.fromIndex + 1} to position ${action.toIndex + 1}.`
    case 'update_deck':
      return action.theme ? `Switched the deck to the ${action.theme} theme.` : 'Updated deck settings.'
  }
}


function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Chat summary for a finished generation when the agent sends no message of its own. */
export function describeDeckOutcome(deck: ValidatedPresentationConfig, mode: 'created' | 'updated'): string {
  const images = new Set(deck.slides.flatMap((slide) => [slide.backgroundImage ?? slide.background, slide.image?.url]).filter(Boolean)).size
  const sources = new Set(deck.slides.flatMap((slide) => slide.sources?.map((source) => source.url) ?? [])).size
  const details = [images ? countLabel(images, 'image') : null, sources ? `${countLabel(sources, 'cited source')}` : null].filter(Boolean)
  const base = `${mode === 'created' ? 'Created' : 'Updated'} presentation with ${countLabel(deck.slides.length, 'slide')}`
  return details.length ? `${base} · ${details.join(' · ')}.` : `${base}.`
}
