import { describe, expect, it } from 'vitest'

import { clipToolOutput, TOOL_OUTPUT_MAX } from '../tool-output'

describe('clipToolOutput', () => {
  it('leaves short output alone', () => {
    expect(clipToolOutput('ok')).toEqual({ text: 'ok', truncated: false, total: 2 })
    expect(clipToolOutput('x'.repeat(TOOL_OUTPUT_MAX))).toMatchObject({ truncated: false })
  })

  it('clips long output on a line boundary', () => {
    const lines = Array.from({ length: 1000 }, (_, index) => `line ${index}`)
    const output = lines.join('\n')
    const clipped = clipToolOutput(output, 200)
    expect(clipped.truncated).toBe(true)
    expect(clipped.total).toBe(output.length)
    expect(clipped.text.length).toBeLessThanOrEqual(200)
    expect(clipped.text.endsWith('line 0') || clipped.text.endsWith('line 1')).toBe(false)
    expect(clipped.text.split('\n').every(line => line.startsWith('line '))).toBe(true)
  })

  it('falls back to a hard cut when there is no newline near the limit', () => {
    const clipped = clipToolOutput('x'.repeat(100), 40)
    expect(clipped.text).toHaveLength(40)
    expect(clipped.truncated).toBe(true)
  })

  it('reports the original size', () => {
    expect(clipToolOutput('a'.repeat(10), 4)).toEqual({ text: 'aaaa', truncated: true, total: 10 })
  })
})
