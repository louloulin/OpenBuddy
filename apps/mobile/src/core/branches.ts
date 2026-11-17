/**
 * Branches and checkpoints, phone side (20261115-mobile.md §4.2 P2).
 *
 * Regenerating or editing a prompt leaves the old answer on a sibling branch;
 * the desktop can also snapshot files around every write. The phone shows both
 * and may switch branch / restore a file, but it never invents an entry id and
 * never reverts tool calls (that needs the turn's tool-call ids, a desktop
 * concept). Everything here is pure.
 */

import type { BranchTree, BranchTurn } from '@openbuddy/protocol/branches'
import type { RewindPoint } from '@openbuddy/protocol/dto'

export type { BranchTurn, RewindPoint }

/** Raw checkpoint record as the engine stores it (`CheckpointRecord`). */
export type CheckpointRecord = {
  id: string
  toolCallId?: string
  path: string
  before: string | null
  after: string | null
  at: number
  source: 'tool' | 'user' | 'restore' | 'apply'
  skipped?: 'too_large'
}

/** Only turns that actually have siblings are worth a row. */
export function branchTurns(tree: BranchTree | null | undefined): BranchTurn[] {
  if (!tree || !Array.isArray(tree.turns)) return []
  return tree.turns.filter(turn => turn.total > 1 && Array.isArray(turn.siblings) && turn.siblings.length > 0)
}

/** `1/3 · 第一句话…` — the desktop's ‹1/3› in words. */
export function branchLabel(turn: BranchTurn, max = 48): string {
  const position = `${Math.max(1, turn.index + 1)}/${turn.total}`
  const preview = (turn.siblings[turn.index]?.preview ?? turn.siblings[0]?.preview ?? '').replace(/\s+/g, ' ').trim()
  if (!preview) return position
  return `${position} · ${preview.length > max ? `${preview.slice(0, max - 1)}…` : preview}`
}

export function toRewindPoints(raw: unknown): RewindPoint[] {
  if (!Array.isArray(raw)) return []
  const points: RewindPoint[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.entryId !== 'string' || !record.entryId) continue
    points.push({
      entryId: record.entryId,
      index: typeof record.index === 'number' ? record.index : points.length,
      preview: typeof record.preview === 'string' ? record.preview : '',
    })
  }
  return points.sort((a, b) => a.index - b.index)
}

/** Newest first; records with neither side of the diff are dropped. */
export function toCheckpoints(raw: unknown): CheckpointRecord[] {
  if (!Array.isArray(raw)) return []
  const records: CheckpointRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || !record.path) continue
    if (typeof record.id !== 'string' || !record.id) continue
    if (typeof record.before !== 'string' && record.before !== null) continue
    if (typeof record.at !== 'number') continue
    records.push({
      id: record.id,
      ...(typeof record.toolCallId === 'string' ? { toolCallId: record.toolCallId } : {}),
      path: record.path,
      before: record.before as string | null,
      after: typeof record.after === 'string' ? record.after : null,
      at: record.at,
      source: (['tool', 'user', 'restore', 'apply'] as const).includes(record.source as never)
        ? (record.source as CheckpointRecord['source'])
        : 'tool',
      ...(record.skipped === 'too_large' ? { skipped: 'too_large' as const } : {}),
    })
  }
  return records.sort((a, b) => b.at - a.at)
}

const SOURCE_LABEL: Record<CheckpointRecord['source'], string> = {
  tool: '工具写入',
  user: '手动写入',
  restore: '恢复',
  apply: '应用代码块',
}

/** What restoring this checkpoint would do, in one line. */
export function checkpointAction(record: CheckpointRecord): string {
  if (record.skipped === 'too_large') return '文件过大，未保存内容'
  if (record.before === null) return '恢复到「文件不存在」'
  return '恢复到修改前'
}

/** `工具写入 · 14:02` */
export function checkpointLabel(record: CheckpointRecord): string {
  const time = new Date(record.at)
  const hh = String(time.getHours()).padStart(2, '0')
  const mm = String(time.getMinutes()).padStart(2, '0')
  return `${SOURCE_LABEL[record.source]} · ${hh}:${mm}`
}

/** The hash `checkpoint_restore` needs: the pre-write content, or null. */
export function restoreHash(record: CheckpointRecord): string | null {
  return record.before
}

/** Last path segment, for the compact row title. */
export function checkpointTitle(path: string): string {
  return path.split('/').pop() ?? path
}
