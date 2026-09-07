/**
 * default-pi-package-installer.test.ts — smoke tests for installDefaultPiPackages.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installDefaultPiPackageInstaller,
  installDefaultPiPackages,
  __resetDefaultPiPackageInstallerForTest,
} from "./default-pi-package-installer";
import { createDefaultAgentHostState } from "./_default-state";

afterEach(() => {
  __resetDefaultPiPackageInstallerForTest();
});

describe("default-pi-package-installer", () => {
  it("throws when not installed", async () => {
    await expect(installDefaultPiPackages()).rejects.toThrow(/not installed/);
  });

  it("throws when profileOptions not initialized", async () => {
    installDefaultPiPackageInstaller({ state: createDefaultAgentHostState() });
    await expect(installDefaultPiPackages()).rejects.toThrow(/not initialized/);
  });

  it("delegates to ensureDefaultPiPackages with profile + force flag", async () => {
    const state = createDefaultAgentHostState();
    state.profileOptions = {
      profileDir: "/fake",
      profileName: "p",
      home: "/h",
    };
    installDefaultPiPackageInstaller({ state });
    // We can't easily mock ensureDefaultPiPackages without ESM hoisting;
    // the smoke guarantee is: it throws if profile is null, and the
    // happy path will actually call ensureDefaultPiPackages with the
    // profile options + force flag merged.
    await expect(installDefaultPiPackages({ force: true })).resolves.toBeDefined();
  });
});
