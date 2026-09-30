import { isSafeImageUrl as isSafeV1ImageUrl } from '../../presentation/imageUrl'

/**
 * v2 image URL check: the v1 allowlist plus a URL Reveal can decode. Reveal
 * passes background and lazy-loaded URLs through decodeURI; a stray "%" (e.g.
 * ".../50%off.jpg") would throw inside its initialization and hang the viewer.
 */
export function isSafeImageUrl(value: string): boolean {
  if (!isSafeV1ImageUrl(value)) return false
  try {
    decodeURI(value)
    return true
  } catch {
    return false
  }
}
