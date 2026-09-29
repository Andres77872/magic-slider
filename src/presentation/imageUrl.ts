function hasUnsafeCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\')
}

function isCredentialFreeWebUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

/** Shared by validation and rendering so accepted image URLs mean the same thing. */
export function isSafeImageUrl(value: string): boolean {
  // Browsers normalize backslashes and control characters in surprising ways.
  // Require explicit web URLs or same-origin root paths, never //host paths.
  if (!value || hasUnsafeCharacters(value)) return false
  if (value.startsWith('/')) return !value.startsWith('//')
  return isCredentialFreeWebUrl(value)
}

/** Source citations open external pages, so only absolute web URLs qualify. */
export function isSafeLinkUrl(value: string): boolean {
  return Boolean(value) && !hasUnsafeCharacters(value) && isCredentialFreeWebUrl(value)
}

/** Readable host for citation labels, without a leading www. */
export function linkHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
