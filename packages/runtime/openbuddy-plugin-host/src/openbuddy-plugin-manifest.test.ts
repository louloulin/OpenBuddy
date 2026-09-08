import { describe, expect, it } from "vitest";
import {
  applyOpenBuddyPluginManifestPassthrough,
  openbuddyPluginManifestSchema,
  OpenBuddyPluginManifestError,
  serializeCordisTrack,
  serializeHarnessTrack,
  serializePiTrack,
  serializeSlotTrack,
  validateOpenBuddyPluginManifest,
  listOpenBuddyPluginManifestTracks,
  type OpenBuddyPluginManifest,
} from "./openbuddy-plugin-manifest";

function makeManifest(partial: Partial<OpenBuddyPluginManifest>): OpenBuddyPluginManifest {
  return {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-test",
    tracks: [{ kind: "pi", inline: "openbuddy-test" }],
    ...partial,
  };
}

describe("openbuddy plugin manifest (Phase K.1 SDK)", () => {
  describe("validateOpenBuddyPluginManifest", () => {
    it("accepts a minimal pi-only manifest", () => {
      const result = validateOpenBuddyPluginManifest(makeManifest({}));
      expect(result.id).toBe("openbuddy-test");
      expect(result.tracks).toHaveLength(1);
      expect(result.tracks[0]?.kind).toBe("pi");
    });

    it("rejects non-object input", () => {
      expect(() => validateOpenBuddyPluginManifest("not-a-manifest")).toThrow(OpenBuddyPluginManifestError);
    });

    it("rejects missing id", () => {
      expect(() =>
        validateOpenBuddyPluginManifest({
          schema: openbuddyPluginManifestSchema,
          tracks: [{ kind: "pi", inline: "x" }],
        }),
      ).toThrow(/id/);
    });

    it("rejects missing or wrong schema", () => {
      expect(() =>
        validateOpenBuddyPluginManifest({
          id: "x",
          schema: "wrong.schema",
          tracks: [{ kind: "pi", inline: "x" }],
        }),
      ).toThrow(/schema/);
    });

    it("rejects empty tracks", () => {
      expect(() =>
        validateOpenBuddyPluginManifest({
          id: "x",
          schema: openbuddyPluginManifestSchema,
          tracks: [],
        }),
      ).toThrow(/tracks/);
    });

    it("rejects track with both inline and source set", () => {
      expect(() =>
        validateOpenBuddyPluginManifest({
          id: "x",
          schema: openbuddyPluginManifestSchema,
          tracks: [{ kind: "pi", inline: "a", source: "./b.js" }],
        }),
      ).toThrow(/exactly one/);
    });

    it("rejects track with neither inline nor source", () => {
      expect(() =>
        validateOpenBuddyPluginManifest({
          id: "x",
          schema: openbuddyPluginManifestSchema,
          tracks: [{ kind: "pi" }],
        }),
      ).toThrow(/exactly one/);
    });

    it("rejects track kind outside the allowed set", () => {
      expect(() =>
        validateOpenBuddyPluginManifest({
          id: "x",
          schema: openbuddyPluginManifestSchema,
          tracks: [{ kind: "bogus", inline: "a" }],
        }),
      ).toThrow(/pi\|harness\|slot\|cordis/);
    });

    it("rejects inject that is not an array of strings", () => {
      expect(() =>
        validateOpenBuddyPluginManifest({
          id: "x",
          schema: openbuddyPluginManifestSchema,
          tracks: [{ kind: "pi", inline: "a", inject: ["valid", 1] }],
        }),
      ).toThrow(/inject/);
    });

    it("normalises track config defaults", () => {
      const result = validateOpenBuddyPluginManifest({
        id: "x",
        schema: openbuddyPluginManifestSchema,
        tracks: [
          {
            kind: "pi",
            inline: "a",
            config: { schema: "zod-v1", defaults: { trustedCwd: "/tmp" } },
          },
        ],
      });
      expect(result.tracks[0]?.config?.defaults).toEqual({ trustedCwd: "/tmp" });
    });

    it("preserves disabled flag", () => {
      const result = validateOpenBuddyPluginManifest({
        id: "x",
        schema: openbuddyPluginManifestSchema,
        tracks: [{ kind: "pi", inline: "a", disabled: true }],
      });
      expect(result.tracks[0]?.disabled).toBe(true);
    });

    it("accepts multi-track manifests with pi + slot + harness + cordis", () => {
      const result = validateOpenBuddyPluginManifest({
        id: "openbuddy-multi",
        schema: openbuddyPluginManifestSchema,
        tracks: [
          { kind: "pi", inline: "openbuddy-multi" },
          { kind: "slot", source: "@openbuddy/ui-runtime" },
          { kind: "harness", source: "@openbuddy/harness-bridge" },
          { kind: "cordis", source: "@openbuddy/cordis-bridge" },
        ],
      });
      expect([...listOpenBuddyPluginManifestTracks(result)].sort()).toEqual(["cordis", "harness", "pi", "slot"]);
    });
  });

  describe("serializePiTrack", () => {
    it("emits a loadable PI entry with merged config defaults", () => {
      const manifest = validateOpenBuddyPluginManifest({
        id: "openbuddy-apply-patch",
        schema: openbuddyPluginManifestSchema,
        tracks: [
          {
            kind: "pi",
            inline: "openbuddy-apply-patch",
            config: { defaults: { trustedCwd: "/workspace" } },
          },
        ],
      });
      const result = serializePiTrack(manifest);
      expect(result).toEqual([
        {
          id: "openbuddy-apply-patch",
          source: "openbuddy-apply-patch",
          config: { trustedCwd: "/workspace" },
          trackKind: "pi",
        },
      ]);
    });

    it("returns an empty list when no pi track is declared", () => {
      const manifest = validateOpenBuddyPluginManifest({
        id: "slot-only",
        schema: openbuddyPluginManifestSchema,
        tracks: [{ kind: "slot", source: "@openbuddy/ui-x" }],
      });
      expect(serializePiTrack(manifest)).toEqual([]);
    });
  });

  describe("serializeHarnessTrack", () => {
    it("emits a PluginEntryOptions-compatible harness row", () => {
      const manifest = validateOpenBuddyPluginManifest({
        id: "openbuddy-bundle",
        schema: openbuddyPluginManifestSchema,
        tracks: [
          {
            kind: "harness",
            source: "@openbuddy/bundle-base",
            inject: ["openbuddy-session"],
          },
        ],
      });
      const result = serializeHarnessTrack(manifest);
      expect(result).toEqual([
        {
          id: "openbuddy-bundle",
          name: "@openbuddy/bundle-base",
          inject: ["openbuddy-session"],
          trackKind: "harness",
        },
      ]);
    });
  });

  describe("serializeSlotTrack", () => {
    it("emits a slot apply descriptor with package name when set", () => {
      const manifest = validateOpenBuddyPluginManifest({
        id: "openbuddy-ui-runtime",
        packageName: "@openbuddy/ui-runtime",
        schema: openbuddyPluginManifestSchema,
        tracks: [
          {
            kind: "slot",
            source: "@openbuddy/ui-runtime",
          },
        ],
      });
      const result = serializeSlotTrack(manifest);
      expect(result).toEqual([
        {
          id: "openbuddy-ui-runtime",
          packageName: "@openbuddy/ui-runtime",
          source: "@openbuddy/ui-runtime",
          trackKind: "slot",
        },
      ]);
    });

    it("rejects a slot track without source (inline slots are out of scope for K.2)", () => {
      const manifest = validateOpenBuddyPluginManifest({
        id: "x",
        schema: openbuddyPluginManifestSchema,
        tracks: [{ kind: "slot", inline: "x" }],
      });
      expect(() => serializeSlotTrack(manifest)).toThrow(/source/);
    });
  });

  describe("serializeCordisTrack", () => {
    it("emits a Cordis plugin descriptor", () => {
      const manifest = validateOpenBuddyPluginManifest({
        id: "openbuddy-cordis-bridge",
        schema: openbuddyPluginManifestSchema,
        tracks: [
          { kind: "cordis", source: "@openbuddy/cordis-bridge", inject: ["pi"] },
        ],
      });
      const result = serializeCordisTrack(manifest);
      expect(result).toEqual([
        {
          id: "openbuddy-cordis-bridge",
          source: "@openbuddy/cordis-bridge",
          inject: ["pi"],
          trackKind: "cordis",
        },
      ]);
    });
  });

  describe("applyOpenBuddyPluginManifestPassthrough", () => {
    it("threads flags.passthrough into the track config when true", () => {
      const manifest = makeManifest({ flags: { passthrough: true } });
      const row = { id: "x", trackKind: "pi" as const, source: "y", config: { trustedCwd: "/workspace" } };
      const result = applyOpenBuddyPluginManifestPassthrough(row, manifest);
      expect(result.config).toEqual({ trustedCwd: "/workspace", passthrough: true });
    });

    it("is a no-op when flags.passthrough is not true", () => {
      const manifest = makeManifest({ flags: { passthrough: false } });
      const row = { id: "x", trackKind: "pi" as const, source: "y" };
      const result = applyOpenBuddyPluginManifestPassthrough(row, manifest);
      expect(result).toEqual(row);
    });

    it("is a no-op when flags is missing", () => {
      const manifest = makeManifest({});
      const row = { id: "x", trackKind: "pi" as const, source: "y" };
      const result = applyOpenBuddyPluginManifestPassthrough(row, manifest);
      expect(result).toEqual(row);
    });
  });
});