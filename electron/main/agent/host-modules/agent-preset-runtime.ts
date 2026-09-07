/**
 * host-modules/agent-preset-runtime.ts — agent-preset 域 (mount + select).
 *
 * Phase 8.3 Batch D-15: 提取 agent-host.ts 中的两个 agent-preset 函数
 *   - `mountConfiguredAgentPreset` (~39 行, agent-host.ts:1285-1323)
 *   - `selectAgentPreset` (~52 行, agent-host.ts:1325-1376)
 *
 * 这两个函数围绕 "agent preset" 这一概念:
 *   - mount: 启动时按 agent-presets.json 默认值挂载 preset (如果有)
 *   - select: 用户在 session 启动前切换 preset
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 InstallAgentPresetRuntimeDeps 参数注入
 *
 * 设计: 沿用 module-level singleton + install pattern.
 */

import type { Context } from "@openbuddy/cordis";
import { type AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

let emitPluginEventImpl: (type: string, payload: unknown) => void = () => undefined;
let listAgentPresetsImpl: (cwd: string) => Promise<any[]> = async () => [];
let readAgentPresetDefaultsImpl: () => Promise<{ default?: string } | undefined> = async () => undefined;
let writeAgentPresetDefaultImpl: (defaultId?: string) => Promise<void> = async () => undefined;
let readAgentPresetImpl: (presetId: string, cwd: string) => Promise<string> = async () => "";
let createPresetSessionRuntimeImpl: (opts: any) => any = () => undefined;
let pluginLifecycleQueueImpl: { enqueue: <T>(kind: string, target: string, op: (tx: any) => Promise<T>) => Promise<T> } | null = null;
let sessionHasConversationImpl: (entries: any[]) => boolean = () => false;
let piRuntimeCoordinatorReloadImpl: (reason: string) => Promise<void> = async () => undefined;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallAgentPresetRuntimeDeps {
  state: AgentHostState;
  emitPluginEvent: (type: string, payload: unknown) => void;
  listAgentPresets: (cwd: string) => Promise<any[]>;
  readAgentPresetDefaults: () => Promise<{ default?: string } | undefined>;
  writeAgentPresetDefault: (defaultId?: string) => Promise<void>;
  readAgentPreset: (presetId: string, cwd: string) => Promise<string>;
  /** PresetSessionRuntime constructor (allow test stub) */
  createPresetSessionRuntime: (opts: any) => any;
  pluginLifecycleQueue: {
    enqueue: <T>(kind: string, target: string, op: (tx: any) => Promise<T>) => Promise<T>;
  };
  sessionHasConversation: (entries: any[]) => boolean;
  piRuntimeCoordinatorReload: (reason: string) => Promise<void>;
}

/**
 * 一次性 install 所有 agent-preset-runtime 依赖.
 */
export function installAgentPresetRuntime(deps: InstallAgentPresetRuntimeDeps): void {
  if (deps.state) state = deps.state;
  if (deps.emitPluginEvent) emitPluginEventImpl = deps.emitPluginEvent;
  if (deps.listAgentPresets) listAgentPresetsImpl = deps.listAgentPresets;
  if (deps.readAgentPresetDefaults) readAgentPresetDefaultsImpl = deps.readAgentPresetDefaults;
  if (deps.writeAgentPresetDefault) writeAgentPresetDefaultImpl = deps.writeAgentPresetDefault;
  if (deps.readAgentPreset) readAgentPresetImpl = deps.readAgentPreset;
  if (deps.createPresetSessionRuntime) createPresetSessionRuntimeImpl = deps.createPresetSessionRuntime;
  if (deps.pluginLifecycleQueue) pluginLifecycleQueueImpl = deps.pluginLifecycleQueue;
  if (deps.sessionHasConversation) sessionHasConversationImpl = deps.sessionHasConversation;
  if (deps.piRuntimeCoordinatorReload) piRuntimeCoordinatorReloadImpl = deps.piRuntimeCoordinatorReload;
}

/** 测试/调试用: 重置模块级单例. */
export function __resetAgentPresetRuntimeForTest(): void {
  state = null;
  emitPluginEventImpl = () => undefined;
  listAgentPresetsImpl = async () => [];
  readAgentPresetDefaultsImpl = async () => undefined;
  writeAgentPresetDefaultImpl = async () => undefined;
  readAgentPresetImpl = async () => "";
  createPresetSessionRuntimeImpl = () => undefined;
  pluginLifecycleQueueImpl = null;
  sessionHasConversationImpl = () => false;
  piRuntimeCoordinatorReloadImpl = async () => undefined;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 在 initialize() 中按 agent-presets.json 的默认 preset 挂载到 host.
 *
 * 行为:
 *   - 如果没有 default preset, 返回 null (silent skip)
 *   - 如果 default preset 文件不存在或 broken, log warn + 清空 stale default + 返回 null
 *   - 否则创建 PresetSessionRuntime, mount 到 host, 返回 preset id
 */
export async function mountConfiguredAgentPreset(
  cwd: string,
  hostContext: Context,
  hostLoader: any,
  selectedId?: string | null,
): Promise<string | null> {
  if (!state) throw new Error("agent-preset-runtime: not installed");

  const configured = selectedId === undefined ? await readAgentPresetDefaultsImpl() : undefined;
  const presetId = selectedId === undefined ? configured?.default?.trim() : selectedId;
  if (!presetId) return null;

  const preset = (await listAgentPresetsImpl(cwd)).find((entry: any) => entry.id === presetId);
  // The configured preset id may be stale (preset deleted, renamed, or set
  // by an old user action). Surfacing this as a fatal error would block
  // every `agent:init`/`agent:new-session` call until the user manually
  // clears `agent-presets.json`. Treat it as a recoverable warning, drop the
  // stale default, and let the rest of init proceed so the agent host stays
  // usable. The same applies to presets whose source file is broken: log it,
  // clear the default, and continue without the preset runtime.
  if (!preset) {
    console.warn(`[openbuddy-agent] configured preset "${presetId}" was not found; clearing stale default`);
    await writeAgentPresetDefaultImpl(undefined).catch(() => undefined);
    return null;
  }
  if (preset.broken) {
    console.warn(`[openbuddy-agent] configured preset "${presetId}" is broken: ${preset.broken}; clearing stale default`);
    await writeAgentPresetDefaultImpl(undefined).catch(() => undefined);
    return null;
  }

  const source = await readAgentPresetImpl(presetId, cwd);
  const runtime = createPresetSessionRuntimeImpl({
    hostContext,
    hostLoader,
    toolRegistry: state.toolRegistry,
    cwd,
  });
  try {
    await runtime.mount({ id: presetId, source, path: preset.path });
    state.presetSessionRuntime = runtime;
    emitPluginEventImpl("agent-preset/selected", { id: presetId, path: preset.path });
    return presetId;
  } catch (error) {
    await runtime.dispose().catch(() => undefined);
    throw error;
  }
}

/**
 * 用户主动切换 agent preset (仅在第一个 conversation turn 之前允许).
 *
 * 行为:
 *   - 把当前 PresetSessionRuntime 替换为新的
 *   - reload pi runtime 让新 preset 生效
 *   - 失败时回滚到 previous preset + reload "agent-preset-rollback"
 */
export async function selectAgentPreset(id: string): Promise<{ id: string; path: string }> {
  if (!state) throw new Error("agent-preset-runtime: not installed");
  if (!pluginLifecycleQueueImpl) throw new Error("agent-preset-runtime: queue not installed");

  const requestedId = id.trim();
  if (!requestedId) throw new Error("agent-presets: preset id must be non-empty");
  return pluginLifecycleQueueImpl.enqueue("plugin-reload", `agent-preset:${requestedId}`, async (transaction) => {
    const session = state!.session;
    const hostContext = state!.context;
    const hostLoader = state!.loader;
    const cwd = state!.cwd;
    if (!session || !hostContext || !hostLoader || !cwd) {
      throw new Error("agent-presets: Pi session is not initialized");
    }

    // Fast-path: already mounted this preset — return its path without re-mounting.
    if (state!.presetSessionRuntime?.id === requestedId) {
      const current = (await listAgentPresetsImpl(cwd)).find((entry: any) => entry.id === requestedId);
      if (!current) throw new Error(`agent-presets: preset "${requestedId}" was not found`);
      return { id: requestedId, path: current.path };
    }

    if (sessionHasConversationImpl(session.sessionManager.getEntries())) {
      throw new Error("agent-presets: preset selection is only allowed before the first conversation turn");
    }
    const preset = (await listAgentPresetsImpl(cwd)).find((entry: any) => entry.id === requestedId);
    if (!preset) throw new Error(`agent-presets: preset "${requestedId}" was not found`);
    if (preset.broken) throw new Error(`agent-presets: preset "${requestedId}" is broken: ${preset.broken}`);
    const source = await readAgentPresetImpl(requestedId, cwd);
    const previous = state!.presetSessionRuntime;
    const candidate = createPresetSessionRuntimeImpl({
      hostContext,
      hostLoader,
      toolRegistry: state!.toolRegistry,
      cwd,
    });

    transaction.phase("prepare", "agent-preset");
    await session.waitForIdle();
    await candidate.mount({ id: requestedId, source, path: preset.path });
    state!.presetSessionRuntime = candidate;
    try {
      transaction.phase("pi", "agent-preset");
      await piRuntimeCoordinatorReloadImpl("agent-preset-switch");
      session.sessionManager.appendCustomEntry("agent-preset/selected", { agentPreset: requestedId, version: 1 });
      await previous?.dispose();
      emitPluginEventImpl("agent-preset/selected", { id: requestedId, path: preset.path });
      return { id: requestedId, path: preset.path };
    } catch (error) {
      state!.presetSessionRuntime = previous;
      await candidate.dispose().catch(() => undefined);
      try {
        transaction.phase("rollback", "agent-preset");
        await piRuntimeCoordinatorReloadImpl("agent-preset-rollback");
      } catch (rollbackError) {
        console.warn("[openbuddy] failed to reload previous agent preset after switch failure", rollbackError);
      }
      throw new Error(
        `agent-presets: failed to select "${requestedId}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });
}
