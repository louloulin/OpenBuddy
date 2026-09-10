import { describe, expect, it } from "vitest";
import { hashPluginContent, PluginSecurityError, validatePluginSecurity } from "./plugin-security";

describe("plugin security policy", () => {
  it("hashes content and validates registry provenance", () => {
    const contentHash = hashPluginContent("plugin-code");
    expect(contentHash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(validatePluginSecurity({ pluginId: "sample", source: "registry", permissions: ["network"], contentHash }, {
      allowedSources: ["registry"],
      allowedPermissions: ["network"],
      requireHashForSources: ["registry"],
    })).toMatchObject({ pluginId: "sample", contentHash, permissions: ["network"] });
  });

  it("rejects unauthorized source, permission, missing hash and malformed hash", () => {
    expect(() => validatePluginSecurity({ pluginId: "x", source: "unknown", permissions: [] }, { allowedSources: ["local"] })).toThrow(PluginSecurityError);
    expect(() => validatePluginSecurity({ pluginId: "x", source: "local", permissions: ["shell"] }, { allowedPermissions: ["network"] })).toThrow(/permissions denied/);
    expect(() => validatePluginSecurity({ pluginId: "x", source: "registry", permissions: [] }, { requireHashForSources: ["registry"] })).toThrow(/hash required/);
    expect(() => validatePluginSecurity({ pluginId: "x", source: "local", permissions: [], contentHash: "bad" })).toThrow(/sha256 digest/);
  });

  it("deduplicates permissions in the normalized descriptor", () => {
    expect(validatePluginSecurity({ pluginId: "x", source: "builtin", permissions: ["network", "network"] }).permissions).toEqual(["network"]);
  });
});
