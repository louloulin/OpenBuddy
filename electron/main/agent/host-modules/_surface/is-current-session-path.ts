/**
 * host-modules/_surface/is-current-session-path.ts
 *
 * v7-A2 — Check if a session path matches the currently-active session.
 *
 * 背景:
 *   agent-host.ts:349-352 的 isCurrentSessionPath() 在 initialize() 中用作
 *   early-return guard: 当 renderer 请求的 sessionPath 已经加载到 state.session
 *   时, 不需要重新 init, 直接返回 cached session. 这是 warm-host fast path 的
 *   关键 predicate.
 *
 * 设计:
 *   - 接受 state 参数 (DI), 零 module-level singleton
 *   - 纯函数, 易测试
 *
 * v7-A2 收益: agent-host.ts -4 行, predicate logic 独立可测试.
 */

export function isCurrentSessionPath(
  state: {
    session?: { sessionManager: { getSessionFile(): string | undefined } } | null;
    cwd?: string | null;
  },
  sessionPath: string | undefined,
  cwd: string | undefined,
): boolean {
  if (!sessionPath || !state.session || (cwd && cwd !== state.cwd)) return false;
  return state.session.sessionManager.getSessionFile() === sessionPath;
}
