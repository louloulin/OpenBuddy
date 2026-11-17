/**
 * Scheduled tasks on the phone (20261115-mobile.md §1.4 gap list).
 *
 * Qwen and Kimi both put "定时任务" on the phone's home screen: the task lives
 * on the computer, the phone is where you check on it and where you trigger it
 * by hand. v3 D3 lets the phone create, edit and delete the text of a task
 * (name / prompt / workspaces); the schedule and permission fields keep the
 * desktop's defaults so a phone edit cannot silently move a task's calendar.
 */

export type AutomationStatus = 'ACTIVE' | 'PAUSED'

export type Automation = {
  id: string
  name: string
  prompt: string
  /** Comma-separated workspace roots, as the desktop stores them. */
  cwds?: string
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
      cwds: typeof record.cwds === 'string' ? record.cwds : undefined,
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

// ── D3: create / edit / delete ─────────────────────────────────────────────

export type AutomationDraft = {
  id?: string
  name: string
  prompt: string
  cwds: string
}

export const AUTOMATION_NAME_MAX = 120

/** Prefill from an existing task, or the empty form for a new one. */
export function automationDraft(automation?: Automation): AutomationDraft {
  return {
    ...(automation ? { id: automation.id } : {}),
    name: automation?.name ?? '',
    prompt: automation?.prompt ?? '',
    cwds: automation?.cwds ?? '',
  }
}

/** Windows drives as well as POSIX roots; the desktop owns the final check. */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/** Splits the comma-separated list, trimming and dropping duplicates. */
export function parseCwds(value: string): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const raw of value.split(/[,\n]/)) {
    const root = raw.trim()
    if (!root || seen.has(root)) continue
    seen.add(root)
    roots.push(root)
  }
  return roots
}

/** A user-facing error, or null when the draft can be saved. */
export function validateAutomationDraft(draft: AutomationDraft): string | null {
  const name = draft.name.trim()
  if (!name) return '给任务起一个名字。'
  if (name.length > AUTOMATION_NAME_MAX) return `名字不能超过 ${AUTOMATION_NAME_MAX} 个字。`
  if (!draft.prompt.trim()) return '写下要电脑做什么。'
  const roots = parseCwds(draft.cwds)
  if (roots.length === 0) return '至少写一个工作目录。'
  if (roots.some(root => !isAbsolutePath(root) || root.includes('\0'))) return '工作目录要用绝对路径。'
  return null
}

/**
 * The partial automation the desktop merges into the existing task (or its
 * defaults). Schedule, skills, permissions and push stay untouched.
 */
export function automationSavePayload(draft: AutomationDraft): {
  id?: string
  name: string
  prompt: string
  cwds: string
} {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    cwds: parseCwds(draft.cwds).join(','),
  }
}
