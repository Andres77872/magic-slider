import { z } from 'zod'

import type { AgentConversationMessage } from '../agent/agentClient'
import { presentationActionSchema } from '../domain/presentationActions'
import { presentationConfigSchema } from '../domain/presentationSchema'
import { stripBriefPreferences } from '../lib/briefPreferences'

export const LOCAL_SESSION_SCHEMA_VERSION = 1
export const LOCAL_SESSION_STORAGE_KEY = 'magic-slider:sessions:v1'
export const LOCAL_SESSION_LIMIT = 10
export const AGENT_CONTEXT_MESSAGE_LIMIT = 15
export const LOCAL_SESSION_MESSAGE_LIMIT = 200
export const LOCAL_SESSION_MESSAGE_MAX_LENGTH = 20_000
export const LOCAL_SESSION_ACTION_LOG_LIMIT = 200

const isoTimestampSchema = z.string().min(1)

export const localSessionMessageSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['user', 'assistant', 'status', 'tool']),
  text: z.string().max(LOCAL_SESSION_MESSAGE_MAX_LENGTH),
  createdAt: isoTimestampSchema,
  apiRole: z.enum(['user', 'assistant']).optional(),
})

export const localSessionActionLogEntrySchema = z.strictObject({
  id: z.string().min(1),
  action: presentationActionSchema,
  summary: z.string().min(1).max(1_000),
  createdAt: isoTimestampSchema,
  result: z.enum(['applied', 'rejected']),
  errorMessage: z.string().max(1_000).optional(),
})

export const localSessionSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SESSION_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  summary: z.string().max(500).optional(),
  messages: z.array(localSessionMessageSchema).max(LOCAL_SESSION_MESSAGE_LIMIT),
  currentDeckSnapshot: presentationConfigSchema.nullable(),
  actionLog: z.array(localSessionActionLogEntrySchema).max(LOCAL_SESSION_ACTION_LOG_LIMIT),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
})

const baseLocalSessionEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SESSION_SCHEMA_VERSION),
  selectedSessionId: z.string().min(1),
  sessions: z.array(localSessionSchema).min(1),
})

export const localSessionEnvelopeSchema = baseLocalSessionEnvelopeSchema.superRefine((envelope, context) => {
  const seen = new Set<string>()
  for (const [index, session] of envelope.sessions.entries()) {
    if (seen.has(session.id)) {
      context.addIssue({ code: 'custom', message: `Duplicate session id: ${session.id}`, path: ['sessions', index, 'id'] })
    }
    seen.add(session.id)
  }

  if (!seen.has(envelope.selectedSessionId)) {
    context.addIssue({ code: 'custom', message: 'selectedSessionId must reference an existing session.', path: ['selectedSessionId'] })
  }
})

export type LocalSessionMessage = z.infer<typeof localSessionMessageSchema>
export type LocalSessionActionLogEntry = z.infer<typeof localSessionActionLogEntrySchema>
export type LocalSession = z.infer<typeof localSessionSchema>
export type LocalSessionEnvelope = z.infer<typeof localSessionEnvelopeSchema>

export type LocalSessionSummary = {
  id: string
  title: string
  summary?: string
  createdAt: string
  updatedAt: string
  messageCount: number
  slideCount: number
  /** First safe image in the deck, for session previews. */
  coverImage?: string
  theme?: string
}

export function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function createFreshLocalSession(overrides: Partial<LocalSession> = {}): LocalSession {
  const timestamp = overrides.createdAt ?? nowIso()
  const id = overrides.id ?? createSessionId()
  return {
    schemaVersion: LOCAL_SESSION_SCHEMA_VERSION,
    id,
    title: overrides.title ?? 'Untitled presentation',
    summary: overrides.summary,
    messages: overrides.messages ?? [],
    currentDeckSnapshot: overrides.currentDeckSnapshot ?? null,
    actionLog: overrides.actionLog ?? [],
    createdAt: timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
  }
}

export function createFreshEnvelope(session = createFreshLocalSession()): LocalSessionEnvelope {
  return {
    schemaVersion: LOCAL_SESSION_SCHEMA_VERSION,
    selectedSessionId: session.id,
    sessions: [session],
  }
}

function recencyValue(session: LocalSession): number {
  return Date.parse(session.updatedAt) || Date.parse(session.createdAt) || 0
}

export function sortSessionsByRecency(sessions: LocalSession[]): LocalSession[] {
  return [...sessions].sort((left, right) => {
    const byUpdated = recencyValue(right) - recencyValue(left)
    if (byUpdated !== 0) return byUpdated
    const byCreated = (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0)
    if (byCreated !== 0) return byCreated
    return left.id.localeCompare(right.id)
  })
}

export function applySessionRetention(envelope: LocalSessionEnvelope, limit = LOCAL_SESSION_LIMIT): LocalSessionEnvelope {
  const selected = envelope.sessions.find((session) => session.id === envelope.selectedSessionId)
  if (!selected) return envelope
  const retained = sortSessionsByRecency(envelope.sessions).slice(0, limit)
  if (!retained.some((session) => session.id === selected.id)) {
    retained.splice(Math.max(0, limit - 1), 1, selected)
  }
  return { ...envelope, sessions: sortSessionsByRecency(retained).slice(0, limit) }
}

export function capLocalSessionMessages(messages: LocalSessionMessage[]): LocalSessionMessage[] {
  return messages.slice(-LOCAL_SESSION_MESSAGE_LIMIT)
}

export function capLocalSessionActionLog(actionLog: LocalSessionActionLogEntry[]): LocalSessionActionLogEntry[] {
  return actionLog.slice(-LOCAL_SESSION_ACTION_LOG_LIMIT)
}

export function normalizeLocalSession(session: LocalSession): LocalSession {
  return {
    ...session,
    messages: capLocalSessionMessages(session.messages),
    actionLog: capLocalSessionActionLog(session.actionLog),
  }
}

export function normalizeLocalSessionEnvelope(envelope: LocalSessionEnvelope): LocalSessionEnvelope {
  return applySessionRetention({
    ...envelope,
    sessions: envelope.sessions.map(normalizeLocalSession),
  })
}

export function validateLocalSessionEnvelope(input: unknown): LocalSessionEnvelope | null {
  const result = localSessionEnvelopeSchema.safeParse(input)
  if (!result.success) return null
  return normalizeLocalSessionEnvelope(result.data)
}

export function getSelectedSession(envelope: LocalSessionEnvelope): LocalSession {
  return envelope.sessions.find((session) => session.id === envelope.selectedSessionId) ?? envelope.sessions[0]
}

export function summarizeLocalSession(session: LocalSession): LocalSessionSummary {
  return {
    id: session.id,
    title: session.title,
    summary: session.summary,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    slideCount: session.currentDeckSnapshot?.slides.length ?? 0,
    ...deckPreview(session.currentDeckSnapshot),
  }
}

function deckPreview(deck: LocalSession['currentDeckSnapshot']): Pick<LocalSessionSummary, 'coverImage' | 'theme'> {
  if (!deck) return {}
  const coverImage = deck.slides.map((slide) => slide.backgroundImage ?? slide.background ?? slide.image?.url).find(Boolean)
  return { ...(coverImage ? { coverImage } : {}), ...(deck.theme ? { theme: deck.theme } : {}) }
}

export function summarizeLocalSessions(sessions: LocalSession[]): LocalSessionSummary[] {
  return sortSessionsByRecency(sessions).filter(isRestorableLocalSession).map(summarizeLocalSession)
}

export function isRestorableLocalSession(session: LocalSession): boolean {
  return Boolean(session.currentDeckSnapshot || session.messages.length > 0 || session.actionLog.length > 0)
}

export function hasRestorableLocalSessions(envelope: LocalSessionEnvelope): boolean {
  return envelope.sessions.some(isRestorableLocalSession)
}

export function titleFromPrompt(prompt: string): string {
  const compact = stripBriefPreferences(prompt).trim().replace(/\s+/g, ' ')
  if (!compact) return 'Untitled presentation'
  return compact.length > 60 ? `${compact.slice(0, 57)}…` : compact
}

export function createLocalSessionMessage(input: Omit<LocalSessionMessage, 'id' | 'createdAt'>): LocalSessionMessage {
  return { ...input, id: createSessionId(), createdAt: nowIso() }
}

export function selectedSessionConversationContext(messages: LocalSessionMessage[]): AgentConversationMessage[] {
  return messages
    .filter((message) => (message.kind === 'user' || message.kind === 'assistant') && message.apiRole === message.kind && message.text.trim())
    .map((message) => ({ role: message.apiRole as 'user' | 'assistant', content: message.text }))
    .slice(-AGENT_CONTEXT_MESSAGE_LIMIT)
}
