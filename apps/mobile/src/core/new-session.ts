/**
 * Starting a session from the phone (20261115-mobile.md §4.2 P0).
 *
 * `agent_new_session` takes an absolute working directory. The phone has no
 * folder picker — the directory belongs to the computer — so the flow is:
 * ask `agent_init` where the desktop works (`cwd`, falling back to its inbox),
 * then create the session there with the desktop's default model. Pure helpers
 * so the fallback rules are testable.
 */

export type InitAnswer = {
  cwd?: unknown
  inbox?: unknown
  ok?: unknown
  invalidDefault?: unknown
}

/** The directory a new session should use, or null when the desktop did not say. */
export function newSessionCwd(init: InitAnswer | null | undefined): string | null {
  for (const candidate of [init?.cwd, init?.inbox]) {
    if (typeof candidate === 'string' && candidate.startsWith('/') && !candidate.includes('\0')) return candidate
  }
  return null
}

export type WorkspaceChoice = { cwd: string; label: string; detail?: string }

export type WorkspaceInfo = { cwd?: unknown; sessionCount?: unknown; lastTitle?: unknown }

/**
 * The folders a new session can start in: the desktop's current directory
 * first, then the workspaces it has seen before. Absolute paths only, de-duped
 * by cwd, capped so the sheet stays one screen.
 */
export function workspaceChoices(
  current: string | null,
  workspaces: readonly WorkspaceInfo[] | null | undefined,
  max = 12,
): WorkspaceChoice[] {
  const rows: WorkspaceChoice[] = []
  const seen = new Set<string>()
  const add = (choice: WorkspaceChoice) => {
    if (!choice.cwd.startsWith('/') || choice.cwd.includes('\0') || seen.has(choice.cwd) || rows.length >= max) return
    seen.add(choice.cwd)
    rows.push(choice)
  }
  if (current) add({ cwd: current, label: current, detail: '桌面当前目录' })
  for (const item of workspaces ?? []) {
    if (typeof item?.cwd !== 'string') continue
    const count = typeof item.sessionCount === 'number' ? item.sessionCount : undefined
    add({
      cwd: item.cwd,
      label: item.cwd,
      detail: [
        typeof item.lastTitle === 'string' && item.lastTitle ? item.lastTitle : undefined,
        count !== undefined ? `${count} 个会话` : undefined,
      ].filter(Boolean).join(' · ') || undefined,
    })
  }
  return rows
}

export type NewSessionCheck = { ok: true; cwd: string } | { ok: false; reason: string }

/** Combines the init answer and the auth state into one message the button can show. */
export function checkNewSession(init: InitAnswer | null | undefined): NewSessionCheck {
  const cwd = newSessionCwd(init)
  if (!cwd) return { ok: false, reason: '这台电脑还没有可用的工作目录，请先在桌面端打开一个文件夹。' }
  if (init?.ok === false) return { ok: false, reason: '桌面端还没有配置模型，先在电脑上选一个模型再新建。' }
  return { ok: true, cwd }
}
