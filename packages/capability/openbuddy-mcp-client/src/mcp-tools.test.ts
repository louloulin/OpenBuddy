/**
 * mcp-tools.test.ts — Phase C.3 tests for the MCP client tool factory.
 *
 * Verifies the createMcpToolDefinitions function extracted from
 * index.ts into mcp-tools.ts preserves the original behavior:
 * - canonical name formatting (mcp__{server}__{tool})
 * - text/image/audio content normalization
 * - onCall observer wired for start + end events
 * - error path also emits end event with ok=false
 */

import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import {
  createMcpToolDefinitions,
  mcpToolName,
  type McpCallToolResult,
  type McpConnectionLike,
  type McpToolCallEvent,
  type McpToolLike,
} from "./mcp-tools";

function makeTool(overrides: Partial<McpToolLike> = {}): McpToolLike {
  return {
    name: "ping",
    description: "Pings a remote service",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
      additionalProperties: false,
    },
    ...overrides,
  };
}

function makeStubConnection(overrides: Partial<McpConnectionLike> = {}): McpConnectionLike {
  return {
    callTool: vi.fn(async () => ({
      content: [{ type: "text" as const, text: "pong" }],
    })),
    ...overrides,
  };
}

/**
 * `ToolDefinition.execute` has five parameters in
 * `@earendil-works/pi-coding-agent@0.85` — `(toolCallId, params, signal,
 * onUpdate, ctx)`. The MCP bridge only ever uses the first three, so the tests
 * call tools through this 3-argument adapter rather than repeating a throwaway
 * `onUpdate`/`ctx` at every call site.
 */
type McpToolExecute = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;

function executeTool(
  defs: ToolDefinition[],
  toolCallId: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const definition = defs[0]!;
  return (definition.execute as McpToolExecute)(toolCallId, params, undefined);
}

describe("mcp-tools (Phase C.3)", () => {
  describe("mcpToolName", () => {
    it("strips unsafe characters from server + tool names", () => {
      expect(mcpToolName("server one", "tool.two")).toBe("mcp__server_one__tool_two");
    });

    it("passes through safe characters unchanged", () => {
      expect(mcpToolName("server", "tool")).toBe("mcp__server__tool");
    });
  });

  describe("createMcpToolDefinitions", () => {
    it("returns one ToolDefinition per MCP tool with the canonical name", () => {
      const tools = [makeTool({ name: "ping" }), makeTool({ name: "fetch" })];
      const defs = createMcpToolDefinitions("server", tools, makeStubConnection());
      expect(defs).toHaveLength(2);
      expect(defs[0]?.name).toBe("mcp__server__ping");
      expect(defs[1]?.name).toBe("mcp__server__fetch");
    });

    it("uses a fallback description when the tool has none", () => {
      const defs = createMcpToolDefinitions("server", [makeTool({ description: undefined })], makeStubConnection());
      expect(defs[0]?.description).toBe("Call ping on MCP server server.");
    });

    it("forwards execute(args) to connection.callTool and normalises the result", async () => {
      const connection = makeStubConnection();
      const defs = createMcpToolDefinitions("server", [makeTool()], connection);
      const result = (await executeTool(defs, "call-1", { message: "hi" })) as { content: Array<{ type: string; text: string }>; details: McpCallToolResult };
      expect(connection.callTool).toHaveBeenCalledWith("ping", { message: "hi" }, undefined);
      expect(result.content).toEqual([{ type: "text", text: "pong" }]);
      expect(result.details.content).toEqual([{ type: "text", text: "pong" }]);
    });

    it("normalises image content to a text placeholder", async () => {
      const connection = makeStubConnection({
        callTool: vi.fn(async () => ({
          content: [{ type: "image", mimeType: "image/png" }],
        })),
      });
      const defs = createMcpToolDefinitions("server", [makeTool()], connection);
      const result = (await executeTool(defs, "call-1", {})) as { content: Array<{ type: string; text: string }> };
      expect(result.content[0]?.text).toBe("[image image/png]");
    });

    it("normalises audio content to a text placeholder", async () => {
      const connection = makeStubConnection({
        callTool: vi.fn(async () => ({
          content: [{ type: "audio", mimeType: "audio/mp3" }],
        })),
      });
      const defs = createMcpToolDefinitions("server", [makeTool()], connection);
      const result = (await executeTool(defs, "call-1", {})) as { content: Array<{ type: string; text: string }> };
      expect(result.content[0]?.text).toBe("[audio audio/mp3]");
    });

    it("emits onCall start + end events on success", async () => {
      const events: McpToolCallEvent[] = [];
      const onCall = (event: McpToolCallEvent) => { events.push(event); };
      const defs = createMcpToolDefinitions("server", [makeTool()], makeStubConnection(), onCall);
      await executeTool(defs, "call-1", {});
      expect(events).toHaveLength(2);
      expect(events[0]?.phase).toBe("start");
      expect(events[1]?.phase).toBe("end");
      const endEvent = events[1] as Extract<McpToolCallEvent, { phase: "end" }>;
      expect(endEvent.ok).toBe(true);
      expect(typeof endEvent.durationMs).toBe("number");
    });

    it("emits onCall end event with ok=false on error", async () => {
      const events: McpToolCallEvent[] = [];
      const onCall = (event: McpToolCallEvent) => { events.push(event); };
      const connection = makeStubConnection({
        callTool: vi.fn(async () => {
          throw new Error("connection broken");
        }),
      });
      const defs = createMcpToolDefinitions("server", [makeTool()], connection, onCall);
      await expect(executeTool(defs, "call-1", {})).rejects.toThrow("connection broken");
      expect(events).toHaveLength(2);
      const endEvent = events[1] as Extract<McpToolCallEvent, { phase: "end" }>;
      expect(endEvent.ok).toBe(false);
      expect(endEvent.error).toBe("connection broken");
    });

    it("passes the callId to onCall for tracing", async () => {
      const events: McpToolCallEvent[] = [];
      const onCall = (event: McpToolCallEvent) => { events.push(event); };
      const defs = createMcpToolDefinitions("server", [makeTool()], makeStubConnection(), onCall);
      await executeTool(defs, "trace-id-42", {});
      expect(events[0]).toEqual({
        phase: "start",
        callId: "trace-id-42",
        serverName: "server",
        toolName: "ping",
        piToolName: "mcp__server__ping",
      });
    });
  });
});