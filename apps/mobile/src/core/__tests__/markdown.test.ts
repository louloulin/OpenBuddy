import { describe, expect, it } from 'vitest'

import { parseBlocks, parseInlines, sourceText } from '../markdown'

describe('parseInlines', () => {
  it('keeps plain runs whole', () => {
    expect(parseInlines('hello world')).toEqual([{ kind: 'text', text: 'hello world' }])
  })

  it('reads bold, code and links', () => {
    expect(parseInlines('a **b** c')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', text: 'b' },
      { kind: 'text', text: ' c' },
    ])
    expect(parseInlines('use `npm i` now')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'code', text: 'npm i' },
      { kind: 'text', text: ' now' },
    ])
    expect(parseInlines('see [docs](https://x.test/a)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'docs', href: 'https://x.test/a' },
    ])
  })

  it('lets code win over emphasis inside a span', () => {
    expect(parseInlines('`**not bold**`')).toEqual([{ kind: 'code', text: '**not bold**' }])
  })

  it('does not lose text around a malformed construct', () => {
    const inlines = parseInlines('a * b [c')
    expect(inlines.map(i => i.text).join('')).toBe('a * b [c')
  })
})

describe('parseBlocks', () => {
  it('separates paragraphs, headings, lists, code and quotes', () => {
    const blocks = parseBlocks([
      '# 标题',
      '',
      '第一段',
      '仍是第一段',
      '',
      '- 一',
      '- 二',
      '',
      '1. 甲',
      '2. 乙',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      '> 引用',
    ].join('\n'))

    expect(blocks.map(b => b.kind)).toEqual([
      'heading', 'paragraph', 'bullet', 'ordered', 'code', 'quote',
    ])
    const code = blocks[4]!
    expect(code.kind === 'code' && code.language).toBe('ts')
    expect(code.kind === 'code' && code.text).toBe('const a = 1')
  })

  it('keeps an unclosed fence as a code block (streaming tail)', () => {
    const blocks = parseBlocks('说明\n```python\nprint(1)')
    expect(blocks.map(b => b.kind)).toEqual(['paragraph', 'code'])
    expect(blocks[1]).toMatchObject({ kind: 'code', language: 'python', text: 'print(1)' })
  })

  it('recognises a horizontal rule', () => {
    expect(parseBlocks('a\n\n---\n\nb').map(b => b.kind)).toEqual(['paragraph', 'rule', 'paragraph'])
  })

  it('never drops visible characters', () => {
    const source = [
      '# 一',
      '正文 **粗** 与 `码`',
      '- 甲',
      '- 乙',
      '```js',
      'x()',
      '```',
      '> 引',
    ].join('\n')
    const rendered = sourceText(parseBlocks(source)).replace(/\s/g, '')
    expect(rendered).toContain('一')
    expect(rendered).toContain('粗')
    expect(rendered).toContain('码')
    expect(rendered).toContain('甲')
    expect(rendered).toContain('x()')
    expect(rendered).toContain('引')
  })
})
