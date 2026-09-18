/**
 * `--wb-*` 令牌审计的守卫(R95)。
 *
 * 这套审计存在的理由是**一类肉眼看不见的坏**:
 * `color: var(--wb-text-secondary)` 里变量为空时,CSS 规范要求浏览器**丢弃
 * 整条声明**。没有报错、没有警告、没有红色波浪线 —— 元素只是安静地回退到
 * 继承色。在深色主题上,结果就是"这段字看不见"。
 *
 * 实测(R95 修复前)有 6 个这样的令牌、34 处声明会被丢弃,其中
 * `--wb-text-secondary` 一项就占 19 处(设置面板、侧栏、邮件面板的次要文字)。
 *
 * 本测试把「零个坏令牌」钉死,并把技术债(死令牌 / 双定义)记成快照,
 * 只允许往下走。
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const report = JSON.parse(
  execFileSync("node", [join(repoRoot, "scripts", "ui-token-audit.mjs"), "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }),
);

/** R95 修复后的实测值。坏令牌必须一直是 0;其余只许下降。 */
const BASELINE = {
  broken: 0,
  dead: 154,
  multiplyDefined: 34,
};

describe("`--wb-*` 令牌审计", () => {
  it("没有「用了但未定义且无 fallback」的令牌", () => {
    const detail = report.broken
      .map((entry) => `  ${entry.token}  (${entry.sites.length} 处)\n${entry.sites.map((s) => `      ${s.file}:${s.line}  ${s.raw}`).join("\n")}`)
      .join("\n");
    expect(
      report.broken.map((entry) => entry.token),
      `这些令牌被 var() 引用但从未定义,声明会被浏览器丢弃:\n${detail}`,
    ).toEqual([]);
  });

  it("坏令牌数不超过基线(必须一直是 0)", () => {
    expect(report.broken.length).toBeLessThanOrEqual(BASELINE.broken);
  });

  it("死令牌数不增长(技术债只许下降)", () => {
    expect(report.dead.length).toBeLessThanOrEqual(BASELINE.dead);
  });

  it("双定义令牌数不增长", () => {
    expect(report.multiplyDefined.length).toBeLessThanOrEqual(BASELINE.multiplyDefined);
  });

  it("关键文本令牌都被定义且被使用", () => {
    // 这几个是"字看不见"事故的直接来源 —— 单独点名,防止有人顺手删掉别名。
    const critical = ["--wb-text-primary", "--wb-text-secondary", "--wb-text-disabled", "--wb-text-low"];
    for (const token of critical) {
      expect(report.evidence.broken[token], `${token} 又变成坏令牌了`).toBeUndefined();
      expect(report.evidence.dead.map((e) => e.token), `${token} 变成了死令牌`).not.toContain(token);
    }
  });
});
