// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

// B1a JS 扩展试点: Pi's own loader imports a file extension and registers its tool + command.
const ROOT = join(import.meta.dirname, "..", "..", "..");
const EXTENSION = join(ROOT, "examples", "pi-extension-demo", "extension.mjs");

describe("示例 Pi 扩展 (B1a)", () => {
  it("loads through Pi's loader and registers demo_echo + /demo", async () => {
    const result = await discoverAndLoadExtensions([EXTENSION], ROOT);
    expect(result.errors ?? []).toEqual([]);
    const extension = result.extensions.find((entry) => entry.path === EXTENSION || entry.resolvedPath === EXTENSION);
    expect(extension).toBeTruthy();
    expect([...extension!.tools.keys()]).toContain("demo_echo");
    expect([...extension!.commands.keys()]).toContain("demo");
    const tool = extension!.tools.get("demo_echo")!;
    expect(tool.definition.name).toBe("demo_echo");
    expect(tool.definition.description).toMatch(/example/i);
  });
});
