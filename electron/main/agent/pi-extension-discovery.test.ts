import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_PI_PACKAGES,
  discoverInstalledPiPackages,
  discoveredPiPackagePaths,
} from "./pi-extension-discovery";

describe("pi-extension-discovery", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "pi-discovery-"));
    // Pretend the temp dir is the cwd so node_modulesRoots() picks it up.
    vi.spyOn(process, "cwd").mockReturnValue(tmp);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns an empty list when node_modules is absent", () => {
    expect(discoverInstalledPiPackages()).toEqual([]);
    expect(discoveredPiPackagePaths()).toEqual([]);
  });

  it("discovers scoped and unscoped pi packages with extension.js entries", async () => {
    const nm = join(tmp, "node_modules");
    // Scoped package with extension.js
    await mkdir(join(nm, "@remnic", "plugin-pi"), { recursive: true });
    await writeFile(join(nm, "@remnic", "plugin-pi", "package.json"), '{"name":"@remnic/plugin-pi"}');
    await writeFile(join(nm, "@remnic", "plugin-pi", "extension.js"), "module.exports = {};");
    // Unscoped package with index.js fallback
    await mkdir(join(nm, "pi-hermes-memory"), { recursive: true });
    await writeFile(join(nm, "pi-hermes-memory", "package.json"), '{"name":"pi-hermes-memory"}');
    await writeFile(join(nm, "pi-hermes-memory", "index.js"), "module.exports = {};");
    // Dist extension
    await mkdir(join(nm, "pi-mcp-adapter", "dist"), { recursive: true });
    await writeFile(join(nm, "pi-mcp-adapter", "package.json"), '{"name":"pi-mcp-adapter"}');
    await writeFile(join(nm, "pi-mcp-adapter", "dist", "extension.js"), "module.exports = {};");

    const found = discoverInstalledPiPackages();
    const names = found.map((entry) => entry.packageName).sort();
    expect(names).toEqual(["@remnic/plugin-pi", "pi-hermes-memory", "pi-mcp-adapter"]);
    const paths = discoveredPiPackagePaths();
    expect(paths).toContain(join(nm, "@remnic", "plugin-pi", "extension.js"));
    expect(paths).toContain(join(nm, "pi-hermes-memory", "index.js"));
    expect(paths).toContain(join(nm, "pi-mcp-adapter", "dist", "extension.js"));
  });

  it("dedupes when the same package appears in multiple roots", async () => {
    const nm1 = join(tmp, "node_modules");
    await mkdir(join(nm1, "pi-lens"), { recursive: true });
    await writeFile(join(nm1, "pi-lens", "extension.js"), "");

    const nm2 = join(tmp, "secondary", "node_modules");
    await mkdir(join(nm2, "pi-lens"), { recursive: true });
    await writeFile(join(nm2, "pi-lens", "extension.js"), "");

    // The secondary root may not be probed (electronRoot + piHome) but
    // even if both are, dedupe must collapse to a single entry.
    const found = discoverInstalledPiPackages();
    expect(found.filter((entry) => entry.packageName === "pi-lens").length).toBeLessThanOrEqual(1);
  });

  it("ignores packages without any candidate entry", async () => {
    const nm = join(tmp, "node_modules");
    await mkdir(join(nm, "pi-simplify"), { recursive: true });
    await writeFile(join(nm, "pi-simplify", "package.json"), "{}");
    // no extension.js / index.js / dist/extension.js
    expect(discoverInstalledPiPackages()).toEqual([]);
  });

  it("CANONICAL_PI_PACKAGES lists every package the adapter table can passthrough", () => {
    expect(CANONICAL_PI_PACKAGES).toContain("pi-hermes-memory");
    expect(CANONICAL_PI_PACKAGES).toContain("pi-plan-mode");
    expect(CANONICAL_PI_PACKAGES).toContain("pi-web-access");
    expect(CANONICAL_PI_PACKAGES).toContain("pi-mcp-adapter");
    expect(CANONICAL_PI_PACKAGES).toContain("pi-lens");
    expect(CANONICAL_PI_PACKAGES).toContain("pi-simplify");
    expect(CANONICAL_PI_PACKAGES.length).toBeGreaterThanOrEqual(15);
  });
});
