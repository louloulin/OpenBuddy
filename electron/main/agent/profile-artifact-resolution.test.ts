import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProfileArtifactResolvers, discoverProfilePackageJsons } from "./profile-artifact-resolution";

describe("profile artifact resolution", () => {
  it("discovers generated artifact packages from nested profile dependencies", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-artifacts-"));
    const profileRoot = join(root, "profile");
    const directRoot = join(profileRoot, "node_modules", "@fixture", "bundle");
    const nestedRoot = join(directRoot, "node_modules", "@fixture", "service");
    await mkdir(nestedRoot, { recursive: true });
    await writeFile(join(profileRoot, "package.json"), JSON.stringify({ name: "profile" }));
    await writeFile(join(directRoot, "package.json"), JSON.stringify({ name: "@fixture/bundle" }));
    await writeFile(join(nestedRoot, "package.json"), JSON.stringify({
      name: "@fixture/service",
      exports: { "./remote": "./remote.js", "./typert": "./typert.js" },
    }));
    const manifests = await discoverProfilePackageJsons([profileRoot]);
    expect([...manifests.keys()]).toEqual(["profile", "@fixture/bundle", "@fixture/service"]);
    expect(manifests.get("@fixture/service")).toBe(join(nestedRoot, "package.json"));
  });

  it("resolves nested dependencies from the profile package anchor", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-artifacts-"));
    const profileRoot = join(root, "profile");
    const dependencyRoot = join(profileRoot, "node_modules", "@fixture", "nested");
    await mkdir(join(dependencyRoot, "lib"), { recursive: true });
    const profilePackageJson = join(profileRoot, "package.json");
    const dependencyPackageJson = join(dependencyRoot, "package.json");
    await writeFile(profilePackageJson, JSON.stringify({ name: "profile" }));
    await writeFile(dependencyPackageJson, JSON.stringify({
      name: "@fixture/nested",
      exports: {
        "./remote": {
          node: "./lib/node.remote.mjs",
          default: "./lib/default.remote.mjs",
        },
      },
    }));
    await writeFile(join(dependencyRoot, "lib/node.remote.mjs"), "export default {};\n");

    const resolvers = createProfileArtifactResolvers({
      packageJsonByName: new Map([["profile", profilePackageJson]]),
      profilePackageJson,
    });
    const resolvedPackageJson = await resolvers.resolvePackageJson("@fixture/nested");
    expect(resolvedPackageJson).toBe(dependencyPackageJson);
    expect(realpathSync(await resolvers.resolveModule("@fixture/nested/remote", resolvedPackageJson))).toBe(
      realpathSync(join(dependencyRoot, "lib/node.remote.mjs")),
    );
  });

  it("prefers the installed profile package path before Node lookup", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-artifacts-"));
    const packageRoot = join(root, "installed");
    await mkdir(join(packageRoot, "lib"), { recursive: true });
    const packageJson = join(packageRoot, "package.json");
    await writeFile(packageJson, JSON.stringify({
      name: "@fixture/installed",
      exports: { "./typert": "./lib/typert.mjs" },
    }));
    await writeFile(join(packageRoot, "lib/typert.mjs"), "export default {};\n");

    const resolvers = createProfileArtifactResolvers({
      packageJsonByName: new Map([["@fixture/installed", packageJson]]),
    });
    expect(await resolvers.resolvePackageJson("@fixture/installed")).toBe(packageJson);
    expect(realpathSync(await resolvers.resolveModule("@fixture/installed/typert", packageJson))).toBe(
      realpathSync(join(packageRoot, "lib/typert.mjs")),
    );
  });

  it("resolves DeepSeek default exports through a fallback array", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-artifacts-"));
    const packageRoot = join(root, "generated");
    await mkdir(join(packageRoot, "lib"), { recursive: true });
    const packageJson = join(packageRoot, "package.json");
    await writeFile(packageJson, JSON.stringify({
      name: "@fixture/generated",
      exports: {
        "./remote": [
          { types: "./lib/remote.d.ts" },
          { default: "./lib/remote.mjs" },
        ],
      },
    }));
    await writeFile(join(packageRoot, "lib/remote.mjs"), "export default {};\n");

    const resolvers = createProfileArtifactResolvers({
      packageJsonByName: new Map([["@fixture/generated", packageJson]]),
    });
    expect(realpathSync(await resolvers.resolveModule("@fixture/generated/remote", packageJson))).toBe(
      realpathSync(join(packageRoot, "lib/remote.mjs")),
    );
  });
});
