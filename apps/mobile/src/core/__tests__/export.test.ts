import { describe, expect, it } from 'vitest'

import { exportFilename, isTruncatedRead, jsonlEntryCount, MAX_EXPORT_BYTES } from '../export'

describe('session export', () => {
  it('builds a shareable filename from a Chinese title', () => {
    const name = exportFilename('手机端接入设计', 'sess-1', new Date(2026, 10, 17, 9, 5))
    expect(name).toBe('openbuddy-手机端接入设计-20261117-0905.jsonl')
  })

  it('strips path separators and control characters', () => {
    const name = exportFilename('../评审/网关\u0000 改动', 'sess-2', new Date(2026, 0, 2, 3, 4))
    expect(name).toBe('openbuddy-评审-网关-改动-20260102-0304.jsonl')
    expect(name).not.toContain('/')
    expect(name).not.toContain('\u0000')
  })

  it('falls back to the session id, then to "session"', () => {
    expect(exportFilename('   ', 'sess-3', new Date(2026, 0, 2, 3, 4))).toBe('openbuddy-sess-3-20260102-0304.jsonl')
    expect(exportFilename('', '///', new Date(2026, 0, 2, 3, 4))).toBe('openbuddy-session-20260102-0304.jsonl')
  })

  it('caps the slug without leaving a trailing dash', () => {
    const name = exportFilename('a'.repeat(80), 'sess-4', new Date(2026, 0, 2, 3, 4))
    expect(name.startsWith('openbuddy-')).toBe(true)
    expect(name).toBe(`openbuddy-${'a'.repeat(40)}-20260102-0304.jsonl`)
  })

  it('detects the host truncation marker', () => {
    expect(isTruncatedRead('a\nb\n\n…(已截断，仅预览前部分内容)')).toBe(true)
    expect(isTruncatedRead('{"type":"message"}\n')).toBe(false)
  })

  it('counts non-empty JSONL entries', () => {
    expect(jsonlEntryCount('')).toBe(0)
    expect(jsonlEntryCount('{"a":1}\n\n{"b":2}\n')).toBe(2)
  })

  it('publishes the host read ceiling', () => {
    expect(MAX_EXPORT_BYTES).toBe(16 * 1024 * 1024)
  })
})
