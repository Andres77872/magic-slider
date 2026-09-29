import { appOwnedRevealOptions } from './revealConfig'

export class RevealUrlConfigError extends Error {
  readonly conflictingOptions: string[]

  constructor(conflictingOptions: string[]) {
    super(`This link changes settings managed by the editor. Remove these URL parameters and reload: ${conflictingOptions.join(', ')}.`)
    this.name = 'RevealUrlConfigError'
    this.conflictingOptions = conflictingOptions
  }
}

export function assertSafeRevealUrl(queryOptions: Record<string, unknown>, search: string): void {
  const conflicts = Object.entries(appOwnedRevealOptions)
    .filter(([key, expected]) => Object.prototype.hasOwnProperty.call(queryOptions, key) && queryOptions[key] !== expected)
    .map(([key]) => key)

  // Reveal's URL parser cannot supply actual plugin instances. Letting a URL
  // replace the trusted registry makes initialize() fail before it can start.
  if (Object.prototype.hasOwnProperty.call(queryOptions, 'plugins')) conflicts.push('plugins')

  // Reveal supports this legacy switch even without an equals sign/value.
  if (/print-pdf/i.test(search)) conflicts.push('print-pdf')

  if (conflicts.length > 0) throw new RevealUrlConfigError(conflicts)
}
