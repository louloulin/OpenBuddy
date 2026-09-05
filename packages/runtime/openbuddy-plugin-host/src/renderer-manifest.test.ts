import { describe, expect, it } from "vitest";
import { composeRendererPluginBootGraph, discoverRendererPluginEntries } from "./renderer-manifest";

describe("DeepSeek renderer manifest discovery", () => {
  it("maps dsh.client metadata to renderer entries and package dependencies", async () => {
    const packages: Record<string, Record<string, unknown>> = {
      "@scope/base": {
        exports: { "./client": { default: "./client.js" } },
        dsh: { client: { platform: "web", immediately: true } },
      },
      "@scope/feature": {
        exports: { "./client": "./client.js" },
        dsh: { client: { platform: "web", inject: ["@scope/base"], external: ["@scope/base/client"] } },
      },
    };
    const result = await discoverRendererPluginEntries([
      { id: "base", name: "@scope/base" },
      { id: "feature", name: "@scope/feature", config: { enabled: true } },
    ], {
      resolvePackageJson: async (specifier) => specifier,
      readPackageJson: async (path) => packages[path]!,
    });
    expect(result).toEqual([
      { id: "base", name: "@scope/base/client", immediately: true },
      {
        id: "feature",
        name: "@scope/feature/client",
        inject: ["base"],
        external: ["@scope/base/client"],
        config: { enabled: true },
      },
    ]);
  });

  it("discovers client packages that are not Cordis loader entries", async () => {
    const result = await discoverRendererPluginEntries([], {
      additionalPackages: ["@scope/feature"],
      resolvePackageJson: async (specifier) => specifier,
      readPackageJson: async () => ({
        exports: { "./client": "./client.js" },
        dsh: { client: { platform: "web", immediately: true } },
      }),
      resolveModule: async (specifier) => `file:///tmp/${specifier.replace(/[^A-Za-z0-9]+/gu, "-")}.js`,
    });
    expect(result).toEqual([{
      id: "@scope/feature",
      moduleId: "@scope/feature",
      moduleKey: "@scope/feature",
      name: "@scope/feature/client",
      moduleUrl: "file:///tmp/-scope-feature-client.js",
      immediately: true,
    }]);
  });

  it("skips non-web client faces and packages without metadata", async () => {
    const result = await discoverRendererPluginEntries([
      { id: "desktop", name: "desktop" },
      { id: "plain", name: "plain" },
    ], {
      resolvePackageJson: async (specifier) => specifier,
      readPackageJson: async (path) => path === "desktop"
        ? { dsh: { client: { platform: "desktop" } } }
        : {},
    });
    expect(result).toEqual([]);
  });

  it("keeps disabled renderer faces disabled", async () => {
    const result = await discoverRendererPluginEntries([{ id: "disabled", name: "disabled", disabled: true }], {
      resolvePackageJson: async () => "disabled",
      readPackageJson: async () => ({
        exports: { "./client": "./client.js" },
        dsh: { client: { platform: "web" } },
      }),
    });
    expect(result[0]?.disabled).toBe(true);
  });

  it("resolves the exported client subpath instead of guessing a file", async () => {
    const resolved: string[] = [];
    const result = await discoverRendererPluginEntries([{ id: "feature", name: "@scope/feature" }], {
      resolvePackageJson: async () => "feature-package.json",
      readPackageJson: async () => ({
        exports: { "./client": { browser: "./browser.js", default: "./client.js" } },
        dsh: { client: { platform: "web" } },
      }),
      resolveModule: async (specifier) => { resolved.push(specifier); return "file:///tmp/browser.js"; },
    });
    expect(result[0]).toMatchObject({
      name: "@scope/feature/client",
      moduleId: "@scope/feature",
      moduleKey: "feature",
      moduleUrl: "file:///tmp/browser.js",
    });
    expect(resolved).toEqual(["@scope/feature/client"]);
  });

  it("supports conditional export arrays and skips type-only targets", async () => {
    const resolved: string[] = [];
    const result = await discoverRendererPluginEntries([{ id: "feature", name: "@scope/feature" }], {
      resolvePackageJson: async () => "feature-package.json",
      readPackageJson: async () => ({
        exports: {
          "./client": [
            { types: "./client.d.ts" },
            { browser: "./browser.js", default: "./client.js" },
          ],
        },
        dsh: { client: { platform: "web" } },
      }),
      resolveModule: async (specifier) => { resolved.push(specifier); return "file:///tmp/browser.js"; },
    });
    expect(result[0]?.moduleUrl).toBe("file:///tmp/browser.js");
    expect(resolved).toEqual(["@scope/feature/client"]);
  });

  it("rejects a client declaration without exports[\"./client\"]", async () => {
    await expect(discoverRendererPluginEntries([{ id: "broken", name: "broken" }], {
      resolvePackageJson: async () => "broken",
      readPackageJson: async () => ({
        exports: { ".": "./index.js" },
        dsh: { client: { platform: "web" } },
      }),
    })).rejects.toThrow('exports no "./client" entry');
  });

  it("rejects a client declaration without an exports map", async () => {
    await expect(discoverRendererPluginEntries([{ id: "broken", name: "broken" }], {
      resolvePackageJson: async () => "broken",
      readPackageJson: async () => ({ dsh: { client: { platform: "web" } } }),
    })).rejects.toThrow('exports no "./client" entry');
  });

  it("rejects malformed dsh.client fields", async () => {
    await expect(discoverRendererPluginEntries([{ id: "broken", name: "broken" }], {
      resolvePackageJson: async () => "broken",
      readPackageJson: async () => ({
        exports: { "./client": "./client.js" },
        dsh: { client: { platform: "web", external: ["ok", 1] } },
      }),
    })).rejects.toThrow("dsh.client.external must be an array of strings");
  });

  it("discovers client faces nested inside a group", async () => {
    const result = await discoverRendererPluginEntries([{
      id: "group",
      name: "group",
      group: true,
      children: [{ id: "child", name: "@scope/child" }],
    }], {
      resolvePackageJson: async (specifier) => specifier,
      readPackageJson: async (path) => path === "@scope/child"
        ? { exports: { "./client": "./client.js" }, dsh: { client: { platform: "web" } } }
        : {},
    });
    expect(result).toEqual([{
      id: "group:child",
      name: "@scope/child/client",
    }]);
  });

  it("composes the host-owned client boot graph in external dependency order", async () => {
    const graph = composeRendererPluginBootGraph([
      { id: "consumer", moduleId: "@scope/consumer", moduleKey: "consumer", name: "@scope/consumer/client", external: ["@scope/provider/client"], moduleUrl: "file:///consumer.js" },
      { id: "provider", moduleId: "@scope/provider", moduleKey: "provider", name: "@scope/provider/client", immediately: true, moduleUrl: "file:///provider.js" },
    ]);
    expect(graph.entries.map((entry) => entry.id)).toEqual(["provider", "consumer"]);
    expect(graph.entries.every((entry) => typeof entry.rev === "string")).toBe(true);
    expect(graph.rev).toMatch(/^openbuddy-client-[0-9a-f]+$/);
  });
});
