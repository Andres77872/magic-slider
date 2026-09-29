import { deckTitle } from '../domain/presentationSchema'
import type { ValidatedPresentationConfig } from '../domain/presentationTypes'

export function presentationFileName(config: ValidatedPresentationConfig, format: 'html' | 'json'): string {
  const name = deckTitle(config)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'presentation'
  return `${name}.${format}`
}

export function downloadPresentation(contents: string, config: ValidatedPresentationConfig, format: 'html' | 'json'): void {
  const url = URL.createObjectURL(new Blob([contents], { type: format === 'html' ? 'text/html;charset=utf-8' : 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = presentationFileName(config, format)
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
