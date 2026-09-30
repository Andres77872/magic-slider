import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import StudioApp from './StudioApp'
import * as agentClient from '../agent/agentClient'
import { normalizeDeck } from '../domain/normalize'
import { STORAGE_KEY } from '../session/sessions'

// Reveal needs real layout; the stage is exercised in the browser. Here it is a stub.
vi.mock('./DeckStage', () => ({
  default: ({ deck }: { deck: { slides: Array<{ id: string }> } }) => <div data-testid="stage">{deck.slides.map((slide) => slide.id).join(',')}</div>,
}))

const generated = normalizeDeck({
  title: 'Generated deck',
  theme: { preset: 'ocean' },
  slides: [
    { id: 'cover', blocks: [{ type: 'heading', id: 'cover-title', text: 'Hello', level: 1 }] },
    { id: 'body', blocks: [{ type: 'text', id: 'body-text', text: 'World' }] },
  ],
}).deck!

describe('StudioApp', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubEnv('VITE_API_URL', 'http://localhost:7000/v1/chat/completions')
    vi.stubEnv('VITE_AGENT_MODEL', 'agt-v1')
    vi.stubEnv('VITE_AGENT_MODEL_V2', 'agt-v2')
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('opens a template in the studio and edits it locally with undo', async () => {
    render(<StudioApp />)
    fireEvent.click(screen.getByText('Primitives tour'))
    expect(await screen.findByTestId('stage')).toHaveTextContent('cover,why,kpis')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Magic Slider v2 — primitives tour')

    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'paper' } })
    expect(await screen.findByText('Switched to the paper theme.')).toBeInTheDocument()
    expect(screen.getByText(/13 slides · paper/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(/13 slides · aurora/)).toBeInTheDocument()
  })

  it('generates a deck through the agent client and persists the session', async () => {
    const spy = vi.spyOn(agentClient, 'generate').mockResolvedValue({
      ok: true, kind: 'deck', deck: generated, created: true, appliedOperations: 0, failedOperations: [], diagnostics: [], rawText: '',
    })
    render(<StudioApp />)
    fireEvent.change(screen.getByLabelText('Describe your presentation'), { target: { value: 'A deck about greetings' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByTestId('stage')).toHaveTextContent('cover,body')
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'A deck about greetings', deck: null, config: expect.objectContaining({ agentModel: 'agt-v2' }) }))
    expect(screen.getByText('Created “Generated deck” with 2 slides.')).toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toContain('Generated deck'), { timeout: 2_000 })
  })

  it('sends follow-ups with the current deck and reports skipped operations', async () => {
    const spy = vi.spyOn(agentClient, 'generate')
      .mockResolvedValueOnce({ ok: true, kind: 'deck', deck: generated, created: true, appliedOperations: 0, failedOperations: [], diagnostics: [], rawText: '' })
      .mockResolvedValueOnce({ ok: true, kind: 'deck', deck: generated, created: false, appliedOperations: 1, failedOperations: [{ message: 'Slide "x" does not exist.' }], diagnostics: [], rawText: '', message: 'Updated the title.' })
    render(<StudioApp />)
    fireEvent.change(screen.getByLabelText('Describe your presentation'), { target: { value: 'first' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByTestId('stage')

    const composer = screen.getByLabelText('What would you like to change?')
    fireEvent.change(composer, { target: { value: 'Retitle it' } })
    await act(async () => {
      fireEvent.keyDown(composer, { key: 'Enter' })
    })
    expect(await screen.findByText('Updated the title.')).toBeInTheDocument()
    expect(screen.getByText('1 requested change was skipped.')).toBeInTheDocument()
    expect(spy.mock.calls[1][0]).toMatchObject({ prompt: 'Retitle it', deck: generated, focusedSlideId: 'cover' })
    expect(spy.mock.calls[1][0].history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'Created “Generated deck” with 2 slides.' },
    ])
  })

  it('shows configuration problems without calling the agent', async () => {
    vi.stubEnv('VITE_AGENT_MODEL_V2', '')
    const spy = vi.spyOn(agentClient, 'generate')
    render(<StudioApp />)
    fireEvent.change(screen.getByLabelText('Describe your presentation'), { target: { value: 'anything' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('VITE_AGENT_MODEL_V2')
    expect(spy).not.toHaveBeenCalled()
  })

  it('edits a block through the inspector JSON', async () => {
    render(<StudioApp />)
    fireEvent.click(screen.getByText('Pitch skeleton'))
    await screen.findByTestId('stage')
    const inspector = screen.getByRole('complementary', { name: 'Inspector' })
    fireEvent.click(within(inspector).getAllByRole('treeitem')[1].querySelector('button')!)
    const editor = within(inspector).getByLabelText('JSON') as HTMLTextAreaElement
    const block = JSON.parse(editor.value)
    fireEvent.change(editor, { target: { value: JSON.stringify({ ...block, text: 'Edited by hand' }) } })
    fireEvent.click(within(inspector).getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText(`Edited block ${block.id}.`)).toBeInTheDocument()
    expect(editor.value).toContain('Edited by hand')
  })
})
