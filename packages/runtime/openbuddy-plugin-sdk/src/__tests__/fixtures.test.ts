import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { manifestToExtensionFactory, parsePluginManifest, parsePluginPackageJson } from "../index";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "../__fixtures__/sample-plugin");
const pluginJsonPath = resolve(fixtureRoot, "plugin.json");
const packageJsonPath = resolve(fixtureRoot, "package.json");

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

describe("sample-plugin fixture", () => {
  it("parses the bundled plugin.json and serializes a factory", () => {
    const raw = JSON.parse(readFileSync(pluginJsonPath, "utf8")) as Record<string, unknown>;
    const parsed = parsePluginManifest(raw, pluginJsonPath);
    const serialized = manifestToExtensionFactory(parsed, pluginJsonPath);
    expect(serialized.name).toBe("@openbuddy/sample-plugin");
    expect([...serialized.tracks].sort()).toEqual(["harness", "pi", "ui"]);
    expect(typeof serialized.factory).toBe("function");
  });

  it("parses the fixture via the package.json#openbuddy path", () => {
    const raw = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
    // The fixture ships the openbuddy block inside plugin.json (so a
    // reader can see the manifest in isolation). The package.json path
    // round-trips the same data through the dedicated parser — strip
    // name/version from the plugin.json block first because those are
    // always inherited from the package itself.
    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf8")) as Record<string, unknown>;
    const { name: _name, version: _version, ...openbuddyBlock } = pluginJson;
    const merged = { ...raw, openbuddy: openbuddyBlock };
    const parsed = parsePluginPackageJson(merged, packageJsonPath);
    expect(parsed.name).toBe("@openbuddy/sample-plugin");
    expect(parsed.ui && Object.keys(parsed.ui).length).toBe(3);
  });
});
