// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExpertStore } from "../src/agents/store";
import { workBuddyTeamPrompt } from "../src/agents/workbuddy";

/** A real deflated WorkBuddy export (plugin.json + two agents + one avatar). */
const ZIP_BASE64 = "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";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-wb-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const store = () => {
  const dir = tempDir();
  const expertDir = join(dir, "pi");
  mkdirSync(expertDir, { recursive: true });
  return new ExpertStore({ dir: expertDir, trusted: () => false });
};

describe("WorkBuddy 专家包导入 (S18)", () => {
  it("imports a real WorkBuddy ZIP: names, prompt, examples, tags, category and avatar", () => {
    const dir = tempDir();
    const zip = join(dir, "wbpkg.zip");
    writeFileSync(zip, Buffer.from(ZIP_BASE64, "base64"));
    const result = store().importWorkBuddy(zip);
    expect(result.package).toBe("wbpkg");
    expect(result.skipped).toEqual([]);
    expect(result.imported).toHaveLength(2);
    const lead = result.imported.find((expert) => expert.id.startsWith("quant-analyst"))!;
    expect(lead.name).toBe("舒建谟");
    expect(lead.category).toBe("research");
    expect(lead.prompt).toContain("负责回测与因子分析");
    expect(lead.examples).toContain("帮我回测一个策略");
    expect(lead.tags).toContain("workbuddy");
    expect(lead.image).toBeTruthy();
    expect(result.imported.map((expert) => expert.name)).toContain("魏知安");
  });

  it("imports an extracted package directory", () => {
    const root = tempDir();
    const pkg = join(root, "pkg");
    mkdirSync(join(pkg, ".codebuddy-plugin"), { recursive: true });
    mkdirSync(join(pkg, "agents"), { recursive: true });
    writeFileSync(join(pkg, ".codebuddy-plugin", "plugin.json"), JSON.stringify({
      name: "dirpkg",
      displayName: { zh: "目录团队" },
      displayDescription: { zh: "说明" },
      categoryId: "02-Engineering",
      agents: ["./agents/reviewer.md"],
    }));
    writeFileSync(join(pkg, "agents", "reviewer.md"), "---\nname: reviewer\ndescription: 代码审查\ndisplayName:\n  zh: 审查员\n---\n\n你是审查员。\n");
    const result = store().importWorkBuddy(pkg);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]).toMatchObject({ name: "审查员", category: "dev" });
    expect(result.imported[0]!.prompt).toContain("你是审查员");
  });

  it("reports an unreadable archive instead of throwing raw zip errors", () => {
    const dir = tempDir();
    const zip = join(dir, "bad.zip");
    writeFileSync(zip, "not a zip");
    expect(() => store().importWorkBuddy(zip)).toThrow(/expert_invalid/);
  });

  it("wires a team package: settings.json lead + final ids + prompt body (S21)", () => {
    const root = tempDir();
    const pkg = join(root, "team");
    mkdirSync(join(pkg, ".codebuddy-plugin"), { recursive: true });
    mkdirSync(join(pkg, "agents"), { recursive: true });
    writeFileSync(join(pkg, ".codebuddy-plugin", "plugin.json"), JSON.stringify({
      name: "team-pkg",
      expertType: "team",
      displayName: { zh: "团队包" },
      agents: ["./agents/lead.md", "./agents/member.md"],
      members: [
        { id: "lead", displayName: { zh: "负责人" }, role: "lead" },
        { id: "member", displayName: { zh: "成员" }, role: "member" },
      ],
    }));
    writeFileSync(join(pkg, "settings.json"), JSON.stringify({ agent: "lead" }));
    writeFileSync(join(pkg, "agents", "lead.md"), "---\nname: lead\ndescription: 负责统筹\n---\n\n你是负责人。\n");
    writeFileSync(join(pkg, "agents", "member.md"), "---\nname: member\ndescription: 负责执行\n---\n\n你是成员。\n");
    const result = store().importWorkBuddy(pkg);
    expect(result.team?.name).toBe("团队包");
    expect(result.team?.members).toHaveLength(2);
    expect(result.imported.find((expert) => expert.id === result.team?.leadAgent)?.name).toBe("负责人");
    expect(workBuddyTeamPrompt("团队包", [
      { name: "负责人", role: "lead", description: "负责统筹" },
      { name: "成员", role: "member", description: "负责执行" },
    ])).toContain("- 负责人（负责人）：负责统筹");
  });
});
