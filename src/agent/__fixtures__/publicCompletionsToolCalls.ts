export const presentationToolNames = [
  'create_deck',
  'add_slide',
  'edit_slide',
  'delete_slide',
  'reorder_slides',
] as const

export type PresentationToolName = (typeof presentationToolNames)[number]

type PresentationToolArguments = {
  create_deck: {
    slides: { title: string; content: string }[]
    plugins: ('highlight' | 'notes')[]
    revealOptions: { controls: boolean; progress: boolean; transition: 'slide' }
  }
  add_slide: { afterIndex: number; slide: { title: string; content: string } }
  edit_slide: { slideIndex: number; patch: { title: string; content: string } }
  delete_slide: { slideIndex: number }
  reorder_slides: { fromIndex: number; toIndex: number }
}

export const presentationToolArguments: PresentationToolArguments = {
  create_deck: {
    slides: [
      { title: 'Contract intro', content: 'Plain text only introduction' },
      { title: 'Plan', content: 'Plain text agenda' },
    ],
    plugins: ['highlight', 'notes'],
    revealOptions: { controls: true, progress: true, transition: 'slide' },
  },
  add_slide: {
    afterIndex: 0,
    slide: { title: 'New section', content: 'Plain text only new section' },
  },
  edit_slide: {
    slideIndex: 1,
    patch: { title: 'Updated plan', content: 'Updated plain text content' },
  },
  delete_slide: {
    slideIndex: 1,
  },
  reorder_slides: {
    fromIndex: 1,
    toIndex: 0,
  },
}

export const backendCreateDeckToolArguments = {
  slides: [
    { title: 'AI Presentation Builder', content: 'Generate structured Reveal decks from one prompt' },
    { title: 'User Intent', content: 'Capture topic, audience, tone, and slide count up front' },
    { title: 'Agent Workflow', content: 'The backend emits client-executed presentation tool calls' },
    { title: 'Safe Rendering', content: 'The frontend validates generated slides before rendering' },
    { title: 'Next Steps', content: 'Apply actions and preview the deck immediately' },
  ],
  plugins: ['notes'],
  revealOptions: { transition: 'slide', hash: true },
} as const

export const backendCreateDeckToolCallChunk = {
  id: 'chatcmpl-real-create-deck',
  object: 'chat.completion.chunk',
  created: 1_800_000_001,
  model: 'agt-reveal-presentation',
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call_create_deck_real',
            type: 'function' as const,
            function: {
              name: 'create_deck',
              arguments: JSON.stringify(backendCreateDeckToolArguments),
            },
            execution: 'client' as const,
            source: 'schema_only' as const,
          },
        ],
      },
      finish_reason: null,
    },
  ],
} as const

export const publicCompletionsStreamingToolCallChunk = {
  id: 'chatcmpl-presentation-contract',
  object: 'chat.completion.chunk',
  created: 1_800_000_000,
  model: 'agt-reveal-presentation',
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: presentationToolNames.map((name, index) => ({
          index,
          id: `call_${name}`,
          type: 'function' as const,
          function: {
            name,
            arguments: JSON.stringify(presentationToolArguments[name]),
          },
          execution: 'client' as const,
          source: 'schema_only' as const,
        })),
      },
      finish_reason: null,
    },
  ],
} as const

export const publicCompletionsNonStreamingToolCallResponse = {
  id: 'chatcmpl-presentation-contract',
  object: 'chat.completion',
  created: 1_800_000_000,
  model: 'agt-reveal-presentation',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: '',
        tool_calls: presentationToolNames.map((name, index) => ({
          index,
          id: `call_${name}`,
          type: 'function' as const,
          function: {
            name,
            arguments: JSON.stringify(presentationToolArguments[name]),
          },
          execution: 'client' as const,
          source: 'schema_only' as const,
        })),
      },
      finish_reason: 'tool_calls',
    },
  ],
} as const

export function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}
