import { describe, expect, it } from "vitest";
import type { BuddyCapability } from "@openbuddy/collaboration-protocol";
import { buildCallToolResponse, buildListToolsResponse, createMcpServerAdapter, toJsonText, toMcpInputSchema } from "./mcp-server-adapter";

const sampleCapability: BuddyCapability = {
  id: "memory:list",
  providerId: "buddy-personal",
  description: "读取本地记忆索引",
  inputSchema: { type: "object", properties: { limit: { type: "number" } }, required: ["limit"] },
  outputSchema: {},
  procedure: [],
  allowedDataScopes: ["room:personal-room"],
  forbiddenDataScopes: ["secret:prompt"],
  allowedActions: ["read:room"],
  forbiddenActions: ["external:send"],
  acceptanceTests: [],
  requiredApproval: "never",
  allowDelegation: false,
  maxDelegationDepth: 0,
  visibility: "private",
};

const options = {
  serverName: "openbuddy-test",
  serverVersion: "0.1.0-test",
  listCapabilities: () => [sampleCapability],
  invokeCapability: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
};

describe("mcp-server-adapter pure helpers", () => {
  it("coerces valid object schemas to MCP inputSchema", () => {
    const result = toMcpInputSchema({ type: "object", properties: { x: { type: "string" } } });
    expect(result.type).toBe("object");
    expect((result as { properties?: Record<string, unknown> }).properties).toBeDefined();
  });

  it("falls back to a free-form object for empty or invalid schemas", () => {
    expect(toMcpInputSchema({})).toEqual({ type: "object", additionalProperties: true });
    expect(toMcpInputSchema(undefined)).toEqual({ type: "object", additionalProperties: true });
    expect(toMcpInputSchema("not-a-schema")).toEqual({ type: "object", additionalProperties: true });
  });

  it("serializes strings verbatim and JSON-encodes other values", () => {
    expect(toJsonText("hello")).toBe("hello");
    expect(toJsonText({ count: 1 })).toBe("{\n  \"count\": 1\n}");
  });
});

describe("buildListToolsResponse", () => {
  it("maps each capability to a tool entry with name, description, and inputSchema", async () => {
    const response = await buildListToolsResponse(options);
    expect(response.tools).toHaveLength(1);
    expect(response.tools[0]).toMatchObject({
      name: "memory:list",
      description: "读取本地记忆索引",
    });
    expect((response.tools[0].inputSchema as { type?: string }).type).toBe("object");
  });

  it("re-evaluates the capability list on every call so new cards are discoverable", async () => {
    const first = await buildListToolsResponse(options);
    expect(first.tools).toHaveLength(1);
    const second = await buildListToolsResponse({ ...options, listCapabilities: () => [] });
    expect(second.tools).toHaveLength(0);
  });
});

describe("buildListToolsResponse with per-package exporters", () => {
  it("merges collaboration capabilities with exporter capabilities in the tools list", async () => {
    const response = await buildListToolsResponse({
      serverName: "openbuddy-test",
      serverVersion: "0.1.0-test",
      invokeCapability: async () => ({ content: [{ type: "text", text: "{}" }] }),
      listCapabilities: () => [sampleCapability],
      exporters: [{
        packageId: "openbuddy-automation",
        capabilities: [
          { id: "automation:list", invoke: async () => ({ items: [] }) },
        ],
      }],
    });
    expect(response.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["automation:list"]));
  });
});

describe("buildCallToolResponse with per-package exporters", () => {
  it("routes calls to exporter invoke when the id matches an exporter capability", async () => {
    let received: unknown = null;
    const response = await buildCallToolResponse(
      {
        serverName: "openbuddy-test",
        serverVersion: "0.1.0-test",
        invokeCapability: async () => ({ content: [{ type: "text", text: "{}" }] }),
        listCapabilities: () => [sampleCapability],
        exporters: [{
          packageId: "openbuddy-automation",
          capabilities: [
            { id: "automation:list", invoke: async (args) => { received = args; return { items: [] }; } },
          ],
        }],
      },
      { name: "automation:list", arguments: { status: "active" } },
    );
    expect(received).toEqual({ status: "active" });
    expect(response.isError).toBeUndefined();
    expect(response.content[0]).toMatchObject({ type: "text", text: toJsonText({ items: [] }) });
  });

  it("falls back to the collaboration invoke path when neither exporter nor capability match", async () => {
    const response = await buildCallToolResponse(
      {
        serverName: "openbuddy-test",
        serverVersion: "0.1.0-test",
        invokeCapability: async () => ({ content: [{ type: "text", text: "{}" }] }),
        listCapabilities: () => [sampleCapability],
        exporters: [],
      },
      { name: "no-such-tool", arguments: {} },
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]).toMatchObject({ type: "text", text: "unknown capability: no-such-tool" });
  });
});

describe("buildCallToolResponse", () => {
  it("invokes the matching capability and returns its content", async () => {
    let received: { id: string; args: Record<string, unknown> } | null = null;
    const response = await buildCallToolResponse(
      {
        ...options,
        invokeCapability: async ({ capability, args }) => {
          received = { id: capability.id, args };
          return { content: [{ type: "text", text: JSON.stringify({ count: 3 }) }] };
        },
      },
      { name: "memory:list", arguments: { limit: 5 } },
    );
    expect(received).toEqual({ id: "memory:list", args: { limit: 5 } });
    expect(response.isError).toBeUndefined();
    expect(response.content[0]).toMatchObject({ type: "text", text: JSON.stringify({ count: 3 }) });
  });

  it("returns isError: true for unknown capability names", async () => {
    const response = await buildCallToolResponse(options, { name: "no-such-tool", arguments: {} });
    expect(response.isError).toBe(true);
    expect(response.content[0]).toMatchObject({ type: "text", text: "unknown capability: no-such-tool" });
  });

  it("surfaces thrown errors as protocol-level isError: true responses", async () => {
    const response = await buildCallToolResponse(
      {
        ...options,
        invokeCapability: async () => { throw new Error("boom"); },
      },
      { name: "memory:list", arguments: {} },
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]).toMatchObject({ type: "text", text: "capability memory:list failed: boom" });
  });

  it("defaults missing arguments to an empty object", async () => {
    let receivedArgs: Record<string, unknown> | null = null;
    await buildCallToolResponse(
      {
        ...options,
        invokeCapability: async ({ args }) => { receivedArgs = args; return { content: [] }; },
      },
      { name: "memory:list" },
    );
    expect(receivedArgs).toEqual({});
  });

  it("propagates isError from the invoke callback", async () => {
    const response = await buildCallToolResponse(
      {
        ...options,
        invokeCapability: async () => ({ content: [{ type: "text", text: "denied" }], isError: true }),
      },
      { name: "memory:list", arguments: {} },
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]).toMatchObject({ type: "text", text: "denied" });
  });
});

describe("createMcpServerAdapter", () => {
  it("reports server name, version, and a zero tool count before any list call", () => {
    const adapter = createMcpServerAdapter(options);
    expect(adapter.serverName()).toBe("openbuddy-test");
    expect(adapter.serverVersion()).toBe("0.1.0-test");
    expect(adapter.listToolCount()).toBe(0);
  });

  it("returns a stop() that resolves without throwing", async () => {
    const adapter = createMcpServerAdapter(options);
    await expect(adapter.stop()).resolves.toBeUndefined();
  });
});
