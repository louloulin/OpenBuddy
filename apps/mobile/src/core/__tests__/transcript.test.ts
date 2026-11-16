import { describe, expect, it } from 'vitest'

import type { SessionUpdate } from '@openbuddy/protocol/dto'

import {
  applyUpdate,
  applyUpdates,
  contentText,
  emptyTranscript,
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
