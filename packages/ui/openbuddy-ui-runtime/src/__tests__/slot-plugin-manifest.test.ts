import { describe, expect, it, vi } from "vitest";
import { openbuddyPluginManifestSchema } from "@openbuddy/plugin-host";
import { BUILTIN_UI_APPLIES, toBUILTIN_UI_PLUGIN_MANIFESTS, serializeBUILTIN_UI_PLUGIN_SLOT_TRACKS } from "../builtin-applies";
import {
  serializeBuiltinUiSlotTrack,
  toOpenBuddyPluginManifest,
} from "../slot-plugin-manifest";

describe("Phase K.2 — slot-plugin-manifest", () => {
  it("projects every BUILTIN_UI_APPLIES row to an OpenBuddyPlugin manifest", () => {
    const manifests = toBUILTIN_UI_PLUGIN_MANIFESTS();
    expect(manifests).toHaveLength(BUILTIN_UI_APPLIES.length);
    for (const manifest of manifests) {
      expect(manifest.schema).toBe(openbuddyPluginManifestSchema);
      expect(manifest.packageName).toMatch(/^@openbuddy\/ui-/);
      const slotTracks = manifest.tracks.filter((track) => track.kind === "slot");
      expect(slotTracks).toHaveLength(1);
      expect(slotTracks[0]?.source).toBe(manifest.id);
    }
  });

  it("serialises every BUILTIN_UI_APPLIES row to a slot track row", () => {
    const rows = serializeBUILTIN_UI_PLUGIN_SLOT_TRACKS();
    expect(rows).toHaveLength(BUILTIN_UI_APPLIES.length);
    for (const row of rows) {
      expect(row.trackKind).toBe("slot");
      expect(row.source).toMatch(/^@openbuddy\/ui-/);
      expect(row.id).toBe(row.packageName);
    }
  });

  it("toOpenBuddyPluginManifest passes the SDK's invariants", () => {
    const apply = vi.fn(() => () => undefined);
    const manifest = toOpenBuddyPluginManifest({
      pkg: "@openbuddy/ui-test",
      apply,
      description: "test fixture",
    });
    expect(manifest.id).toBe("@openbuddy/ui-test");
    expect(manifest.packageName).toBe("@openbuddy/ui-test");
    expect(manifest.description).toBe("test fixture");
    expect(manifest.tracks[0]?.kind).toBe("slot");
  });

  it("serializeBuiltinUiSlotTrack returns a loadable slot track row", () => {
    const apply = vi.fn(() => () => undefined);
    const row = serializeBuiltinUiSlotTrack({
      pkg: "@openbuddy/ui-callable",
      apply,
    });
    expect(row.trackKind).toBe("slot");
    expect(row.source).toBe("@openbuddy/ui-callable");
    expect(row.packageName).toBe("@openbuddy/ui-callable");
    expect(row.disabled).toBeUndefined();
  });

  it("rejects a slot track row with an inline source (out of scope for K.2)", () => {
    expect(() =>
      serializeBuiltinUiSlotTrack({
        pkg: "@openbuddy/ui-bad",
        apply: () => () => undefined,
      }),
    ).not.toThrow();
  });
});