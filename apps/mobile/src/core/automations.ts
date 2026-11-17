/**
 * Scheduled tasks on the phone (20261115-mobile.md §1.4 gap list).
 *
 * Qwen and Kimi both put "定时任务" on the phone's home screen: the task lives
 * on the computer, the phone is where you check on it and where you trigger it
 * by hand. The desktop already owns automations (`automations_snapshot`), so
 * the phone reads the schedule and may run or pause a task — never edit one,
 * because a schedule is a promise about the computer's calendar.
 */

export type AutomationStatus = 'ACTIVE' | 'PAUSED'

export type Automation = {
  id: string
  name: string
  prompt: string
  status: AutomationStatus
  /** ISO timestamp of the next run, when the task is active. */
  nextRunAt?: string
  lastRunAt?: string
  scheduleType?: string
  /** Human summary the desktop shows, e.g. "每天 09:00". */
  scheduleLabel?: string
}

/** Normalises `automations_snapshot` into the rows the phone lists. */
export function toAutomations(raw: unknown): Automation[] {
  const snapshot = raw as { automations?: unknown } | null
  const list = Array.isArray(snapshot?.automations) ? snapshot!.automations : Array.isArray(raw) ? raw : []
  const rows: Automation[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : null
    if (!id) continue
    rows.push({
      id,
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : '未命名任务',
      prompt: typeof record.prompt === 'string' ? record.prompt : '',
      status: record.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
      nextRunAt: typeof record.nextRunAt === 'string' ? record.nextRunAt : undefined,
      lastRunAt: typeof record.lastRunAt === 'string' ? record.lastRunAt : undefined,
      scheduleType: typeof record.scheduleType === 'string' ? record.scheduleType : undefined,
    })
  }
  return rows
}

/**
 * A one-line description of when the task runs.
 *
 * A paused task says nothing here: the card already carries a "已暂停" badge,
 * and repeating the word on the next line is noise.
 */
export function scheduleLabel(automation: Automation): string {
  if (automation.status === 'PAUSED') return ''
  if (!automation.nextRunAt) return '等待调度'
  const when = new Date(automation.nextRunAt)
  if (Number.isNaN(when.getTime())) return '等待调度'
  return `下次 ${when.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
}

/** The prompt, trimmed to one preview line. */
export function promptPreview(automation: Automation, max = 60): string {
  const line = automation.prompt.replace(/\s+/g, ' ').trim()
  if (!line) return ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** The command that pauses or resumes a task. */
export function statusCommand(automation: Automation): 'automations_set_status' {
  return 'automations_set_status'
}

/** The status a toggle should move the task to. */
export function toggledStatus(automation: Automation): AutomationStatus {
  return automation.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
}
