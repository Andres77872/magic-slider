import { z } from 'zod'

import { hexColorSchema } from '../catalog/tokens'

/**
 * Theme engine. A deck names a preset and may override palette colors, fonts
 * and corner radius. Everything resolves to concrete colors in TypeScript so
 * previews, thumbnails, Reveal backgrounds and exports agree, and so contrast
 * can be checked before anything renders.
 */

export const themePresetNames = [
  'midnight', 'aurora', 'ember', 'ocean', 'forest', 'paper', 'ivory', 'slate', 'noir', 'neon', 'sand', 'mint',
] as const
export type ThemePresetName = (typeof themePresetNames)[number]

export const fontNames = ['inter', 'grotesk', 'modern', 'serif', 'display', 'rounded', 'mono', 'system'] as const
export type FontName = (typeof fontNames)[number]

export const decorations = ['none', 'glow', 'grid', 'dots', 'mesh', 'noise'] as const
export type Decoration = (typeof decorations)[number]

export const themeColorKeys = ['background', 'surface', 'text', 'muted', 'accent', 'accent2'] as const

export const themeSchema = z.strictObject({
  preset: z.enum(themePresetNames).optional(),
  colors: z.strictObject(Object.fromEntries(themeColorKeys.map((key) => [key, hexColorSchema.optional()])) as Record<(typeof themeColorKeys)[number], z.ZodOptional<typeof hexColorSchema>>).optional(),
  fonts: z.strictObject({ heading: z.enum(fontNames).optional(), body: z.enum(fontNames).optional() }).optional(),
  radius: z.enum(['none', 'sm', 'md', 'lg', 'xl']).optional(),
  decoration: z.enum(decorations).optional(),
})
export type DeckTheme = z.infer<typeof themeSchema>

interface Preset {
  mode: 'dark' | 'light'
  background: string
  text: string
  muted: string
  accent: string
  accent2: string
  heading: FontName
  body: FontName
  decoration: Decoration
}

export const themePresets: Record<ThemePresetName, Preset> = {
  midnight: { mode: 'dark', background: '#0f1416', text: '#e9f1ed', muted: '#a3b3ad', accent: '#a6cfbc', accent2: '#6fb59a', heading: 'inter', body: 'inter', decoration: 'glow' },
  aurora: { mode: 'dark', background: '#100c22', text: '#ece9ff', muted: '#aea8d3', accent: '#9d8cff', accent2: '#48d4cb', heading: 'grotesk', body: 'inter', decoration: 'mesh' },
  ember: { mode: 'dark', background: '#17100d', text: '#f8ece4', muted: '#c8aa98', accent: '#ff8f55', accent2: '#ffc766', heading: 'display', body: 'inter', decoration: 'glow' },
  ocean: { mode: 'dark', background: '#081a2c', text: '#e6f2ff', muted: '#9db8d2', accent: '#5cbcff', accent2: '#7fe3d3', heading: 'modern', body: 'inter', decoration: 'glow' },
  forest: { mode: 'dark', background: '#0d1a12', text: '#ecf5e8', muted: '#a8c1a3', accent: '#a5d672', accent2: '#e6d5a2', heading: 'serif', body: 'inter', decoration: 'glow' },
  paper: { mode: 'light', background: '#f7f5f0', text: '#1f262d', muted: '#56616c', accent: '#2458d6', accent2: '#d9480f', heading: 'serif', body: 'inter', decoration: 'none' },
  ivory: { mode: 'light', background: '#faf7f2', text: '#1f1b16', muted: '#6b6258', accent: '#c2410c', accent2: '#0f766e', heading: 'display', body: 'modern', decoration: 'none' },
  slate: { mode: 'light', background: '#f8fafc', text: '#0f172a', muted: '#475569', accent: '#2563eb', accent2: '#0891b2', heading: 'inter', body: 'inter', decoration: 'grid' },
  noir: { mode: 'dark', background: '#0a0a0a', text: '#fafafa', muted: '#a3a3a3', accent: '#facc15', accent2: '#e5e5e5', heading: 'grotesk', body: 'inter', decoration: 'noise' },
  neon: { mode: 'dark', background: '#0b0616', text: '#f5f3ff', muted: '#b4a9d6', accent: '#ff4fb0', accent2: '#22d3ee', heading: 'grotesk', body: 'inter', decoration: 'mesh' },
  sand: { mode: 'light', background: '#f4efe6', text: '#2b2620', muted: '#736a5d', accent: '#b45309', accent2: '#4d7c0f', heading: 'serif', body: 'modern', decoration: 'dots' },
  mint: { mode: 'light', background: '#f3faf7', text: '#0f2a22', muted: '#4b6b60', accent: '#047857', accent2: '#7c3aed', heading: 'rounded', body: 'rounded', decoration: 'none' },
}

export const fontStacks: Record<FontName, string> = {
  inter: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  grotesk: "'Space Grotesk', 'Inter', system-ui, sans-serif",
  modern: "'Manrope', 'Inter', system-ui, sans-serif",
  serif: "'Fraunces', Georgia, 'Times New Roman', serif",
  display: "'Playfair Display', Georgia, 'Times New Roman', serif",
  rounded: "'Nunito', 'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
}

/** Google Fonts family specs, loaded only for the fonts a deck uses. */
export const googleFontFamilies: Partial<Record<FontName, string>> = {
  inter: 'Inter:wght@400;500;600;700;800',
  grotesk: 'Space+Grotesk:wght@400;500;600;700',
  modern: 'Manrope:wght@400;500;600;700;800',
  serif: 'Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700',
  display: 'Playfair+Display:wght@500;600;700;800',
  rounded: 'Nunito:wght@400;600;700;800',
  mono: 'JetBrains+Mono:wght@400;500',
}

const radiusPx = { none: 0, sm: 6, md: 12, lg: 18, xl: 26 } as const

export interface ResolvedTheme {
  preset: ThemePresetName
  mode: 'dark' | 'light'
  colors: {
    background: string
    surface: string
    surface2: string
    border: string
    text: string
    muted: string
    accent: string
    accent2: string
    onAccent: string
    success: string
    warning: string
    danger: string
    info: string
  }
  chart: string[]
  fonts: { heading: FontName; body: FontName }
  radius: number
  decoration: Decoration
  /** Adjustments made to keep text readable against generated colors. */
  adjustments: string[]
}

/* ---------- color math ---------- */

function parseHex(hex: string): [number, number, number] {
  let value = hex.replace('#', '')
  if (value.length === 3) value = value.split('').map((character) => character + character).join('')
  const number = Number.parseInt(value, 16)
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255]
}

function toHex([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue].map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`
}

/** Mixes `amount` (0-1) of `overlay` into `base`. */
export function mix(base: string, overlay: string, amount: number): string {
  const from = parseHex(base)
  const to = parseHex(overlay)
  return toHex([0, 1, 2].map((index) => from[index] + (to[index] - from[index]) * amount) as [number, number, number])
}

export function luminance(hex: string): number {
  const channels = parseHex(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left)
  return (light + 0.05) / (dark + 0.05)
}

/** Nudges a color toward black or white until it reaches the target contrast. */
export function ensureContrast(color: string, background: string, target: number): string {
  if (contrastRatio(color, background) >= target) return color
  // Move toward whichever of black or white contrasts more with this background;
  // a luminance threshold picks the wrong side for mid-tone backgrounds.
  const toward = contrastRatio('#ffffff', background) >= contrastRatio('#000000', background) ? '#ffffff' : '#000000'
  for (let step = 1; step <= 10; step += 1) {
    const candidate = mix(color, toward, step / 10)
    if (contrastRatio(candidate, background) >= target) return candidate
  }
  return contrastRatio(toward, background) >= contrastRatio(color, background) ? toward : color
}

function readableOn(background: string): string {
  return contrastRatio('#ffffff', background) >= contrastRatio('#0b0d0e', background) ? '#ffffff' : '#0b0d0e'
}

const semantic = {
  dark: { success: '#4ade80', warning: '#fbbf24', danger: '#f87171', info: '#60a5fa' },
  light: { success: '#15803d', warning: '#b45309', danger: '#b91c1c', info: '#1d4ed8' },
} as const

const chartExtras = {
  dark: ['#f472b6', '#facc15', '#60a5fa', '#34d399', '#fb923c', '#c084fc'],
  light: ['#db2777', '#ca8a04', '#2563eb', '#059669', '#ea580c', '#7c3aed'],
} as const

export function resolveTheme(theme: DeckTheme | undefined): ResolvedTheme {
  const presetName = theme?.preset ?? 'midnight'
  const preset = themePresets[presetName]
  const overrides = theme?.colors ?? {}
  const adjustments: string[] = []
  const background = overrides.background ?? preset.background
  const mode = luminance(background) > 0.4 ? 'light' : 'dark'
  const baseText = overrides.text ?? (overrides.background && !overrides.text ? readableOn(background) : preset.text)

  const text = ensureContrast(baseText, background, 7)
  if (text !== baseText) adjustments.push('Text color adjusted for readability.')
  const baseMuted = overrides.muted ?? (overrides.background && !overrides.muted ? mix(text, background, 0.35) : preset.muted)
  const muted = ensureContrast(baseMuted, background, 4.5)
  if (muted !== baseMuted) adjustments.push('Muted text color adjusted for readability.')
  const baseAccent = overrides.accent ?? preset.accent
  const accent = ensureContrast(baseAccent, background, 3)
  if (accent !== baseAccent) adjustments.push('Accent color adjusted to stand out from the background.')
  const accent2 = ensureContrast(overrides.accent2 ?? preset.accent2, background, 3)
  const surface = overrides.surface ?? mix(background, text, mode === 'dark' ? 0.06 : 0.035)
  const semanticColors = semantic[mode]

  // Always eight distinct series colors, borrowing from the other mode when a palette repeats.
  const otherMode = mode === 'dark' ? 'light' : 'dark'
  const chart = [accent, accent2, ...chartExtras[mode], ...chartExtras[otherMode]]
    .filter((color, index, all) => all.indexOf(color) === index)
    .slice(0, 8)

  return {
    preset: presetName,
    mode,
    colors: {
      background,
      surface,
      surface2: mix(background, text, mode === 'dark' ? 0.11 : 0.07),
      border: mix(background, text, mode === 'dark' ? 0.16 : 0.13),
      text,
      muted,
      accent,
      accent2,
      onAccent: readableOn(accent),
      ...semanticColors,
    },
    chart,
    fonts: { heading: theme?.fonts?.heading ?? preset.heading, body: theme?.fonts?.body ?? preset.body },
    radius: radiusPx[theme?.radius ?? 'md'],
    decoration: theme?.decoration ?? preset.decoration,
    adjustments,
  }
}

/** CSS custom properties consumed by the primitive stylesheet. */
export function themeVariables(theme: ResolvedTheme): Record<string, string> {
  const { colors } = theme
  const vars: Record<string, string> = {
    '--ms-background': colors.background,
    '--ms-surface': colors.surface,
    '--ms-surface-2': colors.surface2,
    '--ms-border': colors.border,
    '--ms-text': colors.text,
    '--ms-muted': colors.muted,
    '--ms-accent': colors.accent,
    '--ms-accent2': colors.accent2,
    '--ms-on-accent': colors.onAccent,
    '--ms-success': colors.success,
    '--ms-warning': colors.warning,
    '--ms-danger': colors.danger,
    '--ms-info': colors.info,
    '--ms-font-heading': fontStacks[theme.fonts.heading],
    '--ms-font-body': fontStacks[theme.fonts.body],
    '--ms-font-mono': fontStacks.mono,
    '--ms-radius': `${theme.radius}px`,
    '--ms-code-bg': theme.mode === 'light' ? '#1d2329' : mix(colors.background, '#000000', 0.45),
    '--ms-scheme': theme.mode,
  }
  theme.chart.forEach((color, index) => {
    vars[`--ms-chart-${index + 1}`] = color
  })
  return vars
}

/** Per-slide tone: "inverse" swaps text and background, "accent" paints the slide in the accent color. */
export function toneVariables(theme: ResolvedTheme, tone: 'default' | 'inverse' | 'accent'): Record<string, string> {
  if (tone === 'default') return {}
  return surfaceVariables(theme, tone === 'inverse' ? theme.colors.text : theme.colors.accent, tone === 'accent')
}

/**
 * Readable palette for content placed on an arbitrary surface color: used by
 * slide tones and by accent/inverse boxes. `monochrome` keeps accents in the
 * text color, for surfaces that already are the accent.
 */
export function surfaceVariables(theme: ResolvedTheme, background: string, monochrome = false): Record<string, string> {
  const text = readableOn(background) === '#ffffff'
    ? (contrastRatio(theme.colors.text, background) >= 7 && luminance(theme.colors.text) > 0.4 ? theme.colors.text : '#ffffff')
    : (contrastRatio(theme.colors.background, background) >= 7 && luminance(theme.colors.background) <= 0.4 ? theme.colors.background : '#0b0d0e')
  const light = luminance(background) > 0.4
  const accent = monochrome ? text : ensureContrast(theme.colors.accent, background, 3)
  const accent2 = monochrome ? text : ensureContrast(theme.colors.accent2, background, 3)
  const mixedMuted = ensureContrast(mix(text, background, 0.3), background, 4.5)
  const semanticColors = semantic[light ? 'light' : 'dark']
  return {
    '--ms-background': background,
    '--ms-surface': mix(background, text, light ? 0.05 : 0.08),
    '--ms-surface-2': mix(background, text, light ? 0.09 : 0.13),
    '--ms-border': mix(background, text, 0.18),
    '--ms-text': text,
    '--ms-muted': mixedMuted,
    '--ms-accent': accent,
    '--ms-accent2': accent2,
    '--ms-on-accent': readableOn(accent),
    '--ms-success': semanticColors.success,
    '--ms-warning': semanticColors.warning,
    '--ms-danger': semanticColors.danger,
    '--ms-info': semanticColors.info,
    '--ms-chart-1': accent,
    '--ms-code-bg': light ? '#1d2329' : mix(background, '#000000', 0.45),
  }
}

export function toneBackground(theme: ResolvedTheme, tone: 'default' | 'inverse' | 'accent'): string {
  return tone === 'inverse' ? theme.colors.text : tone === 'accent' ? theme.colors.accent : theme.colors.background
}

/** Google Fonts stylesheet URL for the fonts a theme uses (null when none need loading). */
export function fontStylesheetUrl(theme: ResolvedTheme): string | null {
  const families = [...new Set([theme.fonts.heading, theme.fonts.body, 'mono' as FontName])]
    .map((font) => googleFontFamilies[font])
    .filter(Boolean)
  if (!families.length) return null
  return `https://fonts.googleapis.com/css2?${families.map((family) => `family=${family}`).join('&')}&display=swap`
}

/** Named gradients resolve against the theme so they follow palette changes. */
export const gradientPresets = ['aurora', 'sunset', 'ocean', 'spotlight', 'duotone', 'fade'] as const
export type GradientPreset = (typeof gradientPresets)[number]

export function gradientCss(theme: ResolvedTheme, name: GradientPreset, base: string): string {
  const { accent, accent2 } = theme.colors
  switch (name) {
    case 'aurora': return `radial-gradient(ellipse 80% 70% at 15% 10%, ${mix(base, accent, 0.45)} 0%, transparent 60%), radial-gradient(ellipse 70% 60% at 90% 90%, ${mix(base, accent2, 0.4)} 0%, transparent 65%)`
    case 'sunset': return `linear-gradient(160deg, ${mix(base, accent, 0.55)} 0%, ${mix(base, accent2, 0.35)} 55%, ${base} 100%)`
    case 'ocean': return `linear-gradient(200deg, ${mix(base, accent2, 0.35)} 0%, ${base} 70%)`
    case 'spotlight': return `radial-gradient(ellipse 65% 55% at 50% 0%, ${mix(base, accent, 0.32)} 0%, ${base} 70%)`
    case 'duotone': return `linear-gradient(135deg, ${accent} 0%, ${accent2} 100%)`
    default: return `linear-gradient(180deg, ${base} 0%, ${mix(base, theme.colors.text, 0.08)} 100%)`
  }
}
