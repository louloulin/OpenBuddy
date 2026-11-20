// @vitest-environment node
// B1c: market skills install into <pi>/skills, export a ZIP, toggle and roll back through IPC.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkBuddyZip } from "@openbuddy/services/agents/workbuddy";
import { sdkFixture } from "./helpers/sdk-fixture.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function marketSkill(root: string): string {
  const dir = join(root, "market", "skills", "market-skill");
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: market-skill\ndescription: 市场技能\nversion: 2.0.0\n---\n\n按步骤执行。\n");
  writeFileSync(join(dir, "references", "guide.md"), "参考\n");
  return dir;
}

describe("技能市场安装 / 导出 (B1c)", () => {
  it("copies, reports the version, exports a ZIP and rolls back", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    const source = marketSkill(f.root);

    const installed = (await f.call("skills_install_from_catalog", { dirs: [source], cwd: f.root })) as any;
    expect(installed.failed).toEqual([]);
    expect(installed.installed[0]).toMatchObject({ name: "market-skill", version: "2.0.0", already: false });
    const path = realpathSync(join(f.root, "pi", "skills", "market-skill"));
    expect(realpathSync(installed.installed[0].path)).toBe(path);
    expect(existsSync(join(path, "references", "guide.md"))).toBe(true);

    const listed = (await f.call("skills_list", { cwd: f.root })) as any[];
    expect(listed.find((skill) => skill.name === "market-skill")).toMatchObject({ version: "2.0.0", enabled: true });

    // Repeat install is idempotent and does not duplicate the skill path.
    const again = (await f.call("skills_install_from_catalog", { dirs: [source], cwd: f.root })) as any;
    expect(again.installed[0]).toMatchObject({ name: "market-skill", already: true });

    const target = join(f.root, "market-skill.zip");
    const exported = (await f.call("skills_export_zip", { path, target, cwd: f.root })) as any;
    expect(exported.files).toContain("SKILL.md");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target).subarray(0, 2).toString()).toBe("PK");
    const files = readWorkBuddyZip(readFileSync(target));
    expect(new TextDecoder().decode(files.get("SKILL.md"))).toContain("version: 2.0.0");

    await f.call("skills_toggle", { name: "market-skill", enabled: false });
    expect(((await f.call("skills_list", { cwd: f.root })) as any[]).find((skill) => skill.name === "market-skill")).toMatchObject({ enabled: false });
    await f.call("skills_toggle", { name: "market-skill", enabled: true });

    await f.call("skills_remove", { path });
    expect(existsSync(path)).toBe(false);
    expect(((await f.call("skills_list", { cwd: f.root })) as any[]).some((skill) => skill.name === "market-skill")).toBe(false);
  });
});
