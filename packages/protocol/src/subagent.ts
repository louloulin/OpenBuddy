/**
 * 子代理 (pii W3.4) wire types. Kept out of `dto.ts` so that file stays under its size ceiling.
 */

/** `agent://subagent` event payload: one child session's lifecycle. */
export interface SubagentEvent {
  /** The session that spawned the child. */
  parentId: string;
  /** The child session id (empty until the child session is created). */
  childId: string;
  /** `started` when the child begins; then its terminal status. */
  status: "started" | "running" | "done" | "failed" | "cancelled";
  /** The expert / label the child was spawned as. */
  agent?: string;
  /** Team name when the child belongs to a team pipeline (`ob_subagent` `team`). */
  team?: string;
  /** Short role label from the step (e.g. 调研 / 审阅). */
  role?: string;
  /** Zero-based step index within the parent tool call. */
  index?: number;
  /** The task the child was given (truncated). */
  task?: string;
  /** The child's final answer (truncated). */
  summary?: string;
  error?: string;
  /** Duration of the child's turn. */
  ms?: number;
  /** Context usage snapshot at the end of the child's turn. */
  usage?: unknown;
}
