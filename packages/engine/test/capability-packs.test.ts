// @vitest-environment node
// B1a: an imported capability pack is persisted, switchable per contribution, and removable.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sdkFixture } from "./helpers/sdk-fixture.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function capabilityPackage(root: string): string {
  const pkg = join(root, "lifecycle-pkg");
  mkdirSync(join(pkg, ".codebuddy-plugin"), { recursive: true });
  mkdirSync(join(pkg, "skills", "demo"), { recursive: true });
  mkdirSync(join(pkg, "commands"), { recursive: true });
  writeFileSync(join(pkg, ".codebuddy-plugin", "plugin.json"), JSON.stringify({
    name: "lifecycle-pack",
    displayName: { zh: "生命周期包" },
    skills: ["./skills/demo"],
    commands: ["./commands"],
    mcpServers: { calendar: { type: "http", url: "https://example.invalid/mcp" } },
  }));
  writeFileSync(join(pkg, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: 演示技能\n---\n做一件事。\n");
  writeFileSync(join(pkg, "commands", "hello.md"), "---\ndescription: 打个招呼\n---\n说你好。\n");
  return pkg;
}

describe("能力包生命周期 (B1a)", () => {
  it("lists, disables, re-enables per contribution, and rolls back an imported pack", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    const pkg = capabilityPackage(f.root);

    const imported = (await f.call("experts_import_workbuddy", { path: pkg })) as any;
    expect(imported.packId).toBe("lifecycle-pack");
    expect(imported.contributions).toEqual(expect.arrayContaining([
      { kind: "skill", name: "demo", enabled: true },
      { kind: "prompt", name: "hello", enabled: true },
      { kind: "mcp", name: "calendar", enabled: false },
    ]));

    const listed = (await f.call("capability_packs_list")) as any[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: "lifecycle-pack", name: "lifecycle-pack", enabled: true });
    expect((await f.call("skills_list")) as any[]).toContainEqual(expect.objectContaining({ name: "demo", enabled: true }));
    expect(((await f.call("prompts_list")) as any[]).map((entry) => entry.name)).toContain("hello");

    // Pack-level off: skills disabled in OpenBuddy's loader, prompt hidden from Pi's `.md` scan.
    await f.call("capability_packs_set_enabled", { id: "lifecycle-pack", enabled: false });
    expect((await f.call("skills_list")) as any[]).toContainEqual(expect.objectContaining({ name: "demo", enabled: false }));
    expect(((await f.call("prompts_list")) as any[]).map((entry) => entry.name)).not.toContain("hello");

    // Pack-level on restores both, but MCP stays opt-in.
    const on = (await f.call("capability_packs_set_enabled", { id: "lifecycle-pack", enabled: true })) as any[];
    expect(on[0].enabled).toBe(true);
    expect(((await f.call("prompts_list")) as any[]).map((entry) => entry.name)).toContain("hello");
    expect(((await f.call("mcp_list")) as any[]).find((entry) => entry.name === "calendar")).toMatchObject({ enabled: false });

    // One contribution off leaves the rest on.
    const one = (await f.call("capability_packs_set_contribution", { id: "lifecycle-pack", kind: "prompt", name: "hello", enabled: false })) as any[];
    expect(one[0].contributions).toEqual(expect.arrayContaining([
      { kind: "prompt", name: "hello", enabled: false },
      { kind: "skill", name: "demo", enabled: true },
    ]));
    expect(((await f.call("prompts_list")) as any[]).map((entry) => entry.name)).not.toContain("hello");

    // Roll back to the pre-install state: descriptor, skill and prompt are gone; MCP is only switched off.
    const removal = (await f.call("capability_packs_remove", { id: "lifecycle-pack" })) as any;
    expect(removal).toMatchObject({ packId: "lifecycle-pack", removed: true, kept: [] });
    expect(await f.call("capability_packs_list")).toEqual([]);
    expect(((await f.call("skills_list")) as any[]).map((entry) => entry.name)).not.toContain("demo");
    expect(((await f.call("prompts_list")) as any[]).map((entry) => entry.name)).not.toContain("hello");
    expect(((await f.call("mcp_list")) as any[]).find((entry) => entry.name === "calendar")).toMatchObject({ enabled: false });
  });

  it("rejects malformed pack ids and unknown contributions", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    // The service never resolves a traversing id to a path; it reports it as unknown.
    await expect(f.call("capability_packs_set_enabled", { id: "../escape", enabled: false })).rejects.toThrow(/capability_pack_not_found/);
    await expect(f.call("capability_packs_set_contribution", { id: "missing", kind: "skill", name: "x", enabled: true })).rejects.toThrow(/capability_pack_not_found/);
    await expect(f.call("capability_packs_remove", { id: "missing" })).rejects.toThrow(/capability_pack_not_found/);
  });
});
