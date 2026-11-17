/**
 * Multi-select session operations (20261117-mobile.md C4).
 *
 * The list can be long, so archiving has to work in one pass. Selection is a
 * plain ordered array — deterministic for the UI and easy to assert in tests —
 * and the summary keeps the "N done / M failed" split the desktop shows.
 */

export type BatchOutcome = {
  ok: string[]
  failed: Array<{ id: string; reason: string }>
}

/** Add/remove one id, keeping insertion order and ignoring repeats. */
export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]
}

/** "已归档 3 个" / "已归档 2 个，1 个失败". */
export function batchSummary(verb: string, outcome: BatchOutcome): string {
  const done = outcome.ok.length
  const failed = outcome.failed.length
  if (failed === 0) return `${verb} ${done} 个`
  if (done === 0) return `${verb}失败 ${failed} 个`
  return `${verb} ${done} 个，${failed} 个失败`
}
