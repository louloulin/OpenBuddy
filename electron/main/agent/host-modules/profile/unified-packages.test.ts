/**
 * unified-packages.test.ts — smoke tests for profilePackages unified view.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installUnifiedPackages,
  profilePackages,
  __resetUnifiedPackagesForTest,
} from "./unified-packages";
import { createDefaultAgentHostState } from "../_default-state";

afterEach(() => {
  __resetUnifiedPackagesForTest();
});

function installState(state = createDefaultAgentHostState()) {
  installUnifiedPackages({
    state,
    discoverRendererPluginManifest: async () => [],
  });
  return state;
}

describe("profile/unified-packages", () => {
  it("throws when not installed", async () => {
    await expect(profilePackages()).rejects.toThrow(/not installed/);
  });

  it("throws when profileOptions is not initialized", async () => {
    installState();
    // No profileOptions set
    await expect(profilePackages()).rejects.toThrow(/not initialized/);
  });

  it("profilePackages merges surfaces and projects health", async () => {
    const state = installState();
    state.profileOptions = {
      profileDir: "/fake/profile",
    };
    state.piExtensionStatuses = [
      { packageName: "pkg-a", state: "loaded" } as any,
      { packageName: "pkg-a", state: "failed" } as any,
      { packageName: "pkg-b", state: "loaded" } as any,
    ];
    (state as unknown as Record<string, unknown>).profileRemoteContributions = new Set(["pkg-c"]);
    (state as unknown as Record<string, unknown>).profileTypertContributions = new Set(["pkg-d"]);

    // Stub plugin-host functions
    const pluginHost = await import("@openbuddy/plugin-host");
    vi.spyOn(pluginHost, "listProfilePackages").mockResolvedValue([
      {
        name: "pkg-a",
        bundle: false,
        pi: true,
        client: false,
        remote: false,
        typert: false,
        cordis: false,
        health: "healthy",
        manifest: {} as any,
      },
      {
        name: "pkg-b",
        bundle: false,
        pi: true,
        client: false,
        remote: false,
        typert: false,
        cordis: false,
        health: "healthy",
        manifest: {} as any,
      },
      {
        name: "pkg-c",
        bundle: false,
        pi: false,
        client: false,
        remote: true,
        typert: false,
        cordis: false,
        health: "healthy",
        manifest: {} as any,
      },
      {
        name: "pkg-d",
        bundle: false,
        pi: false,
        client: false,
        remote: false,
        typert: true,
        cordis: false,
        health: "healthy",
        manifest: {} as any,
      },
    ] as any);
    vi.spyOn(pluginHost, "readOpenBuddyProfile").mockResolvedValue({
      bundles: [],
    } as any);
    vi.spyOn(pluginHost, "updateUnifiedPluginManifest").mockImplementation((m, update) => ({ ...m, ...update } as any));

    const result = await profilePackages();
    expect(result).toHaveLength(4);
    // pkg-a has pi:loaded + pi:failed -> health=degraded, loaded includes "pi"
    const pkgA = result.find((r) => r.name === "pkg-a");
    expect(pkgA?.manifest).toMatchObject({ loaded: ["pi"], health: "degraded" });
    // pkg-b: pi healthy -> loaded includes "pi", health stays healthy
    const pkgB = result.find((r) => r.name === "pkg-b");
    expect(pkgB?.manifest).toMatchObject({ loaded: ["pi"], health: "healthy" });
    // pkg-c: remote contribution -> loaded includes "remote"
    const pkgC = result.find((r) => r.name === "pkg-c");
    expect(pkgC?.manifest).toMatchObject({ loaded: ["remote"], health: "healthy" });
    // pkg-d: typert contribution -> loaded includes "typert"
    const pkgD = result.find((r) => r.name === "pkg-d");
    expect(pkgD?.manifest).toMatchObject({ loaded: ["typert"], health: "healthy" });
  });
});
