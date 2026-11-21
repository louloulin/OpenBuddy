import { describe, expect, it } from 'vitest'

import { messageFilename, messageMarkdown, transcriptFilename, transcriptMarkdown } from '../share'
import type { Transcript } from '../transcript'

const transcript: Transcript = {
  rows: [
    { kind: 'text', id: 'u1', role: 'user', text: '手机端现在能直接用了？' },
    { kind: 'thinking', id: 't1', text: '先看桥接。', live: false },
    { kind: 'tool', id: 'c1', name: 'read_text_file', status: 'ok', output: 'Phase 3' },
    { kind: 'text', id: 'a1', role: 'assistant', text: '可以。' },
  ],
  lastAssistantText: '可以。',
}

describe('markdown sharing', () => {
  it('labels a single message and keeps its text', () => {
    expect(messageMarkdown('assistant', '  可以。 ')).toBe('## OpenBuddy\n\n可以。\n')
    expect(messageMarkdown('user', '问题')).toContain('## 我')
    expect(messageMarkdown('system', '提示')).toContain('## 系统')
  })

  it('renders the transcript in order with tool details', () => {
    const md = transcriptMarkdown(transcript, '手机端接入设计', new Date(2026, 10, 17, 9, 5))
    expect(md.startsWith('# 手机端接入设计')).toBe(true)
    expect(md).toContain('## 我\n\n手机端现在能直接用了？')
    expect(md).toContain('<summary>思考</summary>')
    expect(md).toContain('<summary>工具 · read_text_file (ok)</summary>')
    expect(md).toContain('```\nPhase 3\n```')
    expect(md.indexOf('## 我')).toBeLessThan(md.indexOf('## OpenBuddy'))
  })

  it('falls back for an empty transcript and unsafe titles', () => {
    expect(transcriptMarkdown({ rows: [], lastAssistantText: '' }, '  ')).toContain('_还没有消息。_')
    expect(transcriptFilename('../评审/网关', 'sess-1', new Date(2026, 0, 2, 3, 4)))
      .toBe('openbuddy-评审-网关-20260102-0304.md')
    expect(messageFilename('assistant', new Date(2026, 0, 2, 3, 4))).toBe('openbuddy-回复-20260102-0304.md')
  })
})
