// @vitest-environment node
// B1c: marketplace skills copy into <pi>/skills, export as a re-importable ZIP, and roll back.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Settings } from "../src/settings/settings";
import { SkillsService } from "../src/skills/skills";
import { writeZip } from "../src/skills/zip";
import { readWorkBuddyZip } from "../src/agents/workbuddy";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-skill-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const service = (pi: string, config = { skillPaths: [] as string[], disabledSkills: [] as string[] }) =>
  new SkillsService({ dir: pi, config: { read: () => ({ ...config }), write: (value: typeof config) => Object.assign(config, value) } } as unknown as Settings);

const marketSkill = (root: string, name = "market-skill", version = "1.2.3") => {
  const dir = join(root, "connectors", "test", "skills", name);
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: 市场技能\nversion: ${version}\n---\n\n按步骤执行。\n`);
  writeFileSync(join(dir, "references", "guide.md"), "参考\n");
  return dir;
};

describe("技能 ZIP (B1c)", () => {
  it("round-trips through the WorkBuddy unzip reader", () => {
    const bytes = writeZip([
      { name: "SKILL.md", bytes: new TextEncoder().encode("---\nname: demo\n---\n正文\n") },
      { name: "references/a.md", bytes: new TextEncoder().encode("嵌套文件") },
    ]);
    const files = readWorkBuddyZip(Buffer.from(bytes));
    expect(new TextDecoder().decode(files.get("SKILL.md"))).toContain("name: demo");
    expect(new TextDecoder().decode(files.get("references/a.md"))).toBe("嵌套文件");
  });
});

describe("技能市场安装 / 导出 / 回退 (B1c)", () => {
  it("copies into <pi>/skills, reports the version, and is idempotent", async () => {
    const pi = tempDir();
    const market = tempDir();
    const dir = marketSkill(market);
    const skills = service(pi);

    const result = await skills.installFromCatalog([dir], pi);
    expect(result.failed).toEqual([]);
    expect(result.installed[0]).toMatchObject({ name: "market-skill", version: "1.2.3", already: false });
    const target = join(pi, "skills", "market-skill");
    expect(result.installed[0]!.path).toBe(realpathSync(target));
    expect(existsSync(join(target, "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, "references", "guide.md"))).toBe(true);
    expect(existsSync(join(target, ".openbuddy.json"))).toBe(true);
    expect(skills.list(pi).find((skill) => skill.name === "market-skill")).toMatchObject({ version: "1.2.3", enabled: true });

    const again = await skills.installFromCatalog([dir], pi);
    expect(again.installed[0]).toMatchObject({ name: "market-skill", already: true });
    // The market root can disappear and the installed copy still works.
    rmSync(market, { recursive: true, force: true });
    expect(existsSync(join(target, "SKILL.md"))).toBe(true);
    expect(skills.list(pi).some((skill) => skill.name === "market-skill")).toBe(true);
  });

  it("exports a portable ZIP and removes the copied files on 移除", async () => {
    const pi = tempDir();
    const market = tempDir();
    const dir = marketSkill(market);
    const skills = service(pi);
    const installed = (await skills.installFromCatalog([dir], pi)).installed[0]!;
    const target = join(tempDir(), "export.zip");

    const exported = await skills.exportZip(installed.path!, target, pi);
    expect(exported.path).toBe(target);
    expect(exported.files).toContain("SKILL.md");
    expect(exported.files).not.toContain(".openbuddy.json");
    const files = readWorkBuddyZip(readFileSync(target));
    expect(new TextDecoder().decode(files.get("SKILL.md"))).toContain("version: 1.2.3");

    await skills.remove(installed.path!);
    expect(existsSync(installed.path!)).toBe(false);
    expect(skills.list(pi).some((skill) => skill.name === "market-skill")).toBe(false);
  });

  it("refuses to export a directory Pi does not discover", async () => {
    const pi = tempDir();
    const outside = marketSkill(tempDir());
    const skills = service(pi);
    await expect(skills.exportZip(outside, join(tempDir(), "x.zip"), pi)).rejects.toThrow(/只能导出已安装的技能/);
  });
});
