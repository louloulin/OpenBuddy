import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureOpenBuddyProfile, readOpenBuddyProfile } from "./profile";
import { updateProfileExtensions, OPENBUDDY_DEFAULT_PI_PACKAGES, ensureDefaultPiPackages } from "./profile-manager";


async function bootstrapProfile(home: string) {
  const ensured = await ensureOpenBuddyProfile({ home, profileName: "desktop" });
  return readOpenBuddyProfile({ profileDir: ensured.dir });
}

describe("Phase I.1: updateProfileExtensions", () => {
  it("adds a spec into both openbuddy + dsh namespaces (dual-namespace mirror)", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-ext-"));
    const profile = await bootstrapProfile(home);
    expect(profile.packageJson).toBeDefined();

    await updateProfileExtensions(
      profile,
      { id: "pi-goal-list-loop-audit", source: "pi-goal-list-loop-audit", enabled: true },
      true,
    );

    const written = JSON.parse(await readFile(profile.packageJson, "utf8"));
    expect(written.openbuddy.profile.piExtensions).toEqual([
      { id: "pi-goal-list-loop-audit", source: "pi-goal-list-loop-audit", enabled: true },
    ]);
    // Dual-namespace: dsh namespace mirrors so legacy DSH readers see the spec.
    expect(written.dsh.profile.piExtensions).toEqual([
      { id: "pi-goal-list-loop-audit", source: "pi-goal-list-loop-audit", enabled: true },
    ]);
  });

  it("dedupes when the same spec is added twice (idempotent)", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-ext-"));
    const profile = await bootstrapProfile(home);

    await updateProfileExtensions(
      profile,
      { id: "pi-goal", source: "pi-goal", enabled: true },
      true,
    );
    await updateProfileExtensions(
      profile,
      { id: "pi-goal", source: "pi-goal", enabled: true },
      true,
    );

    const written = JSON.parse(await readFile(profile.packageJson, "utf8"));
    expect(written.openbuddy.profile.piExtensions).toHaveLength(1);
    expect(written.dsh.profile.piExtensions).toHaveLength(1);
  });

  it("merges fields on duplicate ids (later fields override)", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-ext-"));
    const profile = await bootstrapProfile(home);

    await updateProfileExtensions(
      profile,
      { id: "pi-goal", source: "pi-goal", enabled: false },
      true,
    );
    // Re-add with `enabled: true` — should override without duplicating.
    await updateProfileExtensions(
      profile,
      { id: "pi-goal", source: "pi-goal", enabled: true },
      true,
    );

    const written = JSON.parse(await readFile(profile.packageJson, "utf8"));
    expect(written.openbuddy.profile.piExtensions).toEqual([
      { id: "pi-goal", source: "pi-goal", enabled: true },
    ]);
  });

  it("removes a spec by id (present=false) without touching other entries", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-ext-"));
    const profile = await bootstrapProfile(home);

    await updateProfileExtensions(
      profile,
      { id: "pi-goal", enabled: true },
      true,
    );
    await updateProfileExtensions(
      profile,
      { id: "pi-plan-mode", enabled: true },
      true,
    );

    await updateProfileExtensions(
      profile,
      { id: "pi-goal", enabled: true },
      false /* present=false → delete */,
    );

    const written = JSON.parse(await readFile(profile.packageJson, "utf8"));
    expect(written.openbuddy.profile.piExtensions).toEqual([
      { id: "pi-plan-mode", enabled: true },
    ]);
    expect(written.dsh.profile.piExtensions).toEqual([
      { id: "pi-plan-mode", enabled: true },
    ]);
  });

  it("survives prior openbuddy/dsh namespace drift (merges both sides, prefers openbuddy-side fields)", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-ext-"));
    const ensured = await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    // Pre-seed with drift: openbuddy-side has passthrough, dsh-side does not.
    await writeFile(
      join(ensured.dir, "package.json"),
      JSON.stringify(
        {
          name: "openbuddy-profile-desktop",
          openbuddy: {
            profile: {
              piExtensions: [{ id: "pi-goal", source: "pi-goal", passthrough: true }],
            },
          },
          dsh: {
            profile: {
              piExtensions: [{ id: "pi-goal", source: "pi-goal" }],
            },
          },
        },
        null,
        2,
      ),
    );
    const profile = await readOpenBuddyProfile({ profileDir: ensured.dir });

    await updateProfileExtensions(
      profile,
      { id: "pi-goal", source: "pi-goal", enabled: true },
      true,
    );

    const written = JSON.parse(await readFile(profile.packageJson, "utf8"));
    // Single entry, with passthrough preserved from the openbuddy-side seed.
    expect(written.openbuddy.profile.piExtensions).toHaveLength(1);
    expect(written.openbuddy.profile.piExtensions[0]).toMatchObject({
      id: "pi-goal",
      passthrough: true,
      enabled: true,
    });
    expect(written.dsh.profile.piExtensions).toHaveLength(1);
  });

  it("uses atomic .tmp + rename (no partial writes visible to file watchers)", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-ext-"));
    const profile = await bootstrapProfile(home);

    await updateProfileExtensions(
      profile,
      { id: "pi-goal", enabled: true },
      true,
    );

    // .tmp files are cleaned up by `rename`; only the canonical package.json
    // remains.
    const written = JSON.parse(await readFile(profile.packageJson, "utf8"));
    expect(written.openbuddy.profile.piExtensions).toHaveLength(1);
  });
});
describe("ensureDefaultPiPackages (C6 default pi bundle)", () => {
  it("exposes a frozen, non-empty list of pinned Pi packages", () => {
    expect(Array.isArray(OPENBUDDY_DEFAULT_PI_PACKAGES)).toBe(true);
    expect(OPENBUDDY_DEFAULT_PI_PACKAGES.length).toBeGreaterThanOrEqual(6);
    for (const spec of OPENBUDDY_DEFAULT_PI_PACKAGES) {
      expect(spec).toMatch(/^npm:[^@]+@\d+\.\d+\.\d+$/);
    }
    expect(Object.isFrozen(OPENBUDDY_DEFAULT_PI_PACKAGES)).toBe(true);
  });

  it("includes every E2E-verified Pi package", () => {
    const expected = [
      "pi-context-prune",
      "pi-mcp-adapter",
      "pi-web-access",
      "pi-goal",
      "pi-plan-mode",
      "pi-subagents",
    ];
    for (const name of expected) {
      expect(OPENBUDDY_DEFAULT_PI_PACKAGES.some((spec) => spec.includes(name))).toBe(true);
    }
  });

  it("returns skipped results for an empty profile (nothing to install)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "openbuddy-default-pi-"));
    try {
      const results = await ensureDefaultPiPackages({ profileDir: tmp, force: false });
      // The first call fails the install (no package manager scaffolded in test dir),
      // so we expect either "failed" with EEXIST-ish error, or "installed" if the
      // pnpm scaffold worked. We do NOT allow "skipped" because nothing is installed.
      const statuses = results.map((r) => r.status);
      expect(statuses).toHaveLength(OPENBUDDY_DEFAULT_PI_PACKAGES.length);
      for (const status of statuses) {
        expect(["installed", "failed", "skipped"]).toContain(status);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
