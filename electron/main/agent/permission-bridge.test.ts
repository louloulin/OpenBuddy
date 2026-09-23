/**
 * Tests for electron/main/agent/permission-bridge.ts.
 */
import { describe, expect, it, vi } from "vitest";

import {
  HostPermissionGateway,
  InMemoryPermissionGateway,
  compactRule,
  type HostCallLike,
} from "./permission-bridge.js";

describe("compactRule", () => {
  it("emits tool when no pattern", () => {
    expect(compactRule("bash")).toBe("bash");
  });
  it("emits tool(pattern) when present", () => {
    expect(compactRule("bash", "ls *")).toBe("bash(ls *)");
  });
});

describe("HostPermissionGateway", () => {
  function fakeHost(responses: Record<string, unknown> = {}): HostCallLike & { calls: any[] } {
    const calls: any[] = [];
    const host = {
      calls,
      async call<T>(method: string, params?: unknown): Promise<T> {
        calls.push({ method, params });
        if (method in responses) return responses[method] as T;
        if (method === "permissions.readRules") return [] as T;
        return undefined as unknown as T;
      },
    };
    return host;
  }

  it("grantPlugin filters out high-risk capabilities and writes combined rules", async () => {
    const host = fakeHost({ "permissions.readRules": [] });
    const gw = new HostPermissionGateway({ host });
    await gw.grantPlugin({
      id: "demo",
      version: "1.0.0",
      capabilities: [
        { id: "tools.demo-hello", risk: "low" },
        { id: "tools.demo-rm", risk: "high" },
        { id: "tools.demo-write", risk: "medium" },
      ],
    });
    // Two writeRules calls happen via different methods; the writeRules call
    // carries the filtered list.
    const writes = host.calls.filter((c) => c.method === "permissions.writeRules");
    expect(writes.length).toBe(1);
    const rules = writes[0].params.rules as Array<{ action: string; tool: string; pattern: string }>;
    expect(rules.length).toBe(2);
    expect(rules.map((r) => r.tool).sort()).toEqual(["tools.demo-hello", "tools.demo-write"]);
    expect(rules.every((r) => r.action === "allow")).toBe(true);
    expect(rules.every((r) => r.pattern === "plugin:demo")).toBe(true);
  });

  it("grantPlugin merges with existing rules and removes prior plugin entries", async () => {
    const host = fakeHost({
      "permissions.readRules": [
        { action: "allow", tool: "tools.other", pattern: "plugin:other" },
        { action: "allow", tool: "tools.demo-hello", pattern: "plugin:demo" },
        { action: "deny", tool: "rm", pattern: "*" },
      ],
    });
    const gw = new HostPermissionGateway({ host });
    await gw.grantPlugin({
      id: "demo",
      version: "1.0.0",
      capabilities: [{ id: "tools.demo-write", risk: "low" }],
    });
    const writes = host.calls.filter((c) => c.method === "permissions.writeRules");
    const rules = writes[0].params.rules as Array<{ tool: string; pattern?: string; action: string }>;
    // Existing demo:hello plugin:demo is gone, demo:write is added, others stay.
    expect(rules.find((r) => r.tool === "tools.demo-hello")).toBeUndefined();
    expect(rules.find((r) => r.tool === "tools.demo-write")).toBeTruthy();
    expect(rules.find((r) => r.tool === "tools.other")).toBeTruthy();
    expect(rules.find((r) => r.tool === "rm")).toBeTruthy();
  });

  it("grantPlugin is a no-op when only high-risk capabilities exist", async () => {
    const host = fakeHost({ "permissions.readRules": [] });
    const gw = new HostPermissionGateway({ host });
    await gw.grantPlugin({
      id: "demo",
      version: "1.0.0",
      capabilities: [{ id: "tools.boom", risk: "high" }],
    });
    expect(host.calls.filter((c) => c.method === "permissions.writeRules").length).toBe(0);
  });

  it("revokePlugin removes plugin:<id> rules but keeps unrelated ones", async () => {
    const host = fakeHost({
      "permissions.readRules": [
        { action: "allow", tool: "tools.demo-hello", pattern: "plugin:demo" },
        { action: "allow", tool: "tools.other", pattern: "plugin:other" },
        { action: "deny", tool: "rm", pattern: "*" },
        { action: "allow", tool: "tools.demo-write", pattern: "plugin:demo" },
      ],
    });
    const gw = new HostPermissionGateway({ host });
    await gw.revokePlugin("demo");
    const writes = host.calls.filter((c) => c.method === "permissions.writeRules");
    const rules = writes[0].params.rules as Array<{ tool: string; pattern?: string }>;
    expect(rules.find((r) => r.pattern === "plugin:demo")).toBeUndefined();
    expect(rules.find((r) => r.pattern === "plugin:other")).toBeTruthy();
    expect(rules.find((r) => r.tool === "rm")).toBeTruthy();
  });
});

describe("InMemoryPermissionGateway", () => {
  it("stores rules per plugin", async () => {
    const gw = new InMemoryPermissionGateway();
    await gw.grantPlugin({
      id: "demo",
      version: "1.0.0",
      capabilities: [{ id: "tools.hello" }],
    });
    expect(gw.rulesFor("demo").length).toBe(1);
    expect(gw.rulesFor("demo")[0]).toMatchObject({
      action: "allow",
      tool: "tools.hello",
      pattern: "plugin:demo",
    });
  });

  it("revokePlugin drops the plugin's rules", async () => {
    const gw = new InMemoryPermissionGateway();
    await gw.grantPlugin({ id: "demo", version: "1", capabilities: [{ id: "x" }] });
    await gw.grantPlugin({ id: "other", version: "1", capabilities: [{ id: "y" }] });
    await gw.revokePlugin("demo");
    expect(gw.rulesFor("demo")).toEqual([]);
    expect(gw.rulesFor("other").length).toBe(1);
  });

  it("records call history", async () => {
    const gw = new InMemoryPermissionGateway();
    await gw.grantPlugin({ id: "demo", version: "1", capabilities: [{ id: "x" }] });
    await gw.revokePlugin("demo");
    expect(gw.grantCalls.length).toBe(1);
    expect(gw.revokeCalls).toEqual(["demo"]);
  });
});
