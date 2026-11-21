// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromptsService } from "../src/prompts/prompts";
import { SkillCatalogService, deriveCategory, extractFrontmatter, parseScalar } from "../src/skills/catalog";
import type { Settings } from "../src/settings/settings";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp(prefix: string) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  dirs.push(dir);
  return dir;
}
function setup(trusted = false) {
  const root = temp("openbuddy-prompts-");
  const pi = join(root, "pi");
  mkdirSync(pi);
  const cwd = join(root, "workspace");
  mkdirSync(join(cwd, ".pi", "prompts"), { recursive: true });
  const settings = { dir: pi } as Settings;
  return { root, pi, cwd, prompts: new PromptsService(settings, () => trusted), catalog: new SkillCatalogService(settings) };
}

describe("我的指令 prompts service (pii W2.7 / S8)", () => {
  it("saves a Pi-compatible template and lists it with parsed frontmatter", async () => {
    const { prompts, pi } = setup(true);
    await prompts.save("global", { name: "weekly-report", description: "写周报", argumentHint: "<本周要点>", content: "请根据 $1 整理周报。" });
    const raw = await import("node:fs").then((m) => m.readFileSync(join(pi, "prompts", "weekly-report.md"), "utf8"));
    expect(raw).toContain('argument-hint');
    const list = await prompts.list();
    expect(list.map((p) => `${p.scope}/${p.name}`)).toEqual(["global/weekly-report"]);
    expect(list[0]).toMatchObject({ description: "写周报", argumentHint: "<本周要点>", content: "请根据 $1 整理周报。" });
    expect(await prompts.get("global", "weekly-report")).toContain("argument-hint");
  });

  it("keeps workspace templates behind the trust gate and validates names", async () => {
    const untrusted = setup(false);
    await expect(untrusted.prompts.save("workspace", { name: "x", content: "x" }, untrusted.cwd)).rejects.toThrow("prompts_trust_required");
    const trusted = setup(true);
    await trusted.prompts.save("workspace", { name: "project-brief", content: "项目简报模板" }, trusted.cwd);
    expect((await trusted.prompts.list(trusted.cwd)).map((p) => p.name)).toEqual(["project-brief"]);
    const global = setup(true);
    await expect(global.prompts.save("global", { name: "Bad Name", content: "x" })).rejects.toThrow("prompts_invalid_name");
    await expect(global.prompts.save("global", { name: "empty", content: "  " })).rejects.toThrow("prompts_empty");
    await global.prompts.save("global", { name: "gone", content: "x" });
    await global.prompts.delete("global", "gone");
    expect(await global.prompts.list()).toEqual([]);
  });
});

describe("技能目录 catalog service (pii W2.7)", () => {
  it("scans connector and builtin skills, dedupes with builtins featured, derives categories", async () => {
    const { catalog, root } = setup();
    const market = join(root, "market");
    mkdirSync(join(market, ".codebuddy-connector"), { recursive: true });
    writeFileSync(join(market, ".codebuddy-connector", "connectors.json"), "{}");
    mkdirSync(join(market, "connectors", "tonghuashun", "skills"), { recursive: true });
    mkdirSync(join(market, "icons"), { recursive: true });
    writeFileSync(join(market, "icons", "tonghuashun.svg"), "<svg/>");
    writeFileSync(
      join(market, "connectors", "tonghuashun", "skills", "SKILL.md"),
      ['---', 'name: 股票行情', 'description: 查询 A 股行情与资金流', '---', '', '用法说明'].join("\n"),
    );
    const builtin = join(root, "builtin-skills", "weekly-report");
    mkdirSync(builtin, { recursive: true });
    writeFileSync(join(builtin, "SKILL.md"), ['---', 'name: 周报助手', 'description: 汇总本周工作写周报', '---', '', '步骤'].join("\n"));
    const result = await catalog.load(market, join(root, "builtin-skills"));
    expect(result.root).toBe(market);
    expect(result.categories.length).toBe(9);
    // Featured (builtin) skills sort first, then alphabetical.
    expect(result.skills.map((s) => [s.name, s.cat, s.featured ?? false])).toEqual([
      ["周报助手", "other", true],
      ["股票行情", "invest", false],
    ]);
    expect(result.skills[1].iconLocal).toContain("icons/tonghuashun.svg"); // connector icon resolved
    // The dedupe rule: a builtin with the same id wins and is featured.
    expect(result.skills.find((s) => s.name === "周报助手")?.origin).toBe("builtin");
    expect(await catalog.readSkill(join(market, "connectors", "tonghuashun", "skills"))).toContain("资金流");
  });

  it("falls back to body salvage when a SKILL.md has no frontmatter", async () => {
    const { catalog, root } = setup();
    const builtin = join(root, "b", "plain");
    mkdirSync(builtin, { recursive: true });
    writeFileSync(join(builtin, "SKILL.md"), "# Skill: 数据透视\n\n把 CSV 变成报表。");
    const result = await catalog.load("", join(root, "b"));
    expect(result.skills[0]).toMatchObject({ id: "plain", name: "数据透视", desc: "把 CSV 变成报表。", cat: "data" });
  });

  it("parses scalars like the Rust port", () => {
    expect(parseScalar('name: 周报助手\ndesc: x', "name")).toBe("周报助手");
    expect(parseScalar('name: "quoted value"', "name")).toBe("quoted value");
    expect(parseScalar("description: >-\n  第一行\n  第二行", "description")).toBe("第一行 第二行");
    expect(extractFrontmatter("---\na: 1\n---\nbody")).toBe("a: 1\n");
    expect(deriveCategory("Excel 表格", "处理表格")).toBe("office");
  });
});
