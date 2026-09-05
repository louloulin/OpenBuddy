import { describe, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  manifestToBundle,
  readBundleManifest,
  type BundleManifest,
  type BundleManifestField,
} from "./bundle-manifest";

// Fixture: a synthetic manifest + patch file at a known location.
// vitest's transform replaces `import.meta.url`, so we resolve relative
// to the package root via a tiny runtime sniff: find the first
// directory that contains the fixture we just created.
function findFixtureDir(): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "packages/runtime/openbuddy-plugin-host/src/__fixtures__/bundle-manifest-fixture");
    try {
      const stat = readFileSync(join(candidate, "package.json"), "utf-8");
      if (stat) return candidate;
    } catch {
      // keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("bundle-manifest.test: fixture dir not found");
}

const FIXTURE_DIR = findFixtureDir();
const SPEC = join(FIXTURE_DIR, "package.json");
const PATCH_PATH = join(FIXTURE_DIR, "openbuddy.patch.yml");

describe("readBundleManifest", () => {
  it("returns the openbuddy.bundle field with the resolved directory", async () => {
    const manifest = await readBundleManifest(SPEC, {
      importer: () => SPEC,
    });
    expect(manifest.field).toMatchObject({ patch: "./openbuddy.patch.yml" });
    expect(manifest.dir).toBe(FIXTURE_DIR);
    expect(manifest.manifestField).toBe("openbuddy");
  });

  it("recognises dsh.bundle.patch as a deepseek-harness-conventional fallback", async () => {
    const dshFixture = join(FIXTURE_DIR, "..", "dsh-bundle-fixture", "package.json");
    const manifest = await readBundleManifest(dshFixture, { importer: () => dshFixture });
    expect(manifest.manifestField).toBe("dsh");
    expect(manifest.field.patch).toBe("./openbuddy.patch.yml");
  });

  it("rejects when the package.json has no openbuddy.bundle / dsh.bundle field", async () => {
    const withoutField = join(FIXTURE_DIR, "..", "no-bundle-field", "package.json");
    await expect(readBundleManifest(withoutField, { importer: () => withoutField }))
      .rejects.toThrow(/does not declare any of "openbuddy\.bundle", "dsh\.bundle"/);
  });
});

describe("manifestToBundle", () => {
  it("loads the patch file and returns a PluginBundle with one patch layer", async () => {
    const manifest: BundleManifest = {
      specifier: SPEC,
      dir: FIXTURE_DIR,
      field: { patch: "./openbuddy.patch.yml" } as BundleManifestField,
      manifestField: "openbuddy",
    };
    const bundle = await manifestToBundle(manifest);
    expect(bundle.entries).toEqual([]);
    expect(bundle.patches).toHaveLength(1);
    expect(bundle.patches?.[0]?.[0]).toMatchObject({
      insert: [{ id: "timer", name: "@scope/timer" }],
    });
  });

  it("uses inline entries/patches when no patch file is declared", async () => {
    const manifest: BundleManifest = {
      specifier: SPEC,
      dir: FIXTURE_DIR,
      field: {
        entries: [{ id: "inline", name: "@scope/inline" }],
      },
      manifestField: "openbuddy",
    };
    const bundle = await manifestToBundle(manifest);
    expect(bundle.entries).toEqual([{ id: "inline", name: "@scope/inline" }]);
    expect(bundle.patches).toEqual([]);
  });
});

describe("manifestToBundle patch file resolution", () => {
  it("resolves a relative patch path against the bundle directory", async () => {
    const manifest: BundleManifest = {
      specifier: SPEC,
      dir: FIXTURE_DIR,
      field: { patch: "./openbuddy.patch.yml" },
      manifestField: "openbuddy",
    };
    const bundle = await manifestToBundle(manifest, {
      patchLoader: async (path) => {
        expect(path).toBe(PATCH_PATH);
        return "- insert:\n    - id: timer\n      name: '@scope/timer'\n";
      },
    });
    expect(bundle.patches?.[0]?.[0]).toMatchObject({
      insert: [{ id: "timer", name: "@scope/timer" }],
    });
  });
});
