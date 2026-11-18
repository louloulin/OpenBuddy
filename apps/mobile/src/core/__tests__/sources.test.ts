import { describe, expect, it } from 'vitest'

import { extractSources, isSourceTool } from '../sources'

describe('extractSources', () => {
  it('prefers Markdown titles and dedupes', () => {
    const text = [
      '1. [网关设计说明](https://example.com/docs/gateway)',
      '2. https://example.com/docs/gateway',
      '3. [另一篇](https://news.example.org/post?id=1).',
    ].join('\n')
    expect(extractSources(text)).toEqual([
      { url: 'https://example.com/docs/gateway', title: '网关设计说明' },
      { url: 'https://news.example.org/post?id=1', title: '另一篇' },
    ])
  })

  it('falls back to the hostname for bare URLs', () => {
    expect(extractSources('见 https://www.example.com/a。')).toEqual([
      { url: 'https://www.example.com/a', title: 'example.com' },
    ])
  })

  it('ignores non-web text, empty output and caps the list', () => {
    expect(extractSources('')).toEqual([])
    expect(extractSources('没有链接，只有文件 /tmp/a.ts')).toEqual([])
    const many = Array.from({ length: 10 }, (_, index) => `https://e.test/${index}`).join(' ')
    expect(extractSources(many, 3)).toHaveLength(3)
  })

  it('only treats web tools as source carriers', () => {
    expect(isSourceTool('web_search')).toBe(true)
    expect(isSourceTool('web_fetch')).toBe(true)
    expect(isSourceTool('read_text_file')).toBe(false)
  })
})
