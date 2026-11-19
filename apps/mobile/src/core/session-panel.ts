/**
 * The session panel's data model (20261115-mobile.md §4.2 P1, §1.4 gap list).
 *
 * A phone that drives a desktop agent should be able to see and change the
 * things that belong to a session: which persona answers, how hard it thinks,
 * what it produced, and what files the desktop has. Kimi and Qwen both put
 * these one tap away from the conversation; this module keeps the shapes pure
 * so the rules (what is settable, what is read-only) are testable.
 */

export type ExpertOption = {
  id: string
  name: string
  description?: string
  avatar?: string
}

/** The thinking levels the engine accepts, in the order the desktop shows them. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value)
}

export type ArtifactEntry = {
  path: string
  kind?: string
  bytes?: number
  updatedAt?: number
}

export type SessionPanel = {
  /** The expert answering this session, if one is bound. */
  expertId?: string
  expertName?: string
  /** The thinking level currently in effect. */
  thinking?: ThinkingLevel
  /** Context usage as the desktop reports it. */
  usage?: { used?: number; total?: number }
  /** Files the session produced. */
  artifacts: ArtifactEntry[]
  /** The desktop's working directory for this session. */
  cwd?: string
}

/**
 * Normalises `agents_list` into options the phone can show.
 *
 * The desktop returns experts in its own shape (id/name/description/avatar);
 * an expert without a name is dropped rather than shown as an empty row.
 */
export function toExpertOptions(raw: unknown): ExpertOption[] {
  if (!Array.isArray(raw)) return []
  const options: ExpertOption[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : typeof record.expertId === 'string' ? record.expertId : null
    if (!id) continue
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id
    options.push({
      id,
      name,
      description: typeof record.description === 'string' ? record.description : undefined,
      avatar: typeof record.avatar === 'string' ? record.avatar : undefined,
    })
  }
  return options
}

/** Normalises `artifacts_list`; the desktop returns paths in its own shape. */
export function toArtifacts(raw: unknown): ArtifactEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: ArtifactEntry[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      entries.push({ path: item })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const path = typeof record.path === 'string' ? record.path : typeof record.file === 'string' ? record.file : null
    if (!path) continue
    entries.push({
      path,
      kind: typeof record.kind === 'string' ? record.kind : undefined,
      bytes: typeof record.bytes === 'number' ? record.bytes : typeof record.size === 'number' ? record.size : undefined,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : undefined,
    })
  }
  return entries
}

/**
 * Context-window usage as the panel shows it: `38,400 / 200,000 · 19%`.
 * Raw digits are hard to compare at a glance on a phone, and a percentage is
 * how people actually judge "how full is this window".
 */
export function formatUsage(usage?: { used?: number; total?: number }): string | undefined {
  const used = usage?.used
  const total = usage?.total
  if (typeof used !== 'number' || typeof total !== 'number') return undefined
  const percent = total > 0 ? Math.round((used / total) * 100) : undefined
  const base = `${used.toLocaleString('zh-CN')} / ${total.toLocaleString('zh-CN')}`
  return percent === undefined ? base : `${base} · ${percent}%`
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * `artifacts_list` sometimes returns workspace-relative paths. The file
 * preview speaks absolute paths, so join against the session's cwd when one is
 * known; anything already absolute (or without a cwd) is passed through.
 */
export function resolveArtifactPath(path: string, cwd?: string): string {
  const trimmed = path.trim()
  if (!trimmed || isAbsolutePath(trimmed) || !cwd || !isAbsolutePath(cwd)) return trimmed
  return `${cwd.replace(/[\\/]+$/, '')}/${trimmed.replace(/^[.][\\/]/, '')}`
}

/** `agent_set_thinking_level` only accepts these; anything else is refused. */
export function thinkingLevelPayload(level: string): { level: ThinkingLevel } | null {
  return isThinkingLevel(level) ? { level } : null
}

/**
 * The next level when the composer chip is tapped. An unknown level starts at
 * `medium`; `max` wraps back to `off`, so one chip covers the whole scale.
 */
export function nextThinkingLevel(current: ThinkingLevel | undefined): ThinkingLevel {
  if (!current) return 'medium'
  const index = THINKING_LEVELS.indexOf(current)
  return THINKING_LEVELS[(index + 1) % THINKING_LEVELS.length] ?? 'off'
}

/** The human label for a level, the way the desktop writes it. */
export function thinkingLevelLabel(level: ThinkingLevel | undefined): string {
  switch (level) {
    case 'off': return '关闭'
    case 'minimal': return '极简'
    case 'low': return '低'
    case 'medium': return '中'
    case 'high': return '高'
    case 'xhigh': return '很高'
    case 'max': return '最高'
    default: return '跟随桌面'
  }
}
