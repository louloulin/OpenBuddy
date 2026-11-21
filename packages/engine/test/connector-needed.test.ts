// @vitest-environment node
// pii W2.5: an MCP tool that fails for lack of authorization asks the composer for a 连接 card.
import { describe, expect, it } from "vitest";
import type { EngineContext } from "../src/engine-context.js";
import { notifyConnectorNeeded } from "../src/event-pipeline.js";

function fakeEngine(servers: string[]) {
  const events: Array<{ name: string; payload: any }> = [];
  const engine = {
    emit: (name: string, payload: unknown) => events.push({ name, payload }),
    mcp: { list: () => servers.map((name) => ({ name, enabled: true })) },
  } as unknown as EngineContext;
  return { engine, events };
}
const result = (text: string) => ({ content: [{ type: "text", text }] });

describe("即时连接卡 (pii W2.5 / U7.4)", () => {
  it("reports the configured server for an authorization-looking MCP error", () => {
    const { engine, events } = fakeEngine(["my-server"]);
    // Pi namespaces the tools: `-` in the server name becomes `_`.
    notifyConnectorNeeded(engine, "s1", { toolName: "mcp__my_server__query", result: result("401 Unauthorized: OAuth token required") });
    expect(events).toEqual([{
      name: "agent://connector-needed",
      payload: { sessionId: "s1", server: "my-server", tool: "query", reason: "401 Unauthorized: OAuth token required" },
    }]);
  });

  it("stays quiet for a tool bug, an unknown server, or a non-MCP tool", () => {
    const { engine, events } = fakeEngine(["my-server"]);
    notifyConnectorNeeded(engine, "s1", { toolName: "mcp__my_server__query", result: result("TypeError: bad arguments") });
    notifyConnectorNeeded(engine, "s1", { toolName: "mcp__other__query", result: result("401 Unauthorized") });
    notifyConnectorNeeded(engine, "s1", { toolName: "read", result: result("401 Unauthorized") });
    expect(events).toEqual([]);
  });
});
