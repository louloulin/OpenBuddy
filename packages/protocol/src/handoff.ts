/**
 * 交接到新任务 (20261116-pii W1.7 / Pi `handoff` 模式).
 *
 * The old session is left untouched. The host builds a self-contained prompt from
 * the current branch, opens a new session in the same workspace and returns the
 * draft; the renderer only pre-fills the composer (never auto-sends).
 */
export interface HandoffOrigin {
  sessionId: string;
  title?: string;
}

export interface HandoffResult {
  /** The newly opened session. */
  sessionId: string;
  /** Draft for the composer: 背景接手 + 下一步任务. */
  prompt: string;
  from: HandoffOrigin;
}
