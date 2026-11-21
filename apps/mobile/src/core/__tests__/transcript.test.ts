import { describe, expect, it } from 'vitest'

import type { SessionUpdate } from '@openbuddy/protocol/dto'

import {
  applyUpdate,
  applyUpdates,
  contentText,
  emptyTranscript,
  isTurnPending,
  sealInterruptedTurn,
  toolCategory,
  transcriptPreview,
  type Transcript,
} from '../transcript'

const sessionId = 'sess-1'

function feed(updates: SessionUpdate[]): Transcript {
  return applyUpdates(updates, sessionId)
}

describe('contentText', () => {
  it('joins text parts and ignores non-text ones', () => {
    expect(contentText('plain')).toBe('plain')
    expect(contentText([
      { type: 'text', text: 'a' },
      { type: 'thinking', thinking: 'hidden' },
      { type: 'text', text: 'b' },
    ])).toBe('ab')
    expect(contentText(undefined)).toBe('')
  })
})

describe('applyUpdate — assistant streaming', () => {
  it('accumulates deltas into one row and closes it on the final message', () => {
    let transcript = feed([
      { type: 'message_start', sessionId },
      { type: 'message_delta', sessionId, assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } },
      { type: 'message_delta', sessionId, assistantMessageEvent: { type: 'text_delta', delta: ' from' } },
    ])
    expect(transcript.rows).toHaveLength(1)
    expect(transcript.rows[0]).toMatchObject({ kind: 'text', role: 'assistant', text: 'Hello from', streaming: true })

    const partial: Transcript = applyUpdate(transcript, {
      type: 'message_delta', sessionId, assistantMessageEvent: { type: 'text_delta', delta: ' Pi' },
    }, sessionId)
    expect(partial.rows[0]).toMatchObject({ text: 'Hello from Pi' })

    transcript = applyUpdate(partial, {
      type: 'message_end',
      sessionId,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello from Pi' }] },
    }, sessionId)
    expect(transcript.rows).toHaveLength(1)
    expect(transcript.rows[0]).toMatchObject({ kind: 'text', text: 'Hello from Pi', streaming: false })
    expect(transcript.lastAssistantText).toBe('Hello from Pi')
  })

  it('a start event without a delta opens no row', () => {
    expect(feed([{ type: 'message_start', sessionId }]).rows).toHaveLength(0)
  })

  it('an empty-but-present delta opens the streaming row', () => {
    const transcript = feed([{
      type: 'message_start', sessionId,
      assistantMessageEvent: { type: 'text_start', delta: '' },
    }])
    expect(transcript.rows[0]).toMatchObject({ kind: 'text', text: '', streaming: true })
  })

  it('user and system messages append separate rows', () => {
    const transcript = feed([
      { type: 'message_end', sessionId, message: { role: 'user', content: 'hi' } },
      { type: 'message_end', sessionId, message: { role: 'system', content: 'queued' } },
    ])
    expect(transcript.rows.map(row => row.kind === 'text' && row.role)).toEqual(['user', 'system'])
  })
})

describe('applyUpdate — tools', () => {
  it('creates a running row, streams its hint, then settles with output', () => {
    let transcript = feed([
      { type: 'toolcall_start', sessionId, toolCallId: 't1', toolName: 'read_text_file', assistantMessageEvent: { type: 'toolcall_start', toolCall: { type: 'toolCall', id: 't1', name: 'read_text_file' } } },
      { type: 'toolcall_delta', sessionId, toolCallId: 't1', assistantMessageEvent: { type: 'toolcall_delta', partialArgs: { path: '/tmp/a.md' } } },
    ])
    expect(transcript.rows[0]).toMatchObject({ kind: 'tool', id: 't1', name: 'read_text_file', status: 'running', hint: '/tmp/a.md' })

    transcript = applyUpdate(transcript, {
      type: 'toolcall_end', sessionId, toolCallId: 't1',
      result: { content: [{ type: 'text', text: 'file body' }] },
    }, sessionId)
    expect(transcript.rows[0]).toMatchObject({ kind: 'tool', status: 'ok', output: 'file body' })
  })

  it('marks a failed tool and keeps the error text', () => {
    const transcript = feed([
      { type: 'tool_result', sessionId, toolCallId: 't2', toolName: 'bash', isError: true, result: { content: [{ type: 'text', text: 'exit 1' }] } },
    ])
    expect(transcript.rows[0]).toMatchObject({ kind: 'tool', status: 'error', isError: true, output: 'exit 1' })
  })
})

describe('applyUpdate — lifecycle', () => {
  it('settled clears the streaming caret', () => {
    let transcript = feed([
      { type: 'message_delta', sessionId, assistantMessageEvent: { type: 'text_delta', delta: 'partial' } },
    ])
    expect(transcript.rows[0]).toMatchObject({ streaming: true })
    transcript = applyUpdate(transcript, { type: 'agent_settled', sessionId }, sessionId)
    expect(transcript.rows[0]).toMatchObject({ streaming: false })
  })

  it('ignores events it does not model', () => {
    const transcript = emptyTranscript()
    expect(applyUpdate(transcript, { type: 'queue_update', sessionId }, sessionId)).toBe(transcript)
    expect(applyUpdate(transcript, { type: 'message_end', sessionId }, sessionId)).toBe(transcript)
  })
})

describe('transcriptPreview', () => {
  it('uses the last non-empty text row and truncates', () => {
    const transcript = feed([
      { type: 'message_end', sessionId, message: { role: 'user', content: 'first' } },
      { type: 'message_end', sessionId, message: { role: 'assistant', content: 'the answer\nwith lines' } },
    ])
    expect(transcriptPreview(transcript)).toBe('the answer with lines')
    expect(transcriptPreview(transcript, 10)).toBe('the answe…')
    expect(transcriptPreview(emptyTranscript())).toBe('')
  })
})

describe('applyUpdate — reasoning', () => {
  it('folds thinking deltas into one live block, then folds it when the answer starts', () => {
    let transcript = feed([
      { type: 'thinking_delta', sessionId, assistantMessageEvent: { type: 'thinking_delta', delta: '先看' } },
      { type: 'thinking_delta', sessionId, assistantMessageEvent: { type: 'thinking_delta', delta: '代理层' } },
    ])
    expect(transcript.rows).toHaveLength(1)
    expect(transcript.rows[0]).toMatchObject({ kind: 'thinking', text: '先看代理层', live: true })

    transcript = applyUpdate(transcript, {
      type: 'message_delta', sessionId, assistantMessageEvent: { type: 'text_delta', delta: '答' },
    }, sessionId)
    expect(transcript.rows[0]).toMatchObject({ kind: 'thinking', live: false })
    expect(transcript.rows[1]).toMatchObject({ kind: 'text', text: '答', streaming: true })
  })

  it('settled folds a reasoning block that never got an answer', () => {
    let transcript = feed([
      { type: 'thinking_delta', sessionId, assistantMessageEvent: { type: 'thinking_delta', delta: '想了想' } },
    ])
    expect(transcript.rows[0]).toMatchObject({ live: true })
    transcript = applyUpdate(transcript, { type: 'agent_settled', sessionId }, sessionId)
    expect(transcript.rows[0]).toMatchObject({ kind: 'thinking', live: false })
  })
})

describe('toolCategory', () => {
  it('tags a tool the way the desktop does', () => {
    expect(toolCategory('read_text_file')).toBe('read')
    expect(toolCategory('list_dir')).toBe('list')
    expect(toolCategory('mcp_fetch')).toBe('mcp')
  })

  it('drops the agent_ prefix rather than showing it', () => {
    expect(toolCategory('agent_bash')).toBe('bash')
    expect(toolCategory('agent_send')).toBe('send')
  })

  it('never returns an empty tag', () => {
    expect(toolCategory('')).toBe('tool')
    expect(toolCategory('agent_')).toBe('agent')
  })
})

describe('sealInterruptedTurn', () => {
  // A stream can end without `agent_settled` (desktop crash, tunnel loss). A
  // caret left blinking tells the user work is happening when it is not.
  const streaming = (): Transcript => ({
    rows: [
      { kind: 'text', id: 'u1', role: 'user', text: '问题' },
      { kind: 'text', id: 'a1', role: 'assistant', text: '正在处理', streaming: true },
      { kind: 'thinking', id: 't1', text: '想一想', live: true },
      { kind: 'tool', id: 'k1', name: 'bash', status: 'running' },
    ],
    lastAssistantText: '正在处理',
  })

  it('closes every row that still claims to be running', () => {
    const sealed = sealInterruptedTurn(streaming(), '断开了')
    expect(sealed.rows.filter(row => row.kind === 'text' && row.role === 'assistant')[0]).toMatchObject({ streaming: false })
    expect(sealed.rows.find(row => row.kind === 'thinking')).toMatchObject({ live: false })
    expect(sealed.rows.find(row => row.kind === 'tool')).toMatchObject({ status: 'error' })
    expect(isTurnPending(sealed)).toBe(false)
  })

  it('appends one system row explaining why the answer stops', () => {
    const sealed = sealInterruptedTurn(streaming(), '断开了')
    const notice = sealed.rows.at(-1)
    expect(notice).toMatchObject({ kind: 'text', role: 'system', text: '断开了' })
  })

  it('is a no-op on a settled transcript, and without a note', () => {
    const settled: Transcript = { rows: [{ kind: 'text', id: 'a1', role: 'assistant', text: '完成' }], lastAssistantText: '完成' }
    expect(sealInterruptedTurn(settled, 'x')).toBe(settled)
    const silent = sealInterruptedTurn(streaming())
    expect(silent.rows).toHaveLength(4)
    expect(isTurnPending(silent)).toBe(false)
  })
})

describe('interrupted system row', () => {
  // The chat screen uses this flag to hide follow-up chips: they assume a
  // finished answer, and an interrupted turn has none.
  it('is marked so the UI can style it and suppress follow-ups', () => {
    const sealed = sealInterruptedTurn({
      rows: [{ kind: 'text', id: 'a1', role: 'assistant', text: '半句', streaming: true }],
      lastAssistantText: '半句',
    }, '断开了')
    const notice = sealed.rows.at(-1)
    expect(notice).toMatchObject({ role: 'system', interrupted: true })
  })

  it('leaves ordinary system asides untouched', () => {
    const plain: Transcript = { rows: [{ kind: 'text', id: 's', role: 'system', text: '已压缩上下文' }], lastAssistantText: '' }
    expect(sealInterruptedTurn(plain, 'x')).toBe(plain)
    expect(plain.rows[0]).not.toHaveProperty('interrupted')
  })
})

describe('turn-error handling shape', () => {
  // The store turns `agent://turn-error` into the same `interrupted` row the
  // connection-drop path uses, so the chat screen styles it once and suppresses
  // follow-ups for both. This pins the contract those two paths share.
  it('an interrupted row seals streaming state before being appended', () => {
    const streaming: Transcript = {
      rows: [{ kind: 'text', id: 'a1', role: 'assistant', text: '先看一下', streaming: true }],
      lastAssistantText: '先看一下',
    }
    const sealed = sealInterruptedTurn(streaming)
    const withNotice: Transcript = {
      ...sealed,
      rows: [...sealed.rows, { kind: 'text', id: 'turn-error:1', role: 'system', text: '这一轮没有成功：模型请求失败', interrupted: true }],
    }
    expect(isTurnPending(withNotice)).toBe(false)
    expect(withNotice.rows.at(-1)).toMatchObject({ role: 'system', interrupted: true })
  })
})
