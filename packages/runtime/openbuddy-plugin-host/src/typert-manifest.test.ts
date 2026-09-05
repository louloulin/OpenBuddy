import { describe, expect, it } from "vitest";
import { discoverTypertManifestEntries, validateTypertHostContribution } from "./typert-manifest";

describe("DeepSeek Typert host manifest", () => {
  it("discovers and validates generated host artifacts", async () => {
    const entries = await discoverTypertManifestEntries({
      additionalPackages: ["@fixture/goal"],
      resolvePackageJson: async () => "goal/package.json",
      readPackageJson: async () => ({ exports: { "./typert": { node: "./lib/typert.host.js" } } }),
      resolveModule: async (specifier) => `file:///tmp/${specifier.replaceAll("/", "-")}.js`,
    });
    expect(entries[0]).toMatchObject({ packageName: "@fixture/goal", moduleName: "@fixture/goal/typert" });
    expect(validateTypertHostContribution("@fixture/goal", {
      package: "@fixture/goal",
      face: "host",
      schemas: [{ name: "Request", schema: { _zod: {}, parse: (value: unknown) => value } }],
      invocations: [],
      model: { services: [], events: [], objects: [] },
    })).toMatchObject({ package: "@fixture/goal", face: "host" });
  });

  it("accepts fallback arrays while ignoring type declarations", async () => {
    const entries = await discoverTypertManifestEntries({
      additionalPackages: ["@fixture/goal"],
      resolvePackageJson: async () => "goal/package.json",
      readPackageJson: async () => ({
        exports: {
          "./typert": [
            { types: "./lib/typert.host.d.ts" },
            { default: "./lib/typert.host.js" },
          ],
        },
      }),
    });
    expect(entries).toEqual([{
      packageName: "@fixture/goal",
      packageJson: "goal/package.json",
      moduleName: "@fixture/goal/typert",
    }]);
  });

  it("rejects a manifest owned by a different package", () => {
    expect(() => validateTypertHostContribution("@fixture/goal", {
      package: "@fixture/other", face: "host", schemas: [], invocations: [], model: {},
    })).toThrow("TYPERT.package is invalid");
  });

  it("requires generated Zod schemas and strict invocation codecs", () => {
    expect(() => validateTypertHostContribution("@fixture/broken", {
      package: "@fixture/broken", face: "host", schemas: [{ name: "Request", schema: {} }], invocations: [], model: {},
    })).toThrow("not backed by a zod v4 schema");

    const schema = { _zod: {}, parse: (value: unknown) => value };
    const invocation = {
      id: "@fixture/goal#run",
      service: "goal",
      namespace: "goal",
      method: "run",
      invocation: { kind: "direct" },
      parameters: [{ name: "request", wire: "request", source: "json", codec: { mode: "strict", typeSymbol: "@fixture/goal#Request", schema } }],
      result: { mode: "strict", typeSymbol: "@fixture/goal#Result", schema },
    };
    expect(validateTypertHostContribution("@fixture/goal", {
      package: "@fixture/goal", face: "host", schemas: [], invocations: [invocation], model: { services: [], events: [], objects: [] },
    }).invocations).toEqual([invocation]);
    expect(() => validateTypertHostContribution("@fixture/goal", {
      package: "@fixture/goal", face: "host", schemas: [], invocations: [invocation, { ...invocation }], model: { services: [], events: [], objects: [] },
    })).toThrow("invocation id is duplicated");
  });
});
