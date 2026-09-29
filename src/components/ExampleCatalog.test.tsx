import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config'
import type { GeneratePresentationResult } from '../agent/agentClient'
import { audienceOptions, defaultBriefPreferences, toneOptions } from '../lib/briefPreferences'
import { exampleCategories, examplePreferences, examplesFor, presentationExamples } from '../lib/exampleCatalog'
import { LOCAL_SESSION_MESSAGE_MAX_LENGTH } from '../session/localSessionModel'
import Chatbot from './Chatbot'
import ExampleCatalog from './ExampleCatalog'

const config: AppConfig = {
  apiUrl: 'https://agent.example.test/generate',
  agentModel: 'presentation-model',
  requestTimeoutMs: 1_000,
  idleTimeoutMs: 500,
  maxStreamBytes: 10_000,
}

afterEach(cleanup)

describe('example catalog data', () => {
  it('has unique ids and at least three examples in every category', () => {
    expect(new Set(presentationExamples.map((example) => example.id)).size).toBe(presentationExamples.length)
    for (const category of exampleCategories) {
      expect(examplesFor(category.id).length, category.id).toBeGreaterThanOrEqual(3)
    }
  })

  it('only uses option values the presentation options offer', () => {
    for (const example of presentationExamples) {
      const preferences = examplePreferences(example)
      expect(['auto', '5', '8', '12']).toContain(preferences.slideCount)
      expect(['', ...audienceOptions]).toContain(preferences.audience)
      expect(['', ...toneOptions]).toContain(preferences.tone)
      expect(example.prompt.length).toBeLessThan(LOCAL_SESSION_MESSAGE_MAX_LENGTH / 10)
    }
  })

  it('starts every preset from the defaults', () => {
    const minimal = { ...presentationExamples[0], preferences: {} }
    expect(examplePreferences(minimal)).toEqual(defaultBriefPreferences)
  })
})

describe('ExampleCatalog', () => {
  it('shows featured examples first and filters by category', () => {
    render(<ExampleCatalog onSelect={vi.fn()} />)
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getAllByRole('button')).toHaveLength(examplesFor('featured').length)

    fireEvent.click(screen.getByRole('tab', { name: 'Technical' }))
    expect(screen.getByRole('tab', { name: 'Technical' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getAllByRole('button').map((card) => card.getAttribute('data-testid')))
      .toEqual(examplesFor('technical').map((example) => `example-${example.id}`))
  })

  it('supports arrow, Home and End keys between category tabs', () => {
    render(<ExampleCatalog onSelect={vi.fn()} />)
    const featured = screen.getByRole('tab', { name: 'Featured' })
    featured.focus()
    fireEvent.keyDown(featured, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Business' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Business' })).toHaveAttribute('tabindex', '0')
    expect(featured).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Business' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Personal & events' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Personal & events' }), { key: 'ArrowRight' })
    expect(featured).toHaveFocus()
  })
})

describe('choosing an example on the home screen', () => {
  it('loads the request and its options, then sends both', async () => {
    const generatePresentationClient = vi.fn().mockResolvedValue({ ok: true, presentation: { slides: [{ title: 'Pitch' }] }, rawText: '{}' } satisfies GeneratePresentationResult)
    render(<Chatbot sessionId="session-a" onGenerate={vi.fn()} loadConfig={() => config} generatePresentationClient={generatePresentationClient} />)
    const pitch = presentationExamples.find((example) => example.id === 'investor-pitch')!

    fireEvent.click(screen.getByTestId('example-investor-pitch'))

    expect(screen.getByTestId('prompt-input')).toHaveValue(pitch.prompt)
    expect(screen.getByTestId('prompt-input')).toHaveFocus()
    expect(screen.getByTestId('example-investor-pitch')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('radio', { name: '12 slides' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Aurora' })).toBeChecked()
    expect(screen.getByText(/loaded the investor pitch example/i)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('generate-button'))
    await waitFor(() => expect(generatePresentationClient).toHaveBeenCalled())
    expect(generatePresentationClient.mock.calls[0][0].prompt).toBe(`${pitch.prompt}\n\nPresentation preferences: 12 slides · Audience: Investors · Tone: Persuasive · Theme: aurora · Web research: on · Generated images: on`)
  })

  it('clears the loaded mark once the request is edited', () => {
    render(<Chatbot sessionId="session-a" onGenerate={vi.fn()} loadConfig={() => config} />)
    fireEvent.click(screen.getByTestId('example-farewell'))
    expect(screen.getByTestId('example-farewell')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByTestId('prompt-input'), { target: { value: 'Something else entirely' } })
    expect(screen.getByTestId('example-farewell')).toHaveAttribute('aria-pressed', 'false')
  })

  it('is not shown in the workspace chat', () => {
    render(<Chatbot mode="workspace" sessionId="session-a" onGenerate={vi.fn()} loadConfig={() => config} />)
    expect(screen.queryByTestId('example-catalog')).not.toBeInTheDocument()
  })
})
