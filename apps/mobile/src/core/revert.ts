/**
 * Undoing one tool call (20261117-mobile.md D5).
 *
 * The desktop keeps a checkpoint per file write, so `turn_revert` can put the
 * files a tool call touched back the way they were. The phone only offers it
 * on tools that can write, and reports what the desktop restored (or which
 * files changed since, which the user has to resolve on the computer).
 */

export type RevertResult = {
  restored?: unknown
  conflicts?: unknown
  skipped?: unknown
}

const WRITE_TOOLS = [
  /^write_/,
  /^edit(_file)?$/,
  /^multi_edit$/,
  /^apply_patch$/,
  /^patch$/,
  /^artifact_save$/,
  /^bash$/,
  /^run_bash$/,
]

/** True for the tool names that can leave files behind. */
export function canRevertTool(name: string): boolean {
  const lower = name.toLowerCase()
  return WRITE_TOOLS.some(pattern => pattern.test(lower))
}

export type RevertSummary = {
  ok: boolean
  restored: number
  conflicts: number
  message: string
}

export function summarizeRevert(raw: unknown): RevertSummary {
  const result = (raw ?? {}) as RevertResult
  const restored = Array.isArray(result.restored) ? result.restored.length : 0
  const conflicts = Array.isArray(result.conflicts) ? result.conflicts.length : 0
  if (restored === 0 && conflicts === 0) {
    return { ok: true, restored, conflicts, message: '这一步没有改动文件' }
  }
  if (conflicts === 0) {
    return { ok: true, restored, conflicts, message: `已恢复 ${restored} 个文件` }
  }
  if (restored === 0) {
    return { ok: false, restored, conflicts, message: `${conflicts} 个文件已被改动，需在电脑上处理` }
  }
  return { ok: false, restored, conflicts, message: `已恢复 ${restored} 个，${conflicts} 个冲突` }
}
