// §5.3 `mcp` module: mcp_list / upsert / toggle / delete, mcp_config_read / save / path,
// mcp_test (pii W2.4), mcp_auth_trigger / status.
import type { ConnectorCatalog, McpAuthStatusEntry, McpAuthTriggerResult, McpConfigFile, McpServerEntry, McpTestResult, McpUpsertRequest, SessionMcpState } from "@openbuddy/protocol/dto";
import { invoke } from "../ipc";

/** 测试连接 (W2.4): connect once, list the tools, close; returns the duration or the error. */
export async function mcpTest(name: string): Promise<McpTestResult> {
  return invoke<McpTestResult>("mcp_test", { name });
}

// ---------- connectors / MCP (x.ai/mcp
export async function mcpList(sessionId?: string): Promise<McpServerEntry[]> {
  return invoke<McpServerEntry[]>("mcp_list", { sessionId: sessionId ?? null });
}


export async function mcpUpsert(sessionId: string, server: McpUpsertRequest): Promise<void> {
  await invoke<void>("mcp_upsert", { sessionId, server });
}

/** Delete an MCP server by name. */
export async function mcpDelete(sessionId: string, name: string): Promise<void> {
  await invoke<void>("mcp_delete", { sessionId, name });
}

/** Enable or disable an MCP server at runtime. */
export async function mcpToggle(sessionId: string, name: string, enabled: boolean): Promise<void> {
  await invoke<void>("mcp_toggle", { sessionId, name, enabled });
}

/** Resolved absolute path of the standalone mcp.json (for the editor header). */
export async function mcpConfigPath(): Promise<string> {
  return invoke<string>("mcp_config_path");
}

/** Read the standalone mcp.json (returns an empty template if missing). */
export async function mcpConfigRead(): Promise<McpConfigFile> {
  return invoke<McpConfigFile>("mcp_config_read");
}


export async function mcpConfigSave(content: string, sessionId?: string): Promise<void> {
  await invoke<void>("mcp_config_save", { content, sessionId: sessionId ?? null });
}

// ---------- MCP OAuth authorization (x.ai/mcp/auth_*) ----------


export async function mcpAuthTrigger(
  sessionId: string,
  serverName: string,
): Promise<McpAuthTriggerResult> {
  return invoke<McpAuthTriggerResult>("mcp_auth_trigger", { sessionId, serverName });
}


export async function mcpAuthStatus(sessionId: string): Promise<McpAuthStatusEntry[]> {
  return invoke<McpAuthStatusEntry[]>("mcp_auth_status", { sessionId });
}

// ---------- 延迟暴露 (W2.4 P2 / S11) ----------

/** Whether any configured server defers its tools behind the built-in `tool_search`. */
export const mcpDeferredGet = () => invoke<{ deferred: boolean }>("mcp_deferred_get", {});

/** Switch every server between direct and deferred exposure; live sessions reload in place. */
export const mcpDeferredSet = (deferred: boolean) => invoke<{ deferred: boolean }>("mcp_deferred_set", { deferred });

// ---------- 连接器目录 (pii W2.4 P2) ----------

/** Built-in catalog root (sentinel; the service ignores external directories). */
export const connectorsDefaultRoot = () => invoke<string>("connectors_default_root");
export const connectorsListRoots = (root: string) => invoke<string[]>("connectors_list_roots", { root });
export const connectorsLoad = (root?: string) => invoke<ConnectorCatalog>("connectors_load", { root: root ?? null });
export const connectorsReadMcpConfig = (root: string, source: string) => invoke<string>("connectors_read_mcp_config", { root, source });
export const connectorsIcon = (path: string) => invoke<string>("connectors_icon", { path });

// ---------- 本任务连接器开关 (pii W2.4 P2) ----------

export const sessionMcpGet = (sessionId: string) => invoke<SessionMcpState>("session_mcp_get", { sessionId });
export const sessionMcpSet = (sessionId: string, name: string, enabled: boolean) =>
  invoke<SessionMcpState>("session_mcp_set", { sessionId, name, enabled });
