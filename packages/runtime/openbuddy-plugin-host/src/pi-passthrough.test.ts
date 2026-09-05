import { describe, expect, it, beforeEach } from "vitest";
import {
  CAPABILITY_TO_PLUGIN_ID,
  clearPassthroughRegistry,
  getPassthroughInfo,
  isPassthroughed,
  listPassthroughed,
  pluginIdForCapability,
  recordPassthrough,
} from "./pi-passthrough";

describe("pi-passthrough registry", () => {
  beforeEach(() => clearPassthroughRegistry());

  it("starts empty and reports no passthrough", () => {
    expect(isPassthroughed("plan")).toBe(false);
    expect(listPassthroughed()).toEqual([]);
  });

  it("records a passthrough decision and exposes metadata", () => {
    recordPassthrough("plan", "opted-in", "pi-plan-mode");
    expect(isPassthroughed("plan")).toBe(true);
    const info = getPassthroughInfo("plan");
    expect(info?.source).toBe("opted-in");
    expect(info?.adapter).toBe("pi-plan-mode");
    expect(typeof info?.recordedAt).toBe("number");
  });

  it("overwrites a previous passthrough record", () => {
    recordPassthrough("plan", "installed", "pi-plan-mode");
    recordPassthrough("plan", "opted-in", "pi-plan-mode");
    expect(getPassthroughInfo("plan")?.source).toBe("opted-in");
    expect(listPassthroughed().filter((entry) => entry.capability === "plan")).toHaveLength(1);
  });

  it("tracks multiple capabilities independently", () => {
    recordPassthrough("plan", "installed", "pi-plan-mode");
    recordPassthrough("team", "installed", "openbuddy-team");
    expect(isPassthroughed("plan")).toBe(true);
    expect(isPassthroughed("team")).toBe(true);
    expect(isPassthroughed("notification")).toBe(false);
    expect(listPassthroughed()).toHaveLength(2);
  });

  it("clearPassthroughRegistry wipes every entry", () => {
    recordPassthrough("plan", "installed", "pi-plan-mode");
    recordPassthrough("team", "installed", "openbuddy-team");
    clearPassthroughRegistry();
    expect(isPassthroughed("plan")).toBe(false);
    expect(listPassthroughed()).toEqual([]);
  });

  it("exposes the capability -> plugin id mapping for common passthrough surfaces", () => {
    expect(pluginIdForCapability("mcp")).toBe("openbuddy-mcp-client");
    expect(pluginIdForCapability("session")).toBe("openbuddy-session");
    expect(pluginIdForCapability("fs")).toBe("openbuddy-fs-local");
    // C7: new passthrough surfaces
    expect(pluginIdForCapability("plan")).toBe("pi-plan-mode");
    expect(pluginIdForCapability("web")).toBe("pi-web-access");
    expect(pluginIdForCapability("permission")).toBe("@gotgenes/pi-permission-system");
    // G-2: sub-capability keys for tracking pi-subagents and pi-goal installs.
    // The Cordis team plugin still mounts (multi-buddy only); these keys are
    // for diagnostics so listPassthroughed() reports the full surface.
    expect(pluginIdForCapability("team-subagent")).toBe("pi-subagents");
    expect(pluginIdForCapability("team-goal")).toBe("pi-goal");
  });

  it("returns undefined for capabilities without a Cordis plugin", () => {
    expect(pluginIdForCapability("nonexistent")).toBeUndefined();
  });

  it("keeps the mapping frozen as a ReadonlyMap", () => {
    expect(CAPABILITY_TO_PLUGIN_ID).toBeInstanceOf(Map);
    // ReadonlyMap blocks mutating methods at the type level; at runtime the
    // reference is still a Map, so we just assert the expected size.
    // Stage G-1b: `plan` is no longer in CAPABILITY_TO_PLUGIN_ID — plan-mode
    // is owned by `pi-plan-mode` and recorded dynamically via
    // recordPassthrough("plan", ...). The remaining keys are mcp, session,
    // fs, team, memory, automation.
    expect(CAPABILITY_TO_PLUGIN_ID.size).toBeGreaterThanOrEqual(6);
  });
});
