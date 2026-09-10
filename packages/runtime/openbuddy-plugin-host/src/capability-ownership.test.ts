import { describe, expect, it } from "vitest";
import {
  CAPABILITY_OWNERSHIP,
  CAPABILITY_TO_PLUGIN_ID,
  assertNoCapabilityOwnershipConflicts,
  findCapabilityOwnershipConflicts,
  listOpenBuddyOwned,
  listPassthroughEligible,
  openbuddyPluginForCapability,
  ownershipForCapability,
  piPluginForCapability,
  pluginIdForCapability,
} from "./capability-ownership";

describe("capability-ownership authority", () => {
  it("declares every capability exactly once", () => {
    const keys = CAPABILITY_OWNERSHIP.map((entry) => entry.capability);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers all 12 compatibility adapters plus the team/web family", () => {
    for (const capability of [
      "mcp", "permission", "goal", "plan", "task", "session",
      "fs", "lens", "simplify", "hashline", "worktree", "automation",
      "team", "team-subagent", "team-goal", "web",
    ]) {
      expect(ownershipForCapability(capability), capability).toBeDefined();
    }
  });

  it("maps each capability to both a pi native plugin and an openbuddy plugin", () => {
    for (const entry of CAPABILITY_OWNERSHIP) {
      expect(entry.piPlugin, entry.capability).toBeTruthy();
      expect(entry.openbuddyPlugin, entry.capability).toBeTruthy();
      expect(entry.pluginId, entry.capability).toBeTruthy();
    }
  });

  it("derives CAPABILITY_TO_PLUGIN_ID from the authority", () => {
    expect(CAPABILITY_TO_PLUGIN_ID.size).toBe(CAPABILITY_OWNERSHIP.length);
    for (const entry of CAPABILITY_OWNERSHIP) {
      expect(CAPABILITY_TO_PLUGIN_ID.get(entry.capability)).toBe(entry.pluginId);
    }
  });

  it("pluginIdForCapability matches the derived map", () => {
    for (const entry of CAPABILITY_OWNERSHIP) {
      expect(pluginIdForCapability(entry.capability)).toBe(entry.pluginId);
    }
  });

  it("reports passthrough-eligible vs openbuddy-owned subsets", () => {
    const eligible = listPassthroughEligible();
    const owned = listOpenBuddyOwned();
    expect(eligible.length + owned.length).toBe(CAPABILITY_OWNERSHIP.length);
    // team is the only capability that stays Cordis-owned.
    expect(owned.map((entry) => entry.capability)).toEqual(["team"]);
    expect(eligible.every((entry) => entry.passthrough)).toBe(true);
  });

  it("exposes pi and openbuddy plugin per capability", () => {
    expect(piPluginForCapability("fs")).toBe("pi-fs");
    expect(openbuddyPluginForCapability("fs")).toBe("openbuddy-fs-local");
    expect(piPluginForCapability("automation")).toBe("pi-goal-list-loop-audit");
    expect(openbuddyPluginForCapability("permission")).toBe("openbuddy-authorization");
  });

  it("detects distinct active backends and ignores duplicate reports", () => {
    const backends = [
      { capability: "mcp", backendId: "openbuddy-mcp-client" },
      { capability: "mcp", backendId: "pi-mcp-adapter" },
      { capability: "mcp", backendId: "pi-mcp-adapter" },
      { capability: "web", backendId: "pi-web-access" },
    ];
    expect(findCapabilityOwnershipConflicts(backends)).toEqual([
      {
        capability: "mcp",
        backends: [backends[0], backends[1]],
      },
    ]);
  });

  it("rejects a graph with duplicate capability owners", () => {
    expect(() =>
      assertNoCapabilityOwnershipConflicts([
        { capability: "task", backendId: "openbuddy-task" },
        { capability: "task", backendId: "pi-task" },
      ]),
    ).toThrow("capability ownership conflict (task: openbuddy-task, pi-task)");
    expect(() =>
      assertNoCapabilityOwnershipConflicts([
        { capability: "task", backendId: "openbuddy-task" },
        { capability: "task", backendId: "openbuddy-task" },
      ]),
    ).not.toThrow();
  });

  it("ignores incomplete backend declarations", () => {
    expect(findCapabilityOwnershipConflicts([
      { capability: "", backendId: "a" },
      { capability: "mcp", backendId: " " },
    ])).toEqual([]);
  });
  it("returns undefined for unknown capabilities", () => {
    expect(ownershipForCapability("nonexistent")).toBeUndefined();
    expect(piPluginForCapability("nonexistent")).toBeUndefined();
    expect(pluginIdForCapability("nonexistent")).toBeUndefined();
  });
});
