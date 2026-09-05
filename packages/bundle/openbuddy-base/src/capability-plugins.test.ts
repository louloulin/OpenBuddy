import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Context } from "@openbuddy/cordis";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { clearPassthroughRegistry, isPassthroughed, recordPassthrough } from "@openbuddy/plugin-host";
import {
  capabilityPlugin,
  mcpClientPlugin,
} from "./capability-plugins";

/**
 * Stage D F4: when a native Pi package owns a capability (e.g.
 * `pi-web-access` for web, `pi-plan-mode` for plan), the Cordis
 * capability plugin must short-circuit its `apply()` so the same surface
 * is not registered twice — once by the Pi native extension and once by
 * the Cordis mount.
 *
 * Stage G-1a / G-1b: `webSearchPlugin` (G-1a) and `planPlugin` (G-1b)
 * were both removed because the capabilities are owned by
 * `pi-web-access` and `pi-plan-mode` (passthrough). Only `mcpClientPlugin`
 * remains as a gated Cordis plugin.
 */
describe("capability-plugins passthrough gate", () => {
  beforeEach(() => clearPassthroughRegistry());

  it("plan capability is fully owned by pi-plan-mode (passthrough)", () => {
    // Stage G-1b: planPlugin is removed; the capability is owned by
    // pi-plan-mode. The passthrough registry reports the plan key as
    // installed (auto-recorded by the native loader).
    recordPassthrough("plan", "installed", "pi-plan-mode");
    expect(isPassthroughed("plan")).toBe(true);
  });

  it("web capability is fully owned by pi-web-access (passthrough)", () => {
    // Stage G-1a: webSearchPlugin is removed; the capability is owned by
    // pi-web-access. The passthrough registry reports the web key as
    // installed (auto-recorded by the native loader).
    recordPassthrough("web", "installed", "pi-web-access");
    expect(isPassthroughed("web")).toBe(true);
  });

  it("mcpClientPlugin skips Cordis mount when mcp is passthrough'd", async () => {
    recordPassthrough("mcp", "installed", "openbuddy-mcp-client");
    const plugin = mcpClientPlugin;
    const ctx = { get: vi.fn(), effect: vi.fn() } as unknown as Context;
    const cleanup = await plugin.apply(ctx);
    expect(typeof cleanup).toBe("function");
    expect(ctx.get).not.toHaveBeenCalled();
  });

  it("automation capability key is owned by pi-goal-list-loop-audit (Stage H-4)", () => {
    // Stage H-4: openbuddy-automation removed (Stage G-1c); the canonical
    // backplane is now `pi-goal-list-loop-audit`. Registering the gate
    // flips the Cordis mount to a no-op (per capabilityPlugin 5th arg)
    // so the same surface is not double-registered when the user
    // installs the Pi extension via /marketplace.
    recordPassthrough("automation", "installed", "pi-goal-list-loop-audit");
    expect(isPassthroughed("automation")).toBe(true);
  });
});

/**
 * Priority integration: the user's hard rule is
 *   "pi > openbuddy when both exist; preserve some openbuddy plugins".
 *
 * The gate is the 5th `passthroughCapability` argument on `capabilityPlugin`.
 * These tests inject a mock importer so we can prove the priority path in
 * isolation — without spinning up the real @openbuddy/capability-mcp-client
 * (which would need a full Cordis context to mount).
 */
describe("capabilityPlugin priority gate (pi > openbuddy)", () => {
  beforeEach(() => clearPassthroughRegistry());

  it("without passthrough, the openbuddy importer + tools run (Cordis fallback)", async () => {
    // No recordPassthrough → openbuddy fallback owns the surface.
    const importer = vi.fn().mockResolvedValue(vi.fn().mockReturnValue(undefined));
    const tools = vi.fn().mockResolvedValue([{ name: "stub_tool", label: "stub", description: "x", parameters: {}, execute: async () => ({ content: [], details: {} }) }] as ToolDefinition[]);
    const piRegister = vi.fn().mockReturnValue(() => undefined);
    const ctx = {
      get: vi.fn((key: string) => (key === "pi" ? { tools: { registerTool: piRegister } } : undefined)),
      effect: vi.fn(),
    } as unknown as Context;
    const plugin = capabilityPlugin(
      "stub-capability",
      importer,
      tools,
      ["agentHost", "pi"],
      "stub-capability", // gate key = plugin id; registry empty ⇒ openbuddy runs
    );
    const cleanup = await plugin.apply(ctx);
    expect(typeof cleanup).toBe("function");
    expect(importer).toHaveBeenCalledTimes(1);
    expect(tools).toHaveBeenCalledTimes(1);
    expect(piRegister).toHaveBeenCalledTimes(1);
    // The registered tool name should match the stub.
    const registered = piRegister.mock.calls[0]?.[0] as { name: string };
    expect(registered?.name).toBe("stub_tool");
  });

  it("with passthrough recorded, the openbuddy importer is skipped (pi wins)", async () => {
    // Simulate `pi-mcp-adapter` being installed: pi-extensions.ts calls
    // recordPassthrough("mcp", "installed", "pi-mcp-adapter") at bootstrap.
    recordPassthrough("mcp", "installed", "pi-mcp-adapter");
    const importer = vi.fn();
    const tools = vi.fn();
    const piRegister = vi.fn();
    const ctx = {
      get: vi.fn((key: string) => (key === "pi" ? { tools: { registerTool: piRegister } } : undefined)),
      effect: vi.fn(),
    } as unknown as Context;
    const plugin = capabilityPlugin(
      "openbuddy-mcp-client",
      importer,
      tools,
      ["agentHost", "pi"],
      "mcp",
    );
    const cleanup = await plugin.apply(ctx);
    expect(typeof cleanup).toBe("function");
    // pi path won: importer never called, tools never registered, ctx untouched.
    expect(importer).not.toHaveBeenCalled();
    expect(tools).not.toHaveBeenCalled();
    expect(piRegister).not.toHaveBeenCalled();
    expect(ctx.get).not.toHaveBeenCalled();
  });

  it("priority is local to the registered capability key (one gate does not affect another)", async () => {
    recordPassthrough("mcp", "installed", "pi-mcp-adapter");
    const importer = vi.fn().mockResolvedValue(vi.fn().mockReturnValue(undefined));
    const ctx = {
      get: vi.fn().mockReturnValue(undefined),
      effect: vi.fn(),
    } as unknown as Context;
    // Team plugin uses gate "team" — that key is NOT in the registry, so
    // team must still mount even though mcp was passthrough'd.
    const teamPlugin = capabilityPlugin(
      "openbuddy-team",
      importer,
      undefined,
      ["agentHost"],
      "team",
    );
    await teamPlugin.apply(ctx);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("re-recording passthrough (e.g. user toggles the gate) re-applies the priority on the next apply", async () => {
    // First: openbuddy runs.
    const importer = vi.fn().mockResolvedValue(vi.fn().mockReturnValue(undefined));
    const ctx = {
      get: vi.fn().mockReturnValue(undefined),
      effect: vi.fn(),
    } as unknown as Context;
    const plugin = capabilityPlugin(
      "openbuddy-mcp-client",
      importer,
      undefined,
      ["agentHost"],
      "mcp",
    );
    await plugin.apply(ctx);
    expect(importer).toHaveBeenCalledTimes(1);
    // User installs pi-mcp-adapter → pi-extensions.ts records the gate.
    recordPassthrough("mcp", "installed", "pi-mcp-adapter");
    await plugin.apply(ctx);
    // Same plugin instance — importer must NOT be called again on the
    // second apply. The pi native extension owns the surface now.
    expect(importer).toHaveBeenCalledTimes(1);
  });
});
