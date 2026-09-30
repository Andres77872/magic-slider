import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveReference } from '../../agent/references'
import { normalizeDeck } from '../../domain/normalize'
import Composer, { type ComposerHandle } from './Composer'
import { REFERENCE_MIME } from './referenceDrag'

const deck = normalizeDeck({
  slides: [
    { id: 'cover', name: 'Cover', blocks: [{ type: 'heading', id: 'cover-title', text: 'Hello' }] },
    { id: 'market-size', name: 'Market size', blocks: [{ type: 'image', id: 'hero-image', src: 'https://images.example.com/a.jpg', alt: 'A hill' }] },
  ],
}).deck!

function setup(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn()
  const onNavigate = vi.fn()
  const ref = createRef<ComposerHandle>()
  render(<Composer ref={ref} deck={deck} activeSlideId="cover" selection={null} busy={false} onSend={onSend} onCancel={() => undefined} onNavigate={onNavigate} {...overrides} />)
  const input = screen.getByRole('combobox', { name: 'What would you like to change?' }) as HTMLTextAreaElement
  const type = (value: string) => {
    fireEvent.change(input, { target: { value, selectionStart: value.length } })
    input.setSelectionRange(value.length, value.length)
    fireEvent.select(input)
  }
  return { input, onSend, onNavigate, ref, type }
}

describe('Composer', () => {
  afterEach(cleanup)

  it('suggests slides and elements after @ and accepts one with the keyboard', () => {
    const { input, type } = setup()
    type('Update @')
    const listbox = screen.getByRole('listbox', { name: 'Slides and elements' })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Slide 1 · Cover')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(listbox).toBeInTheDocument()

    type('Update @hero')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('@hero-image')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('Update @hero-image ')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('button', { name: /Remove reference @hero-image/ })).toBeInTheDocument()
  })

  it('closes only the popup on Escape and never sends while a suggestion is being accepted', () => {
    const { input, onSend, type } = setup()
    type('Tighten @mark')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.value).toBe('Tighten @mark')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('flags unknown mentions, but not the one still being typed', () => {
    const { type } = setup()
    type('Fix @nope')
    expect(screen.queryByText('@nope not found')).toBeNull()
    type('Fix @nope please')
    expect(screen.getByText('@nope not found')).toBeInTheDocument()
  })

  it('removes a whole mention with Backspace and with the chip button', () => {
    const { input, type } = setup()
    type('Make @cover-title')
    fireEvent.keyDown(input, { key: 'Escape' })
    input.setSelectionRange(input.value.length, input.value.length)
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(input.value).toBe('Make ')

    type('Swap @hero-image now')
    fireEvent.click(screen.getByRole('button', { name: 'Remove reference @hero-image' }))
    expect(input.value).toBe('Swap now')
  })

  it('offers the canvas selection as a suggested reference that can be pinned or excluded', () => {
    const selection = resolveReference(deck, 'cover-title')
    const { input, onSend, type } = setup({ selection })
    fireEvent.click(screen.getByRole('button', { name: /Selected: heading · Hello/ }))
    expect(input.value).toBe('@cover-title ')

    type('Bigger')
    fireEvent.click(screen.getByRole('button', { name: "Don't send the selection" }))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('Bigger', { includeSelection: false })
  })

  it('inserts references from the imperative handle and from drops', () => {
    const { input, ref } = setup()
    act(() => ref.current!.insertReference('market-size'))
    expect(input.value).toBe('@market-size ')
    act(() => ref.current!.insertReference('market-size'))
    expect(input.value).toBe('@market-size ')

    const data = new Map([[REFERENCE_MIME, 'cover']])
    const dataTransfer = { types: [REFERENCE_MIME], getData: (key: string) => data.get(key) ?? '', dropEffect: '' }
    const field = input.closest('.v2-composer')!
    fireEvent.dragOver(field, { dataTransfer })
    fireEvent.drop(field, { dataTransfer })
    expect(input.value).toContain('@cover')
  })

  it('navigates from a chip and sends with Enter', () => {
    const { input, onNavigate, onSend, type } = setup()
    type('Tighten @market-size')
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /Slide 2 · Market size/ }))
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 'market-size', kind: 'slide' }))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('Tighten @market-size', { includeSelection: true })
    expect(input.value).toBe('')
  })
})
