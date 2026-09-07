/**
 * host-modules/facade/agent-host-facade-builders.ts
 *
 * Phase 8.3 §52: 把 `buildAgentHostFacade({...})` 调用点的 inline 配置对象
 * (agent-host.ts:896-1038) 中需要 close-over state 的 inline lambda 抽出来.
 *
 * 拆分原则:
 *   - builder 是 0-coupling pure function, 不引用任何 agent-host 模块级 singleton
 *   - 所有需要 state 的 inline lambda 通过 DI 参数注入, 跟 host-modules/{mcp,session,plugin}
 *     等模块一致
 *   - 直接函数引用 (init, dispose, prompt, listPlugins, …) 仍然从 agent-host 顶层
 *     re-export, builder 只负责"inline lambda 集中化"——避免双重定义
 *
 * 域划分:
 *   session-facade    : 5 个 session 上下文 inline lambda
 *   remote-facade     : registerRemote / unregisterRemote (close over state.remoteDispatcher)
 *   mcp-facade        : 6 个 mcp 函数 (DI 注入 state, 内部委托给 mcp-runtime)
 *   renderer-facade   : discoverRendererPluginManifest (state-bound wrapper)
 *   tenant-facade     : bindCurrentSessionToTenant (DI 注入实函数)
 *
 * 设计参考: pi-web/lib/rpc-manager.ts 的 startRpcSession 风格, 但粒度更细
 * (一个域一个 builder, 而不是把所有 inline lambda 塞进一个对象).
 */

import * as piResources from "../../pi-resources";
import { serializeRemoteContribution } from "@openbuddy/plugin-host";
import { readPersistedSessionEntries } from "../session-store";
import { remoteServiceContext } from "../workbench-scope";
import { profileArtifactModuleUrl } from "../profile/resource-paths";
import {
  reloadMcp as reloadMcpImpl,
  runMcpAuthorization as runMcpAuthorizationImpl,
  authorizeMcp as authorizeMcpImpl,
  cancelMcpAuthorization as cancelMcpAuthorizationImpl,
  mcpStatus as mcpStatusImpl,
  mcpCapabilityGovernance as mcpCapabilityGovernanceImpl,
} from "../mcp-runtime";
import { discoverRendererPluginManifest as discoverRendererPluginManifestImpl } from "../profile/renderer-manifest";
import type { AgentHostState } from "../_state-shape";

// ---------------------------------------------------------------------------
// Session domain — 5 个 inline lambda (close over state)
// ---------------------------------------------------------------------------

export function buildSessionFacade(state: AgentHostState) {
  return {
    getContext: () => state.context,
    listAgentPresets: (cwd?: string | null) => piResources.listAgentPresets(cwd ?? state.cwd),
    currentAgentPreset: () => state.presetSessionRuntime?.id ?? null,
    listTools: () => state.toolRegistry.list().map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
    })),
    readSessionEntries: async (sessionId: string) => {
      if (state.session?.sessionId === sessionId) return state.session.sessionManager.getEntries();
      return readPersistedSessionEntries(sessionId);
    },
  };
}

// ---------------------------------------------------------------------------
// Remote domain — register / unregister (close over state.remoteDispatcher)
// ---------------------------------------------------------------------------

export function buildRemoteFacade(state: AgentHostState) {
  return {
    registerRemote: (contribution: unknown) =>
      state.remoteDispatcher.register(serializeRemoteContribution(contribution), remoteServiceContext()),
    unregisterRemote: (packageName: unknown) =>
      state.remoteDispatcher.unregister(packageName as string),
  };
}

// ---------------------------------------------------------------------------
// MCP domain — DI 注入 state, 内部委托给 host-modules/mcp-runtime
// ---------------------------------------------------------------------------

export function buildMcpFacade(state: AgentHostState) {
  return {
    reloadMcp: () => reloadMcpImpl(state),
    runMcpAuthorization: (serverName: string, signal?: AbortSignal) =>
      runMcpAuthorizationImpl(state, serverName, signal),
    authorizeMcp: (serverName: string, signal?: AbortSignal) =>
      authorizeMcpImpl(state, serverName, signal),
    cancelMcpAuthorization: (serverName: string) =>
      cancelMcpAuthorizationImpl(state, serverName),
    mcpStatus: () => mcpStatusImpl(state),
    mcpCapabilityGovernance: () => mcpCapabilityGovernanceImpl(state),
  };
}

// ---------------------------------------------------------------------------
// Renderer manifest domain — state-bound wrapper for discoverRendererPluginManifest
// ---------------------------------------------------------------------------

export function buildRendererManifestFacade(state: AgentHostState) {
  return {
    discoverRendererPluginManifest: async () =>
      discoverRendererPluginManifestImpl(state, profileArtifactModuleUrl),
  };
}

// ---------------------------------------------------------------------------
// Tenant binding — DI 注入实函数 (避免 builder 反向 import agent-host)
// ---------------------------------------------------------------------------

export type BindTenantFn = (tenantId?: string) => Promise<unknown> | unknown;

export function buildTenantFacade(_state: AgentHostState, bindCurrentSessionToTenant: BindTenantFn) {
  return {
    bindCurrentSessionToTenant: (tenantId?: string) => bindCurrentSessionToTenant(tenantId),
  };
}
