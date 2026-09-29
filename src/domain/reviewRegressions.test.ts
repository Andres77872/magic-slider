import { describe, expect, it } from 'vitest'

import { DECK_CONTEXT_MAX_CHARS, STRUCTURED_TEXT_MAX_CHARS, formatDeckContext } from '../agent/deckContextFormatter'
import { stripBriefPreferences, withBriefPreferences, defaultBriefPreferences } from '../lib/briefPreferences'
import { buildSafeSlideDom } from '../presentation/safeSlideRenderer'
import { localSessionSchema, titleFromPrompt } from '../session/localSessionModel'
import { parsePresentationToolCall } from './presentationActions'
import { validatePresentation } from './presentationSchema'

const coverUrl = `https://v3.fal.media/files/${'a'.repeat(900)}/cover.jpg`

describe('review regressions', () => {
  it('keeps code-like text valid while still rejecting real markup', () => {
    for (const content of ['Return Promise<void> from async handlers', 'Use Map<string, number> for counts', 'Alert when temp<limit fails\nand load>80%']) {
      expect(validatePresentation({ slides: [{ content }] })).toMatchObject({ ok: true })
    }
    expect(validatePresentation({ slides: [{ content: 'Plain <p>paragraph</p>' }] })).toMatchObject({ ok: false })
    expect(validatePresentation({ slides: [{ content: '<img src=x onerror=alert(1)>' }] })).toMatchObject({ ok: false })
  })

  it('renders plain text that merely looks like an attribute assignment', () => {
    const { element } = buildSafeSlideDom({ slides: [{ content: 'Set online = true\nKeep style = consistent' }] })
    expect(element.textContent).toContain('Set online = true')
  })

  it('keeps saved sessions that contain an older no-op edit valid', () => {
    const now = '2026-01-01T00:00:00.000Z'
    const session = {
      schemaVersion: 1, id: 's', title: 'Saved', messages: [], currentDeckSnapshot: { slides: [{ title: 'x' }] }, createdAt: now, updatedAt: now,
      actionLog: [{ id: 'a', action: { action: 'edit_slide', slideIndex: 0, patch: {} }, summary: 'Updated slide 1.', createdAt: now, result: 'applied' }],
    }
    expect(localSessionSchema.safeParse(session).success).toBe(true)
    expect(() => parsePresentationToolCall({ type: 'function', function: { name: 'edit_slide', arguments: '{"slideIndex":0,"patch":{}}' } })).toThrow(/at least one field/)
  })

  it('titles sessions from the prompt, not the appended presentation options', () => {
    const text = withBriefPreferences('Bees', { ...defaultBriefPreferences, theme: 'paper' })
    expect(stripBriefPreferences(text)).toBe('Bees')
    expect(titleFromPrompt(text)).toBe('Bees')
  })

  it('never cuts structured fields or URLs in the middle when giving the agent deck context', () => {
    const longStep = 'x'.repeat(STRUCTURED_TEXT_MAX_CHARS + 50)
    const context = formatDeckContext({
      slides: [{
        backgroundImage: coverUrl,
        timeline: Array.from({ length: 6 }, (_, index) => ({ label: `Step ${index}`, text: longStep })),
        sources: [{ title: 'Source', url: `https://example.com/${'p'.repeat(600)}` }],
      }],
    })!
    const timelineLine = context.split('\n').find((line) => line.trim().startsWith('timeline:'))!
    const timeline = JSON.parse(timelineLine.trim().slice('timeline: '.length))
    expect(timeline).toHaveLength(6)
    expect(timeline[5].text).toMatch(/… \[truncated]$/)
    expect(context).toContain(`backgroundImage: ${coverUrl}`)
    expect(context).toContain(`https://example.com/${'p'.repeat(600)}`)
    expect(context).toContain('never copy them into an action')
  })

  it('summarizes structured fields for every slide when the deck exceeds the context budget', () => {
    const context = formatDeckContext({
      slides: Array.from({ length: 30 }, (_, index) => ({
        layout: 'stats' as const,
        title: `Figures ${index}`,
        stats: [{ value: `${index}%`, label: 'x'.repeat(150) }, { value: '2', label: 'y'.repeat(150) }],
        sources: [{ title: 'Source', url: 'https://example.com/report' }],
        notes: 'n'.repeat(900),
      })),
    })!
    expect(context.length).toBeLessThanOrEqual(DECK_CONTEXT_MAX_CHARS)
    for (let index = 0; index < 30; index += 1) {
      expect(context).toContain(`slideIndex: ${index}; title: Figures ${index}; layout: stats; fields: notes, stats×2, sources×1`)
    }
    expect(context).toContain('Slide details (shortened):')
  })
})
