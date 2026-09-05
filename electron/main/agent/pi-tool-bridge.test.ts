import { describe, expect, it, vi } from "vitest";
import {
  registerAdapterTool,
  registerDescribeFallbackTool,
  type AdapterToolSpec,
} from "./pi-tool-bridge";
import { Type } from "@earendil-works/pi-ai";

interface ToolRecord {
  name: string;
  description: string;
  parameters: unknown;
  execute: (...callArgs: unknown[]) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: { ok: boolean; summary?: string; fallback?: boolean; error?: string };
  }>;
}

function collectTools(
  factory: (api: unknown) => void,
): Map<string, ToolRecord> {
  const tools = new Map<string, ToolRecord>();
  const api = {
    registerTool: (tool: ToolRecord) => {
      tools.set(tool.name, tool);
    },
  };
  factory(api);
  return tools;
}

describe("pi-tool-bridge", () => {
  it("no-ops when pi.registerTool is unavailable", () => {
    expect(() => {
      registerAdapterTool(
        {} as never,
        {
          name: "x",
          description: "x",
          parameters: Type.Object({}),
          serializeArgs: () => "",
        },
        { invokeInvocation: async () => "ok", resolveService: () => ({}), },
      );
    }).not.toThrow();
  });

  it("exposes sessionId resolved from ExtensionContext.sessionManager", async () => {
    const calls: Array<{ args: string; sessionId?: string }> = [];
    const tools = collectTools((api) => {
      registerAdapterTool(
        api as never,
        {
          name: "openbuddy_test_session",
          description: "verify sessionId flow",
          parameters: Type.Object({ verb: Type.Literal("list") }),
          serializeArgs: () => "list",
        },
        {
          invokeInvocation: async (_service, args, ctx) => {
            calls.push({ args, sessionId: ctx.sessionId });
            return "ok";
          },
          resolveService: () => ({}),
        },
      );
    });
    const tool = tools.get("openbuddy_test_session")!;
    await tool.execute("tc-1", { verb: "list" }, undefined, undefined, {
      cwd: "/tmp/ws",
      sessionManager: { getSessionId: () => "session-abc" },
    } as never);
    expect(calls).toEqual([{ args: "list", sessionId: "session-abc" }]);
  });

  it("synthesises a sessionManager shim when only sessionId is set (slash-command compat)", async () => {
    const calls: Array<{ args: string; sessionId?: string }> = [];
    const tools = collectTools((api) => {
      registerAdapterTool(
        api as never,
        {
          name: "openbuddy_test_shim",
          description: "verify shim",
          parameters: Type.Object({ verb: Type.Literal("list") }),
          serializeArgs: () => "list",
        },
        {
          invokeInvocation: async (_service, _args, ctx) => {
            // Legacy handlers read ctx.sessionManager.getSessionId() — the
            // bridge must keep that path working even on the tool path.
            const id = ctx.sessionManager?.getSessionId?.();
            calls.push({ args: "list", sessionId: id });
            return "ok";
          },
          resolveService: () => ({}),
        },
      );
    });
    const tool = tools.get("openbuddy_test_shim")!;
    await tool.execute("tc-1", { verb: "list" }, undefined, undefined, {
      cwd: "/tmp/ws",
      sessionManager: { getSessionId: () => "session-xyz" },
    } as never);
    expect(calls[0]?.sessionId).toBe("session-xyz");
  });

  it("returns ok=false details when invokeInvocation throws", async () => {
    const tools = collectTools((api) => {
      registerAdapterTool(
        api as never,
        {
          name: "openbuddy_test_throws",
          description: "verify error path",
          parameters: Type.Object({ verb: Type.Literal("list") }),
          serializeArgs: () => "list",
        },
        {
          invokeInvocation: async () => {
            throw new Error("boom");
          },
          resolveService: () => ({}),
        },
      );
    });
    const tool = tools.get("openbuddy_test_throws")!;
    const result = await tool.execute("tc-1", { verb: "list" }, undefined, undefined, { cwd: "/tmp/ws" } as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.error).toContain("boom");
    expect(result.content[0]?.text).toContain("boom");
  });

  it("falls back to a generic summary when invokeInvocation returns undefined", async () => {
    const tools = collectTools((api) => {
      registerAdapterTool(
        api as never,
        {
          name: "openbuddy_test_undef",
          description: "verify no-summary fallback",
          parameters: Type.Object({ verb: Type.Literal("list") }),
          serializeArgs: () => "list",
        },
        {
          invokeInvocation: async () => undefined,
          resolveService: () => undefined,
        },
      );
    });
    const tool = tools.get("openbuddy_test_undef")!;
    const result = await tool.execute("tc-1", { verb: "list" }, undefined, undefined, { cwd: "/tmp/ws" } as never);
    expect(result.details.ok).toBe(true);
    expect(result.content[0]?.text).toContain("completed without text summary");
  });

  it("registerDescribeFallbackTool surfaces describeInvocation output as a passthrough tool", async () => {
    const tools = collectTools((api) => {
      registerDescribeFallbackTool(
        api as never,
        {
          name: "openbuddy_test_fallback",
          description: "passthrough fallback tool",
          parameters: Type.Object({ verb: Type.Literal("status") }),
          serializeArgs: () => "status",
          describeInvocation: async (_service, _args) => "Install pi-package to enable this tool.",
          resolveService: () => undefined,
        },
      );
    });
    const tool = tools.get("openbuddy_test_fallback")!;
    const result = await tool.execute("tc-1", { verb: "status" }, undefined, undefined, { cwd: "/tmp/ws" } as never);
    expect(result.details.ok).toBe(true);
    expect(result.details.fallback).toBe(true);
    expect(result.content[0]?.text).toContain("Install pi-package");
  });

  it("registerDescribeFallbackTool no-ops when pi.registerTool is unavailable", () => {
    expect(() => {
      registerDescribeFallbackTool(
        {} as never,
        {
          name: "x",
          description: "x",
          parameters: Type.Object({}),
          serializeArgs: () => "",
          describeInvocation: () => "x",
          resolveService: () => undefined,
        },
      );
    }).not.toThrow();
  });
});
