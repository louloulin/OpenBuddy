/**
 * Project grouping for the session list (20261117-mobile.md C5).
 *
 * `projects_snapshot` is a desktop registry of named folders. The phone folds
 * the non-pinned sessions by the project whose `cwd` matches the session's
 * `cwd`; unmatched folders fall back to their folder name, and sessions
 * without a cwd stay in one "其他会话" bucket. Read-only: projects are created
 * and edited on the desktop.
 */

export type ProjectRef = {
  id: string
  name: string
  cwd?: string
}

export function toProjects(raw: unknown): ProjectRef[] {
  const snapshot = raw as { projects?: unknown } | null
  const list = Array.isArray(snapshot?.projects) ? snapshot!.projects : Array.isArray(raw) ? raw : []
  const projects: ProjectRef[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : ''
    if (!name) continue
    projects.push({
      id: typeof record.id === 'string' && record.id ? record.id : name,
      name,
      cwd: typeof record.cwd === 'string' && record.cwd ? record.cwd.replace(/\/+$/, '') : undefined,
    })
  }
  return projects
}

/** The section title for one workspace root. */
export function projectLabelFor(cwd: string | undefined, projects: readonly ProjectRef[]): string {
  if (!cwd) return '其他会话'
  const normalized = cwd.replace(/\/+$/, '')
  const project = projects.find(item => item.cwd === normalized)
  if (project) return project.name
  const name = normalized.split('/').filter(Boolean).pop()
  return name || normalized
}
