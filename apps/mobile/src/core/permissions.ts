/**
 * Read-only view of the desktop's permission rules (20261117-mobile.md §4:
 * 「权限模式 / 规则查看」P1). The phone never edits rules — that stays in the
 * desktop's 设置·安全中心 — it only shows what the desktop will apply, so the
 * user can predict whether a tool call will ask.
 */

export type PermissionRule = {
  action: 'allow' | 'deny' | 'ask'
  tool: string
  pattern?: string
}

const ACTIONS = new Set(['allow', 'deny', 'ask'])

/** Normalizes `permission_list` output, dropping anything malformed. */
export function permissionRules(raw: unknown): PermissionRule[] {
  if (!Array.isArray(raw)) return []
  const out: PermissionRule[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const action = record.action
    const tool = record.tool
    if (typeof action !== 'string' || !ACTIONS.has(action)) continue
    if (typeof tool !== 'string' || !tool) continue
    const pattern = typeof record.pattern === 'string' && record.pattern ? record.pattern : undefined
    out.push({ action: action as PermissionRule['action'], tool, ...(pattern ? { pattern } : {}) })
  }
  return out
}

const ACTION_LABEL: Record<PermissionRule['action'], string> = { allow: '允许', deny: '拒绝', ask: '询问' }

/** One row's text, e.g. 「允许 bash · git 」. */
export function permissionRuleLabel(rule: PermissionRule): string {
  return rule.pattern ? `${ACTION_LABEL[rule.action]} ${rule.tool} · ${rule.pattern}` : `${ACTION_LABEL[rule.action]} ${rule.tool}`
}

/** The section footer, e.g. 「3 条 · 允许 2 · 拒绝 1」. */
export function permissionRuleSummary(rules: PermissionRule[]): string {
  if (!rules.length) return '没有自定义规则，按审批模式执行'
  const allow = rules.filter(rule => rule.action === 'allow').length
  const deny = rules.filter(rule => rule.action === 'deny').length
  const ask = rules.length - allow - deny
  const parts = [`${rules.length} 条`, `允许 ${allow}`, `拒绝 ${deny}`]
  if (ask) parts.push(`询问 ${ask}`)
  return parts.join(' · ')
}
