/**
 * `!command` in the composer (20261116-pii W1.2, Pi S2): `agent_bash` / `agent_bash_abort`.
 * `!cmd` puts the output into the model's context; `!!cmd` keeps it out (`excludeFromContext`).
 */

export interface BashRunOptions {
  /** `!!cmd`: run and show the output, but never send it to the model. */
  excludeFromContext?: boolean;
  /**
   * The renderer's own risk reading (chat-core command-risk). It can only make the engine
   * stricter: medium/high always asks for the strong confirmation.
   */
  risk?: 'low' | 'medium' | 'high';
}

export interface BashRunResult {
  /** Client-visible id of this run (the `id` of its `bash_execution_*` events). */
  id: string;
  exitCode?: number;
  cancelled: boolean;
  truncated: boolean;
  /** Output tail (the full output, when long, is in `fullOutputPath`). */
  output: string;
  fullOutputPath?: string;
  excludeFromContext: boolean;
}

/** `agent://event` payloads of one run, in order: start → update* → end. */
export type BashExecutionEvent =
  | { type: 'bash_execution_start'; id: string; command: string; excludeFromContext: boolean }
  | { type: 'bash_execution_update'; id: string; delta: string }
  | { type: 'bash_execution_end'; id: string; command: string; exitCode?: number; cancelled: boolean; truncated: boolean; output: string; excludeFromContext: boolean; fullOutputPath?: string };

/** Permission requests raised for a command the user typed carry this `toolCallId` prefix. */
export const USER_BASH_REQUEST_PREFIX = 'user-bash:';
export const isUserBashRequest = (request: { toolCallId?: string }) => typeof request.toolCallId === 'string' && request.toolCallId.startsWith(USER_BASH_REQUEST_PREFIX);
