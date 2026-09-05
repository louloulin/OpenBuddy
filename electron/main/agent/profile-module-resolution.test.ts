import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProfileModuleFallback } from "./profile-module-resolution";

describe("profile module resolution fallback", () => {
  it("resolves package main and explicit module files without exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-module-"));
    const packageRoot = join(root, "fixture");
    await mkdir(join(packageRoot, "client"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "fixture", main: "main.mjs" }));
    await writeFile(join(packageRoot, "main.mjs"), "export default {};");
    await writeFile(join(packageRoot, "client", "index.mjs"), "export default {};");
    const packageJson = join(packageRoot, "package.json");

    await expect(resolveProfileModuleFallback("fixture", packageJson)).resolves.toBe(join(packageRoot, "main.mjs"));
    await expect(resolveProfileModuleFallback("fixture/client", packageJson)).resolves.toBe(join(packageRoot, "client", "index.mjs"));
  });

  it("rejects modules outside the declaring package root", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-module-"));
    const packageRoot = join(root, "fixture");
    await mkdir(packageRoot, { recursive: true });
    const packageJson = join(packageRoot, "package.json");
    await writeFile(packageJson, JSON.stringify({ name: "fixture" }));

    await expect(resolveProfileModuleFallback("fixture/../secret", packageJson)).resolves.toBeUndefined();
  });
});
