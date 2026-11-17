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

export type NewSessionCheck = { ok: true; cwd: string } | { ok: false; reason: string }

/** Combines the init answer and the auth state into one message the button can show. */
export function checkNewSession(init: InitAnswer | null | undefined): NewSessionCheck {
  const cwd = newSessionCwd(init)
  if (!cwd) return { ok: false, reason: '这台电脑还没有可用的工作目录，请先在桌面端打开一个文件夹。' }
  if (init?.ok === false) return { ok: false, reason: '桌面端还没有配置模型，先在电脑上选一个模型再新建。' }
  return { ok: true, cwd }
}
