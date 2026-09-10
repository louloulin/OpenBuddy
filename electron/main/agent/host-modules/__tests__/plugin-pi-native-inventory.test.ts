/**
 * plugin-pi-native-inventory tests — Phase 7.2 of plan3.0.md.
 *
 * Pins the contract `buildPiNativeInventory` exposes to the renderer:
 *   - 10 builtin PI extensions are always reported (even with no cwd).
 *   - user extensions filter out builtin entries (builtIn flag respected).
 *   - empty marketplace / skills / agents fall back to [] (fail-soft).
 *   - schema version is "1" — bump when the response shape changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUILTIN_PI_PLUGIN_MANIFESTS } from "../../pi-extensions";
import { buildPiNativeInventory } from "../plugin-pi-native-inventory";
import * as marketplace from "../../pi-resources/marketplace";
import * as skills from "../../pi-resources/skills";
import * as agents from "../../pi-resources/agents";
import type { AgentHostState } from "../_state-shape";
import { createDefaultAgentHostState } from "../_default-state";

// Lazy-loaded pi-resources surfaces. Tests override the marketplace +
// skills + agents loaders to keep the test deterministic and offline.
vi.mock("../../pi-resources/marketplace", async () => {
  const actual = await vi.importActual<typeof import("../../pi-resources/marketplace")>("../../pi-resources/marketplace");
  return {
    ...actual,
    listPlugins: vi.fn(),
  };
});
vi.mock("../../pi-resources/skills", async () => {
  const actual = await vi.importActual<typeof import("../../pi-resources/skills")>("../../pi-resources/skills");
  return {
    ...actual,
    listSkills: vi.fn(),
  };
});
vi.mock("../../pi-resources/agents", async () => {
  const actual = await vi.importActual<typeof import("../../pi-resources/agents")>("../../pi-resources/agents");
  return {
    ...actual,
    listAgents: vi.fn(),
  };
});

const BUILTIN_IDS = new Set(BUILTIN_PI_PLUGIN_MANIFESTS.map((m) => m.id));

function makeState(extra: Partial<AgentHostState> = {}): AgentHostState {
  const base = createDefaultAgentHostState();
  return {
    ...base,
    cwd: extra.cwd ?? base.cwd ?? "/tmp",
    ...extra,
  };
}

describe("buildPiNativeInventory", () => {
  beforeEach(() => {
    vi.mocked(marketplace.listPlugins).mockResolvedValue([]);
    vi.mocked(skills.listSkills).mockResolvedValue([]);
    vi.mocked(agents.listAgents).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.mocked(marketplace.listPlugins).mockReset();
    vi.mocked(skills.listSkills).mockReset();
    vi.mocked(agents.listAgents).mockReset();
  });

  it("returns the 10 builtin PI extensions for a fresh state", async () => {
    const state = makeState({ piExtensionStatuses: [] });
    const inventory = await buildPiNativeInventory({ state, cwd: "/tmp" });

    expect(inventory.builtinExtensions).toHaveLength(BUILTIN_PI_PLUGIN_MANIFESTS.length);
    expect(inventory.builtinExtensions.map((e) => e.id)).toEqual(
      BUILTIN_PI_PLUGIN_MANIFESTS.map((m) => m.id),
    );
    expect(inventory.totals.builtin).toBe(BUILTIN_PI_PLUGIN_MANIFESTS.length);
    expect(inventory.totals.user).toBe(0);
    expect(inventory.totals.marketplace).toBe(0);
    expect(inventory.schemaVersion).toBe(1);
  });

  it("filters builtin entries out of the userExtensions slice", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "openbuddy-pi-inv-"));
    const state = makeState({
      cwd: tmp,
      piExtensionStatuses: [
        {
          id: "openbuddy-pi-observability",
          name: "openbuddy-pi-observability",
          kind: "pi",
          state: "loaded",
          builtIn: true,
          source: "/builtins/observability",
          packageName: "@openbuddy/builtin-pi-observability",
          version: "1.0.0",
          mode: "native",
          health: "healthy",
        },
        {
          id: "user-extension-foo",
          name: "user-extension-foo",
          kind: "pi",
          state: "loaded",
          builtIn: false,
          source: "/home/user/.pi/agent/extensions/foo",
          sourceScope: "user",
          packageName: "@user/foo",
          version: "0.1.2",
          mode: "native",
          health: "healthy",
          toolCount: 3,
          hookCount: 1,
        },
        {
          id: "user-extension-bar",
          name: "user-extension-bar",
          kind: "pi",
          state: "failed",
          builtIn: false,
          source: "/home/user/.pi/agent/extensions/bar",
          sourceScope: "user",
          packageName: "@user/bar",
          version: "0.0.1",
          mode: "adapter",
          health: "failed",
        },
      ],
    });

    const inventory = await buildPiNativeInventory({ state, cwd: tmp });

    expect(inventory.userExtensions).toHaveLength(2);
    expect(inventory.userExtensions.map((e) => e.id)).toEqual([
      "user-extension-foo",
      "user-extension-bar",
    ]);
    expect(inventory.userExtensions.every((e) => !BUILTIN_IDS.has(e.id))).toBe(true);
    expect(inventory.userExtensions[0]).toMatchObject({
      id: "user-extension-foo",
      packageName: "@user/foo",
      version: "0.1.2",
      mode: "native",
      health: "healthy",
      toolCount: 3,
      hookCount: 1,
    });
    expect(inventory.userExtensions[1]).toMatchObject({
      id: "user-extension-bar",
      state: "failed",
      mode: "adapter",
      health: "failed",
    });
    expect(inventory.totals.user).toBe(2);
  });

  it("propagates marketplace + skills + agents counts from the resource loaders", async () => {
    vi.mocked(marketplace.listPlugins).mockResolvedValue([
      {
        name: "openbuddy-team",
        root: "/home/user/.pi/marketplace/openbuddy-team",
        scope: "user",
        trusted: true,
        enabled: true,
        skillCount: 0,
        skillNames: [],
        agentCount: 0,
        agentNames: [],
        hookCount: 0,
        hookPoints: [],
        hookDiagnostics: [],
        mcpServerCount: 0,
      },
    ] as never);
    vi.mocked(skills.listSkills).mockResolvedValue([
      {
        name: "pdf",
        description: "Render PDF markup",
        enabled: true,
        path: "/skills/pdf",
      },
    ] as never);
    vi.mocked(agents.listAgents).mockResolvedValue([
      {
        name: "code-review",
        path: "/agents/code-review.md",
      },
    ] as never);

    const state = makeState({ cwd: "/tmp", piExtensionStatuses: [] });
    const inventory = await buildPiNativeInventory({ state, cwd: "/tmp" });

    expect(inventory.marketplacePackages).toHaveLength(1);
    expect(inventory.marketplacePackages[0]).toEqual({
      name: "openbuddy-team",
      root: "/home/user/.pi/marketplace/openbuddy-team",
      enabled: true,
    });
    expect(inventory.skills).toHaveLength(1);
    expect(inventory.skills[0]).toEqual({
      name: "pdf",
      description: "Render PDF markup",
      path: "/skills/pdf",
      enabled: true,
    });
    expect(inventory.agents).toHaveLength(1);
    expect(inventory.agents[0]).toEqual({
      name: "code-review",
      path: "/agents/code-review.md",
    });
    expect(inventory.totals).toEqual({
      builtin: BUILTIN_PI_PLUGIN_MANIFESTS.length,
      user: 0,
      marketplace: 1,
      skills: 1,
      agents: 1,
    });
  });

  it("falls back to empty arrays when the resource loaders throw", async () => {
    vi.mocked(marketplace.listPlugins).mockRejectedValue(new Error("offline"));
    vi.mocked(skills.listSkills).mockRejectedValue(new Error("offline"));
    vi.mocked(agents.listAgents).mockRejectedValue(new Error("offline"));

    const state = makeState({ cwd: "/tmp", piExtensionStatuses: [] });
    const inventory = await buildPiNativeInventory({ state, cwd: "/tmp" });

    expect(inventory.marketplacePackages).toEqual([]);
    expect(inventory.skills).toEqual([]);
    expect(inventory.agents).toEqual([]);
    // builtin still populated
    expect(inventory.builtinExtensions.length).toBeGreaterThan(0);
    expect(inventory.totals.builtin).toBe(BUILTIN_PI_PLUGIN_MANIFESTS.length);
  });
});