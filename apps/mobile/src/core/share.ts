/**
 * Markdown sharing (20261117-mobile.md E1/E2).
 *
 * Single replies and a whole transcript are rendered here — from what the
 * phone already has — so sharing never asks the desktop for a save dialog.
 * (The desktop's `agent_export_html` needs a native save grant, which the
 * phone cannot show.)
 */

import { slugTitle, timestamp } from './export'
import type { Transcript, TranscriptRow } from './transcript'

export function messageFilename(role: string, now = new Date()): string {
  const label = role === 'assistant' ? '回复' : role === 'user' ? '提问' : '消息'
  return `openbuddy-${label}-${timestamp(now)}.md`
}

export function transcriptFilename(title: string, sessionId: string, now = new Date()): string {
  return `openbuddy-${slugTitle(title, sessionId)}-${timestamp(now)}.md`
}

export function messageMarkdown(role: string, text: string): string {
  const heading = role === 'assistant' ? 'OpenBuddy' : role === 'user' ? '我' : '系统'
  return `## ${heading}\n\n${text.trim()}\n`
}

function rowMarkdown(row: TranscriptRow): string {
  switch (row.kind) {
    case 'text':
      return row.text.trim() ? messageMarkdown(row.role, row.text) : ''
    case 'thinking':
      return row.text.trim()
        ? `<details><summary>思考</summary>\n\n${row.text.trim()}\n\n</details>\n`
        : ''
    case 'tool': {
      const body = (row.output ?? row.hint ?? '').trim()
      return `<details><summary>工具 · ${row.name} (${row.status})</summary>\n\n${body ? `\`\`\`\n${body}\n\`\`\`\n` : ''}</details>\n`
    }
  }
}

/** The whole transcript as one Markdown document, in conversation order. */
export function transcriptMarkdown(transcript: Transcript, title: string, now = new Date()): string {
  const header = [
    `# ${title.trim() || '会话'}`,
    '',
    `> OpenBuddy 手机端导出 · ${now.toLocaleString('zh-CN')}`,
    '',
  ].join('\n')
  const body = transcript.rows.map(rowMarkdown).filter(Boolean).join('\n')
  return body ? `${header}\n${body}` : `${header}\n_还没有消息。_\n`
}
