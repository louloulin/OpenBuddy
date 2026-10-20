/**
 * Adapter tool-coverage guard.
 *
 * The recurring failure mode in this codebase is a capability that is
 * *declared* but never wired: a plugin installed and configured for one rule
 * while the rest went unaddressed, a compatibility adapter listed in the
 * inventory that the LLM can never call. So this test does not check the
 * declared `tools` array — it drives every adapter through the real factory
 * and asserts `pi.registerTool` actually fired.
 *
 * Mutations this kills:
 *  - delete an adapter's `tools` array
 *  - restore the old `if (!toolSourceCommand) return;` early return
 *  - add an adapter to the table with no tools
 */
import { describe, expect, it } from "vitest";
import {
  compatibilityAdapters,
  createCompatibilityAdapterFactory,
  type PiCompatibilityAdapter,
} from "./pi-extensions";
import type { OpenBuddyPiExtensionSpec } from "@openbuddy/plugin-host";
import type { ServiceKey } from "./pi-service-keys";

interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    args: unknown,
    signal?: unknown,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>;
}

function registerAdapter(adapter: PiCompatibilityAdapter, service?: unknown): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const spec: OpenBuddyPiExtensionSpec = { id: adapter.packageNames[0]! };
  const factory = createCompatibilityAdapterFactory(spec, adapter, {
    profileDir: "/tmp/profile",
    resolveSource: () => "/tmp/profile/unused/index.js",
    emit: () => {},
    resolveService: (() => service) as unknown as (key: ServiceKey) => unknown,
  });
  factory({
    registerCommand: () => {},
    registerTool: (tool: RegisteredTool) => {
      tools.set(tool.name, tool);
    },
  } as never);
  return tools;
}

/**
 * Capabilities deliberately excluded from the PI tool surface by a recorded
 * plan decision. Keyed by `capability`; the value is the plan clause that
 * says so, so an exemption can never outlive the reasoning behind it.
 *
 * `task` — docs/OPENBUDDY_PI_NATIVE_PLAN.md v3 §I.1:
 *   「决策保留 Cordis（用户已在用），删 PI extension adapter（孤儿）」.
 * An agent-facing `openbuddy_tasks` tool was drafted (the agent loop really
 * cannot reach session tasks today) and reverted, because reversing a recorded
 * architecture decision is the user's call. Add it here only once §I.1 changes.
 */
const CAPABILITY_EXEMPT_FROM_TOOLS: Record<string, string> = {
  task: "OPENBUDDY_PI_NATIVE_PLAN.md v3 §I.1 — 保留 Cordis，删 PI extension adapter",
};

describe("compatibility adapter tool coverage", () => {
  it("enumerates a non-trivial adapter table (guard against a silently empty table)", () => {
    expect(compatibilityAdapters.length).toBeGreaterThanOrEqual(12);
  });

  it("every adapter registers at least one LLM-callable tool, unless a plan clause exempts it", () => {
    const missing = compatibilityAdapters
      .filter((adapter) => registerAdapter(adapter).size === 0)
      .map((adapter) => adapter.capability)
      // An exemption with no recorded rationale is just a silenced failure.
      .filter((capability) => !CAPABILITY_EXEMPT_FROM_TOOLS[capability]);
    expect(missing).toEqual([]);
  });

  it("every exemption still names a plan clause (no silent exemptions)", () => {
    for (const [capability, clause] of Object.entries(CAPABILITY_EXEMPT_FROM_TOOLS)) {
      expect(compatibilityAdapters.map((a) => a.capability)).toContain(capability);
      expect(clause).toMatch(/§|PLAN/i);
    }
  });

  it("tool names are unique across adapters so pi.registerTool cannot shadow one", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const adapter of compatibilityAdapters) {
      for (const name of registerAdapter(adapter).keys()) {
        const owner = seen.get(name);
        if (owner) collisions.push(`${name} (${owner} vs ${adapter.capability})`);
        else seen.set(name, adapter.capability);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("every registered tool carries a name, a description and a parameter schema", () => {
    const malformed: string[] = [];
    for (const adapter of compatibilityAdapters) {
      for (const [name, tool] of registerAdapter(adapter)) {
        if (!tool.name || !tool.description?.trim() || !tool.parameters || typeof tool.execute !== "function") {
          malformed.push(`${adapter.capability}/${name}`);
        }
      }
    }
    expect(malformed).toEqual([]);
  });

  it("passthrough-only adapters return describe text instead of failing", async () => {
    // pi-lens has no Cordis service and no invoke handler; the tool must still
    // answer with the "install the upstream package" projection.
    const lens = compatibilityAdapters.find((adapter) => adapter.capability === "lens");
    expect(lens).toBeDefined();
    const tools = registerAdapter(lens!);
    expect(tools.size).toBeGreaterThan(0);
    const tool = tools.values().next().value as RegisteredTool;
    const result = await tool.execute("call-1", { verb: "status" });
    expect(result.details.ok).toBe(true);
    expect(result.details.fallback).toBe(true);
    expect(result.content[0]?.text).toContain("pi-lens");
  });

  it("an adapter with an invokeInvocation uses the real invoke path, not the fallback", async () => {
    const fs = compatibilityAdapters.find((adapter) => adapter.capability === "fs");
    expect(fs).toBeDefined();
    const fsLocal = { listDir: async () => ["README.md"] };
    const tool = registerAdapter(fs!, fsLocal).values().next().value as RegisteredTool;
    const result = await tool.execute("call-1", { verb: "list" });
    expect(result.details.ok).toBe(true);
    expect(result.details.fallback).toBeUndefined();
    // Proves the summary came from invokeFsCommand against the mounted
    // service, not from a describe stub.
    expect(result.content[0]?.text).toContain("README.md");
  });

  it("an unmounted service surfaces the invoke error rather than a fake success", async () => {
    const fs = compatibilityAdapters.find((adapter) => adapter.capability === "fs");
    const tool = registerAdapter(fs!).values().next().value as RegisteredTool;
    const result = await tool.execute("call-1", { verb: "list" });
    expect(result.details.ok).toBe(false);
  });
});