/**
 * Memory notes, phone side (20261115-mobile.md §4.2 P1).
 *
 * The desktop's `memory_*` commands work on Markdown files under one of two
 * scopes. The phone browses and edits them; the store, the injection budget and
 * the folder-trust gate all stay on the computer. These helpers are pure so the
 * grouping/validation rules are testable without a device.
 */

import type { MemoryEntry } from '@openbuddy/protocol/dto'

export type { MemoryEntry }

export type MemoryGroup = {
  scope: 'global' | 'workspace'
  title: string
  entries: MemoryEntry[]
}

const SCOPE_TITLES: Record<string, string> = {
  global: '全局记忆',
  workspace: '项目记忆',
}

/** Global first, then workspace; each sorted by path. Unknown scopes are kept. */
export function groupMemory(entries: readonly MemoryEntry[]): MemoryGroup[] {
  const buckets = new Map<string, MemoryEntry[]>()
  for (const entry of entries) {
    const scope = entry.scope === 'workspace' ? 'workspace' : entry.scope === 'global' ? 'global' : entry.scope
    const bucket = buckets.get(scope) ?? []
    bucket.push(entry)
    buckets.set(scope, bucket)
  }
  const order = (scope: string) => (scope === 'global' ? 0 : scope === 'workspace' ? 1 : 2)
  return [...buckets.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([scope, list]) => ({
      scope: scope as MemoryGroup['scope'],
      title: SCOPE_TITLES[scope] ?? scope,
      entries: [...list].sort((a, b) => a.path.localeCompare(b.path)),
    }))
}

/** File stem for a row: `projects/foo.md` → `foo`; keeps the folder in a hint. */
export function memoryTitle(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.md$/i, '')
}

/** Directory portion, `null` for a top-level file. */
export function memoryDir(path: string): string | null {
  const index = path.lastIndexOf('/')
  return index === -1 ? null : path.slice(0, index)
}

/**
 * One-line preview: the first non-empty line that is not a heading, with the
 * common Markdown markers removed so the list reads like prose.
 */
export function memoryPreview(content: string, max = 80): string {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const plain = line
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/^>\s*/, '')
      .replace(/[*_`]/g, '')
      .trim()
    if (!plain) continue
    return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
  }
  return ''
}

export type DraftCheck = { ok: true } | { ok: false; reason: string }

/**
 * Mirrors the contract's own rules (`packages/protocol/src/validate.ts`
 * `memoryPayload`): a relative `.md` path made of ASCII segments. Checking here
 * turns a rejected save into a message before the round trip.
 */
export function validateMemoryDraft(path: string, content: string): DraftCheck {
  const trimmed = path.trim()
  if (!trimmed) return { ok: false, reason: '文件名不能为空。' }
  if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) return { ok: false, reason: '用相对路径，例如 daily/notes.md。' }
  if (!/\.md$/i.test(trimmed)) return { ok: false, reason: '记忆文件需以 .md 结尾。' }
  if (trimmed.length > 512) return { ok: false, reason: '路径太长。' }
  const parts = trimmed.split('/')
  if (parts.includes('..')) return { ok: false, reason: '路径不能包含 ..。' }
  if (parts.some(part => !/^[A-Za-z0-9._-]+$/.test(part))) {
    return { ok: false, reason: '文件名只能用字母、数字、点、下划线和连字符。' }
  }
  if (content.length > 512 * 1024) return { ok: false, reason: '内容超过 512KB。' }
  return { ok: true }
}
