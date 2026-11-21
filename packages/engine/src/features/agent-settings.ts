import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentSettings, AgentSettingsPatch, ModelCycleResult, SessionCost, SessionModelState } from "@openbuddy/protocol/agent-settings";
import type { ProtocolError, ProtocolErrorCode } from "@openbuddy/protocol/errors";
import type { ResolvedPiSettings } from "@openbuddy/services/settings/pi-settings";
import { modelKey } from "@openbuddy/services/providers/providers";
import type { EngineContext } from "../engine-context.js";
import type { Slot } from "../types.js";
import { BUILTIN_EXTENSIONS } from "../builtin/index.js";

/**
 * Agent behaviour settings (20261116-pii W0.4, W1.6): pi-settings.json ⇄ Pi's SettingsManager.
 * Every live session gets the change at once through the AgentSession setters; switching a
 * built-in on or off rebuilds the sessions (extension factories are fixed when a session opens).
 */

/** An expected failure with a protocol error code (packages/protocol/src/errors.ts). */
export function fail(code: ProtocolErrorCode, message: string): never {
  throw Object.assign(new Error(`${code}: ${message}`), { code } satisfies Pick<ProtocolError, "code">);
}

/** `model:<provider>/<model>` ⇄ Pi's `<provider>/<model>` reference (`enabledModels`). */
function refToKey(ref: string): string | undefined {
  const at = ref.indexOf("/");
  return at > 0 ? modelKey(ref.slice(0, at), ref.slice(at + 1)) : undefined;
}

export function agentSettings(engine: EngineContext): AgentSettings {
  return toDto(engine.settings.pi.resolved());
}
function toDto(r: ResolvedPiSettings): AgentSettings {
  return {
    autoCompaction: r.autoCompaction,
    autoRetry: r.autoRetry,
    steeringMode: r.steeringMode,
    followUpMode: r.followUpMode,
    cacheWarming: r.cacheWarming,
    favoriteModels: r.favoriteRefs.map(refToKey).filter((key): key is string => !!key),
    builtins: BUILTIN_EXTENSIONS.map((b) => ({ id: b.id, label: b.label ?? b.id, description: b.description, enabled: r.builtins[b.id] !== false })),
  };
}

export async function setAgentSettings(engine: EngineContext, patch: AgentSettingsPatch): Promise<AgentSettings> {
  const favoriteRefs = patch.favoriteModels?.map((key) => {
    let entry: ReturnType<EngineContext["providers"]["entry"]>;
    try { entry = engine.providers.entry(key); } catch { entry = undefined; }
    if (!entry) fail("model_not_found", "收藏的模型不存在，请刷新模型列表");
    return `${entry.providerId}/${entry.modelId}`;
  });
  for (const id of Object.keys(patch.builtins ?? {}))
    if (!BUILTIN_EXTENSIONS.some((b) => b.id === id)) fail("invalid_payload", `未知的内置扩展：${id}`);
  const before = engine.settings.pi.resolved();
  const after = engine.settings.pi.update({
    autoCompaction: patch.autoCompaction,
    autoRetry: patch.autoRetry,
    steeringMode: patch.steeringMode,
    followUpMode: patch.followUpMode,
    cacheWarming: patch.cacheWarming,
    favoriteRefs,
    builtins: patch.builtins,
  });
  for (const slot of [...engine.slots.values()]) await applyToSession(engine, slot, before, after);
  const builtinsChanged = BUILTIN_EXTENSIONS.some((b) => (before.builtins[b.id] !== false) !== (after.builtins[b.id] !== false));
  if (builtinsChanged) await engine.reload().catch(() => { /* a session that cannot rebuild is retried on the next reload */ });
  return toDto(after);
}

/** Bring one live session in line: re-read the file, then the setters that also update runtime state. */
async function applyToSession(engine: EngineContext, slot: Slot, before: ResolvedPiSettings, after: ResolvedPiSettings) {
  const s = slot.session;
  await s.settingsManager.reload();
  if (before.autoCompaction.enabled !== after.autoCompaction.enabled) s.setAutoCompactionEnabled(after.autoCompaction.enabled);
  if (before.autoRetry.enabled !== after.autoRetry.enabled) s.setAutoRetryEnabled(after.autoRetry.enabled);
  if (before.steeringMode !== after.steeringMode) s.setSteeringMode(after.steeringMode);
  if (before.followUpMode !== after.followUpMode) s.setFollowUpMode(after.followUpMode);
  if (before.cacheWarming !== after.cacheWarming) s.setCacheWarmingMode(after.cacheWarming);
  if (before.favoriteRefs.join("\n") !== after.favoriteRefs.join("\n")) s.setScopedModels(favoriteScope(engine));
}

/** Favourite models resolved for Pi's model cycling (`scopedModels`); unknown ones are skipped. */
export function favoriteScope(engine: EngineContext): Array<{ model: NonNullable<AgentSession["model"]> }> {
  return engine.settings.pi.resolved().favoriteRefs.flatMap((ref) => {
    const at = ref.indexOf("/");
    const model = at > 0 ? engine.providers.runtime.getModel(ref.slice(0, at), ref.slice(at + 1)) : undefined;
    return model ? [{ model }] : [];
  });
}

/** Ctrl/Cmd+P: the next favourite in this session, through Pi's `cycleModel` over `scopedModels`. */
export async function cycleModel(engine: EngineContext, id: string, direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult> {
  const slot = engine.slots.get(id);
  if (!slot) fail("session_not_loaded", "会话未加载");
  if (slot.busy) fail("session_busy", "请等待当前回复完成后再切换模型");
  const scope = favoriteScope(engine);
  if (!scope.length) return { changed: false, reason: "no_favorites", state: engine.modelState(id) as SessionModelState };
  slot.session.setScopedModels(scope);
  const result = await slot.session.cycleModel(direction);
  const state = engine.modelState(id) as SessionModelState;
  if (!result) return { changed: false, reason: "single_favorite", state };
  engine.emit("agent://model-state", state);
  return { changed: true, state };
}

/** Session spend (S4); `priced` once the model has prices or anything was billed. */
export function sessionCost(session: AgentSession): SessionCost {
  const total = session.getSessionStats().cost;
  const price = session.model?.cost;
  return { total, priced: total > 0 || !!price && (price.input > 0 || price.output > 0), currency: "USD" };
}
