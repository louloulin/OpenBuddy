import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EngineContext } from "./engine-context.js";
import { validateThinkingLevel, type Slot, type ThinkingLevel } from "./types.js";
import { builtinFactories, builtinToolNames, reserveBuiltinToolNames } from "./builtin/index.js";
import { readPromptTemplatesSync } from "./builtin/prompts-sync.js";
import { restoreMode } from "./features/mode.js";
import { favoriteScope } from "./features/agent-settings.js";

/** Create a live session for `manager` without touching any other session. */
export async function open(
  engine: EngineContext,
  manager: SessionManager,
  modelId?: string,
  providerId?: string,
  thinkingLevel?: ThinkingLevel,
  /** 子代理 (W3.4): tag the slot from the very first event, so it never becomes a sidebar row. */
  subagent?: { parentId: string; agentName?: string },
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
  // Persisted Pi settings (pi-settings.json, 20261116-pii W0.4); project settings still need trust.
  const sdkSettings = engine.settings.pi.manager(trusted);
  const sessionId = manager.getSessionId();
  const builtinEnabled = (id: string) => engine.settings.pi.builtinEnabled(id);
  // 项目说明 (W5.4): a project bound to this cwd appends its instructions to the system prompt.
  // Read at session open; edits apply to the next open (the live session keeps its prompt).
  const projectPrompt = engine.projects.instructionsFor(cwd);
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: engine.settings.dir,
    settingsManager: sdkSettings,
    ...(projectPrompt ? { appendSystemPrompt: [projectPrompt] } : {}),
    noExtensions: !(config.extensionsEnabled && trusted),
    additionalExtensionPaths: config.extensionsEnabled
      ? (config.extensionPaths ?? []).filter((p) => !(config.extensionDisabled ?? []).includes(p))
      : [],
    noContextFiles: !trusted,
    // 我的指令 (pii W2.7 / S8): the loader's own scan is replaced by the PromptsService view, so
    // the `/` menu sees exactly the global + trusted-project templates the settings panel edits.
    // The override is synchronous (Pi calls it during reload), so read the files with node:fs.
    noPromptTemplates: true,
    promptsOverride: () => ({
      prompts: readPromptTemplatesSync([
        { dir: join(engine.settings.dir, "prompts"), scope: "global" },
        ...(trusted ? [{ dir: join(cwd, ".pi", "prompts"), scope: "workspace" as const }] : []),
      ]),
      diagnostics: [],
    }),
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
      // Built-in extensions (20261116-pii W0.5): app code, before user extensions.
      ...builtinFactories({ engine, sessionId, cwd }, builtinEnabled),
      ...engine.extensionFactories,
    ],
    // `ob_*` tool names are the built-ins' own: extensions from disk can neither take nor shadow them.
    extensionsOverride: reserveBuiltinToolNames,
  });
  await loader.reload();
  // Pi keeps a process-wide extension-module cache and only clears it when a *loaded* loader reloads.
  // A config change (added / removed / toggled path) must pick up new file contents, so reload once
  // more to invalidate that cache (W2.6).
  if (engine.extensionsDirty) {
    engine.extensionsDirty = false;
    await loader.reload();
  }
  // 扩展中心 (W2.6): a broken extension is skipped and recorded per path — it must not fail the whole
  // session, and 扩展 needs to name the offending path.
  engine.extensionErrors = loader.getExtensions().errors.slice();
  for (const entry of engine.extensionErrors)
    engine.emit("agent://error", { message: `扩展加载失败：${entry.path}: ${entry.error}` });
  const { session } = await createAgentSession({
    cwd,
    agentDir: engine.settings.dir,
    modelRuntime: engine.providers.runtime,
    sessionManager: manager,
    resourceLoader: loader,
    settingsManager: sdkSettings,
    model,
    // The enabled built-ins' tools by name (not `ob_*`): a switched-off built-in's name stays unused.
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "mcp__*", ...builtinToolNames(builtinEnabled)],
    thinkingLevel: requestedThinking,
    // Favourite models, cycled with Ctrl/Cmd+P (W1.6).
    scopedModels: favoriteScope(engine),
  });
  const defaultTools = session.getActiveToolNames();
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
    ...(subagent ? { parentId: subagent.parentId, agentName: subagent.agentName, subagent: true } : {}),
  };
  // 做一做 / 想一想 / 问一问 of the branch being opened (W0.5; in-memory when the built-in is off).
  restoreMode(engine, slot);
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
  /** 自动化 (W4.2): a background run must not steal focus from the session the user is reading. */
  background = false,
) {
  const actual = await engine.validCwd(cwd);
  const slot = await engine.open(
    SessionManager.create(actual, engine.sessionDir),
    modelId,
    providerId,
    thinkingLevel,
  );
  if (!background) engine.focus(slot.id);
  return slot.id;
}
/**
 * Sessions currently running work (the renderer's 运行中 view, pii W4.5). A background
 * automation is tagged with its task; sub-agents (W3.4) run inside the parent turn but are
 * listed as their own row so the panel can show and stop them. `pending` counts approval cards
 * waiting on this session; `startedAt` drives 用时.
 */
export function running(engine: EngineContext) {
  const meta = engine.settings.config.read().sessions;
  return [...engine.slots.values()]
    .filter((slot) => slot.busy || slot.userBash)
    .map((slot) => {
      const title = meta[slot.id]?.title ?? slot.session.sessionName ?? "新任务";
      return {
        id: slot.id,
        sessionId: slot.id,
        cwd: slot.session.sessionManager.getCwd(),
        title,
        kind: slot.automation ? "automation" : slot.subagent ? "subagent" : slot.userBash && !slot.busy ? "bash" : "task",
        description: slot.automation?.name ?? slot.agentName ?? title,
        status: slot.userBash && !slot.busy ? "running-bash" : "running",
        startedAt: slot.busySince ?? slot.lastActive,
        pending: engine.permissions.countPending(slot.id) + (engine.ui.hasPending(slot.id) ? 1 : 0),
        ...(slot.parentId ? { parentId: slot.parentId } : {}),
      };
    })
    .sort((a, b) => a.startedAt - b.startedAt);
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
/** Running a turn, or a `!command` (W1.2): such a slot is never evicted, and its rebuild waits. */
const occupied = (slot: Slot) => slot.busy || slot.userBash === true;
/** Close idle sessions over the live limit (least recently used first). */
export async function evictOverflow(engine: EngineContext, keep: string) {
  const candidates = [...engine.slots.values()]
    // 子代理 (W3.4) are owned by their parent: the parent closes them, the pool never evicts them.
    .filter((s) => !s.subagent && s.id !== keep && s.id !== engine.focusedId && !occupied(s) && !engine.permissions.hasPending(s.id) && !engine.ui.hasPending(s.id))
    .sort((a, b) => a.lastActive - b.lastActive);
  while (engine.slots.size > engine.limits.maxLive && candidates.length)
    await engine.close(candidates.shift()!.id);
}
export async function evictIdle(engine: EngineContext, now = Date.now()) {
  for (const slot of [...engine.slots.values()])
    if (
      !slot.subagent &&
      slot.id !== engine.focusedId &&
      !occupied(slot) &&
      !engine.permissions.hasPending(slot.id) &&
      !engine.ui.hasPending(slot.id) &&
      now - slot.lastActive > engine.limits.idleMs
    )
      await engine.close(slot.id);
}
/** Rebuild live sessions after a configuration change; busy ones (or ones running a `!command`) rebuild when settled. */
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
    if (occupied(slot)) {
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
  // Closing would abort the turn or the `!command`; whichever ends last rebuilds.
  if (occupied(slot)) {
    slot.stale = true;
    return;
  }
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
