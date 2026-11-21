import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";
import { followTree } from "../features/branch-state.js";

/**
 * Built-in `mode` (20261116-pii W0.5): 做一做 / 想一想 / 问一问 live on the conversation tree.
 *
 * - `agent_set_mode` writes `openbuddy.mode` onto the current branch (features/mode.ts).
 * - Opening a session (load, resume, fork, rebuild) restores the branch's mode in session-pool.
 * - Moving inside a live session's tree fires `session_tree`; this extension then lets the branch
 *   state follow (features/branch-state.ts): switching versions ‹1/2› re-applies that branch's
 *   mode (and expert), 重新生成 / 从这里编辑 keep the mode selected now on the new branch. The
 *   renderer is told whenever the mode, model or expert changed.
 *
 * Switched off in 设置 · 智能体, the mode is kept in memory only (the pre-W0.5 behaviour).
 */
export function modeExtension(ctx: { engine: EngineContext; sessionId: string }): ExtensionFactory {
  return (pi) => {
    pi.on("session_tree", async (event) => {
      const slot = ctx.engine.slots.get(ctx.sessionId);
      if (slot) await followTree(ctx.engine, slot, event.oldLeafId);
    });
  };
}
