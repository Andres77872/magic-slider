import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import StudioApp from './StudioApp'
import * as agentClient from '../agent/agentClient'
import { normalizeDeck } from '../domain/normalize'
import { applyOperations } from '../domain/operations'
import { STORAGE_KEY } from '../session/sessions'
import type { Deck } from '../domain/deckSchema'

// Reveal needs real layout; the live preview is exercised in the browser. Here it is a stub.
vi.mock('./DeckStage', () => ({
  default: ({ deck }: { deck: { slides: Array<{ id: string }> } }) => <div data-testid="stage">{deck.slides.map((slide) => slide.id).join(',')}</div>,
}))

const generated = normalizeDeck({
  title: 'Generated deck',
  theme: { preset: 'ocean' },
  slides: [
    { id: 'cover', name: 'Cover', blocks: [{ type: 'heading', id: 'cover-title', text: 'Hello', level: 1 }] },
    { id: 'body', name: 'Body', blocks: [{ type: 'text', id: 'body-text', text: 'World' }, { type: 'image', id: 'hero-image', src: 'https://images.example.com/a.jpg', alt: 'A hill' }] },
  ],
}).deck!

const created = { ok: true as const, kind: 'deck' as const, deck: generated, created: true, appliedOperations: 0, failedOperations: [], diagnostics: [], rawText: '' }

const canvas = () => screen.getByTestId('v2-edit-canvas')
const blockNode = (id: string) => canvas().querySelector<HTMLElement>(`[data-block-id="${id}"]`)!
const composer = () => screen.getByLabelText('What would you like to change?') as HTMLTextAreaElement

async function generateFirstDeck() {
  render(<StudioApp />)
  fireEvent.change(screen.getByLabelText('Describe your presentation'), { target: { value: 'first' } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  await screen.findByTestId('v2-edit-canvas')
}

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

  it('opens a template in the edit canvas, switches the theme and undoes it', async () => {
    render(<StudioApp />)
    fireEvent.click(screen.getByText('Primitives tour'))
    expect(await screen.findByTestId('v2-edit-canvas')).toBeInTheDocument()
    expect(screen.getByLabelText('Presentation title')).toHaveValue('Magic Slider v2 — primitives tour')
    expect(screen.getAllByRole('option', { name: /^Slide \d+ of 13/ })).toHaveLength(13)

    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'paper' }))
    expect(await screen.findByText('Switched to the paper theme.')).toBeInTheDocument()
    expect(screen.getByText(/13 slides · paper/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(/13 slides · aurora/)).toBeInTheDocument()
  })

  it('generates a deck through the agent client and persists the session', async () => {
    const spy = vi.spyOn(agentClient, 'generate').mockResolvedValue(created)
    render(<StudioApp />)
    fireEvent.change(screen.getByLabelText('Describe your presentation'), { target: { value: 'A deck about greetings' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await screen.findByTestId('v2-edit-canvas')
    expect(blockNode('cover-title')).toHaveTextContent('Hello')
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'A deck about greetings', deck: null, config: expect.objectContaining({ agentModel: 'agt-v2' }) }))
    expect(screen.getByText('Created “Generated deck” with 2 slides.')).toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toContain('Generated deck'), { timeout: 2_000 })
  })

  it('sends @references with the request, renders them as chips and reports skipped operations', async () => {
    const edited = applyOperations(generated, [{ op: 'update_block', blockId: 'hero-image', set: { alt: 'A sunrise' } }]).deck
    const spy = vi.spyOn(agentClient, 'generate')
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce({ ok: true, kind: 'deck', deck: edited, base: generated, created: false, appliedOperations: 1, failedOperations: [{ message: 'Slide "x" does not exist.' }], diagnostics: [], rawText: '', message: 'Swapped the image.' })
    await generateFirstDeck()

    fireEvent.change(composer(), { target: { value: 'Replace @hero-image with a sunrise' } })
    expect(screen.getByRole('button', { name: /Remove reference @hero-image/ })).toBeInTheDocument()
    await act(async () => {
      fireEvent.keyDown(composer(), { key: 'Enter' })
    })

    expect(await screen.findByText('Swapped the image.')).toBeInTheDocument()
    expect(screen.getByText('1 requested change was skipped.')).toBeInTheDocument()
    const request = spy.mock.calls[1][0]
    expect(request).toMatchObject({ prompt: 'Replace @hero-image with a sunrise', deck: generated, focusedSlideId: 'cover' })
    expect(typeof request.resolveDeck).toBe('function')
    expect(request.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'Created “Generated deck” with 2 slides.' },
    ])
    // The sent message shows the reference as a chip that navigates to the element.
    const chat = screen.getByRole('region', { name: 'Conversation' })
    const chip = within(chat).getByRole('button', { name: /image · image: A sunrise/ })
    expect(within(chat).getByRole('button', { name: 'Slide 2 · Body' })).toBeInTheDocument()
    fireEvent.click(within(chat).getByRole('button', { name: 'Slide 2 · Body' }))
    fireEvent.click(chip)
    expect(screen.getByText('Slide 2 of 2 · Body')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'image actions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revert this change' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revert this change' }))
    expect(await screen.findByText('Reverted the assistant’s change.')).toBeInTheDocument()
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

  it('selects a canvas element, references it in chat and sends it as the selected block', async () => {
    const spy = vi.spyOn(agentClient, 'generate').mockResolvedValueOnce(created).mockResolvedValueOnce({ ok: true, kind: 'message', message: 'Sure.', rawText: 'Sure.' })
    await generateFirstDeck()

    fireEvent.click(blockNode('cover-title'))
    const toolbar = await screen.findByRole('toolbar', { name: 'heading actions' })
    expect(screen.getByRole('navigation', { name: 'Selection path' })).toHaveTextContent('heading')
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Ask AI about this element' }))
    expect(composer().value).toBe('@cover-title ')

    fireEvent.change(composer(), { target: { value: '@cover-title make it bigger' } })
    await act(async () => {
      fireEvent.keyDown(composer(), { key: 'Enter' })
    })
    expect(spy.mock.calls[1][0]).toMatchObject({ prompt: '@cover-title make it bigger', focusedSlideId: 'cover', selectedBlockId: 'cover-title' })
  })

  it('edits text inline on the canvas and through the Design panel', async () => {
    vi.spyOn(agentClient, 'generate').mockResolvedValue(created)
    await generateFirstDeck()

    fireEvent.doubleClick(blockNode('cover-title'))
    const editable = await waitFor(() => {
      const node = canvas().querySelector<HTMLElement>('.ms-inline-editing')
      expect(node).not.toBeNull()
      return node!
    })
    expect(editable).toHaveTextContent('Hello')
    editable.textContent = 'Hello **world**'
    fireEvent.keyDown(editable, { key: 'Enter' })
    await waitFor(() => expect(blockNode('cover-title').querySelector('strong')).toHaveTextContent('world'))

    const inspector = screen.getByRole('complementary', { name: 'Inspector' })
    const text = within(inspector).getByLabelText(/^Text/) as HTMLTextAreaElement
    expect(text.value).toBe('Hello **world**')
    fireEvent.focus(text)
    fireEvent.change(text, { target: { value: 'Edited by hand' } })
    fireEvent.blur(text)
    await waitFor(() => expect(blockNode('cover-title')).toHaveTextContent('Edited by hand'))

    fireEvent.click(within(within(inspector).getByRole('radiogroup', { name: 'Level' })).getByRole('radio', { name: '2' }))
    await waitFor(() => expect(blockNode('cover-title').tagName).toBe('H2'))
  })

  it('inserts blocks from the catalog, deletes with the keyboard and undoes', async () => {
    vi.spyOn(agentClient, 'generate').mockResolvedValue(created)
    await generateFirstDeck()

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    const search = screen.getByRole('combobox', { name: 'Search blocks' })
    fireEvent.change(search, { target: { value: 'callout' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    await waitFor(() => expect(canvas().querySelector('.ms-callout')).not.toBeNull())
    const calloutId = canvas().querySelector('.ms-callout')!.getAttribute('data-block-id')!
    expect(screen.getByRole('toolbar', { name: 'callout actions' })).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Delete' })
    await waitFor(() => expect(blockNode(calloutId)).toBeNull())
    expect(screen.getByText(`Deleted callout ${calloutId}.`)).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(blockNode(calloutId)).not.toBeNull())
  })

  it('adds, duplicates and reorders slides from the filmstrip', async () => {
    vi.spyOn(agentClient, 'generate').mockResolvedValue(created)
    await generateFirstDeck()

    fireEvent.click(screen.getByRole('button', { name: 'Add a slide' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Key numbers' }))
    await waitFor(() => expect(screen.getAllByRole('option', { name: /^Slide \d of 3/ })).toHaveLength(3))
    expect(screen.getByText('Slide 2 of 3 · Key numbers')).toBeInTheDocument()

    const second = screen.getByRole('option', { name: 'Slide 2 of 3: Key numbers' })
    fireEvent.keyDown(second, { key: 'ArrowRight', altKey: true })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Slide 3 of 3: Key numbers' })).toBeInTheDocument())

    fireEvent.keyDown(screen.getByRole('option', { name: 'Slide 3 of 3: Key numbers' }), { key: 'd', ctrlKey: true })
    await waitFor(() => expect(screen.getAllByRole('option', { name: /^Slide \d of 4/ })).toHaveLength(4))
  })

  it('edits notes and deck settings from the inspector tabs', async () => {
    vi.spyOn(agentClient, 'generate').mockResolvedValue(created)
    await generateFirstDeck()
    const inspector = screen.getByRole('complementary', { name: 'Inspector' })

    fireEvent.click(within(inspector).getByRole('tab', { name: /Notes/ }))
    const notes = within(inspector).getByLabelText('Speaker notes')
    fireEvent.focus(notes)
    fireEvent.change(notes, { target: { value: 'Open with a question.' } })
    fireEvent.blur(notes)

    fireEvent.click(within(inspector).getByRole('tab', { name: /Theme/ }))
    fireEvent.click(within(inspector).getByRole('radio', { name: /ember/i }))
    await waitFor(() => expect(screen.getByText(/2 slides · ember/)).toBeInTheDocument())

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as { sessions: Array<{ deck: Deck | null }> }
      const deck = stored.sessions.find((session) => session.deck)?.deck
      expect(deck?.slides[0].notes).toBe('Open with a question.')
      expect(deck?.theme?.preset).toBe('ember')
    }, { timeout: 2_000 })
  })
})
