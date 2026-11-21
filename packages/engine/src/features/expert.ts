import { ProtocolError } from "@openbuddy/protocol/errors";
import { modelKey } from "@openbuddy/services/providers/providers";
import type { EngineContext } from "../engine-context.js";
import { writeBranchState } from "../builtin/session-state.js";
import { currentBinding, EXPERT_ENTRY, toolFilter, type ExpertBinding } from "../builtin/persona.js";
import type { Slot, ThinkingLevel, TreeMove } from "../types.js";
import { mode as currentMode, setMode } from "./mode.js";

/**
 * Session ↔ expert binding (20261116-pii W2.2): `agent_set_session_expert` /
 * `agent_clear_session_expert`. Binding applies the expert's model, thinking level and tool
 * allowlist and records a snapshot in the `openbuddy.expert` session entry; the persona built-in
 * appends the persona on every run. Clearing undoes what binding changed (unless the user changed
 * it again since) and restores the mode's tools.
 */
export interface ExpertProfile {
  id: string;
  name: string;
  avatar?: string;
  scope: string;
  prompt: string;
  model?: string;
  thinking?: ThinkingLevel;
  tools?: string[];
  skills?: string[];
  connectors?: string[];
}

export interface SessionExpert {
  sessionId: string;
  id: string;
  name: string;
  avatar?: string;
  scope: string;
  applied: ExpertBinding["applied"];
  warnings: string[];
}

const summary = (sessionId: string, b: ExpertBinding): SessionExpert => ({
  sessionId, id: b.id, name: b.name, avatar: b.avatar, scope: b.scope, applied: b.applied, warnings: b.warnings,
});

function idleSlot(engine: EngineContext, id: string): Slot {
  const slot = engine.slots.get(id);
  if (!slot) throw new ProtocolError("session_not_loaded", "会话未加载");
  if (slot.busy) throw new ProtocolError("session_busy", "请等待当前回复完成后再切换专家");
  return slot;
}

/** The expert bound on the session's current branch, or null (also for sessions not loaded). */
export function sessionExpert(engine: EngineContext, id: string): SessionExpert | null {
  const slot = engine.slots.get(id);
  const binding = slot && currentBinding(slot.session.sessionManager);
  return binding ? summary(id, binding) : null;
}

/** `model:<p>/<id>`, `<p>/<id>` or a bare id → a configured model (undefined when unknown or ambiguous). */
function resolveModel(engine: EngineContext, ref: string) {
  try {
    if (ref.startsWith("model:")) return engine.providers.model(ref);
    const slash = ref.indexOf("/");
    if (slash > 0) return engine.providers.model(ref.slice(slash + 1), ref.slice(0, slash)) ?? engine.providers.model(ref);
    return engine.providers.model(ref);
  } catch {
    return undefined;
  }
}

/** Undo the model / thinking a binding applied, where the user has not changed them since. */
async function undo(engine: EngineContext, slot: Slot, binding: ExpertBinding) {
  const session = slot.session;
  const own = binding.restore.model;
  if (binding.applied.model && own && session.model && modelKey(session.model.provider, session.model.id) === binding.applied.model) {
    const model = engine.providers.model(own.modelId, own.provider);
    if (model && engine.providers.runtime.hasConfiguredAuth(model.provider)) await session.setModel(model);
  }
  const thinking = binding.restore.thinking;
  if (binding.applied.thinking && thinking && session.thinkingLevel === binding.applied.thinking && session.getAvailableThinkingLevels().includes(thinking))
    session.setThinkingLevel(thinking);
}

/** Apply a binding's model and thinking level again (back on a version where it is bound). */
async function reapply(engine: EngineContext, slot: Slot, binding: ExpertBinding) {
  const session = slot.session;
  const model = binding.applied.model ? resolveModel(engine, binding.applied.model) : undefined;
  if (model && engine.providers.runtime.hasConfiguredAuth(model.provider) && (session.model?.provider !== model.provider || session.model?.id !== model.id))
    await session.setModel(model);
  const thinking = binding.applied.thinking;
  if (thinking && session.thinkingLevel !== thinking && session.getAvailableThinkingLevels().includes(thinking)) session.setThinkingLevel(thinking);
}

const sameBinding = (a?: ExpertBinding, b?: ExpertBinding) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * After the leaf moved from `oldLeafId` (features/branch-state.ts; the mode's tools are already
 * applied). `restore` (‹1/2›): the target version's own binding applies — the expert's model and
 * thinking where it is bound, the task's own (as clearing restores them) where it is not. `keep`
 * (重新生成 / 从这里编辑): the expert bound before the move stays bound and is written onto the new
 * branch. Either way the tools are narrowed to the binding's allowlist.
 */
export async function followExpert(engine: EngineContext, slot: Slot, move: TreeMove, oldLeafId: string | null) {
  const sm = slot.session.sessionManager;
  const before = oldLeafId === null ? undefined : currentBinding(sm, oldLeafId);
  let binding = currentBinding(sm);
  if (!sameBinding(before, binding)) {
    if (move === "keep") {
      writeBranchState(sm, EXPERT_ENTRY, before ?? null);
      binding = before;
    } else {
      if (before) await undo(engine, slot, before);
      if (binding) await reapply(engine, slot, binding);
    }
  }
  const filter = binding && toolFilter(binding);
  if (filter) slot.session.setActiveToolsByName(slot.session.getActiveToolNames().filter(filter));
}

/** Reset the tools to the mode's set, then narrow them to the expert's allowlist. */
function applyTools(engine: EngineContext, slot: Slot, filter?: (name: string) => boolean): string[] | undefined {
  setMode(engine, slot.id, currentMode(engine, slot.id));
  if (!filter) return undefined;
  slot.session.setActiveToolsByName(slot.session.getActiveToolNames().filter(filter));
  return slot.session.getActiveToolNames();
}

export async function setSessionExpert(engine: EngineContext, id: string, expert: ExpertProfile): Promise<SessionExpert> {
  const slot = idleSlot(engine, id);
  const session = slot.session;
  const previous = currentBinding(session.sessionManager);
  if (previous) await undo(engine, slot, previous);
  // The session's own state (after undoing a previous expert) is what clearing returns to.
  const restore: ExpertBinding["restore"] = {
    model: session.model ? { provider: session.model.provider, modelId: session.model.id } : undefined,
    thinking: session.thinkingLevel as ThinkingLevel,
  };
  const applied: ExpertBinding["applied"] = {};
  const warnings: string[] = [];
  if (expert.model) {
    const model = resolveModel(engine, expert.model);
    if (!model) warnings.push("model_unavailable");
    else if (!engine.providers.runtime.hasConfiguredAuth(model.provider)) warnings.push("model_auth_missing");
    else {
      if (session.model?.provider !== model.provider || session.model?.id !== model.id) await session.setModel(model);
      applied.model = modelKey(model.provider, model.id);
    }
  }
  if (expert.thinking) {
    if (session.getAvailableThinkingLevels().includes(expert.thinking)) {
      if (session.thinkingLevel !== expert.thinking) session.setThinkingLevel(expert.thinking);
      applied.thinking = expert.thinking;
    } else warnings.push("thinking_unsupported");
  }
  const binding: ExpertBinding = { ...expert, applied, restore, warnings };
  binding.applied.tools = applyTools(engine, slot, toolFilter(binding));
  if (!binding.applied.tools) delete binding.applied.tools;
  writeBranchState(session.sessionManager, EXPERT_ENTRY, binding);
  engine.emit("agent://model-state", engine.modelState(id));
  return summary(id, binding);
}

/** Returns false when no expert was bound. */
export async function clearSessionExpert(engine: EngineContext, id: string): Promise<boolean> {
  const slot = idleSlot(engine, id);
  const previous = currentBinding(slot.session.sessionManager);
  if (!previous) return false;
  await undo(engine, slot, previous);
  writeBranchState(slot.session.sessionManager, EXPERT_ENTRY, null);
  applyTools(engine, slot);
  engine.emit("agent://model-state", engine.modelState(id));
  return true;
}
