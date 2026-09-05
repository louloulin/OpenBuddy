import { describe, expect, it } from "vitest";
import { discoverRemoteManifestEntries } from "./remote-manifest";

describe("DeepSeek remote manifest discovery", () => {
  it("discovers exports[\"./remote\"] without requiring a Cordis entry", async () => {
    const result = await discoverRemoteManifestEntries({
      additionalPackages: ["@fixture/goal", "plain"],
      resolvePackageJson: async (specifier) => `${specifier}/package.json`,
      readPackageJson: async (path) => path.startsWith("@fixture/goal")
        ? { exports: { "./remote": { node: "./lib/typert.remote-client.js" } } }
        : {},
      resolveModule: async (specifier, packageJson) => `file://${packageJson.replace("/package.json", "")}/${specifier.split("/").at(-1)}.js`,
    });
    expect(result).toEqual([{
      packageName: "@fixture/goal",
      packageJson: "@fixture/goal/package.json",
      moduleName: "@fixture/goal/remote",
      moduleUrl: "file://@fixture/goal/remote.js",
    }]);
  });

  it("deduplicates packages and ignores packages without a remote export", async () => {
    const resolved: string[] = [];
    const result = await discoverRemoteManifestEntries({
      additionalPackages: ["fixture", "fixture", "missing"],
      resolvePackageJson: async (specifier) => {
        resolved.push(specifier);
        if (specifier === "missing") throw new Error("missing");
        return specifier;
      },
      readPackageJson: async (path) => path === "fixture" ? { exports: { "./remote": "./remote.js" } } : {},
    });
    expect(result).toEqual([{ packageName: "fixture", packageJson: "fixture", moduleName: "fixture/remote" }]);
    expect(resolved).toEqual(["fixture", "missing"]);
  });

  it("accepts DeepSeek-style default exports and fallback arrays", async () => {
    const result = await discoverRemoteManifestEntries({
      additionalPackages: ["@deepseek-ai/dsh-goal"],
      resolvePackageJson: async () => "goal/package.json",
      readPackageJson: async () => ({
        exports: {
          "./remote": [
            { types: "./lib/remote.d.ts" },
            { default: "./lib/remote.js" },
          ],
        },
      }),
    });
    expect(result).toEqual([{
      packageName: "@deepseek-ai/dsh-goal",
      packageJson: "goal/package.json",
      moduleName: "@deepseek-ai/dsh-goal/remote",
    }]);
  });
});
