/**
 * Real e2e for `pi-automation` (G8 PR 2, plan4.1.md §9.16.8).
 *
 * Verifies that the canonical automation package installs and exposes
 * a loadable entry. Listed in
 * `electron/main/agent/pi-extension-discovery.ts:45`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupTempDir,
  inspectInstalledPackage,
  tryInstallCanonicalPiPackage,
  type InstallResult,
} from "../../src/test-integration-helpers/index";

describe("canonical-pi: pi-automation real install (G8 PR 2)", () => {
  let result: InstallResult;

  beforeAll(() => {
    result = tryInstallCanonicalPiPackage("pi-automation", 120_000);
  }, 120_000);

  afterAll(() => {
    if (result?.cwd) cleanupTempDir(result.cwd);
  });

  it("is published on npm (not spec-only)", () => {
    expect(result.specOnly).toBe(false);
  });

  it("installs successfully via pnpm add", () => {
    if (result.specOnly) return;
    expect(result.installed).toBe(true);
  });

  it("exposes a package.json with name and version", () => {
    if (result.specOnly) return;
    const meta = inspectInstalledPackage(result.cwd, "pi-automation");
    expect(meta.hasNodeModules).toBe(true);
    expect(meta.name).toBe("pi-automation");
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("has a loadable entry (main / exports / bin / pi.extensions)", () => {
    if (result.specOnly) return;
    const meta = inspectInstalledPackage(result.cwd, "pi-automation");
    expect(meta.hasEntry).toBe(true);
  });
});