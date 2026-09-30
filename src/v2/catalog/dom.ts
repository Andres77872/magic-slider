import { appendRichText } from './richText'
import { createIcon, isIconName } from './icons'
import type { RenderContext } from './types'

/** Small DOM helpers shared by primitives. Text always goes through textContent or the rich-text builder. */
export function el<K extends keyof HTMLElementTagNameMap>(
  context: Pick<RenderContext, 'doc'>,
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = context.doc.createElement(tagName)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function rich<K extends keyof HTMLElementTagNameMap>(
  context: Pick<RenderContext, 'doc'>,
  tagName: K,
  className: string,
  source: string,
): HTMLElementTagNameMap[K] {
  const node = el(context, tagName, className)
  appendRichText(node, source)
  return node
}

export function icon(context: Pick<RenderContext, 'doc' | 'report'>, name: string, className = 'ms-icon'): SVGSVGElement {
  if (!isIconName(name)) context.report('unknown-icon', `Unknown icon "${name.slice(0, 40)}" rendered as a dot.`)
  return createIcon(context.doc, name, className)
}

export function setVars(node: HTMLElement, vars: Record<string, string | number | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) node.style.setProperty(key, String(value))
  }
}

/** Formats a chart or stat number compactly: 1234 → "1,234", 0.5 → "0.5". */
export function formatNumber(value: number, locale?: string): string {
  const abs = Math.abs(value)
  const digits = abs !== 0 && abs < 10 && !Number.isInteger(value) ? 2 : abs < 100 && !Number.isInteger(value) ? 1 : 0
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)
  } catch {
    return String(value)
  }
}

/** Evenly marks items as Reveal fragments when the author asks for staggered reveals. */
export function stagger(node: Element, enabled: boolean | undefined, effect = 'fade-up'): void {
  if (!enabled) return
  node.classList.add('fragment', effect)
}
