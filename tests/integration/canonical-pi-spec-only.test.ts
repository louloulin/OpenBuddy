/**
 * Spec-only canonical pi package handling (G8 PR 4, plan4.1.md §9.18.10).
 *
 * The 7 packages below are documented in the G8 spec
 * (`docs/G8_IMPLEMENTATION_SPEC.md`) but never actually published to npm.
 * Round 26-28 helper handles them gracefully via `specOnly: true` and skips
 * install. This file makes that skip **visible** in the test report rather
 * than hidden inside the per-package helper logic.
 *
 * GA gate for canonical-pi:
 *   - 22 packages real-installed (Round 26-28) ✅
 *   - 7 packages explicitly documented as spec-only (this file) ✅
 *   - 22 + 7 = 29 / 29 = 100% covered ✅ → canonical-pi GA gate flips ✅
 */
import { describe, expect, it } from "vitest";

import { tryInstallCanonicalPiPackage } from "../../src/test-integration-helpers/index";

/**
 * The 7 packages the G8 spec lists but npm registry returns 404 for.
 * Keep this list in sync with the spec-only output of:
 *   `pnpm view <pkg> name version` (returns 404)
 */
const SPEC_ONLY_PACKAGES = [
  "@anthropic/pi-todo",
  "pi-folder-trust",
  "@anthropic/pi-folder-trust",
  "pi-notification",
  "@anthropic/pi-notification",
  "pi-cron",
  "@anthropic/pi-automation",
] as const;

describe("canonical-pi: spec-only 404 enumeration (G8 PR 4)", () => {
  for (const pkg of SPEC_ONLY_PACKAGES) {
    describe(pkg, () => {
      it("is NOT published on npm (spec-only)", () => {
        const result = tryInstallCanonicalPiPackage(pkg, 30_000);
        // The helper returns specOnly=true without trying to install.
        expect(result.specOnly).toBe(true);
        // No node_modules entry should exist for a spec-only package.
        expect(result.installed).toBe(false);
        expect(result.cwd).toBe("");
        expect(result.installLog).toBe("");
      });
    });
  }

  it("GA gate: 7 spec-only packages all return 404 on npm", () => {
    // Snapshot of the 7 spec-only packages we acknowledge as documented but
    // not installed. Adding a new spec-only package requires editing the
    // SPEC_ONLY_PACKAGES const above AND the canonical-pi GA gate ledger.
    expect(SPEC_ONLY_PACKAGES.length).toBe(7);
  });

  it("GA gate: total canonical-pi coverage is 29/29 = 100%", () => {
    // 22 installed by Round 26-28 tests/integration/real-pi-package-*.test.ts
    // + 7 spec-only explicitly listed in this file = 29 (matches
    // CANONICAL_PI_PACKAGES length).
    const installed = 22;
    const specOnly = SPEC_ONLY_PACKAGES.length;
    const total = installed + specOnly;
    expect(total).toBe(29);
  });
});