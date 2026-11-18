import { describe, expect, it } from 'vitest'

import { QUOTE_LINES_MAX, quoteBlock, quotePreview, withQuote } from '../quote'

describe('quote helpers', () => {
  it('flattens and truncates the composer preview', () => {
    expect(quotePreview('第一行\n第二行   第三行')).toBe('第一行 第二行 第三行')
    expect(quotePreview('x'.repeat(200), 10)).toBe('xxxxxxxxx…')
    expect(quotePreview('   ')).toBe('')
  })

  it('turns the original into a bounded > block', () => {
    const block = quoteBlock('a\n\nb\nc\nd\ne\nf\ng')
    expect(block).toHaveLength(QUOTE_LINES_MAX)
    expect(block[0]).toBe('> a')
    expect(quoteBlock('x'.repeat(300))[0]?.endsWith('…')).toBe(true)
  })

  it('prefixes the reply and keeps an empty body as the quote only', () => {
    expect(withQuote('原问题', '我的回答')).toBe('> 原问题\n\n我的回答')
    expect(withQuote('原问题', '   ')).toBe('> 原问题')
    expect(withQuote(null, ' 回答 ')).toBe('回答')
    expect(withQuote('', '回答')).toBe('回答')
  })
})
