/**
 * Read-only 技能 / 我的指令 lists (20261117-mobile.md §4 「技能/命令/提示词」P2).
 *
 * The desktop owns installation, enablement and editing. The phone shows what
 * exists so the user knows what the agent can do and what `/` will offer.
 */

export type SkillEntry = {
  name: string
  displayName?: string
  description: string
  scope: 'user' | 'repo'
  enabled: boolean
  version?: string
  market: boolean
}

export type PromptEntry = {
  name: string
  description: string
  scope: 'global' | 'workspace'
  argumentHint?: string
}

export function toSkills(raw: unknown): SkillEntry[] {
  if (!Array.isArray(raw)) return []
  const out: SkillEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' && record.name ? record.name : null
    if (!name) continue
    out.push({
      name,
      ...(typeof record.displayName === 'string' && record.displayName ? { displayName: record.displayName } : {}),
      description: typeof record.description === 'string' ? record.description : '',
      scope: record.scope === 'repo' ? 'repo' : 'user',
      enabled: record.enabled !== false,
      ...(typeof record.version === 'string' && record.version ? { version: record.version } : {}),
      market: record.market === true,
    })
  }
  return out
}

export function toPrompts(raw: unknown): PromptEntry[] {
  if (!Array.isArray(raw)) return []
  const out: PromptEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' && record.name ? record.name : null
    if (!name) continue
    out.push({
      name,
      description: typeof record.description === 'string' ? record.description : '',
      scope: record.scope === 'workspace' ? 'workspace' : 'global',
      ...(typeof record.argumentHint === 'string' && record.argumentHint ? { argumentHint: record.argumentHint } : {}),
    })
  }
  return out
}

/** 「全局」/「项目」 for a skill's user/repo scope. */
export function skillScopeLabel(scope: SkillEntry['scope']): string {
  return scope === 'repo' ? '项目' : '全局'
}

/** 「全局」/「项目」 for a prompt's global/workspace scope. */
export function promptScopeLabel(scope: PromptEntry['scope']): string {
  return scope === 'workspace' ? '项目' : '全局'
}
