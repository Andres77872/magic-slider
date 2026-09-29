import { describe, expect, it } from 'vitest'

import {
  backendCreateDeckToolArguments,
  backendCreateDeckToolCallChunk,
  presentationToolArguments,
  presentationToolNames,
  publicCompletionsStreamingToolCallChunk,
} from '../agent/__fixtures__/publicCompletionsToolCalls'
import { parsePresentationToolCall, presentationActionSchema } from './presentationActions'

describe('presentationActionSchema', () => {
  it('accepts every canonical public presentation tool action', () => {
    for (const name of presentationToolNames) {
      expect(presentationActionSchema.safeParse({ action: name, ...presentationToolArguments[name] }).success).toBe(true)
    }
  })

  it('rejects unknown action fields before mutation', () => {
    expect(
      presentationActionSchema.safeParse({
        action: 'add_slide',
        afterIndex: 0,
        slide: { title: 'Safe', content: 'Plain text' },
        unexpected: true,
      }).success,
    ).toBe(false)
  })

  it('rejects raw HTML in content-bearing action payloads', () => {
    expect(
      presentationActionSchema.safeParse({
        action: 'add_slide',
        slide: { title: 'Unsafe', content: '<p>unsafe</p>' },
      }).success,
    ).toBe(false)
  })
})

describe('parsePresentationToolCall', () => {
  it('normalizes OpenAI function.name into the action discriminator', () => {
    const [toolCall] = publicCompletionsStreamingToolCallChunk.choices[0].delta.tool_calls

    expect(parsePresentationToolCall(toolCall)).toMatchObject({
      action: 'create_deck',
      slides: presentationToolArguments.create_deck.slides,
    })
  })

  it('strips app-owned reveal options before strict action validation', () => {
    const [toolCall] = backendCreateDeckToolCallChunk.choices[0].delta.tool_calls

    const action = parsePresentationToolCall(toolCall)

    expect(action).toMatchObject({
      action: 'create_deck',
      slides: backendCreateDeckToolArguments.slides,
      plugins: ['notes'],
      revealOptions: { transition: 'slide' },
    })
    expect(action.action).toBe('create_deck')
    if (action.action !== 'create_deck') throw new Error('Expected create_deck action')
    expect(action.revealOptions).not.toHaveProperty('hash')
  })

  it('preserves valid reveal options while stripping app-owned options', () => {
    const action = parsePresentationToolCall({
      type: 'function',
      function: {
        name: 'create_deck',
        arguments: JSON.stringify({
          ...backendCreateDeckToolArguments,
          revealOptions: { transition: 'slide', hash: true, center: false },
        }),
      },
    })

    expect(action.action).toBe('create_deck')
    if (action.action !== 'create_deck') throw new Error('Expected create_deck action')
    expect(action.revealOptions).toEqual({ transition: 'slide', center: false })
    expect(action.revealOptions).not.toHaveProperty('hash')
  })

  it('still rejects unsupported reveal option values after app-owned normalization', () => {
    expect(() =>
      parsePresentationToolCall({
        type: 'function',
        function: {
          name: 'create_deck',
          arguments: JSON.stringify({
            ...backendCreateDeckToolArguments,
            revealOptions: { transition: 'spin', hash: true },
          }),
        },
      }),
    ).toThrow()
  })

  it('rejects malformed JSON arguments and unknown tool names', () => {
    expect(() =>
      parsePresentationToolCall({ type: 'function', function: { name: 'add_slide', arguments: '{not-json}' } }),
    ).toThrow()
    expect(() =>
      parsePresentationToolCall({ type: 'function', function: { name: 'client:add_slide', arguments: '{}' } }),
    ).toThrow()
  })

  it('rejects argument payloads that override the declared tool action', () => {
    expect(() => parsePresentationToolCall({
      function: { name: 'create_deck', arguments: JSON.stringify({ action: 'delete_slide', slideIndex: 0 }) },
    })).toThrow(/cannot override function.name/)
  })
})
