/**
 * Tests for the renderer-safe PI package catalog (UX-1).
 *
 * The catalog is a static mirror of `compatibilityAdapters` in
 * `electron/main/agent/pi-extensions.ts` so the marketplace card can render
 * the pi-priority chip without an IPC round-trip. The two sources MUST stay
 * in sync — these tests pin the packageNames + passthrough flags that the
 * chip rendering depends on, so a regression in either the catalog or the
 * adapter table surfaces here.
 */

import { describe, expect, it } from "vitest";
import {
  PI_PACKAGE_CATALOG,
  findPiPackageCatalogEntry,
} from "../src/index";

describe("PI_PACKAGE_CATALOG", () => {
  it("contains the 12 baseline capability adapters", () => {
    // The number is fixed by design — adding/removing adapters must be a
    // deliberate decision (and update docs/PI-PRIORITY.md alongside).
    expect(PI_PACKAGE_CATALOG).toHaveLength(12);
  });

  it("every entry declares a unique capability id", () => {
    const capabilities = PI_PACKAGE_CATALOG.map((e) => e.capability);
    expect(new Set(capabilities).size).toBe(capabilities.length);
  });

  it("every entry declares a non-empty packageNames list", () => {
    for (const entry of PI_PACKAGE_CATALOG) {
      expect(entry.packageNames.length).toBeGreaterThan(0);
      for (const name of entry.packageNames) {
        expect(name.length).toBeGreaterThan(0);
      }
    }
  });

  it("no package name appears in more than one entry", () => {
    const seen = new Map<string, string>();
    for (const entry of PI_PACKAGE_CATALOG) {
      for (const name of entry.packageNames) {
        const prior = seen.get(name);
        expect(prior, `package ${name} appears in both ${prior} and ${entry.capability}`).toBeUndefined();
        seen.set(name, entry.capability);
      }
    }
  });

  it("passthrough=true entries carry a piPackageHint (used for install detection)", () => {
    for (const entry of PI_PACKAGE_CATALOG) {
      if (entry.passthrough) {
        expect(entry.piPackageHint, `entry ${entry.capability} is passthrough but lacks piPackageHint`).toBeTruthy();
      }
    }
  });

  it("preserves the canonical OpenBuddy mcp capability as the only one already wired with passthroughCapability in Cordis", () => {
    // mcp is the reference adapter; the chip rendering relies on its
    // passthrough flag being true so a freshly installed pi-mcp-adapter
    // surfaces the chip the first time the user visits the marketplace.
    const mcp = findPiPackageCatalogEntry("pi-mcp-adapter");
    expect(mcp?.capability).toBe("mcp");
    expect(mcp?.passthrough).toBe(true);
  });
});

describe("findPiPackageCatalogEntry", () => {
  it("returns the entry when given a known primary package name", () => {
    expect(findPiPackageCatalogEntry("pi-mcp-adapter")?.capability).toBe("mcp");
    expect(findPiPackageCatalogEntry("pi-goal")?.capability).toBe("goal");
    expect(findPiPackageCatalogEntry("pi-goal-list-loop-audit")?.capability).toBe("automation");
  });

  it("returns the entry when given a known alias", () => {
    expect(findPiPackageCatalogEntry("@narumitw/pi-goal")?.capability).toBe("goal");
    expect(findPiPackageCatalogEntry("@plannotator/pi-extension")?.capability).toBe("plan");
    expect(findPiPackageCatalogEntry("pi-todo")?.capability).toBe("task");
  });

  it("returns undefined for unknown packages", () => {
    expect(findPiPackageCatalogEntry("pi-not-a-real-package")).toBeUndefined();
    expect(findPiPackageCatalogEntry("")).toBeUndefined();
  });

  it("marks every entry as passthrough (P-3 unified catalog: all adapters honor pi install detection)", () => {
    // P-3 unified the catalog behind one rule: if a pi package is installed
    // that matches the entry's packageNames, OpenBuddy records a passthrough
    // for that capability and the Cordis fallback short-circuits. The catalog
    // mirrors that — every entry must read passthrough=true here, and the
    // single source of truth for "is pi installed?" is R-X1's 3-tier probe
    // (root require.resolve → root node_modules → <agentHome>/plugins/<name>).
    // No entry should claim passthrough=false; that flag is now redundant.
    for (const entry of PI_PACKAGE_CATALOG) {
      expect(entry.passthrough, `entry ${entry.capability} should be passthrough=true`).toBe(true);
    }
    // Spot-check the two entries that were flipped in P-3 (session + fs).
    // Earlier revisions had these as passthrough=false; the catalog and the
    // Cordis capability-plugins.ts now agree (session/fs have
    // passthroughCapability wired in stage P-3).
    expect(findPiPackageCatalogEntry("pi-session")?.passthrough).toBe(true);
    expect(findPiPackageCatalogEntry("pi-fs")?.passthrough).toBe(true);
  });

  it("catalogs the automation capability as the highest-priority passthrough (Stage H-4 migration target)", () => {
    // Stage H-4 deleted the openbuddy-automation Cordis stub; the chip is
    // how users discover that pi-goal-list-loop-audit owns the surface.
    const entry = findPiPackageCatalogEntry("pi-goal-list-loop-audit");
    expect(entry?.capability).toBe("automation");
    expect(entry?.passthrough).toBe(true);
    expect(entry?.owner).toBe("pi-goal-list-loop-audit");
  });
});
