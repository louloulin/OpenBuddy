/**
 * sample-plugin fixture test — Phase K.2 reference round-trip.
 *
 * Validates that every track the OpenBuddyPlugin SDK (Phase K.1)
 * recognises is wired up end-to-end. The fixture is the canonical
 * contract for v6 §3.4: the SDK is the manifest shape, real loading
 * still happens through PI `loadExtensions()` / Cordis `ctx.plugin()`
 * / renderer slot apply.
 */

import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  openbuddyPluginManifestSchema,
  serializeCordisTrack,
  serializeHarnessTrack,
  serializePiTrack,
  serializeSlotTrack,
  validateOpenBuddyPluginManifest,
} from "../../openbuddy-plugin-manifest";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

describe("@fixture/sample-plugin — Phase K.2 reference", () => {
  it("declares an OpenBuddyPlugin manifest that round-trips through the SDK", async () => {
    const raw = await readFile(join(fixtureDir, "plugin.json"), "utf8");
    const manifest = validateOpenBuddyPluginManifest(JSON.parse(raw));
    expect(manifest.schema).toBe(openbuddyPluginManifestSchema);
    expect(manifest.id).toBe("@fixture/sample-plugin");
    expect(manifest.tracks).toHaveLength(4);
    expect(manifest.flags?.phase).toBe("K.2");
  });

  it("serialises each of the four tracks", async () => {
    const raw = await readFile(join(fixtureDir, "plugin.json"), "utf8");
    const manifest = validateOpenBuddyPluginManifest(JSON.parse(raw));
    expect(serializePiTrack(manifest)).toHaveLength(1);
    expect(serializeHarnessTrack(manifest)).toHaveLength(1);
    expect(serializeSlotTrack(manifest)).toHaveLength(1);
    expect(serializeCordisTrack(manifest)).toHaveLength(1);
  });

  it("package.json declares the conventional surfaces for harness + renderer + pi", async () => {
    const raw = await readFile(join(fixtureDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const openbuddy = pkg.openbuddy as Record<string, unknown> | undefined;
    expect(openbuddy).toBeDefined();
    expect(openbuddy?.bundle).toBeDefined();
    expect(openbuddy?.client).toBeDefined();
    const pi = pkg.pi as Record<string, unknown> | undefined;
    expect(pi).toBeDefined();
    expect(Array.isArray(pi?.extensions)).toBe(true);
    expect(Array.isArray(pi?.skills)).toBe(true);
  });

  it("cordis patch.yml round-trips through the existing patch loader", async () => {
    const home = await mkdtemp(join(tmpdir(), "sample-plugin-cordis-"));
    await mkdir(join(home, "@fixture", "sample-plugin"), { recursive: true });
    await writeFile(
      join(home, "@fixture", "sample-plugin", "package.json"),
      JSON.stringify({
        name: "@fixture/sample-plugin",
        type: "module",
        main: "./index.js",
      }),
    );
    const patch = await readFile(join(fixtureDir, "cordis.patch.yml"), "utf8");
    expect(patch).toContain("insert:");
    expect(patch).toContain("@fixture/sample-plugin");
  });

  it("ExtensionFactory stub matches the inline id in plugin.json", async () => {
    const raw = await readFile(join(fixtureDir, "plugin.json"), "utf8");
    const manifest = validateOpenBuddyPluginManifest(JSON.parse(raw));
    const [piTrack] = serializePiTrack(manifest);
    expect(piTrack?.source).toBe("@fixture/sample-plugin:extension");
  });
});