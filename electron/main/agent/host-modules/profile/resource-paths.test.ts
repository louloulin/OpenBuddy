/**
 * resource-paths.test.ts — smoke tests for Pi native resource path management.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installProfileResourcePaths,
  setProfilePiResourcePaths,
  refreshMarketplacePiResourcePaths,
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
      { extensions: [], skills: ["/market/skill1", "/profile/skill1"], prompts: [], themes: [] },
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
      { extensions: [], skills: ["/profile/pkg/skill-internal"], prompts: [], themes: [] },
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

  it("profileArtifactModuleUrl adds openbuddy_profile_reload query", () => {
    const state = installState();
    state.profileArtifactGeneration = 7;
    expect(profileArtifactModuleUrl("/path/to/mod")).toBe("openbuddy:///path/to/mod?openbuddy_profile_reload=7");
  });
});
