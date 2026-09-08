/**
 * init-deepseek.test.ts — Phase K.2 unit tests for the DSH assembly stage.
 *
 * Coverage:
 *   - `coreCapabilityManifests` declares every `DEEPSEEK_CORE_CAPABILITY_PACKAGES`
 *     entry as an OpenBuddyPlugin manifest with a harness track.
 *   - `profileEntriesFromManifests` materialises the manifests into
 *     `PluginEntryOptions` rows the loader already understands.
 *   - The composed profile prepends the core entries in the documented order
 *     (so marketplace bundles can override them).
 */

import { describe, expect, it } from "vitest";
import {
  coreCapabilityManifests,
  DEEPSEEK_CORE_CAPABILITY_PACKAGES,
  profileEntriesFromManifests,
} from "./init-deepseek";
import { openbuddyPluginManifestSchema } from "@openbuddy/plugin-host";

describe("init-deepseek / Phase K.2 SDK integration", () => {
  it("declares an OpenBuddyPlugin manifest for every DSH core package", () => {
    expect(coreCapabilityManifests).toHaveLength(DEEPSEEK_CORE_CAPABILITY_PACKAGES.length);
    for (const manifest of coreCapabilityManifests) {
      expect(manifest.schema).toBe(openbuddyPluginManifestSchema);
      expect(manifest.tracks).toHaveLength(1);
      expect(manifest.tracks[0]?.kind).toBe("harness");
      expect(manifest.tracks[0]?.source).toBe(manifest.id);
    }
    // Order matters: the loader sees the entries in the same sequence as
    // `DEEPSEEK_CORE_CAPABILITY_PACKAGES`, so marketplace overrides can
    // target a specific index.
    expect(coreCapabilityManifests.map((manifest) => manifest.id)).toEqual([
      ...DEEPSEEK_CORE_CAPABILITY_PACKAGES,
    ]);
  });

  it("profileEntriesFromManifests emits PluginEntryOptions rows", () => {
    const rows = profileEntriesFromManifests(coreCapabilityManifests);
    expect(rows).toHaveLength(DEEPSEEK_CORE_CAPABILITY_PACKAGES.length);
    for (const row of rows) {
      expect(row.id).toMatch(/^@deepseek-ai\/dsh-/);
      expect(row.name).toBe(row.id);
    }
  });

  it("profileEntriesFromManifests preserves manifest flags in the row", () => {
    const manifests = [
      {
        schema: openbuddyPluginManifestSchema,
        id: "openbuddy-flagged",
        packageName: "openbuddy-flagged",
        version: "0.0.0",
        tracks: [{ kind: "harness" as const, source: "openbuddy-flagged" }],
        flags: { passthrough: true },
      },
    ];
    const rows = profileEntriesFromManifests(manifests);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("openbuddy-flagged");
    expect(rows[0]?.name).toBe("openbuddy-flagged");
  });

  it("profileEntriesFromManifests returns an empty list for empty input", () => {
    expect(profileEntriesFromManifests([])).toEqual([]);
  });
});