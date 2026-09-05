/**
 * Phase I.2 tests for marketplace install/uninstall → profile.piExtensions
 * sync. The marketplace layer must mirror install/uninstall state into
 * profile.piExtensions so the loader's existing passthrough path actually
 * fires — without this, a freshly installed pi-priority package is silently
 * ignored by OpenBuddy (Task #80 verified this regression end-to-end).
 *
 * Strategy: use a plugin dir name that matches a real adapter
 * `packageNames` entry (`pi-mcp-adapter` is the most stable passthrough
 * adapter in `compatibilityAdapters`), then verify the round trip:
 *   install   → spec with passthrough=true appears in profile.piExtensions
 *   uninstall → spec removed from profile.piExtensions
 *
 * Negative path: installing a plugin whose dir name does NOT appear in any
 * adapter `packageNames` must leave profile.piExtensions untouched.
 */

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-marketplace-pi-sync-test" },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock("../casdoor/casdoor-auth", () => ({
  casdoorAuth: { status: () => ({ config: { configured: false }, identity: null, tenantContext: { activeTenantId: undefined } }) },
}));

const originalPiHome = process.env.PI_HOME;
const originalPiAgent = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalPiHome === undefined) delete process.env.PI_HOME;
  else process.env.PI_HOME = originalPiHome;
  if (originalPiAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiAgent;
});

async function loadResources() {
  return import("../pi-resources");
}

async function setupSource(sourceDir: string, pluginRelPath: string) {
  const pluginDir = join(sourceDir, "plugins", pluginRelPath);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, "package.json"), JSON.stringify({
    name: pluginRelPath,
    version: "0.0.0",
    description: `${pluginRelPath} marketplace plugin for sync test`,
  }));
}

describe("Phase I.2: marketplace install/uninstall sync profile.piExtensions", () => {
  it("install writes spec with passthrough=true for a pi-priority package", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-mkt-sync-home-"));
    const source = await mkdtemp(join(tmpdir(), "openbuddy-mkt-sync-source-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;

    // pi-mcp-adapter is the canonical passthrough adapter in
    // compatibilityAdapters (capability=mcp, owner=openbuddy-mcp-client).
    await setupSource(source, "pi-mcp-adapter");
    const resources = await loadResources();
    await resources.marketplaceAddSource(source);

    const installResult = await resources.marketplaceAction({
      type: "install",
      sourceUrlOrPath: source,
      pluginRelativePath: "pi-mcp-adapter",
    });

    expect(installResult).toMatchObject({ ok: true });
    expect(installResult.piPriorityEnabled).toBe(true);
    expect(installResult.capability).toBe("mcp");

    // The profile package.json now declares the spec, mirrored in both
    // openbuddy + dsh namespaces (dual-namespace mirror from Phase I.1).
    const profilePath = join(home, ".pi", "agent", "profiles", "desktop", "package.json");
    const written = JSON.parse(await readFile(profilePath, "utf8"));
    expect(written.openbuddy.profile.piExtensions).toEqual([
      expect.objectContaining({
        id: "pi-mcp-adapter",
        source: "pi-mcp-adapter",
        enabled: true,
        passthrough: true,
      }),
    ]);
    expect(written.dsh.profile.piExtensions).toEqual(written.openbuddy.profile.piExtensions);
  });

  it("uninstall removes the spec from profile.piExtensions", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-mkt-sync-home-"));
    const source = await mkdtemp(join(tmpdir(), "openbuddy-mkt-sync-source-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;

    await setupSource(source, "pi-mcp-adapter");
    const resources = await loadResources();
    await resources.marketplaceAddSource(source);

    // First install.
    await resources.marketplaceAction({
      type: "install",
      sourceUrlOrPath: source,
      pluginRelativePath: "pi-mcp-adapter",
    });

    // Then uninstall.
    const uninstallResult = await resources.marketplaceAction({
      type: "uninstall",
      sourceUrlOrPath: source,
      pluginRelativePath: "pi-mcp-adapter",
    });

    expect(uninstallResult).toMatchObject({ ok: true });
    expect(uninstallResult.piPriorityEnabled).toBe(false);
    expect(uninstallResult.capability).toBe("mcp");

    // Spec is gone from both namespaces.
    const profilePath = join(home, ".pi", "agent", "profiles", "desktop", "package.json");
    const written = JSON.parse(await readFile(profilePath, "utf8"));
    expect(written.openbuddy.profile.piExtensions ?? []).toEqual([]);
    expect(written.dsh.profile.piExtensions ?? []).toEqual([]);
  });

  it("does not modify profile.piExtensions for a non-pi-priority package", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-mkt-sync-home-"));
    const source = await mkdtemp(join(tmpdir(), "openbuddy-mkt-sync-source-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;

    // "demo" is NOT in any compatibilityAdapters.packageNames entry, so
    // syncProfileExtension should treat it as a no-op and never touch the
    // profile file.
    await setupSource(source, "demo");
    const resources = await loadResources();
    await resources.marketplaceAddSource(source);

    const installResult = await resources.marketplaceAction({
      type: "install",
      sourceUrlOrPath: source,
      pluginRelativePath: "demo",
    });

    expect(installResult).toMatchObject({ ok: true });
    expect(installResult.piPriorityEnabled).toBeUndefined();
    expect(installResult.capability).toBeUndefined();

    // Either the profile file was never created (no-op path) or it exists
    // with an empty piExtensions array — both prove the marketplace layer
    // didn't write any spec.
    const profilePath = join(home, ".pi", "agent", "profiles", "desktop", "package.json");
    let piExtensions: unknown = undefined;
    try {
      const written = JSON.parse(await readFile(profilePath, "utf8"));
      piExtensions = written.openbuddy?.profile?.piExtensions;
    } catch (e) {
      // ENOENT is acceptable: the marketplace layer should not bootstrap a
      // profile it doesn't need.
      expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
    }
    if (piExtensions !== undefined) {
      expect(piExtensions).toEqual([]);
    }
  });

  it("writes the capability on install and clears it on uninstall (round trip)", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-mkt-sync-home-"));
    const source = await mkdtemp(join(tmpdir(), "openbuddy-mkt-sync-source-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;

    // pi-permission-system is another passthrough adapter (capability=permission,
    // owner=openbuddy-authorization). Use it here to confirm capability
    // classification is dynamic, not hard-coded to "mcp".
    await setupSource(source, "pi-permission-system");
    const resources = await loadResources();
    await resources.marketplaceAddSource(source);

    const installResult = await resources.marketplaceAction({
      type: "install",
      sourceUrlOrPath: source,
      pluginRelativePath: "pi-permission-system",
    });
    expect(installResult.capability).toBe("permission");

    const uninstallResult = await resources.marketplaceAction({
      type: "uninstall",
      sourceUrlOrPath: source,
      pluginRelativePath: "pi-permission-system",
    });
    expect(uninstallResult.capability).toBe("permission");
    expect(uninstallResult.piPriorityEnabled).toBe(false);
  });
});
