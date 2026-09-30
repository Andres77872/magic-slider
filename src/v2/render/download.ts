import { deckTitle, type Deck } from '../domain/deckSchema'

export function deckFileName(deck: Deck, extension: 'html' | 'json'): string {
  const name = deckTitle(deck).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'presentation'
  return `${name}.${extension}`
}

export function downloadFile(contents: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }
}
