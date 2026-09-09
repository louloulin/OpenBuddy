/**
 * mcp-tools.ts — PI ToolDefinition factory for the MCP client capability.
 *
 * Phase C.3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v18 §38.6):
 *   Apply the email-tools / calendar-tools factory pattern to the
 *   MCP client so the tool definitions are isolated from the rest
 *   of the MCP client code (connection / oauth / transport).
 *
 * Architecture (mirrors email-tools.ts + calendar-tools.ts):
 *   - `toolResult` / `mcpToolName` / `safeServerName` helpers are local.
 *   - `createMcpToolDefinitions(serverName, tools, connection, onCall)`
 *     is a pure factory. It maps each MCP server tool to a PI
 *     ToolDefinition, wiring the call observer through.
 *   - index.ts re-exports the public surface.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from electron/main/ and nothing from
 *   index.ts. It only depends on `@earendil-works/pi-coding-agent` for
 *   the type definitions + local re-declared minimal types.
 */

import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";

// Minimal subset of MCP types we need. The full types live in
// index.ts; we re-declare the surface we actually consume so this
// module loads without resolving index.ts (avoids the circular
// dependency that would otherwise exist because index.ts re-exports
// the factories from this module).
export interface McpToolLike {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type McpCallToolResultContentItem =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data?: string }
  | { type: "audio"; mimeType: string; data?: string }
  | { type: string; [key: string]: unknown };

export interface McpCallToolResult {
  content: McpCallToolResultContentItem[];
}

export interface McpConnectionLike {
  callTool(name: string, args: Record<string, unknown>, signal?: unknown): Promise<McpCallToolResult>;
}

export type McpToolCallObserver = (event: McpToolCallEvent) => void;

export type McpToolCallEvent =
  | { phase: "start"; callId: string; serverName: string; toolName: string; piToolName: string }
  | {
      phase: "end";
      callId: string;
      serverName: string;
      toolName: string;
      piToolName: string;
      durationMs: number;
      ok: boolean;
      error?: string;
    };

// ─── Helpers ────────────────────────────────────────────────────────

function safeServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${safeServerName(serverName)}__${toolName.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function toolResult(result: McpCallToolResult): AgentToolResult<McpCallToolResult> {
  const content: Array<{ type: "text"; text: string }> = result.content.map((item) => {
    if (isTextItem(item)) return { type: "text", text: item.text };
    if (isMediaItem(item)) return { type: "text", text: `[${item.type} ${item.mimeType}]` };
    // Fallback: stringify any unknown item so the LLM still gets a
    // useful representation even for non-standard content types.
    return { type: "text", text: JSON.stringify(item) };
  });
  return { content, details: result };
}

function isTextItem(
  item: McpCallToolResultContentItem,
): item is { type: "text"; text: string } {
  return item.type === "text" && typeof (item as { text?: unknown }).text === "string";
}

function isMediaItem(
  item: McpCallToolResultContentItem,
): item is { type: string; mimeType: string } {
  return (item.type === "image" || item.type === "audio") && typeof (item as { mimeType?: unknown }).mimeType === "string";
}

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Phase C.3 — composes a list of MCP server tools into PI
 * ToolDefinitions. Each tool gets:
 * - canonical name `mcp__{server}__{tool}` (so they don't collide
 *   with builtin PI tool names)
 * - the original MCP tool's inputSchema cast to ToolDefinition["parameters"]
 * - an execute() that wraps `connection.callTool`, forwarding start/end
 *   events to the optional `onCall` observer for diagnostics
 */
export function createMcpToolDefinitions(
  serverName: string,
  tools: readonly McpToolLike[],
  connection: McpConnectionLike,
  onCall?: McpToolCallObserver,
): ToolDefinition[] {
  return tools.map((tool) => ({
    name: mcpToolName(serverName, tool.name),
    label: `${serverName}: ${tool.name}`,
    description: tool.description || `Call ${tool.name} on MCP server ${serverName}.`,
    parameters: tool.inputSchema as ToolDefinition["parameters"],
    execute: async (toolCallId, args, signal) => {
      const piToolName = mcpToolName(serverName, tool.name);
      const callId = typeof toolCallId === "string" && toolCallId ? toolCallId : `mcp-${Date.now().toString(36)}`;
      const startedAt = Date.now();
      onCall?.({ phase: "start", callId, serverName, toolName: tool.name, piToolName });
      try {
        const result = await connection.callTool(tool.name, record(args), signal);
        onCall?.({ phase: "end", callId, serverName, toolName: tool.name, piToolName, durationMs: Date.now() - startedAt, ok: true });
        return toolResult(result);
      } catch (error) {
        onCall?.({
          phase: "end",
          callId,
          serverName,
          toolName: tool.name,
          piToolName,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }));
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}