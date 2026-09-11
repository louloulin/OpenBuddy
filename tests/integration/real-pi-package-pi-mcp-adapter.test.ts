/**
 * Real e2e for `pi-mcp-adapter` (G8 PR 1, plan4.1.md §9.16).
 *
 * Verifies that the canonical MCP adapter package installs and exposes
 * a runnable main entry. Listed in
 * `electron/main/agent/pi-extension-discovery.ts:29`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupTempDir,
  inspectInstalledPackage,
  tryInstallCanonicalPiPackage,
  type InstallResult,
} from "../../src/test-integration-helpers/index";

describe("canonical-pi: pi-mcp-adapter real install (G8 PR 1)", () => {
  let result: InstallResult;

  beforeAll(() => {
    result = tryInstallCanonicalPiPackage("pi-mcp-adapter", 120_000);
  }, 120_000);

  afterAll(() => {
    if (result?.cwd) cleanupTempDir(result.cwd);
  });

  it("is published on npm (not spec-only)", () => {
    expect(result.specOnly).toBe(false);
  });

  it("installs successfully via pnpm add", () => {
    if (result.specOnly) {
      // Spec-only packages skip the install step — no-op this assertion.
      return;
    }
    expect(result.installed).toBe(true);
  });

  it("exposes a package.json with name and version", () => {
    if (result.specOnly) return;
    const meta = inspectInstalledPackage(result.cwd, "pi-mcp-adapter");
    expect(meta.hasNodeModules).toBe(true);
    expect(meta.name).toBe("pi-mcp-adapter");
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("has a loadable entry (main / exports / bin)", () => {
    if (result.specOnly) return;
    const meta = inspectInstalledPackage(result.cwd, "pi-mcp-adapter");
    expect(meta.hasEntry).toBe(true);
  });
});