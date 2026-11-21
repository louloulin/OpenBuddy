import type { EngineContext } from "../engine-context.js";
import { READ_ONLY_TOOLS, type AgentMode, type Slot } from "../types.js";
import { readBranchState, writeBranchState, type BranchReader } from "../builtin/session-state.js";

/** 做一做 gets the session's tools, 想一想 / 问一问 only the read-only ones. */
function applyModeTools(slot: Slot, mode: AgentMode) {
  slot.session.setActiveToolsByName(mode === "craft" ? slot.defaultTools : slot.defaultTools.filter((name) => READ_ONLY_TOOLS.includes(name)));
}
export function setMode(engine: EngineContext, id: string, mode: AgentMode) {
  const slot = engine.slot(id);
  engine.modes.set(id, mode);
  applyModeTools(slot, mode);
  persistMode(engine, slot, mode);
  engine.emit("agent://model-state", engine.modelState(id));
}
export function mode(engine: EngineContext, id: string): AgentMode { return engine.modes.get(id) ?? "craft"; }

// ---- Mode persistence: the first built-in (20261116-pii W0.5, builtin/mode.ts) ----

/** Custom session entry holding `{ mode }` on the conversation tree (S7). */
export const MODE_ENTRY = "openbuddy.mode";
const MODES: readonly AgentMode[] = ["craft", "plan", "ask"];
const enabled = (engine: EngineContext) => engine.settings.pi.builtinEnabled("mode");

/** The mode stored on the current branch, if any. */
export function savedMode(sm: BranchReader): AgentMode | undefined {
  const mode = readBranchState<{ mode?: unknown }>(sm, MODE_ENTRY)?.mode;
  return MODES.includes(mode as AgentMode) ? (mode as AgentMode) : undefined;
}

/** Write the mode onto the branch; a branch that never left 做一做 needs no entry. */
function persistMode(engine: EngineContext, slot: Slot, mode: AgentMode) {
  if (!enabled(engine)) return;
  const sm = slot.session.sessionManager;
  if (mode === "craft" && savedMode(sm) === undefined) return;
  writeBranchState(sm, MODE_ENTRY, { mode });
}

/**
 * Re-apply the mode of the session's current branch: on open (load, resume, fork, rebuild) and
 * after switching versions ‹1/2›. Once a session has stored a mode, the branch decides (a branch
 * from before the first switch is 做一做); a session that never stored one keeps the in-memory mode.
 * Re-applying also replaces the tool loadout Pi restores from the transcript when the leaf moves.
 */
export function restoreMode(engine: EngineContext, slot: Slot): AgentMode {
  const sm = slot.session.sessionManager;
  const stored = enabled(engine) && sm.getEntries().some((e) => e.type === "custom" && e.customType === MODE_ENTRY);
  const next = stored ? savedMode(sm) ?? "craft" : engine.modes.get(slot.id) ?? "craft";
  engine.modes.set(slot.id, next);
  applyModeTools(slot, next);
  return next;
}

/**
 * 重新生成 / 从这里编辑 move the leaf back before a prompt that is then sent again: the mode the user
 * has selected now applies (never the older one stored before that prompt), and it is written onto
 * the new branch so that reopening the branch restores it.
 */
export function keepMode(engine: EngineContext, slot: Slot): AgentMode {
  const mode = engine.modes.get(slot.id) ?? "craft";
  applyModeTools(slot, mode);
  persistMode(engine, slot, mode);
  return mode;
}
