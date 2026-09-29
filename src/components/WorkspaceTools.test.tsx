import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultBriefPreferences, formatBriefPreferences, withBriefPreferences } from '../lib/briefPreferences'
import SessionList, { describeUpdatedAt } from './SessionList'
import SlideNavigator from './SlideNavigator'
import SlideNotesPanel from './SlideNotesPanel'

const sessions = [
  { id: 'a', title: 'Solar briefing', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', messageCount: 1, slideCount: 8, coverImage: 'https://v3.fal.media/files/cover.jpg', theme: 'ocean' },
  { id: 'b', title: 'Unsafe cover', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', messageCount: 2, slideCount: 1, coverImage: 'javascript:alert(1)' },
]

afterEach(cleanup)

describe('SessionList', () => {
  it('asks for confirmation before clearing history and can be cancelled', () => {
    const onClear = vi.fn()
    render(<SessionList variant="home" sessions={sessions} onClear={onClear} />)

    fireEvent.click(screen.getByTestId('clear-history-button'))
    expect(onClear).not.toHaveBeenCalled()
    expect(screen.getByTestId('confirm-clear-history')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('confirm-clear-history')).not.toBeInTheDocument()
    expect(screen.getByTestId('clear-history-button')).toHaveFocus()

    fireEvent.click(screen.getByTestId('clear-history-button'))
    fireEvent.click(screen.getByTestId('confirm-clear-history'))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('shows safe cover previews, counts and selection state', () => {
    const onSelect = vi.fn()
    render(<SessionList variant="workspace" sessions={sessions} selectedSessionId="a" onSelect={onSelect} />)
    const [solar, unsafe] = screen.getAllByRole('button', { name: /slide/ })

    expect(solar).toHaveAttribute('aria-current', 'true')
    expect(solar).toHaveTextContent('8 slides · 1 message')
    expect(solar.querySelector('img')).toHaveAttribute('src', 'https://v3.fal.media/files/cover.jpg')
    expect(unsafe.querySelector('img')).toBeNull()
    fireEvent.click(unsafe)
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('describes recent updates relative to now', () => {
    const now = Date.parse('2026-01-02T00:00:00.000Z')
    expect(describeUpdatedAt('2026-01-01T23:59:40.000Z', now)).toBe('just now')
    expect(describeUpdatedAt('2026-01-01T00:00:00.000Z', now)).toMatch(/yesterday|1 day ago/)
    expect(describeUpdatedAt('not a date', now)).toBe('')
  })
})

describe('SlideNavigator', () => {
  const deck = {
    theme: 'forest' as const,
    slides: [
      { layout: 'title' as const, title: 'Opening', backgroundImage: 'https://v3.fal.media/files/cover.jpg' },
      { title: 'Figures', stats: [{ value: '3', label: 'x' }] },
      { quote: { text: 'A quotation without a title' } },
    ],
  }

  it('labels every slide with its number, title and layout and marks the current one', () => {
    render(<SlideNavigator deck={deck} currentIndex={1} onSelect={vi.fn()} />)
    const buttons = within(screen.getByTestId('slide-navigator')).getAllByRole('button')

    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Slide 1: Opening (Title)',
      'Slide 2: Figures (Key figures)',
      'Slide 3: A quotation without a title (Quote)',
    ])
    expect(buttons[1]).toHaveAttribute('aria-current', 'true')
    expect(buttons[0].querySelector('img')).toHaveAttribute('alt', '')
  })

  it('selects slides by index', () => {
    const onSelect = vi.fn()
    render(<SlideNavigator deck={deck} currentIndex={0} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /slide 3/i }))
    expect(onSelect).toHaveBeenCalledWith(2)
  })
})

describe('SlideNotesPanel', () => {
  it('shows notes, safe source links and image descriptions for the current slide', () => {
    render(<SlideNotesPanel slideNumber={2} slide={{
      notes: 'Explain the 2025 figure.',
      image: { url: '/a.png', alt: 'Wind turbines at dusk' },
      sources: [{ title: 'IRENA', url: 'https://www.irena.org/report' }, { title: 'Unsafe', url: 'javascript:alert(1)' }],
    }} />)

    expect(screen.getByText('Explain the 2025 figure.')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /irena/i })
    expect(link).toHaveAttribute('href', 'https://www.irena.org/report')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByRole('link', { name: /unsafe/i })).not.toBeInTheDocument()
    expect(screen.getByText(/wind turbines at dusk/i)).toBeInTheDocument()
  })

  it('explains empty notes and sources', () => {
    render(<SlideNotesPanel slideNumber={1} slide={{ title: 'Bare' }} />)
    expect(screen.getByText(/no notes for this slide/i)).toBeInTheDocument()
    expect(screen.getByText(/no sources cited/i)).toBeInTheDocument()
  })
})

describe('brief preferences', () => {
  it('formats explicit choices on one labelled line', () => {
    expect(formatBriefPreferences({ ...defaultBriefPreferences, slideCount: '8', audience: 'Executives', theme: 'paper', images: false }))
      .toBe('Presentation preferences: 8 slides · Audience: Executives · Theme: paper · Web research: on · Generated images: off')
  })

  it('leaves the prompt untouched without preferences', () => {
    expect(withBriefPreferences('Deck about bees', undefined)).toBe('Deck about bees')
    expect(withBriefPreferences('Deck about bees  ', defaultBriefPreferences)).toBe('Deck about bees\n\nPresentation preferences: Web research: on · Generated images: on')
  })
})

describe('deck outcome summary', () => {
  it('reports slides, distinct images and cited sources', async () => {
    const { describeDeckOutcome } = await import('../lib/presentationCopy')
    expect(describeDeckOutcome({ slides: [{ title: 'x' }] }, 'created')).toBe('Created presentation with 1 slide.')
    expect(describeDeckOutcome({
      slides: [
        { backgroundImage: '/a.png', sources: [{ title: 'A', url: 'https://a.example/' }] },
        { image: { url: '/b.png', alt: 'b' }, sources: [{ title: 'A', url: 'https://a.example/' }, { title: 'B', url: 'https://b.example/' }] },
        { backgroundImage: '/a.png' },
      ],
    }, 'updated')).toBe('Updated presentation with 3 slides · 2 images · 2 cited sources.')
  })
})
