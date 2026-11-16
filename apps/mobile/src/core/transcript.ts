/**
 * Turning `SessionUpdate` events into a phone-sized transcript
 * (20261115-mobile.md §4.2, §5.4).
 *
 * The desktop emits a fine-grained event stream (deltas, tool calls, tool
 * results, queue notices). The phone renders a flat list, so this module is the
 * single place that folds events into rows. It is pure: the screens own no
 * transcript logic, and the reducer is covered by unit tests that replay a real
 * capture shape.
 */

import type { PiContent, PiMessage, SessionUpdate } from '@openbuddy/protocol/dto'

export type ToolRow = {
  kind: 'tool'
  id: string
  name: string
  /** Streamed argument preview (path/command while it arrives). */
  hint?: string
  status: 'running' | 'ok' | 'error'
  /** Result text once the tool finished. */
  output?: string
  isError?: boolean
}

export type TextRow = {
  kind: 'text'
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  /** True while tokens are still arriving; the view shows a caret. */
  streaming?: boolean
  isError?: boolean
}

export type TranscriptRow = TextRow | ToolRow

export type Transcript = {
  rows: TranscriptRow[]
  /** Assistant text of the row currently streaming, for copy/share. */
  lastAssistantText: string
}

export function emptyTranscript(): Transcript {
  return { rows: [], lastAssistantText: '' }
}

export function contentText(content: PiContent[] | string | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text as string)
    .join('')
}

/** Stable row id for a message that arrived from the engine. */
function messageRowId(message: PiMessage, sessionId: string | undefined, index: number): string {
  const stamp = typeof message.timestamp === 'number' ? message.timestamp : index
  return `${sessionId ?? 'session'}:${message.role}:${stamp}:${index}`
}

function streamingRowId(sessionId: string | undefined): string {
  return `${sessionId ?? 'session'}:assistant:streaming`
}

/**
 * Applies one update. Rows are appended; the streaming assistant row is
 * updated in place so the list never re-keys mid-stream (that is what keeps
 * FlashList from re-rendering the whole transcript).
 */
export function applyUpdate(transcript: Transcript, update: SessionUpdate, sessionId?: string): Transcript {
  const rows = transcript.rows
  const sid = update.sessionId ?? update.__sessionId ?? sessionId

  switch (update.type) {
    case 'message_update':
    case 'message_end': {
      const message = update.message
      if (!message) return transcript
      const text = contentText(message.content)
      const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system'
      if (!text) return transcript

      // The final assistant message replaces the streaming placeholder, so a
      // completed turn never leaves a half row behind.
      const placeholder = rows.findIndex(row => row.kind === 'text' && row.id === streamingRowId(sid))
      const row: TextRow = {
        kind: 'text',
        id: placeholder === -1 ? messageRowId(message, sid, rows.length) : streamingRowId(sid),
        role,
        text,
        streaming: false,
        isError: message.isError === true,
      }
      if (placeholder === -1) return { rows: [...rows, row], lastAssistantText: role === 'assistant' ? text : transcript.lastAssistantText }
      const next = [...rows]
      next[placeholder] = row
      return {
        rows: next,
        lastAssistantText: role === 'assistant' ? text : transcript.lastAssistantText,
      }
    }

    case 'message_delta':
    case 'message_start': {
      const delta = update.assistantMessageEvent
      if (!delta) return transcript
      const chunk = typeof delta.delta === 'string' ? delta.delta : typeof delta.content === 'string' ? delta.content : ''
      const index = rows.findIndex(row => row.kind === 'text' && row.id === streamingRowId(sid))

      if (!chunk) {
        // A start event with no text still opens the row so later deltas find it.
        if (index !== -1) return transcript
        const opened: TextRow = { kind: 'text', id: streamingRowId(sid), role: 'assistant', text: '', streaming: true }
        return { rows: [...rows, opened], lastAssistantText: transcript.lastAssistantText }
      }

      if (index === -1) {
        const opened: TextRow = { kind: 'text', id: streamingRowId(sid), role: 'assistant', text: chunk, streaming: true }
        return { rows: [...rows, opened], lastAssistantText: chunk }
      }
      const current = rows[index] as TextRow
      const next = [...rows]
      next[index] = { ...current, text: current.text + chunk, streaming: true }
      return { rows: next, lastAssistantText: current.text + chunk }
    }

    case 'toolcall_start':
    case 'toolcall_delta': {
      const delta = update.assistantMessageEvent
      const id = update.toolCallId ?? delta?.toolCall?.id
      if (!id) return transcript
      const name = update.toolName ?? delta?.toolCall?.name ?? 'tool'
      const hint = delta?.partialArgs?.path ?? delta?.partialArgs?.command ?? undefined
      const index = rows.findIndex(row => row.kind === 'tool' && row.id === id)
      if (index === -1) {
        return {
          rows: [...rows, { kind: 'tool', id, name, hint, status: 'running' }],
          lastAssistantText: transcript.lastAssistantText,
        }
      }
      const current = rows[index] as ToolRow
      const next = [...rows]
      // A delta without a name must not erase the name the start event gave.
      next[index] = {
        ...current,
        name: update.toolName ?? delta?.toolCall?.name ?? current.name,
        hint: hint ?? current.hint,
      }
      return { rows: next, lastAssistantText: transcript.lastAssistantText }
    }

    case 'toolcall_end':
    case 'tool_result': {
      const id = update.toolCallId
      if (!id) return transcript
      const index = rows.findIndex(row => row.kind === 'tool' && row.id === id)
      const result = update.result ?? update.partialResult
      const output = result?.content
        ? result.content.filter(part => typeof part.text === 'string').map(part => part.text).join('\n')
        : ''
      if (index === -1) {
        return {
          rows: [...rows, {
            kind: 'tool', id, name: update.toolName ?? 'tool', status: update.isError ? 'error' : 'ok',
            output: output || undefined, isError: update.isError === true,
          }],
          lastAssistantText: transcript.lastAssistantText,
        }
      }
      const current = rows[index] as ToolRow
      const next = [...rows]
      next[index] = {
        ...current,
        status: update.isError ? 'error' : 'ok',
        output: output || current.output,
        isError: update.isError === true,
      }
      return { rows: next, lastAssistantText: transcript.lastAssistantText }
    }

    case 'agent_settled': {
      // Nothing is arriving any more: close the streaming row so the caret goes.
      const index = rows.findIndex(row => row.kind === 'text' && row.streaming)
      if (index === -1) return transcript
      const next = [...rows]
      next[index] = { ...(next[index] as TextRow), streaming: false }
      return { rows: next, lastAssistantText: transcript.lastAssistantText }
    }

    default:
      return transcript
  }
}

/** Folds a whole event batch; used when a session is replayed from its snapshot. */
export function applyUpdates(updates: readonly SessionUpdate[], sessionId?: string): Transcript {
  return updates.reduce((transcript, update) => applyUpdate(transcript, update, sessionId), emptyTranscript())
}

/** One-line preview for the session list. */
export function transcriptPreview(transcript: Transcript, max = 80): string {
  const last = [...transcript.rows].reverse().find(row => row.kind === 'text' && row.text.trim())
  if (!last || last.kind !== 'text') return ''
  const line = last.text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
