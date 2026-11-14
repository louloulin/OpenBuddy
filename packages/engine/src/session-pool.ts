import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import type { EngineContext } from "./engine-context.js";
import { READ_ONLY_TOOLS, validateThinkingLevel, type Slot, type ThinkingLevel } from "./types.js";

/** Create a live session for `manager` without touching any other session. */
export async function open(
  engine: EngineContext,
  manager: SessionManager,
  modelId?: string,
  providerId?: string,
  thinkingLevel?: ThinkingLevel,
): Promise<Slot> {
  const savedContext = manager.buildSessionContext();
  const model = modelId
    ? engine.providers.model(modelId, providerId)
    : savedContext.model
      ? engine.providers.model(
          savedContext.model.modelId,
          savedContext.model.provider,
        )
      : engine.providers.model();
  if (!model) throw Error("model_not_found: 请先配置提供商和模型");
  if (!engine.providers.runtime.hasConfiguredAuth(model.provider))
    throw Error("model_auth_missing: 模型提供商尚未认证");
  const config = engine.settings.config.read();
  const requestedThinking =
    thinkingLevel ??
    (manager.getEntries().some((e) => e.type === "thinking_level_change")
      ? validateThinkingLevel(savedContext.thinkingLevel)
      : config.defaults.defaultThinkingLevel
        ? validateThinkingLevel(config.defaults.defaultThinkingLevel)
        : undefined);
  const cwd = manager.getCwd();
  const trusted = engine.trusted(cwd);
  if (!trusted && config.folderTrustDecisions?.[cwd] === undefined)
    engine.emit("agent://folder-trust", { cwd });
  const sdkSettings = SettingsManager.inMemory({}, { projectTrusted: trusted });
  const sessionId = manager.getSessionId();
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: engine.settings.dir,
    settingsManager: sdkSettings,
    noExtensions: !(config.extensionsEnabled && trusted),
    additionalExtensionPaths: config.extensionsEnabled
      ? (config.extensionPaths ?? [])
      : [],
    noContextFiles: !trusted,
    noPromptTemplates: true,
    noThemes: true,
    noSkills: true,
    skillsOverride: () => ({
      skills: engine.skills.active(cwd),
      diagnostics: [],
    }),
    extensionFactories: [
      engine.permissions.extension(sessionId),
      // After the permission gate: only calls that may run get a snapshot.
      engine.checkpoints.extension(sessionId, () => cwd),
      engine.mcp.extension(),
      ...engine.extensionFactories,
    ],
  });
  await loader.reload();
  const errors = loader.getExtensions().errors;
  if (errors.length)
    throw Error(
      `extension_load_failed: ${errors.map((e) => `${e.path}: ${e.error}`).join("; ")}`,
    );
  const { session } = await createAgentSession({
    cwd,
    agentDir: engine.settings.dir,
    modelRuntime: engine.providers.runtime,
    sessionManager: manager,
    resourceLoader: loader,
    settingsManager: sdkSettings,
    model,
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "mcp__*"],
    thinkingLevel: requestedThinking,
  });
  const defaultTools = session.getActiveToolNames();
  const mode = engine.modes.get(session.sessionId) ?? "craft";
  if (mode !== "craft") session.setActiveToolsByName(defaultTools.filter((name) => READ_ONLY_TOOLS.includes(name)));
  const slot: Slot = {
    defaultTools,
    id: session.sessionId,
    session,
    unsubscribe: () => {},
    busy: false,
    generation: 0,
    cancelledGeneration: -1,
    stale: false,
    lastActive: Date.now(),
    failed: false,
  };
  slot.unsubscribe = session.subscribe((event) => engine.onEvent(slot, event));
  try {
    await session.bindExtensions({
      mode: "rpc",
      uiContext: engine.ui.context(slot.id),
      onError: (error) => {
        if (error.event === "command" && engine.slots.get(slot.id) === slot && slot.busy)
          slot.commandError = error.error;
        else engine.emit("agent://error", { sessionId: slot.id, message: error.error });
      },
    });
  } catch (error) {
    slot.unsubscribe();
    session.dispose();
    throw error;
  }
  engine.slots.set(slot.id, slot);
  engine.invalidateList();
  engine.emit("agent://model-state", engine.modelState(slot.id));
  await engine.evictOverflow(slot.id);
  return slot;
}
export function focus(engine: EngineContext, id: string) {
  engine.focusedId = id;
  const slot = engine.slots.get(id);
  if (slot) slot.lastActive = Date.now();
}
export async function newSession(
  engine: EngineContext,
  cwd: string,
  modelId?: string,
  providerId?: string,
  thinkingLevel?: ThinkingLevel,
) {
  const actual = await engine.validCwd(cwd);
  const slot = await engine.open(
    SessionManager.create(actual, engine.sessionDir),
    modelId,
    providerId,
    thinkingLevel,
  );
  engine.focus(slot.id);
  return slot.id;
}
/** Sessions currently running a turn (the renderer's 任务 view of background work). */
export function running(engine: EngineContext) {
  const meta = engine.settings.config.read().sessions;
  return [...engine.slots.values()]
    .filter((slot) => slot.busy)
    .map((slot) => ({
      taskId: slot.id,
      sessionId: slot.id,
      cwd: slot.session.sessionManager.getCwd(),
      title: meta[slot.id]?.title ?? slot.session.sessionName ?? "新任务",
      status: "running",
    }));
}
/** Workspaces the preview protocol may serve: live session folders and the inbox. */
export function previewRoots(engine: EngineContext): string[] {
  return [engine.inbox, ...[...engine.slots.values()].map((s) => s.session.sessionManager.getCwd())];
}
/** Close one live session; its persisted history stays on disk. */
export async function close(engine: EngineContext, id: string) {
  const slot = engine.slots.get(id);
  if (!slot) return;
  engine.slots.delete(id);
  if (engine.focusedId === id) engine.focusedId = undefined;
  slot.generation++;
  engine.ui.cancel(id, "session_closed");
  engine.mcp.auth.cancel(id);
  engine.permissions.cancel(id);
  try {
    await slot.session.abort();
    await slot.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  } finally {
    engine.flushDelta(slot);
    slot.unsubscribe();
    slot.session.dispose();
    engine.invalidateList();
  }
}
export async function shutdown(engine: EngineContext) {
  clearInterval(engine.evictTimer);
  engine.evictTimer = undefined;
  engine.lost = [];
  engine.ui.cancel(undefined, "session_closed");
  engine.mcp.auth.cancel();
  await engine.mcp.auth.settle();
  engine.permissions.cancel();
  for (const id of [...engine.slots.keys()]) await engine.close(id);
}
/** Close idle sessions over the live limit (least recently used first). */
export async function evictOverflow(engine: EngineContext, keep: string) {
  const candidates = [...engine.slots.values()]
    .filter((s) => s.id !== keep && s.id !== engine.focusedId && !s.busy && !engine.permissions.hasPending(s.id) && !engine.ui.hasPending(s.id))
    .sort((a, b) => a.lastActive - b.lastActive);
  while (engine.slots.size > engine.limits.maxLive && candidates.length)
    await engine.close(candidates.shift()!.id);
}
export async function evictIdle(engine: EngineContext, now = Date.now()) {
  for (const slot of [...engine.slots.values()])
    if (
      slot.id !== engine.focusedId &&
      !slot.busy &&
      !engine.permissions.hasPending(slot.id) &&
      !engine.ui.hasPending(slot.id) &&
      now - slot.lastActive > engine.limits.idleMs
    )
      await engine.close(slot.id);
}
/** Rebuild live sessions after a configuration change; busy ones rebuild when settled. */
export async function reload(engine: EngineContext, filter: (slot: Slot) => boolean = () => true) {
  let failure: unknown;
  // Reopen sessions an earlier failed rebuild dropped (the config may have been rolled back since).
  for (const entry of engine.lost.splice(0)) {
    if (engine.slots.has(entry.id)) continue;
    try {
      const next = await engine.open(entry.manager);
      if (entry.focused) engine.focus(next.id);
    } catch (error) {
      engine.lost.push(entry);
      failure ??= error;
    }
  }
  for (const slot of [...engine.slots.values()].filter(filter)) {
    if (slot.busy) {
      slot.stale = true;
      continue;
    }
    try {
      await engine.rebuild(slot);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}
export async function rebuild(engine: EngineContext, slot: Slot) {
  if (engine.slots.get(slot.id) !== slot) return;
  const focused = engine.focusedId === slot.id;
  const file = slot.session.sessionManager.getSessionFile();
  const manager =
    file && existsSync(file)
      ? SessionManager.open(file, engine.sessionDir)
      : slot.session.sessionManager;
  await engine.close(slot.id);
  let next: Slot;
  try {
    next = await engine.open(manager);
  } catch (error) {
    engine.lost.push({ id: slot.id, manager, focused });
    throw error;
  }
  if (next.id !== slot.id) throw Error("会话重载身份发生变化");
  if (focused) engine.focus(next.id);
}
