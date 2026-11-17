/**
 * Running desktop tasks (20261117-mobile.md A4).
 *
 * `tasks_list` is host-wide; the chat screen only wants the rows that belong to
 * its session. The drawer shows what the turn is doing (bash / subagent /
 * automation), how long it has run, and how many approvals are waiting.
 */

import type { RunningTask } from './models'

export function sessionTasks(tasks: readonly RunningTask[], sessionId: string): RunningTask[] {
  return tasks.filter(task => !task.sessionId || task.sessionId === sessionId)
}

export function elapsedLabel(startedAt: number | undefined, now = Date.now()): string {
  if (startedAt === undefined || startedAt === null || startedAt > now) return ''
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** A single line for the row: title, then kind · elapsed · approvals. */
export function taskLine(task: RunningTask, now = Date.now()): string {
  const title = task.title || task.description || task.id
  const bits: string[] = []
  if (task.kind) bits.push(task.kind)
  const elapsed = elapsedLabel(task.startedAt, now)
  if (elapsed) bits.push(elapsed)
  if (task.pending) bits.push(`待确认 ${task.pending}`)
  return bits.length ? `${title} · ${bits.join(' · ')}` : title
}

export function runningCount(tasks: readonly RunningTask[]): number {
  return tasks.length
}
