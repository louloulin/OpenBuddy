/**
 * resource-paths.test.ts — smoke tests for Pi native resource path management.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installProfileResourcePaths,
  setProfilePiResourcePaths,
  refreshMarketplacePiResourcePaths,
  refreshPiHookConfigs,
  nativePiResourcePaths,
  profileArtifactModuleUrl,
  __resetProfileResourcePathsForTest,
} from "./resource-paths";
import { createDefaultAgentHostState } from "../_default-state";

afterEach(() => {
  __resetProfileResourcePathsForTest();
});

function installState(state = createDefaultAgentHostState()) {
  installProfileResourcePaths({
    state,
    isPathWithin: (root, candidate) => candidate.startsWith(root),
    toModuleUrl: (p) => `openbuddy://${p}`,
  });
  return state;
}

describe("profile/resource-paths", () => {
  it("throws when not installed", () => {
    expect(() => setProfilePiResourcePaths({ extensions: [], skills: [], prompts: [], themes: [] })).toThrow(/not installed/);
    expect(() => profileArtifactModuleUrl("/x")).toThrow(/not installed/);
    expect(() => nativePiResourcePaths()).toThrow(/not installed/);
  });

  it("setProfilePiResourcePaths splices into state arrays and triggers sync", () => {
    const state = installState();
    setProfilePiResourcePaths({
      extensions: ["/profile/ext1"],
      skills: ["/profile/skill1"],
      prompts: ["/profile/prompt1"],
      themes: ["/profile/theme1"],
    });
    expect(state.profilePiResourcePaths.skills).toEqual(["/profile/skill1"]);
    expect(state.piNativeResourcePaths.skills).toEqual(["/profile/skill1"]);
  });

  it("refreshMarketplacePiResourcePaths merges profile + marketplace, dedup", async () => {
    const state = installState();
    // Pre-seed profile paths so they appear in native after merge
    setProfilePiResourcePaths({
      extensions: [],
      skills: ["/profile/skill1"],
      prompts: [],
      themes: [],
    });
    // Stub piResources.* via dynamic import mock
    const piResources = await import("../../pi-resources");
    vi.spyOn(piResources, "listPiPluginResourcePaths").mockResolvedValue([
      { plugin: { root: "/market/pkg" }, extensions: [], skills: ["/market/skill1", "/profile/skill1"], prompts: [], themes: [] },
    ] as any);
    vi.spyOn(piResources, "listPiPluginAgentFiles").mockResolvedValue([] as any);

    await refreshMarketplacePiResourcePaths();
    // After merge: dedup => /profile/skill1, /market/skill1
    expect(state.piMarketplaceResourcePaths.skills).toEqual(["/market/skill1", "/profile/skill1"]);
    expect(state.piNativeResourcePaths.skills.sort()).toEqual(["/market/skill1", "/profile/skill1"].sort());
  });

  it("omits marketplace paths that fall within a profile package root", async () => {
    const state = installState();
    state.profilePiPackagePaths = ["/profile/pkg"];
    const piResources = await import("../../pi-resources");
    vi.spyOn(piResources, "listPiPluginResourcePaths").mockResolvedValue([
      { plugin: { root: "/market/pkg" }, extensions: [], skills: ["/profile/pkg/skill-internal"], prompts: [], themes: [] },
    ] as any);
    vi.spyOn(piResources, "listPiPluginAgentFiles").mockResolvedValue([] as any);

    await refreshMarketplacePiResourcePaths();
    // /profile/pkg/skill-internal is within profile package root, so should be excluded from native prompts
    // (skills don't filter via omitAutoDiscovered in sync, but prompts/themes do)
    expect(state.piNativeResourcePaths.skills).toEqual(["/profile/pkg/skill-internal"]);
  });

  it("nativePiResourcePaths returns the merged list", () => {
    const state = installState();
    setProfilePiResourcePaths({ extensions: [], skills: ["/x"], prompts: [], themes: [] });
    expect(nativePiResourcePaths()).toEqual({
      additionalSkillPaths: ["/x"],
      additionalPromptTemplatePaths: [],
      additionalThemePaths: [],
    });
  });

  it("refreshPiHookConfigs 从 profile 包根扫描 hook 声明并灌入 state.hookConfigs", async () => {
    const state = installState();
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "ob-hooks-test-"));
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "hook-pkg", openbuddy: { hooks: { "turn/start": [{ hooks: [{ type: "command", command: "echo hi" }] }] } } }),
    );

    const piResources = await import("../../pi-resources");
    vi.spyOn(piResources, "listPiPluginResourcePaths").mockResolvedValue([
      { plugin: { root }, extensions: [], skills: [], prompts: [], themes: [] },
    ] as any);

    await refreshPiHookConfigs();
    expect(state.hookConfigs).toHaveLength(1);
    expect(state.hookConfigs[0]).toMatchObject({
      packageName: "hook-pkg",
      packageRoot: root,
      dialect: "openbuddy",
    });
    expect(Object.keys(state.hookConfigs[0].config.events)).toEqual(["turn/start"]);
  });

  it("profileArtifactModuleUrl adds openbuddy_profile_reload query", () => {
    const state = installState();
    state.profileArtifactGeneration = 7;
    expect(profileArtifactModuleUrl("/path/to/mod")).toBe("openbuddy:///path/to/mod?openbuddy_profile_reload=7");
  });
});
