import { deckThemes, type DeckTheme } from '../domain/presentationSchema'

export interface BriefPreferences {
  slideCount: 'auto' | '5' | '8' | '12'
  audience: string
  tone: string
  theme: 'auto' | DeckTheme
  research: boolean
  images: boolean
}

export const defaultBriefPreferences: BriefPreferences = {
  slideCount: 'auto',
  audience: '',
  tone: '',
  theme: 'auto',
  research: true,
  images: true,
}

export const audienceOptions = ['General audience', 'Students', 'Executives', 'Technical team', 'Investors', 'Customers'] as const
export const toneOptions = ['Informative', 'Persuasive', 'Inspiring', 'Conversational', 'Formal'] as const
export const themeOptions: ReadonlyArray<{ value: DeckTheme; label: string }> = deckThemes.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}))

/**
 * The agent reads these preferences from a single, clearly labelled line so a
 * request stays readable in the conversation history.
 */
export function formatBriefPreferences(preferences: BriefPreferences): string {
  const parts: string[] = []
  if (preferences.slideCount !== 'auto') parts.push(`${preferences.slideCount} slides`)
  if (preferences.audience) parts.push(`Audience: ${preferences.audience}`)
  if (preferences.tone) parts.push(`Tone: ${preferences.tone}`)
  if (preferences.theme !== 'auto') parts.push(`Theme: ${preferences.theme}`)
  parts.push(`Web research: ${preferences.research ? 'on' : 'off'}`)
  parts.push(`Generated images: ${preferences.images ? 'on' : 'off'}`)
  return `Presentation preferences: ${parts.join(' · ')}`
}

const PREFERENCES_LINE = /\n\nPresentation preferences: [^\n]*$/

/** The user's own words, without the appended preferences line. */
export function stripBriefPreferences(text: string): string {
  return text.replace(PREFERENCES_LINE, '')
}

export function withBriefPreferences(prompt: string, preferences: BriefPreferences | undefined): string {
  if (!preferences) return prompt
  return `${prompt.trimEnd()}\n\n${formatBriefPreferences(preferences)}`
}
