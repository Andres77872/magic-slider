import { describe, expect, it } from 'vitest'

import { presentationToolArguments } from './__fixtures__/publicCompletionsToolCalls'
import { applyPresentationAction } from './presentationActionReducer'

const currentDeck = {
  slides: [
    { title: 'Intro', content: 'Plain intro' },
    { title: 'Plan', content: 'Plain plan' },
  ],
  plugins: ['highlight'] as const,
  revealOptions: { controls: true, transition: 'slide' as const },
}

describe('applyPresentationAction', () => {
  it('creates a full deck from a validated create_deck action', () => {
    const result = applyPresentationAction(null, { action: 'create_deck', ...presentationToolArguments.create_deck })

    expect(result).toMatchObject({ ok: true, deck: presentationToolArguments.create_deck })
  })

  it('adds, edits, deletes, and reorders slides immutably with full-deck validation', () => {
    const added = applyPresentationAction(currentDeck, { action: 'add_slide', ...presentationToolArguments.add_slide })
    expect(added).toMatchObject({ ok: true })
    expect(added.deck?.slides).toHaveLength(3)
    expect(currentDeck.slides).toHaveLength(2)

    const edited = applyPresentationAction(currentDeck, { action: 'edit_slide', ...presentationToolArguments.edit_slide })
    expect(edited).toMatchObject({ ok: true, deck: { slides: [expect.any(Object), expect.objectContaining({ title: 'Updated plan' })] } })

    const deleted = applyPresentationAction(currentDeck, { action: 'delete_slide', ...presentationToolArguments.delete_slide })
    expect(deleted).toMatchObject({ ok: true, deck: { slides: [{ title: 'Intro', content: 'Plain intro' }] } })

    const reordered = applyPresentationAction(currentDeck, { action: 'reorder_slides', ...presentationToolArguments.reorder_slides })
    expect(reordered).toMatchObject({ ok: true, deck: { slides: [{ title: 'Plan' }, { title: 'Intro' }] } })
  })

  it('rejects out-of-bounds and final-slide delete without mutating the previous deck', () => {
    expect(applyPresentationAction(currentDeck, { action: 'delete_slide', slideIndex: 99 })).toMatchObject({
      ok: false,
      deck: currentDeck,
    })
    expect(applyPresentationAction({ slides: [{ title: 'Only' }] }, { action: 'delete_slide', slideIndex: 0 })).toMatchObject({
      ok: false,
      deck: { slides: [{ title: 'Only' }] },
    })
  })
})
