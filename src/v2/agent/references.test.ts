import { describe, expect, it } from 'vitest'

import { normalizeDeck } from '../domain/normalize'
import type { Deck } from '../domain/deckSchema'
import { buildMessages, requestReferences, type AgentConfig } from './agentClient'
import {
  activeMentionQuery, extractMentionIds, formatReferencesContext, insertMention, mentionRanges, mentionSuggestions, removeMention, resolveMentions,
  resolveReference, snapshotReference,
} from './references'

function deckOf(input: unknown): Deck {
  const { deck } = normalizeDeck(input)
  if (!deck) throw new Error('invalid deck')
  return deck
}

const deck = deckOf({
  title: 'Energy',
  slides: [
    { id: 'cover', name: 'Cover', blocks: [{ type: 'heading', id: 'cover-title', text: 'Solar is **cheap**', level: 1 }] },
    {
      id: 'market-size', name: 'Market size',
      blocks: [
        { type: 'heading', id: 'market-title', text: 'The market is growing' },
        { type: 'grid', id: 'market-grid', children: [{ type: 'image', id: 'hero_image', src: 'https://images.example.com/a.jpg', alt: 'Wind turbines at dusk' }] },
      ],
    },
    ...Array.from({ length: 30 }, (_, index) => ({ id: `filler-${index}`, notes: 'n '.repeat(200), blocks: [{ type: 'text', id: `filler-text-${index}`, text: `Filler ${'words '.repeat(80)}` }] })),
  ],
})

describe('mention parsing', () => {
  it('finds @id tokens but ignores e-mail addresses and trailing punctuation', () => {
    const text = 'Update @hero_image, then @market-size. Mail me at a@b.com (@cover-)'
    expect(extractMentionIds(text)).toEqual(['hero_image', 'market-size', 'cover'])
    const [first] = mentionRanges(text)
    expect(text.slice(first.start, first.end)).toBe('@hero_image')
  })

  it('resolves slides and blocks with readable labels', () => {
    expect(resolveReference(deck, 'market-size')).toMatchObject({ kind: 'slide', slideIndex: 1, label: 'Slide 2 · Market size' })
    expect(resolveReference(deck, 'hero_image')).toMatchObject({ kind: 'block', slideId: 'market-size', type: 'image', label: 'image · image: Wind turbines at dusk' })
    expect(resolveReference(deck, 'cover-title')!.label).toBe('heading · Solar is cheap')
    expect(resolveMentions(deck, '@cover and @ghost')).toMatchObject({ resolved: [{ id: 'cover' }], missing: ['ghost'] })
    expect(snapshotReference(resolveReference(deck, 'cover')!)).toEqual({ id: 'cover', kind: 'slide', slideId: 'cover', type: 'slide', label: 'Slide 1 · Cover' })
  })
})

describe('composer helpers', () => {
  it('detects the mention being typed at the caret', () => {
    expect(activeMentionQuery('edit @mar', 9)).toEqual({ start: 5, query: 'mar' })
    expect(activeMentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(activeMentionQuery('mail a@b', 8)).toBeNull()
    expect(activeMentionQuery('edit @market now', 16)).toBeNull()
  })

  it('inserts and removes mentions with tidy spacing', () => {
    expect(insertMention('edit @mar', 9, 'market-size', 5)).toEqual({ text: 'edit @market-size ', caret: 18 })
    expect(insertMention('make it bigger', 7, 'hero_image')).toEqual({ text: 'make it @hero_image bigger', caret: 19 })
    expect(insertMention('', 0, 'cover')).toEqual({ text: '@cover ', caret: 7 })
    expect(removeMention('Update @hero_image and @cover, please', 'cover')).toBe('Update @hero_image and, please')
  })

  it('suggests the active slide first and ranks query matches', () => {
    const initial = mentionSuggestions(deck, '', 'market-size')
    expect(initial.slice(0, 4).map((item) => item.id)).toEqual(['market-size', 'market-title', 'market-grid', 'hero_image'])
    expect(initial[4].id).toBe('cover')
    expect(mentionSuggestions(deck, 'image', 'cover')[0].id).toBe('hero_image')
    expect(mentionSuggestions(deck, '2', null)[0].id).toBe('market-size')
    expect(mentionSuggestions(deck, 'zzz', null)).toEqual([])
  })
})

describe('agent payload', () => {
  const config: AgentConfig = { apiUrl: 'http://localhost/v1/chat/completions', agentModel: 'agt-x', requestTimeoutMs: 5_000, idleTimeoutMs: 5_000, maxStreamBytes: 1_000_000 }

  it('lists referenced items in full, including missing ones', () => {
    const text = formatReferencesContext(deck, ['hero_image', 'cover', 'gone'])!
    expect(text).toContain('- @hero_image → image block on slide "market-size" (slide 2): {"type":"image","id":"hero_image"')
    expect(text).toContain('- @cover → slide 1 "Cover": {"name":"Cover","id":"cover"')
    expect(text).toContain('- @gone → not found')
    expect(formatReferencesContext(deck, [])).toBeNull()
  })

  it('adds references, the selected block and pinned slides to the system message', () => {
    const input = { prompt: 'Swap @hero_image for a sunrise', config, deck, focusedSlideId: 'cover', selectedBlockId: 'cover-title', references: ['filler-29'] }
    expect(requestReferences(input)).toEqual(['filler-29', 'hero_image'])
    const [system, user] = buildMessages(input)
    expect(system.content).toContain('Selected block: cover-title on slide cover')
    expect(system.content).toContain('Referenced items')
    expect(system.content).toContain('- @hero_image → image block')
    // The deck is too large for full detail, but referenced slides keep their props.
    expect(system.content).toContain('- filler-text-29 text {"text":"Filler')
    expect(system.content).toMatch(/- hero_image image \{"src"/)
    expect(user).toEqual({ role: 'user', content: 'Swap @hero_image for a sunrise' })
  })

  it('omits the references section when nothing is referenced or no deck exists', () => {
    expect(buildMessages({ prompt: 'hello', config, deck })[0].content).not.toContain('Referenced items')
    expect(buildMessages({ prompt: 'make @cover', config, deck: null })[0].content).not.toContain('Referenced items')
  })
})
