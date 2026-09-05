import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { Context } from "@openbuddy/cordis";
import {
  materializeOpenBuddyProfile,
  readOpenBuddyProfile,
  ensureOpenBuddyProfile,
  resolveOpenBuddyProfileDir,
  resolvePackageFromAnchors,
} from "./profile";
import { installProfilePackage, listProfilePackages, removeProfilePackage, type ProfilePackageManager } from "./profile-manager";
import { discoverRendererPluginEntries } from "./renderer-manifest";
import { discoverRemoteManifestEntries } from "./remote-manifest";
import { HarnessPluginLoader } from "./index";

describe("DeepSeek profile composition", () => {
  it("creates a non-destructive desktop profile scaffold for first launch", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const first = await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    expect(first.created).toBe(true);
    expect(await readFile(join(first.dir, "package.json"), "utf8")).toContain('"openbuddy"');
    expect(await readFile(join(first.dir, "package.json"), "utf8")).toContain('"dsh"');
    expect(await readFile(join(first.dir, "cordis.patch.yml"), "utf8")).toContain("[]");

    await writeFile(join(first.dir, "cordis.patch.yml"), "- insert:\n    - id: user\n      name: user-plugin\n");
    await writeFile(join(first.dir, "package.json"), JSON.stringify({
      openbuddy: { profile: { bundles: [] } },
      dsh: { profile: { bundles: ["deepseek-bundle"] } },
    }));
    const second = await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    expect(second.created).toBe(false);
    expect(await readFile(join(first.dir, "cordis.patch.yml"), "utf8")).toContain("user-plugin");
    expect((await readOpenBuddyProfile({ home, profileName: "desktop" })).bundles).toEqual(["deepseek-bundle"]);
  });

  it("reads dsh.profile bundles and preserves profile/home patch order", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profileDir = join(home, "profiles", "desktop");
    await mkdir(join(profileDir, "node_modules", "fixture-bundle"), { recursive: true });
    await writeFile(join(profileDir, "package.json"), JSON.stringify({
      name: "desktop",
      dsh: { profile: {
        bundles: ["fixture-bundle"],
        piExtensions: [{ id: "pi-context-prune", enabled: true }],
      } },
    }));
    await writeFile(join(profileDir, "cordis.patch.yml"), "- id: profile\n  config: { layer: profile }\n");
    await writeFile(join(home, "cordis.patch.yml"), "- id: home\n  config: { layer: home }\n");
    await writeFile(join(profileDir, "node_modules", "fixture-bundle", "package.json"), JSON.stringify({
      name: "fixture-bundle",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    }));
    await writeFile(join(profileDir, "node_modules", "fixture-bundle", "cordis.patch.yml"), "- insert:\n    - id: bundle\n      name: fixture-plugin\n");

    const result = await materializeOpenBuddyProfile({
      home,
      profileName: "desktop",
      anchors: [join(profileDir, "package.json")],
    });
    expect(result.profile.bundles).toEqual(["fixture-bundle"]);
    expect(result.profile.piExtensions).toEqual([{ id: "pi-context-prune", enabled: true }]);
    expect(result.bundle.patches).toHaveLength(3);
    expect(result.bundle.patches?.[0]?.[0]).toMatchObject({ insert: [{ id: "bundle" }] });
    expect(result.bundle.patches?.[1]?.[0]).toMatchObject({ id: "profile" });
    expect(result.bundle.patches?.[2]?.[0]).toMatchObject({ id: "home" });
  });

  it("auto-activates directly installed dependencies that declare a Harness bundle", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profileDir = join(home, "profiles", "desktop");
    const packageDir = join(profileDir, "node_modules", "auto-bundle");
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(profileDir, "package.json"), JSON.stringify({
      name: "desktop",
      dependencies: { "auto-bundle": "file:../auto-bundle" },
      dsh: { profile: { bundles: [] } },
    }));
    await writeFile(join(profileDir, "cordis.patch.yml"), "[]\n");
    await writeFile(join(packageDir, "package.json"), JSON.stringify({
      name: "auto-bundle",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    }));
    await writeFile(join(packageDir, "cordis.patch.yml"), "- insert:\n    - id: auto-entry\n      name: auto-plugin\n");

    const result = await materializeOpenBuddyProfile({
      home,
      profileName: "desktop",
      anchors: [join(profileDir, "package.json")],
    });
    expect(result.profile.bundles).toEqual(["auto-bundle"]);
    expect(result.bundle.patches?.[0]?.[0]).toMatchObject({ insert: [{ id: "auto-entry" }] });
  });

  it("follows dependency declaration order and ignores non-bundle or transitive packages", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profileDir = join(home, "profiles", "desktop");
    const nodeModules = join(profileDir, "node_modules");
    const packages = [
      ["@fixture/scoped-bundle", true],
      ["plain-dependency", false],
      ["optional-bundle", true],
      ["transitive-bundle", true],
    ] as const;
    for (const [name, bundle] of packages) {
      const packageDir = join(nodeModules, ...name.split("/"));
      await mkdir(packageDir, { recursive: true });
      await writeFile(join(packageDir, "package.json"), JSON.stringify({
        name,
        ...(bundle ? { dsh: { bundle: { patch: "./cordis.patch.yml" } } } : {}),
      }));
      if (bundle) await writeFile(join(packageDir, "cordis.patch.yml"), `- insert:\n    - id: ${name.replace(/[^a-z0-9]+/gi, "-")}\n      name: fixture-plugin\n`);
    }
    await writeFile(join(profileDir, "package.json"), JSON.stringify({
      name: "desktop",
      dependencies: {
        "@fixture/scoped-bundle": "1.0.0",
        "plain-dependency": "1.0.0",
      },
      optionalDependencies: {
        "optional-bundle": "1.0.0",
        "missing-optional": "1.0.0",
      },
      dsh: { profile: { bundles: ["@fixture/scoped-bundle"] } },
    }));
    await writeFile(join(profileDir, "cordis.patch.yml"), "[]\n");

    const result = await materializeOpenBuddyProfile({
      home,
      profileName: "desktop",
      anchors: [join(profileDir, "package.json")],
    });
    expect(result.profile.bundles).toEqual(["@fixture/scoped-bundle", "optional-bundle"]);
    expect(result.profile.bundles).not.toContain("plain-dependency");
    expect(result.profile.bundles).not.toContain("transitive-bundle");
  });

  it("discovers Pi package manifests and convention directories in the profile graph", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profileDir = join(home, "profiles", "desktop");
    const packageDir = join(profileDir, "node_modules", "pi-fixture");
    await mkdir(join(packageDir, "extensions"), { recursive: true });
    await mkdir(join(packageDir, "skills", "fixture-skill"), { recursive: true });
    await mkdir(join(packageDir, "prompts"), { recursive: true });
    await mkdir(join(packageDir, "themes"), { recursive: true });
    await mkdir(join(profileDir, "extensions"), { recursive: true });
    await writeFile(join(packageDir, "extensions", "index.js"), "export default () => {}\n");
    await writeFile(join(packageDir, "skills", "fixture-skill", "SKILL.md"), "---\ndescription: fixture\n---\n");
    await writeFile(join(packageDir, "prompts", "fixture.md"), "---\ndescription: fixture\n---\n");
    await writeFile(join(packageDir, "themes", "fixture.json"), "{}\n");
    await writeFile(join(profileDir, "package.json"), JSON.stringify({
      name: "desktop",
      pi: { extensions: ["./extensions"], skills: ["./skills"], prompts: ["./prompts"], themes: ["./themes"] },
    }));
    await writeFile(join(packageDir, "package.json"), JSON.stringify({
      name: "pi-fixture",
      pi: { extensions: ["./extensions/index.js"], skills: ["./skills"], prompts: ["./prompts"], themes: ["./themes"] },
    }));

    const profile = await readOpenBuddyProfile({ profileDir });
    expect(profile.packagePaths).toEqual([profileDir, packageDir]);
    expect(profile.piPackagePaths).toEqual([profileDir, packageDir]);
    expect(profile.piResourcePaths).toEqual({
      extensions: [profileDir, join(packageDir, "extensions", "index.js")],
      skills: [join(profileDir, "skills"), join(packageDir, "skills")],
      prompts: [join(profileDir, "prompts"), join(packageDir, "prompts")],
      themes: [join(profileDir, "themes"), join(packageDir, "themes")],
    });
  });

  it("loads omitted Pi resource fields from conventional package directories", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profileDir = join(home, "profiles", "desktop");
    const packageDir = join(profileDir, "node_modules", "pi-partial");
    await mkdir(join(packageDir, "extensions"), { recursive: true });
    await mkdir(join(packageDir, "skills", "partial-skill"), { recursive: true });
    await mkdir(join(packageDir, "prompts"), { recursive: true });
    await mkdir(join(packageDir, "themes"), { recursive: true });
    await writeFile(join(profileDir, "package.json"), JSON.stringify({ name: "desktop" }));
    await writeFile(join(packageDir, "package.json"), JSON.stringify({
      name: "pi-partial",
      pi: { extensions: ["./extensions"] },
    }));
    await writeFile(join(packageDir, "extensions", "index.js"), "export default () => undefined;\n");
    await writeFile(join(packageDir, "skills", "partial-skill", "SKILL.md"), "---\ndescription: partial\n---\n");
    await writeFile(join(packageDir, "prompts", "partial.md"), "---\ndescription: partial\n---\n");
    await writeFile(join(packageDir, "themes", "partial.json"), "{}\n");

    const profile = await readOpenBuddyProfile({ home, profileName: "desktop" });
    expect(profile.piResourcePaths.extensions).toEqual([packageDir]);
    expect(profile.piResourcePaths.skills).toEqual([join(packageDir, "skills")]);
    expect(profile.piResourcePaths.prompts).toEqual([join(packageDir, "prompts")]);
    expect(profile.piResourcePaths.themes).toEqual([join(packageDir, "themes")]);
  });

  it("falls back to a conventional resource directory when every declared path is stale", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profileDir = join(home, "profiles", "desktop");
    const packageDir = join(profileDir, "node_modules", "pi-stale-manifest");
    await mkdir(join(packageDir, "skills", "fallback-skill"), { recursive: true });
    await writeFile(join(profileDir, "package.json"), JSON.stringify({ name: "desktop" }));
    await writeFile(join(packageDir, "package.json"), JSON.stringify({
      name: "pi-stale-manifest",
      pi: { skills: ["../../skills"] },
    }));
    await writeFile(join(packageDir, "skills", "fallback-skill", "SKILL.md"), "---\ndescription: fallback\n---\n");

    const profile = await readOpenBuddyProfile({ home, profileName: "desktop" });
    expect(profile.piResourcePaths.skills).toEqual([join(packageDir, "skills")]);
  });

  it("preserves Pi manifest glob and exclusion semantics", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profileDir = join(home, "profiles", "desktop");
    const packageDir = join(profileDir, "node_modules", "pi-filtered");
    await mkdir(join(packageDir, "extensions"), { recursive: true });
    await mkdir(join(packageDir, "skills", "keep-skill"), { recursive: true });
    await mkdir(join(packageDir, "skills", "skip-skill"), { recursive: true });
    await writeFile(join(profileDir, "package.json"), JSON.stringify({ name: "desktop" }));
    await writeFile(join(packageDir, "package.json"), JSON.stringify({
      name: "pi-filtered",
      pi: {
        extensions: ["./extensions/*.{js,ts}", "!./extensions/skip.js", "+./extensions/forced.ts"],
        skills: ["./skills/*", "!./skills/skip-skill"],
      },
    }));
    await writeFile(join(packageDir, "extensions", "keep.js"), "export default () => undefined;\n");
    await writeFile(join(packageDir, "extensions", "skip.js"), "export default () => undefined;\n");
    await writeFile(join(packageDir, "extensions", "forced.ts"), "export default () => undefined;\n");
    await writeFile(join(packageDir, "skills", "keep-skill", "SKILL.md"), "---\ndescription: keep\n---\n");
    await writeFile(join(packageDir, "skills", "skip-skill", "SKILL.md"), "---\ndescription: skip\n---\n");

    const profile = await readOpenBuddyProfile({ home, profileName: "desktop" });
    expect(profile.piResourcePaths.extensions).toEqual([
      join(packageDir, "extensions", "forced.ts"),
      join(packageDir, "extensions", "keep.js"),
    ]);
    expect(profile.piResourcePaths.skills).toEqual([join(packageDir, "skills", "keep-skill")]);
  });

  it("supports an explicit profile directory and two-anchor resolution", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profileDir = join(home, "custom");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "package.json"), JSON.stringify({ openbuddy: { profile: { bundles: [] } } }));
    const profile = await readOpenBuddyProfile({ profileDir });
    expect(profile.dir).toBe(profileDir);
    expect(resolveOpenBuddyProfileDir("desktop", home)).toBe(join(home, "profiles", "desktop"));
    await expect(resolvePackageFromAnchors("node:path", [join(profileDir, "package.json")] )).resolves.toBe("node:path");
  });

  it("prefers native OpenBuddy Pi extensions over the DeepSeek fallback field", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profileDir = join(home, "profiles", "desktop");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "package.json"), JSON.stringify({
      openbuddy: { profile: { piExtensions: [{ id: "native" }] } },
      dsh: { profile: { piExtensions: [{ id: "fallback" }] } },
    }));
    expect((await readOpenBuddyProfile({ profileDir })).piExtensions).toEqual([{ id: "native" }]);
  });

  it("materializes a profile that the Harness loader can boot in dependency order", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profileDir = join(home, "profiles", "desktop");
    await mkdir(join(profileDir, "node_modules", "fixture-bundle"), { recursive: true });
    await writeFile(join(profileDir, "package.json"), JSON.stringify({
      dsh: { profile: { bundles: ["fixture-bundle"] } },
    }));
    await writeFile(join(profileDir, "node_modules", "fixture-bundle", "package.json"), JSON.stringify({
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    }));
    await writeFile(join(profileDir, "node_modules", "fixture-bundle", "cordis.patch.yml"), "- insert:\n    - id: provider\n      name: provider\n    - id: consumer\n      name: consumer\n      inject: [provider]\n");
    const materialized = await materializeOpenBuddyProfile({
      home,
      profileName: "desktop",
      anchors: [join(profileDir, "package.json")],
    });
    const calls: string[] = [];
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async (name) => ({
        inject: name === "consumer" ? ["provider"] : undefined,
        apply: (ctx: Context) => {
          if (name === "provider") ctx.provide("provider", true);
          calls.push(name);
        },
      }),
    });
    await loader.loadProfile(materialized.bundle);
    expect(calls).toEqual(["provider", "consumer"]);
  });

  it("installs and removes local dsh bundle packages while keeping profile metadata in sync", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const profile = await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    const source = join(home, "source-bundle");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-installed-bundle",
      version: "1.0.0",
      dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { module: "./client.js" } },
    }));
    await writeFile(join(source, "cordis.patch.yml"), "[]\n");
    await writeFile(join(source, "client.js"), "export default {}\n");
    const options = { home, profileName: "desktop" };
    const installed = await installProfilePackage(options, source);
    expect(installed).toMatchObject({ name: "fixture-installed-bundle", bundle: true, client: true, listed: true });
    expect(await listProfilePackages(options)).toHaveLength(1);
    expect((await readOpenBuddyProfile(options)).bundles).toEqual(["fixture-installed-bundle"]);
    await removeProfilePackage(options, "fixture-installed-bundle");
    expect(await listProfilePackages(options)).toEqual([]);
    expect((await readOpenBuddyProfile(options)).bundles).toEqual([]);
    expect(profile.dir).toContain("profiles/desktop");
  });

  it("installs and removes a pure DeepSeek Cordis plugin package", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const options = { home, profileName: "desktop" };
    await ensureOpenBuddyProfile(options);
    const source = join(home, "source-cordis-plugin");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "@deepseek-ai/dsh-terminal",
      version: "0.1.1-rc.2",
      peerDependencies: { "@deepseek-ai/cordis": "^0.1.1" },
    }));

    const installed = await installProfilePackage(options, source);
    expect(installed).toMatchObject({
      name: "@deepseek-ai/dsh-terminal",
      bundle: false,
      client: false,
      pi: false,
      remote: false,
      typert: false,
      cordis: true,
    });
    expect(installed.manifest.surfaces).toEqual([{ kind: "cordis", namespace: "dsh" }]);

    await removeProfilePackage(options, "@deepseek-ai/dsh-terminal");
    expect(await listProfilePackages(options)).toEqual([]);
  });

  it("connects an installed client package to renderer discovery and removes it cleanly", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    const source = join(home, "source-client");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-installed-client",
      version: "1.0.0",
      dsh: { client: { platform: "web", immediately: true } },
      exports: { "./client": "./client.js" },
    }));
    await writeFile(join(source, "client.js"), "export default {}\n");

    const options = { home, profileName: "desktop" };
    const installed = await installProfilePackage(options, source);
    const packageJson = join(installed.path, "package.json");
    const discovered = await discoverRendererPluginEntries([], {
      additionalPackages: [installed.name],
      resolvePackageJson: async () => packageJson,
      readPackageJson: async (path) => JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>,
      resolveModule: async () => pathToFileURL(join(installed.path, "client.js")).href,
    });
    expect(discovered).toEqual([expect.objectContaining({
      id: installed.name,
      moduleKey: installed.name,
      moduleUrl: pathToFileURL(join(installed.path, "client.js")).href,
      immediately: true,
    })]);

    await removeProfilePackage(options, installed.name);
    expect(await listProfilePackages(options)).toEqual([]);
  });

  it("runs an external dsh package through bundle, renderer, remote, and Pi discovery", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-external-dsh-"));
    const source = join(process.cwd(), "packages/runtime/openbuddy-plugin-host/src/__fixtures__/external-dsh-plugin");
    const options = { home, profileName: "desktop" };
    await ensureOpenBuddyProfile(options);
    const installed = await installProfilePackage(options, source);
    const profile = await readOpenBuddyProfile(options);
    const packageJson = join(installed.path, "package.json");
    const resolvePackageJson = async (specifier: string): Promise<string> => {
      if (specifier === installed.name) return packageJson;
      throw new Error(`unknown fixture package ${specifier}`);
    };
    const resolveModule = async (specifier: string): Promise<string> => {
      if (specifier === `${installed.name}/client`) return join(installed.path, "client.js");
      if (specifier === `${installed.name}/remote`) return join(installed.path, "remote.js");
      throw new Error(`unknown fixture module ${specifier}`);
    };
    const importer = async (specifier: string): Promise<unknown> => {
      const resolved = createRequire(profile.packageJson).resolve(specifier);
      const module = await import(pathToFileURL(resolved).href);
      return module.default ?? module;
    };
    const loader = new HarnessPluginLoader({ context: new Context(), importer });

    const materialized = await materializeOpenBuddyProfile(options);
    await loader.loadProfile(materialized.bundle);
    expect(loader.resolve("external-dsh-service").status.state).toBe("loaded");
    expect(loader.getContext().get("externalDsh")).toEqual({ source: "external" });

    const renderer = await discoverRendererPluginEntries([], {
      additionalPackages: [installed.name],
      resolvePackageJson,
      resolveModule: async (specifier) => pathToFileURL(await resolveModule(specifier)).href,
    });
    expect(renderer).toEqual([expect.objectContaining({
      id: installed.name,
      name: `${installed.name}/client`,
      immediately: true,
      moduleUrl: expect.stringContaining("/client.js"),
    })]);

    const remotes = await discoverRemoteManifestEntries({
      additionalPackages: [installed.name],
      resolvePackageJson,
      resolveModule: async (specifier) => pathToFileURL(await resolveModule(specifier)).href,
    });
    expect(remotes).toEqual([expect.objectContaining({
      packageName: installed.name,
      moduleName: `${installed.name}/remote`,
      moduleUrl: expect.stringContaining("/remote.js"),
    })]);

    expect(profile.piResourcePaths.extensions).toEqual([join(installed.path, "extensions/index.js")]);
    expect(profile.piResourcePaths.skills).toEqual([join(installed.path, "skills")]);
    await loader.dispose();
    await removeProfilePackage(options, installed.name);
    expect(await listProfilePackages(options)).toEqual([]);
  });

  it("lists installed generated Remote packages without treating them as bundles", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    const source = join(home, "source-remote");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-installed-remote",
      version: "1.0.0",
      exports: { "./remote": "./remote.js" },
    }));
    await writeFile(join(source, "remote.js"), "export default {}\n");
    const installed = await installProfilePackage({ home, profileName: "desktop" }, source);
    expect(installed).toMatchObject({ name: "fixture-installed-remote", bundle: false, client: false, pi: false, remote: true, typert: false });
  });

  it("lists installed generated Typert host packages without treating them as bundles", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    const source = join(home, "source-typert");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-installed-typert",
      version: "1.0.0",
      exports: { "./typert": "./typert.js" },
    }));
    await writeFile(join(source, "typert.js"), "export default {}\n");
    const installed = await installProfilePackage({ home, profileName: "desktop" }, source);
    expect(installed).toMatchObject({ name: "fixture-installed-typert", bundle: false, client: false, pi: false, remote: false, typert: true });
  });

  it("installs and lists pure Pi packages without adding them to the Harness bundle profile", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    const source = join(home, "pi-package");
    await mkdir(join(source, "extensions"), { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-pi-package",
      version: "1.0.0",
      pi: { extensions: ["./extensions"] },
    }));
    const options = { home, profileName: "desktop" };
    const installed = await installProfilePackage(options, source);
    expect(installed).toMatchObject({ name: "fixture-pi-package", bundle: false, client: false, pi: true, listed: false });
    expect((await readOpenBuddyProfile(options)).bundles).toEqual([]);
    expect((await readOpenBuddyProfile(options)).piPackagePaths).toEqual([
      join(home, "profiles", "desktop", "node_modules", "fixture-pi-package"),
    ]);
    await removeProfilePackage(options, "fixture-pi-package");
    expect(await listProfilePackages(options)).toEqual([]);
  });

  it("materializes nested package dependencies into the installed profile graph", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    const source = join(home, "source-with-dependencies");
    const dependency = join(source, "node_modules", "fixture-dependency");
    const nestedDependency = join(dependency, "node_modules", "fixture-nested");
    await mkdir(nestedDependency, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-with-dependencies",
      version: "1.0.0",
      pi: { extensions: ["./extensions"] },
      dependencies: { "fixture-dependency": "1.0.0" },
    }));
    await mkdir(join(source, "extensions"), { recursive: true });
    await writeFile(join(source, "extensions", "index.js"), "export default () => undefined;\n");
    await writeFile(join(dependency, "package.json"), JSON.stringify({
      name: "fixture-dependency",
      version: "1.0.0",
      dependencies: { "fixture-nested": "1.0.0" },
    }));
    await writeFile(join(dependency, "index.js"), "export default true;\n");
    await writeFile(join(nestedDependency, "package.json"), JSON.stringify({ name: "fixture-nested", version: "1.0.0", main: "index.js" }));
    await writeFile(join(nestedDependency, "index.js"), "export default true;\n");

    const installed = await installProfilePackage({ home, profileName: "desktop" }, source);
    const installedDependency = join(installed.path, "node_modules", "fixture-dependency");
    const installedNested = join(installedDependency, "node_modules", "fixture-nested");
    expect((await lstat(installedDependency)).isSymbolicLink()).toBe(false);
    expect((await lstat(installedNested)).isSymbolicLink()).toBe(false);
    expect(JSON.parse(await readFile(join(installedNested, "package.json"), "utf8"))).toMatchObject({ name: "fixture-nested" });
  });

  it("rolls back an existing package when a required dependency is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const options = { home, profileName: "desktop" };
    await ensureOpenBuddyProfile(options);
    const existing = join(home, "existing-package");
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, "package.json"), JSON.stringify({
      name: "fixture-rollback",
      version: "1.0.0",
      pi: { extensions: ["./extensions"] },
    }));
    await mkdir(join(existing, "extensions"), { recursive: true });
    await writeFile(join(existing, "extensions", "index.js"), "export default () => undefined;\n");
    await installProfilePackage(options, existing);

    const replacement = join(home, "replacement-package");
    await mkdir(replacement, { recursive: true });
    await writeFile(join(replacement, "package.json"), JSON.stringify({
      name: "fixture-rollback",
      version: "2.0.0",
      pi: { extensions: ["./extensions"] },
      dependencies: { "fixture-missing": "1.0.0" },
    }));
    await mkdir(join(replacement, "extensions"), { recursive: true });
    await writeFile(join(replacement, "extensions", "index.js"), "export default () => undefined;\n");

    await expect(installProfilePackage(options, replacement)).rejects.toThrow(/missing dependency fixture-missing/);
    const installed = await listProfilePackages(options);
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({ name: "fixture-rollback", version: "1.0.0" });
  });

  it("keeps dsh profile bundle metadata when replacing a bundle fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-bundle-rollback-"));
    const options = { home, profileName: "desktop" };
    await ensureOpenBuddyProfile(options);
    const existing = join(home, "existing-bundle");
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, "package.json"), JSON.stringify({
      name: "fixture-bundle-rollback",
      version: "1.0.0",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    }));
    await writeFile(join(existing, "cordis.patch.yml"), "[]\n");
    await installProfilePackage(options, existing);
    expect((await readOpenBuddyProfile(options)).bundles).toEqual(["fixture-bundle-rollback"]);

    const replacement = join(home, "replacement-bundle");
    await mkdir(replacement, { recursive: true });
    await writeFile(join(replacement, "package.json"), JSON.stringify({
      name: "fixture-bundle-rollback",
      version: "2.0.0",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
      dependencies: { "fixture-missing": "1.0.0" },
    }));
    await writeFile(join(replacement, "cordis.patch.yml"), "[]\n");

    await expect(installProfilePackage(options, replacement)).rejects.toThrow(/missing dependency fixture-missing/);
    expect((await readOpenBuddyProfile(options)).bundles).toEqual(["fixture-bundle-rollback"]);
    expect(await listProfilePackages(options)).toEqual([expect.objectContaining({
      name: "fixture-bundle-rollback",
      version: "1.0.0",
      listed: true,
    })]);
  });

  it("leaves unresolved peer dependencies for the host compatibility layer", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    const source = join(home, "source-with-host-peer");
    await mkdir(join(source, "extensions"), { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-with-host-peer",
      version: "1.0.0",
      pi: { extensions: ["./extensions"] },
      peerDependencies: { "fixture-host-abi": "^1.0.0" },
    }));
    await writeFile(join(source, "extensions", "index.js"), "export default () => undefined;\n");

    const installed = await installProfilePackage({ home, profileName: "desktop" }, source);
    expect(installed).toMatchObject({
      name: "fixture-with-host-peer",
      pi: true,
      health: "degraded",
    });
    expect(installed.dependencies).toEqual([expect.objectContaining({
      name: "fixture-host-abi",
      kind: "peer",
      health: "missing",
    })]);
  });

  it("reports optional dependencies without blocking installation", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    const source = join(home, "source-with-optional");
    await mkdir(join(source, "extensions"), { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-with-optional",
      version: "1.0.0",
      pi: { extensions: ["./extensions"] },
      optionalDependencies: { "fixture-optional": "^1.0.0" },
    }));
    await writeFile(join(source, "extensions", "index.js"), "export default () => undefined;\n");

    const installed = await installProfilePackage({ home, profileName: "desktop" }, source);
    expect(installed.health).toBe("degraded");
    expect(installed.dependencies[0]).toMatchObject({
      name: "fixture-optional",
      kind: "optional",
      health: "missing",
    });
  });

  it("reports installed dependency versions that do not satisfy the requested range", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const options = { home, profileName: "desktop" };
    await ensureOpenBuddyProfile(options);
    const source = join(home, "source-with-version-mismatch");
    const dependency = join(source, "node_modules", "fixture-versioned");
    await mkdir(join(dependency), { recursive: true });
    await mkdir(join(source, "extensions"), { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-version-mismatch",
      version: "1.0.0",
      pi: { extensions: ["./extensions"] },
      dependencies: { "fixture-versioned": "^2.0.0" },
    }));
    await writeFile(join(source, "extensions", "index.js"), "export default () => undefined;\n");
    await writeFile(join(dependency, "package.json"), JSON.stringify({ name: "fixture-versioned", version: "1.5.0" }));
    await writeFile(join(dependency, "index.js"), "export default true;\n");

    const installed = await installProfilePackage(options, source);
    expect(installed.health).toBe("degraded");
    expect(installed.dependencies[0]).toMatchObject({
      name: "fixture-versioned",
      requested: "^2.0.0",
      installed: "1.5.0",
      kind: "dependency",
      health: "version-mismatch",
    });
  });

  it("rejects local packages without a Harness bundle or client declaration", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    await ensureOpenBuddyProfile({ home, profileName: "desktop" });
    const source = join(home, "not-a-bundle");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "not-a-bundle" }));
    await expect(installProfilePackage({ home, profileName: "desktop" }, source)).rejects.toThrow(/does not declare/);
  });

  it("installs and removes npm/git-style sources through the profile package manager", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const options = { home, profileName: "desktop" };
    await ensureOpenBuddyProfile(options);
    const calls: string[] = [];
    const packageManager: ProfilePackageManager = {
      async install(profileDir, source) {
        calls.push(`install:${source}`);
        const packageDir = join(profileDir, "node_modules", "source-bundle");
        await mkdir(packageDir, { recursive: true });
        await writeFile(join(profileDir, "package.json"), JSON.stringify({
          name: "openbuddy-profile-desktop",
          dependencies: { "source-bundle": "git+https://example.invalid/source-bundle.git#v1.0.0" },
          dsh: { profile: { bundles: [] } },
        }));
        await writeFile(join(packageDir, "package.json"), JSON.stringify({
          name: "source-bundle",
          version: "1.0.0",
          dsh: { bundle: { patch: "./cordis.patch.yml" } },
        }));
        await writeFile(join(packageDir, "cordis.patch.yml"), "[]\n");
      },
      async remove(profileDir, name) {
        calls.push(`remove:${name}`);
        await writeFile(join(profileDir, "package.json"), JSON.stringify({
          name: "openbuddy-profile-desktop",
          dependencies: {},
          dsh: { profile: { bundles: [] } },
        }));
      },
    };

    const installed = await installProfilePackage({ ...options, packageManager }, "git+https://example.invalid/source-bundle.git#v1.0.0");
    expect(installed).toMatchObject({ name: "source-bundle", bundle: true, listed: true });
    expect(calls).toEqual(["install:git+https://example.invalid/source-bundle.git#v1.0.0"]);

    await removeProfilePackage({ ...options, packageManager }, "source-bundle");
    expect(calls).toEqual([
      "install:git+https://example.invalid/source-bundle.git#v1.0.0",
      "remove:source-bundle",
    ]);
  });

  it("uses the real pnpm adapter for a local file source", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const options = { home, profileName: "desktop" };
    await ensureOpenBuddyProfile(options);
    const source = await mkdtemp(join(tmpdir(), "openbuddy-file-package-"));
    await mkdir(join(source, "skills", "file-skill"), { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({
      name: "fixture-file-source",
      version: "1.0.0",
      pi: { skills: ["./skills"] },
    }));
    await writeFile(join(source, "skills", "file-skill", "SKILL.md"), "---\ndescription: file source\n---\n");

    const installed = await installProfilePackage(options, `file:${source}`);
    expect(installed).toMatchObject({ name: "fixture-file-source", pi: true, bundle: false });
    expect((await readOpenBuddyProfile(options)).packagePaths.some((path) => path.endsWith("fixture-file-source"))).toBe(true);

    await removeProfilePackage(options, "fixture-file-source");
    expect(await listProfilePackages(options)).toEqual([]);
  }, 15_000);

  it("rolls back a source install when the installed package has no supported face", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const options = { home, profileName: "desktop" };
    await ensureOpenBuddyProfile(options);
    const before = await readFile(join(home, "profiles", "desktop", "package.json"), "utf8");
    const calls: string[] = [];
    const packageManager: ProfilePackageManager = {
      async install(profileDir) {
        calls.push("install");
        const packageDir = join(profileDir, "node_modules", "plain-package");
        await mkdir(packageDir, { recursive: true });
        await writeFile(join(profileDir, "package.json"), JSON.stringify({ name: "openbuddy-profile-desktop", dependencies: { "plain-package": "1.0.0" } }));
        await writeFile(join(packageDir, "package.json"), JSON.stringify({ name: "plain-package", version: "1.0.0" }));
      },
      async remove(profileDir, name) {
        calls.push(`remove:${name}`);
        await writeFile(join(profileDir, "package.json"), before);
      },
    };
    await expect(installProfilePackage({ ...options, packageManager }, "plain-package@1.0.0")).rejects.toThrow(/supported package/);
    expect(await readFile(join(home, "profiles", "desktop", "package.json"), "utf8")).toBe(before);
    expect(calls).toEqual(["install", "remove:plain-package"]);
  });

  it("does not implicitly upgrade an existing direct dependency", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const options = { home, profileName: "desktop" };
    await ensureOpenBuddyProfile(options);
    await writeFile(join(home, "profiles", "desktop", "package.json"), JSON.stringify({
      name: "openbuddy-profile-desktop",
      dependencies: { "existing-package": "1.0.0" },
    }));
    const install = vi.fn(async () => undefined);
    await expect(installProfilePackage({ ...options, packageManager: { install, remove: vi.fn() } }, "existing-package@2.0.0"))
      .rejects.toThrow(/already installed/);
    expect(install).not.toHaveBeenCalled();
  });

  it("resolves package aliases from the newly added dependency set", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-profile-"));
    const options = { home, profileName: "desktop" };
    await ensureOpenBuddyProfile(options);
    const packageManager: ProfilePackageManager = {
      async install(profileDir) {
        const packageDir = join(profileDir, "node_modules", "alias-name");
        await mkdir(packageDir, { recursive: true });
        await writeFile(join(profileDir, "package.json"), JSON.stringify({
          name: "openbuddy-profile-desktop",
          dependencies: { "alias-name": "npm:source-bundle@1.0.0" },
        }));
        await writeFile(join(packageDir, "package.json"), JSON.stringify({
          name: "source-bundle",
          version: "1.0.0",
          pi: { skills: ["./skills"] },
        }));
        await mkdir(join(packageDir, "skills"), { recursive: true });
      },
      async remove() { /* fixture cleanup is not needed for this resolution test */ },
    };
    const installed = await installProfilePackage({ ...options, packageManager }, "alias-name@npm:source-bundle@1.0.0");
    expect(installed).toMatchObject({ name: "source-bundle", pi: true });
    await removeProfilePackage({ ...options, packageManager }, "source-bundle");
  });
});
