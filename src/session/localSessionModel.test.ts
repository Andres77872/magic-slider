import { describe, expect, it } from 'vitest'

import {
  AGENT_CONTEXT_MESSAGE_LIMIT,
  LOCAL_SESSION_ACTION_LOG_LIMIT,
  LOCAL_SESSION_LIMIT,
  LOCAL_SESSION_MESSAGE_LIMIT,
  applySessionRetention,
  capLocalSessionActionLog,
  capLocalSessionMessages,
  createFreshEnvelope,
  createFreshLocalSession,
  localSessionEnvelopeSchema,
  selectedSessionConversationContext,
  type LocalSessionMessage,
} from './localSessionModel'

const validDeck = { slides: [{ title: 'Safe', content: 'Plain safe content' }] }

describe('local session model', () => {
  it('validates a selectedSessionId plus sessions envelope with complete project state', () => {
    const session = createFreshLocalSession({
      id: 'session-a',
      title: 'Session A',
      currentDeckSnapshot: validDeck,
      messages: [{ id: 'm1', kind: 'user', text: 'Make session A', createdAt: '2026-01-01T00:00:00.000Z', apiRole: 'user' }],
      actionLog: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const result = localSessionEnvelopeSchema.safeParse(createFreshEnvelope(session))

    expect(result.success).toBe(true)
  })

  it('accepts an empty-deck session but rejects duplicate ids, missing selected ids, extra fields, and invalid decks', () => {
    const emptyDeckSession = createFreshLocalSession({ id: 'empty', currentDeckSnapshot: null })
    expect(localSessionEnvelopeSchema.safeParse(createFreshEnvelope(emptyDeckSession)).success).toBe(true)

    const duplicate = { schemaVersion: 1, selectedSessionId: 'a', sessions: [createFreshLocalSession({ id: 'a' }), createFreshLocalSession({ id: 'a' })] }
    expect(localSessionEnvelopeSchema.safeParse(duplicate).success).toBe(false)

    const missingSelected = { schemaVersion: 1, selectedSessionId: 'missing', sessions: [createFreshLocalSession({ id: 'a' })] }
    expect(localSessionEnvelopeSchema.safeParse(missingSelected).success).toBe(false)

    const extraField = { ...createFreshEnvelope(createFreshLocalSession({ id: 'extra' })), debugLoading: true }
    expect(localSessionEnvelopeSchema.safeParse(extraField).success).toBe(false)

    const invalidDeck = createFreshEnvelope(createFreshLocalSession({ id: 'unsafe', currentDeckSnapshot: { slides: [{ content: '<script>alert(1)</script>' }] } as never }))
    expect(localSessionEnvelopeSchema.safeParse(invalidDeck).success).toBe(false)
  })

  it('retains max ten sessions deterministically while preserving the selected session', () => {
    const sessions = Array.from({ length: 12 }, (_, index) => createFreshLocalSession({
      id: `session-${index}`,
      createdAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      updatedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }))

    const retained = applySessionRetention({ schemaVersion: 1, selectedSessionId: 'session-0', sessions })

    expect(retained.sessions).toHaveLength(LOCAL_SESSION_LIMIT)
    expect(retained.sessions.map((session) => session.id)).toContain('session-0')
    expect(applySessionRetention(retained).sessions.map((session) => session.id)).toEqual(retained.sessions.map((session) => session.id))
  })

  it('builds selected-session API context from eligible user/assistant messages only and caps to fifteen', () => {
    const messages: LocalSessionMessage[] = [
      ...Array.from({ length: 20 }, (_, index) => ({
      id: `m-${index}`,
      kind: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `eligible-${index}`,
      createdAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
      apiRole: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    })),
      { id: 'status', kind: 'status', text: 'Generating…', createdAt: '2026-01-01T00:00:30.000Z' },
      { id: 'mistagged-status', kind: 'status', text: 'Saving…', createdAt: '2026-01-01T00:00:30.000Z', apiRole: 'assistant' },
      { id: 'mistagged-user', kind: 'user', text: 'Wrong role', createdAt: '2026-01-01T00:00:30.000Z', apiRole: 'assistant' },
    ]

    const context = selectedSessionConversationContext(messages)

    expect(context).toHaveLength(AGENT_CONTEXT_MESSAGE_LIMIT)
    expect(context[0]).toEqual({ role: 'assistant', content: 'eligible-5' })
    expect(context).not.toContainEqual(expect.objectContaining({ content: 'Generating…' }))
    expect(context).not.toContainEqual(expect.objectContaining({ content: 'Saving…' }))
    expect(context).not.toContainEqual(expect.objectContaining({ content: 'Wrong role' }))
  })

  it('deterministically retains newest messages and action-log entries within write caps', () => {
    const messages = Array.from({ length: LOCAL_SESSION_MESSAGE_LIMIT + 5 }, (_, index) => ({
      id: `m-${index}`,
      kind: 'user' as const,
      text: `message-${index}`,
      createdAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      apiRole: 'user' as const,
    }))
    const actionLog = Array.from({ length: LOCAL_SESSION_ACTION_LOG_LIMIT + 5 }, (_, index) => ({
      id: `a-${index}`,
      action: { action: 'add_slide' as const, slide: { title: `Slide ${index}`, content: 'Safe content' } },
      summary: `action-${index}`,
      createdAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      result: 'applied' as const,
    }))

    expect(capLocalSessionMessages(messages)).toHaveLength(LOCAL_SESSION_MESSAGE_LIMIT)
    expect(capLocalSessionMessages(messages)[0].id).toBe('m-5')
    expect(capLocalSessionActionLog(actionLog)).toHaveLength(LOCAL_SESSION_ACTION_LOG_LIMIT)
    expect(capLocalSessionActionLog(actionLog)[0].id).toBe('a-5')
  })
})
