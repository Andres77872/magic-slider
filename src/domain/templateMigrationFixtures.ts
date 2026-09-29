export type TemplateMigrationStatus = 'cleaned' | 'intentional-validation-failure'

export interface TemplateMigrationFixture {
  readonly fileName: string
  readonly status: TemplateMigrationStatus
  readonly reason: string
}

export const templateMigrationFixtures = [
  {
    fileName: 'basic.json',
    status: 'cleaned',
    reason: 'Legacy paragraph HTML was rewritten to plain text content accepted by the Zod validation boundary.',
  },
  {
    fileName: 'code-highlight.json',
    status: 'cleaned',
    reason: 'Legacy pre/code HTML was migrated to a structured code block rendered as text.',
  },
  {
    fileName: 'image-background.json',
    status: 'cleaned',
    reason: 'Legacy paragraph HTML was rewritten to plain text while preserving the safe HTTPS background image.',
  },
  {
    fileName: 'showcase.json',
    status: 'cleaned',
    reason: 'Reference deck exercising every structured layout, theme, image, citation and code field shared with the agent contract.',
  },
  {
    fileName: 'with-notes.json',
    status: 'cleaned',
    reason: 'Legacy paragraph HTML and unsupported data-note attribute were migrated to plain content plus notes.',
  },
] as const satisfies readonly TemplateMigrationFixture[]
