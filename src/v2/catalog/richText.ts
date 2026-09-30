import { isSafeLinkUrl } from '../../presentation/imageUrl'

/**
 * Inline rich text for every text-bearing primitive. The vocabulary is a small
 * Markdown subset that language models already write fluently:
 *
 *   **bold**  *italic*  _italic_  `code`  ==accent==  ~~strike~~  [label](https://…)
 *
 * A newline is a line break. Nothing is ever parsed as HTML: the result is a
 * tree of text nodes and a fixed set of inline elements, so generated text can
 * never inject markup. Unmatched delimiters stay literal text.
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'br' }
  | { type: 'strong' | 'em' | 'code' | 'mark' | 'del'; children: InlineNode[] }
  | { type: 'link'; href: string; children: InlineNode[] }

type Delimiter = { open: string; close: string; type: 'strong' | 'em' | 'code' | 'mark' | 'del' }

// Longer delimiters first so ** wins over *.
const DELIMITERS: Delimiter[] = [
  { open: '**', close: '**', type: 'strong' },
  { open: '==', close: '==', type: 'mark' },
  { open: '~~', close: '~~', type: 'del' },
  { open: '`', close: '`', type: 'code' },
  { open: '*', close: '*', type: 'em' },
  { open: '_', close: '_', type: 'em' },
]

const MAX_DEPTH = 4

function isWordChar(character: string | undefined): boolean {
  return Boolean(character && /[\p{L}\p{N}]/u.test(character))
}

function pushText(nodes: InlineNode[], value: string): void {
  if (!value) return
  const last = nodes[nodes.length - 1]
  if (last?.type === 'text') last.value += value
  else nodes.push({ type: 'text', value })
}

function findClose(source: string, from: number, delimiter: Delimiter): number {
  let index = source.indexOf(delimiter.close, from)
  while (index !== -1) {
    const inner = source.slice(from, index)
    // Emphasis needs content that does not start or end with whitespace, and
    // underscores inside words (snake_case) are never emphasis.
    const validInner = inner.length > 0 && inner.trim() === inner && !inner.includes('\n')
    const validUnderscore = delimiter.open !== '_' || !isWordChar(source[index + 1])
    if (validInner && validUnderscore && source[index - 1] !== '\\') return index
    index = source.indexOf(delimiter.close, index + 1)
  }
  return -1
}

function parseLink(source: string, index: number, depth: number): { node: InlineNode; end: number } | null {
  const labelEnd = source.indexOf('](', index + 1)
  if (labelEnd === -1) return null
  const label = source.slice(index + 1, labelEnd)
  if (!label || label.includes('\n') || label.includes('[')) return null
  const urlEnd = source.indexOf(')', labelEnd + 2)
  if (urlEnd === -1) return null
  const href = source.slice(labelEnd + 2, urlEnd).trim()
  const children = parseInline(label, depth + 1)
  if (!isSafeLinkUrl(href)) return { node: { type: 'em', children }, end: urlEnd + 1 }
  return { node: { type: 'link', href, children }, end: urlEnd + 1 }
}

export function parseInline(source: string, depth = 0): InlineNode[] {
  const nodes: InlineNode[] = []
  if (depth > MAX_DEPTH) {
    pushText(nodes, source)
    return nodes
  }
  let index = 0
  let buffer = ''
  const flush = () => {
    pushText(nodes, buffer)
    buffer = ''
  }

  while (index < source.length) {
    const character = source[index]

    if (character === '\\' && index + 1 < source.length && /[*_`=~[\]\\]/.test(source[index + 1])) {
      buffer += source[index + 1]
      index += 2
      continue
    }

    if (character === '\n') {
      flush()
      nodes.push({ type: 'br' })
      index += 1
      continue
    }

    if (character === '[') {
      const link = parseLink(source, index, depth)
      if (link) {
        flush()
        nodes.push(link.node)
        index = link.end
        continue
      }
    }

    const delimiter = DELIMITERS.find((candidate) => source.startsWith(candidate.open, index))
    if (delimiter && !(delimiter.open === '_' && isWordChar(source[index - 1]))) {
      const contentStart = index + delimiter.open.length
      const close = findClose(source, contentStart, delimiter)
      if (close !== -1) {
        flush()
        const inner = source.slice(contentStart, close)
        nodes.push({
          type: delimiter.type,
          children: delimiter.type === 'code' ? [{ type: 'text', value: inner }] : parseInline(inner, depth + 1),
        })
        index = close + delimiter.close.length
        continue
      }
    }

    buffer += character
    index += 1
  }
  flush()
  return nodes
}

const TAGS = { strong: 'strong', em: 'em', code: 'code', mark: 'mark', del: 's' } as const

function appendNodes(parent: Node, nodes: InlineNode[], doc: Document): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      parent.appendChild(doc.createTextNode(node.value))
    } else if (node.type === 'br') {
      parent.appendChild(doc.createElement('br'))
    } else if (node.type === 'link') {
      const link = doc.createElement('a')
      link.className = 'ms-link'
      link.href = node.href
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.referrerPolicy = 'no-referrer'
      appendNodes(link, node.children, doc)
      parent.appendChild(link)
    } else {
      const element = doc.createElement(TAGS[node.type])
      element.className = `ms-inline-${node.type}`
      appendNodes(element, node.children, doc)
      parent.appendChild(element)
    }
  }
}

/** Appends safe inline rich text to an element. */
export function appendRichText(parent: HTMLElement, source: string): HTMLElement {
  appendNodes(parent, parseInline(source), parent.ownerDocument)
  return parent
}

function nodesToPlain(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    if (node.type === 'text') return node.value
    if (node.type === 'br') return '\n'
    return nodesToPlain(node.children)
  }).join('')
}

/** The visible text without markup: for navigation labels, alt text and agent context. */
export function plainText(source: string): string {
  return nodesToPlain(parseInline(source))
}
