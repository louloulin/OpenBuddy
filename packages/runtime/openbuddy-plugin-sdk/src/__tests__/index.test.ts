import { describe, expect, it } from "vitest";
import {
  OPENBUDDY_PLUGIN_PROTOCOL,
  OPENBUDDY_PLUGIN_SCHEMA,
  SERIALIZER_PROTOCOL,
  SERIALIZER_SCHEMA,
  manifestToExtensionFactory,
  openBuddyPluginTracks,
  parsePluginManifest,
} from "../index";

describe("barrel exports", () => {
  it("exposes the schema / protocol constants", () => {
    expect(OPENBUDDY_PLUGIN_SCHEMA).toBe("openbuddy.plugin.v1");
    expect(OPENBUDDY_PLUGIN_PROTOCOL).toBe(1);
    expect(SERIALIZER_SCHEMA).toBe(OPENBUDDY_PLUGIN_SCHEMA);
    expect(SERIALIZER_PROTOCOL).toBe(OPENBUDDY_PLUGIN_PROTOCOL);
  });

  it("exposes the four canonical track names", () => {
    expect([...openBuddyPluginTracks].sort()).toEqual(["cordis", "harness", "pi", "ui"]);
  });

  it("round-trips a manifest through the public surface", () => {
    const raw = {
      name: "roundtrip",
      version: "1.0.0",
      pi: { commands: ["./commands.js"] },
    };
    const parsed = parsePluginManifest(raw);
    const serialized = manifestToExtensionFactory(parsed, "/abs/roundtrip/plugin.json");
    expect(serialized.name).toBe("roundtrip");
    expect(serialized.tracks).toEqual(["pi"]);
  });
});
