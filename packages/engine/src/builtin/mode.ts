import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";
import { restoreMode } from "../features/mode.js";

/**
 * Built-in `mode` (20261116-pii W0.5): 做一做 / 想一想 / 问一问 live on the conversation tree.
 *
 * - `agent_set_mode` writes `openbuddy.mode` onto the current branch (features/mode.ts).
 * - Opening a session (load, resume, fork, rebuild) restores the branch's mode in session-pool.
 * - Moving inside a live session's tree (从这里编辑, 重新生成, branch switch) fires `session_tree`;
 *   this extension then re-applies that branch's mode and tells the renderer.
 *
 * Switched off in 设置 · 智能体, the mode is kept in memory only (the pre-W0.5 behaviour).
 */
export function modeExtension(ctx: { engine: EngineContext; sessionId: string }): ExtensionFactory {
  return (pi) => {
    pi.on("session_tree", () => {
      const slot = ctx.engine.slots.get(ctx.sessionId);
      if (!slot) return;
      const before = ctx.engine.modes.get(slot.id) ?? "craft";
      if (restoreMode(ctx.engine, slot) !== before) ctx.engine.emit("agent://model-state", ctx.engine.modelState(slot.id));
    });
  };
}
