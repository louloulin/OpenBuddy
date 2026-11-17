/**
 * A small Markdown subset for phone transcripts
 * (20261115-mobile.md §4.3, §5.5).
 *
 * The desktop renders full Markdown with hljs, KaTeX and mermaid in the DOM.
 * None of that is available in React Native, and a phone transcript mostly
 * contains far less: paragraphs, bullets, fenced code, inline code, bold and
 * links. So this module parses exactly that subset into blocks and inlines —
 * pure functions, no React, so every rule is unit-tested — and the component
 * layer only turns blocks into `<Text>`.
 *
 * Anything outside the subset degrades to plain text rather than disappearing:
 * losing content is worse than losing styling.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

export type Block =
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'heading'; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: 'bullet'; items: Inline[][] }
  | { kind: 'ordered'; start: number; items: Inline[][] }
  | { kind: 'code'; language: string | null; text: string }
  | { kind: 'quote'; inlines: Inline[] }
  | { kind: 'rule' }

/** `**bold**`, `` `code` ``, `[text](href)` — scanned left to right. */
export function parseInlines(source: string): Inline[] {
  const out: Inline[] = []
  let rest = source
  let guard = 0

  while (rest.length > 0 && guard < 10_000) {
    guard += 1

    // Inline code wins over emphasis: a backtick span is literal.
    const code = /^`([^`\n]+)`/.exec(rest)
    if (code) {
      out.push({ kind: 'code', text: code[1]! })
      rest = rest.slice(code[0].length)
      continue
    }

    const strong = /^\*\*([^*\n]+)\*\*/.exec(rest)
    if (strong) {
      out.push({ kind: 'strong', text: strong[1]! })
      rest = rest.slice(strong[0].length)
      continue
    }

    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest)
    if (link) {
      out.push({ kind: 'link', text: link[1]!, href: link[2]! })
      rest = rest.slice(link[0].length)
      continue
    }

    // Consume up to the next special character so plain runs stay whole.
    const plain = /^[^`*[]+/.exec(rest)
    if (plain) {
      out.push({ kind: 'text', text: plain[0] })
      rest = rest.slice(plain[0].length)
      continue
    }

    // A stray `*` or `[` that did not start a construct.
    out.push({ kind: 'text', text: rest[0]! })
    rest = rest.slice(1)
  }

  return out
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const ORDERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/
const HEADING = /^\s{0,3}(#{1,3})\s+(.*)$/
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const FENCE = /^\s{0,3}```(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/

/**
 * Splits source into blocks.
 *
 * A fenced code block that has not been closed yet is still emitted: during
 * streaming the tail is almost always an open fence, and dropping it would make
 * the code flicker out of existence until the closing fence arrives.
 */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]!

    if (line.trim() === '') { index += 1; continue }

    const fence = FENCE.exec(line)
    if (fence) {
      const language = fence[1]!.trim() || null
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^\s{0,3}```/.test(lines[index]!)) {
        body.push(lines[index]!)
        index += 1
      }
      // Skip the closing fence when it is there.
      if (index < lines.length) index += 1
      blocks.push({ kind: 'code', language, text: body.join('\n') })
      continue
    }

    if (RULE.test(line)) { blocks.push({ kind: 'rule' }); index += 1; continue }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        inlines: parseInlines(heading[2]!.trim()),
      })
      index += 1
      continue
    }

    if (BULLET.test(line)) {
      const items: Inline[][] = []
      while (index < lines.length) {
        const item = BULLET.exec(lines[index]!)
        if (!item) break
        items.push(parseInlines(item[1]!.trim()))
        index += 1
      }
      blocks.push({ kind: 'bullet', items })
      continue
    }

    const ordered = ORDERED.exec(line)
    if (ordered) {
      const start = Number(ordered[1])
      const items: Inline[][] = []
      while (index < lines.length) {
        const item = ORDERED.exec(lines[index]!)
        if (!item) break
        items.push(parseInlines(item[2]!.trim()))
        index += 1
      }
      blocks.push({ kind: 'ordered', start, items })
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (index < lines.length) {
        const quote = QUOTE.exec(lines[index]!)
        if (!quote) break
        quoted.push(quote[1]!)
        index += 1
      }
      blocks.push({ kind: 'quote', inlines: parseInlines(quoted.join('\n').trim()) })
      continue
    }

    // A paragraph runs until a blank line or the start of another block.
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index]!
      if (current.trim() === '' || FENCE.test(current) || HEADING.test(current) || BULLET.test(current)
        || ORDERED.test(current) || QUOTE.test(current) || RULE.test(current)) break
      paragraph.push(current)
      index += 1
    }
    blocks.push({ kind: 'paragraph', inlines: parseInlines(paragraph.join('\n')) })
  }

  return blocks
}

/**
 * Visible characters of a block, used to size the streaming caret and to test
 * that nothing was silently dropped.
 */
export function blockText(block: Block): string {
  switch (block.kind) {
    case 'code': return block.text
    case 'rule': return ''
    case 'bullet':
    case 'ordered': return block.items.map(item => item.map(i => i.text).join('')).join('\n')
    default: return block.inlines.map(i => i.text).join('')
  }
}

export function sourceText(blocks: readonly Block[]): string {
  return blocks.map(blockText).join('\n')
}
