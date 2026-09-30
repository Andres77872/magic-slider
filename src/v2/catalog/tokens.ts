import { z } from 'zod'

/**
 * Design tokens shared by every v2 primitive. Generated decks never carry raw
 * CSS: they pick from these small vocabularies, and the renderer maps each
 * token to a CSS custom property owned by the active theme. That keeps decks
 * portable across themes and makes a generated value impossible to abuse.
 */

export const tones = ['default', 'muted', 'accent', 'accent2', 'success', 'warning', 'danger', 'info', 'inverse'] as const
export const textSizes = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'display'] as const
export const spaces = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const
export const aligns = ['start', 'center', 'end'] as const
export const radii = ['none', 'sm', 'md', 'lg', 'xl', 'full'] as const
export const revealEffects = [
  'fade-in', 'fade-up', 'fade-down', 'fade-left', 'fade-right', 'zoom-in', 'grow', 'shrink', 'highlight', 'strike', 'blur-in',
] as const

export type Tone = (typeof tones)[number]
export type TextSize = (typeof textSizes)[number]
export type Space = (typeof spaces)[number]
export type Align = (typeof aligns)[number]
export type Radius = (typeof radii)[number]
export type RevealEffect = (typeof revealEffects)[number]

export const toneSchema = z.enum(tones)
export const textSizeSchema = z.enum(textSizes)
export const spaceSchema = z.enum(spaces)
export const alignSchema = z.enum(aligns)
export const radiusSchema = z.enum(radii)
export const revealEffectSchema = z.enum(revealEffects)

/** Palette roles a color value may reference instead of a literal color. */
export const colorRoles = ['background', 'surface', 'text', 'muted', 'accent', 'accent2', 'success', 'warning', 'danger', 'info'] as const
export type ColorRole = (typeof colorRoles)[number]

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export const hexColorSchema = z.string().regex(HEX_COLOR, 'Colors must be #rgb or #rrggbb hex values.')
/** A palette role (preferred, follows the theme) or a literal hex color. */
export const colorValueSchema = z.union([z.enum(colorRoles), hexColorSchema])
export type ColorValue = z.infer<typeof colorValueSchema>

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value)
}

/** CSS for a color value: palette roles resolve to theme variables. */
export function colorCss(value: ColorValue): string {
  return isHexColor(value) ? value : `var(--ms-${value})`
}

export function toneCss(tone: Tone): string {
  switch (tone) {
    case 'default': return 'var(--ms-text)'
    case 'inverse': return 'var(--ms-background)'
    default: return `var(--ms-${tone})`
  }
}

export const spaceScale: Record<Space, string> = {
  none: '0px',
  xs: '8px',
  sm: '14px',
  md: '24px',
  lg: '36px',
  xl: '52px',
  '2xl': '72px',
}

export const textScale: Record<TextSize, string> = {
  xs: '18px',
  sm: '22px',
  md: '27px',
  lg: '33px',
  xl: '42px',
  '2xl': '54px',
  '3xl': '70px',
  display: '96px',
}

export const radiusScale: Record<Radius, string> = {
  none: '0px',
  sm: 'calc(var(--ms-radius) * .5)',
  md: 'var(--ms-radius)',
  lg: 'calc(var(--ms-radius) * 1.6)',
  xl: 'calc(var(--ms-radius) * 2.4)',
  full: '999px',
}

export const alignFlex: Record<Align | 'stretch', string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
}
