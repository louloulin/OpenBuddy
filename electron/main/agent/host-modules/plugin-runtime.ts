/**
 * host-modules/plugin-runtime.ts — plugin runtime READ surface (D3 subset).
 *
 * Phase 8.3 Batch D3: 从 agent-host.ts 抽出 plugin runtime IPC 的 **read**
 * 路径 (4 个函数, ~25 行):
 *   - getStoredPluginState (line 4652) — state.pluginState.read()
 *   - listRendererPluginEntries (line 4804) — discoverRendererPluginManifest()
 *   - rendererPluginBootGraph (line 4808) — composeRendererPluginBootGraph()
 *   - resolveRendererPluginModule (line 4812) — manifest lookup w/ retry
 *
 * Phase 8.3 Architectural Refactor — DI:
 *   - 修复前: `import { state, discoverRendererPluginManifest } from "../agent-host"` (reverse dep)
 *   - 修复后: 所有函数接受 `state: AgentHostState` + `discoverRendererPluginManifest` 作为参数.
 *     本模块零 agent-host 导入.
 *
 * 设计:
 *   - 纯函数, DI: state 和 discoverRendererPluginManifest 由调用方注入.
 *   - 由于模块不再 import state, 测试时可构造空 state 对象传入, 不需要 mock agent-host.
 *   - 调用方 (agent-host.ts) 仍然持有 state 单例, 在 export 0-arg wrapper 时注入.
 */

import {
  composeRendererPluginBootGraph,
  type RendererPluginBootGraph,
  type RendererPluginManifestEntry,
} from "@openbuddy/plugin-host";

import { type AgentHostState } from "./_state-shape";

/**
 * Discover all renderer-plugin manifest entries, with stale-cache retry.
 * Mirrors agent-host.ts:discoverRendererPluginManifest signature.
 */
export type DiscoverRendererPluginManifest = () => Promise<RendererPluginManifestEntry[]>;

export async function getStoredPluginState(state: AgentHostState) {
  if (!state.pluginState) throw new Error("openbuddy-agent: plugin state store not initialized");
  return state.pluginState.read();
}

export async function listRendererPluginEntries(
  state: AgentHostState,
  discoverRendererPluginManifest: DiscoverRendererPluginManifest,
): Promise<RendererPluginManifestEntry[]> {
  return (await discoverRendererPluginManifest()).map(({ moduleUrl: _moduleUrl, ...entry }) => entry);
}

export async function rendererPluginBootGraph(
  state: AgentHostState,
  discoverRendererPluginManifest: DiscoverRendererPluginManifest,
): Promise<RendererPluginBootGraph> {
  return composeRendererPluginBootGraph(await discoverRendererPluginManifest());
}

export async function resolveRendererPluginModule(
  state: AgentHostState,
  moduleKey: string,
  discoverRendererPluginManifest: DiscoverRendererPluginManifest,
): Promise<string> {
  let entry = (await discoverRendererPluginManifest()).find((candidate) => candidate.moduleKey === moduleKey);
  if (!entry) {
    await state.profileReloadPromise.catch(() => undefined);
    entry = (await discoverRendererPluginManifest()).find((candidate) => candidate.moduleKey === moduleKey);
  }
  if (!entry?.moduleUrl) throw new Error(`openbuddy-renderer: unknown module key ${moduleKey}`);
  const url = new URL(entry.moduleUrl);
  if (url.protocol !== "file:") throw new Error(`openbuddy-renderer: unsupported module URL protocol ${url.protocol}`);
  return url.pathname;
}
