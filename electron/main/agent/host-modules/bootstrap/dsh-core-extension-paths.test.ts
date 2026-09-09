/**
 * dsh-core-extension-paths.test.ts — Phase B.3 step 2b tests.
 *
 * Verifies the path resolver wired into init-deepseek.ts maps the
 * `@openbuddy/dsh-core` package names onto the concrete TS source
 * paths PI `discoverAndLoadExtensions()` accepts. The override field
 * (`state.dshCoreExtensionPathsOverride`) takes priority over the
 * default resolution, which lets tests inject virtual paths.
 */

import { describe, expect, it } from "vitest";
import { resolveDshCoreExtensionPaths } from "./dsh-core-extension-paths";

describe("resolveDshCoreExtensionPaths (Phase B.3 step 2b)", () => {
  it("returns the @openbuddy/dsh-core default paths when override is empty", () => {
    const paths = resolveDshCoreExtensionPaths({ dshCoreExtensionPathsOverride: [] });
    // Two extensions per v13 §33.2: goals + message-feedback.
    expect(paths).toHaveLength(2);
    expect(paths.some((p) => p.endsWith("/packages/runtime/openbuddy-dsh-core/src/goals.ts"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/packages/runtime/openbuddy-dsh-core/src/message-feedback.ts"))).toBe(true);
  });

  it("returns the override list verbatim when non-empty", () => {
    const override = ["/virtual/goals.ts", "/virtual/feedback.ts", "/virtual/extra.ts"];
    const paths = resolveDshCoreExtensionPaths({ dshCoreExtensionPathsOverride: override });
    expect(paths).toEqual(override);
  });

  it("override list of length zero falls back to defaults (B.3 step 2a behaviour)", () => {
    const paths = resolveDshCoreExtensionPaths({ dshCoreExtensionPathsOverride: [] });
    // Should be the default resolution (goals + message-feedback).
    expect(paths.length).toBeGreaterThan(0);
  });

  it("returned list is a fresh array (no aliasing across calls)", () => {
    const a = resolveDshCoreExtensionPaths({ dshCoreExtensionPathsOverride: ["/x"] });
    const b = resolveDshCoreExtensionPaths({ dshCoreExtensionPathsOverride: ["/x"] });
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});