/**
 * MCP 测试连接 (pii W2.4). Kept out of `dto.ts` so that file stays within its size ceiling; the
 * type is re-exported from `dto.ts` for existing importers.
 */

/** 测试连接: one real connect + tool listing, or the error and how long it took. */
export interface McpTestResult {
  name: string;
  ok: boolean;
  /** Milliseconds from connect start to tools listed (or to the failure). */
  ms: number;
  transport: "stdio" | "streamable_http";
  serverInfo?: { name?: string; version?: string };
  tools?: Array<{ name: string; description?: string }>;
  error?: string;
}

/**
 * `agent://connector-needed` event payload (pii W2.5): an MCP tool failed because its server is
 * not authorized. The composer shows a 连接 X card; authorizing posts 「已连接 X，继续」.
 */
export interface ConnectorNeededEvent {
  sessionId: string;
  /** The configured server name (mcp.json key). */
  server: string;
  /** The MCP tool the model tried to call. */
  tool?: string;
  /** The error text the tool returned (already redacted by the service). */
  reason?: string;
}
/** One MCP server config entry surfaced to the UI. */
export interface McpServerEntry {
  name: string;
  /** "stdio" | "streamable_http". */
  transport?: string;
  /** For stdio: command. For http: URL. */
  target?: string;
  enabled: boolean;
  /** "user" | "project" | "bundled" | ... */
  source?: string;
  disabledReason?: string;
  vendor?: string;
  /** A URL server with no static Authorization header whose OAuth token is missing/expired (W2.4). */
  needsAuth?: boolean;
}

/** Frontend payload for creating/updating an MCP server. */
export interface McpUpsertRequest {
  name: string;
  /** "stdio" or "http". */
  transport: string;
  /** stdio: command. http: URL. */
  target: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
}


export interface McpAuthTriggerResult {
  /** "authenticated" | "failed" | "setup_required". */
  status: string;
  error?: string;
}


export interface McpAuthStatusEntry {
  serverName: string;
  status: "authenticated" | "needs_auth";
  expiresAt?: number;
}

