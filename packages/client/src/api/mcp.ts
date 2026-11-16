// §5.3 `mcp` module: mcp_list / upsert / toggle / delete, mcp_config_read / save / path,
// mcp_test (pii W2.4), mcp_auth_trigger / status.
import type { McpAuthStatusEntry, McpAuthTriggerResult, McpConfigFile, McpServerEntry, McpTestResult, McpUpsertRequest } from "@openbuddy/protocol/dto";
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
