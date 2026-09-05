/**
 * host-modules/mcp-runtime.ts — MCP reload + authorization + status surface.
 *
 * Phase 8.3 Batch A: 从 agent-host.ts 抽出 line 4977-5032。
 *
 * Phase 8.3 Architectural Refactor — DI:
 *   - 修复前: `import { state } from "../agent-host"` (reverse dep)
 *   - 修复后: 所有函数接受 `state: AgentHostState` 参数, 零 agent-host 依赖.
 *
 * 设计:
 *   - 纯函数, 接受 state 作为参数 (DI). 调用方 (agent-host.ts) 持有 state
 *     并显式传入.
 *   - 由于模块不再 import state, 测试时可构造空 state 对象传入, 不需要
 *     mock agent-host.
 *   - 所有函数保持原签名 + 增加 state 参数 (向后兼容: agent-host.ts 是
 *     唯一调用方, 我们更新它即可).
 */

import { shell } from "electron";

import { authorizeMcpServer } from "../../mcp-authorization";
import { projectMcpCapabilityGovernance } from "../../mcp-capability-governance";
import * as piResources from "../pi-resources";
import { type AgentHostState } from "./_state-shape";

export async function reloadMcp(state: AgentHostState): Promise<void> {
  const service = state.context?.get("mcpClient") as { reload?: () => Promise<void> } | undefined;
  await service?.reload?.();
}

export async function runMcpAuthorization(
  state: AgentHostState,
  serverName: string,
  signal?: AbortSignal,
): Promise<{ status: "authenticated" } | { status: "setup_required" | "cancelled" | "failed"; error: string }> {
  const config = await piResources.mcpConfigRead(state.cwd);
  const server = config.mcpServers?.[serverName];
  if (!server) return { status: "failed", error: `MCP server not found: ${serverName}` };
  if (await piResources.mcpAuthCredential(serverName, state.cwd)) {
    await piResources.mcpAuthMark(serverName, "authenticated");
    await reloadMcp(state);
    return { status: "authenticated" };
  }
  const result = await authorizeMcpServer(server, { openExternal: (url) => shell.openExternal(url), signal });
  if (result.status !== "authenticated") {
    await piResources.mcpAuthMark(serverName, result.status === "cancelled" ? "pending" : "failed", result.error);
    return { status: result.status, error: result.error };
  }
  await piResources.mcpAuthStoreCredential(serverName, result);
  await reloadMcp(state);
  return { status: "authenticated" };
}

export async function authorizeMcp(
  state: AgentHostState,
  serverName: string,
  signal?: AbortSignal,
): Promise<{ status: "authenticated" } | { status: "setup_required" | "cancelled" | "failed"; error: string }> {
  const service = state.context?.get("mcpClient") as {
    authorize?: (name: string, signal?: AbortSignal) => Promise<{ status: "authenticated" } | { status: "setup_required" | "cancelled" | "failed"; error: string }>;
  } | undefined;
  if (!service?.authorize) return { status: "failed", error: "MCP client service is unavailable" };
  return service.authorize(serverName, signal);
}

export function cancelMcpAuthorization(state: AgentHostState, serverName: string): boolean {
  const authorization = state.context?.get("authorization") as { cancel?: (key: string) => boolean } | undefined;
  return authorization?.cancel?.(`mcp/${serverName}`) ?? false;
}

export function mcpStatus(state: AgentHostState): Array<{ serverName: string; status: string; toolCount: number; emailProfile?: string; error?: string }> {
  const service = state.context?.get("mcpClient") as { list?: () => Array<{ serverName: string; status: string; toolCount: number; emailProfile?: string; error?: string }> } | undefined;
  return service?.list?.() ?? [];
}

export function mcpCapabilityGovernance(state: AgentHostState): Array<{
  serverName: string;
  toolName: string;
  providerId: string;
  roomId: string;
  dataScopes: string[];
  allowedActions: string[];
  approval: "before_external_commit";
  status: string;
}> {
  const service = state.context?.get("mcpClient") as {
    list?: () => Array<{ serverName: string; status: string }>;
    listToolNames?: (serverName: string) => string[];
  } | undefined;
  return projectMcpCapabilityGovernance(service?.list?.() ?? [], (serverName) => service?.listToolNames?.(serverName) ?? []);
}
