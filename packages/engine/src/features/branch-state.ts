import type { EngineContext } from "../engine-context.js";
import type { Slot, TreeMove } from "../types.js";
import { followExpert } from "./expert.js";
import { keepMode, restoreMode } from "./mode.js";

/**
 * Per-branch session state when the leaf moves (20261116-pii §5): the mode (W0.5) and the bound
 * expert (W2.2) live in session entries, so each branch has its own. Pi's `navigateTree` moves
 * the leaf and restores the transcript's tool loadout; it knows nothing about either.
 *
 * - `restore` — switching versions ‹1/2› (`agent_navigate`): the target branch's own mode and
 *   expert apply (model / thinking / tools included); the renderer hears it as `agent://model-state`.
 * - `keep` — 重新生成 and 从这里编辑 (+ resend): the prompt is sent again with what the user has
 *   selected now, which is written onto the new branch. Tools never widen behind the user's back.
 *
 * The mode built-in follows inside `session_tree` (before user extensions see the new leaf);
 * with that built-in switched off, `moveLeaf` follows once navigation returns.
 */

/** Move the leaf with Pi's `navigateTree` and let the branch state follow (`move` says how). */
export async function moveLeaf(engine: EngineContext, slot: Slot, entryId: string, move: TreeMove, options: { summarize?: boolean } = {}) {
  const session = slot.session;
  slot.tree = { move, oldLeafId: session.sessionManager.getLeafId() };
  try {
    const result = await session.navigateTree(entryId, { summarize: options.summarize === true });
    if (!result.cancelled && slot.tree) await followTree(engine, slot);
    return result;
  } finally {
    slot.tree = undefined;
  }
}

/**
 * Bring mode and expert in line with the branch the leaf just moved to. A move the engine started
 * carries its `slot.tree`; any other (an extension navigating) restores, from `oldLeafId`.
 */
export async function followTree(engine: EngineContext, slot: Slot, oldLeafId: string | null = null) {
  const pending = slot.tree;
  slot.tree = undefined;
  const move = pending?.move ?? "restore";
  const before = JSON.stringify(engine.modelState(slot.id));
  if (move === "keep") keepMode(engine, slot);
  else restoreMode(engine, slot);
  await followExpert(engine, slot, move, pending ? pending.oldLeafId : oldLeafId);
  const state = engine.modelState(slot.id);
  if (JSON.stringify(state) !== before) engine.emit("agent://model-state", state);
}
