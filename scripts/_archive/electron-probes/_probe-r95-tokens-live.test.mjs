/**
 * _probe-r95-tokens-live.test.mjs — 令牌运行时探针的 vitest 包装。
 *
 * 为什么必须跑真机:静态审计(`scripts/ui-token-audit.mjs`)只能看到"定义存在"
 * 与"使用存在"。它无法知道定义与使用是否在**同一棵被加载的样式树**里 ——
 * 历史上 `src/styles/global.css` 定义了 14 个令牌但**从未被入口加载**,
 * 于是 `--wb-brand` 空了一整轮、513 处引用全部静默走 fallback,而静态审计
 * 一片绿。只有渲染进程里的 `getComputedStyle` 能证明声明真的生效。
 *
 * 跑法:`npx vitest run scripts/electron/_probe-r95-tokens-live.test.mjs`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r95-tokens-live.mjs");
const electronBin = join(__dirname, "..", "..", "node_modules", ".bin", "electron");

const canLaunch = existsSync(electronBin);

const runProbe = () => {
  if (runProbe._cache) return runProbe._cache;
  const result = spawnSync("node", [probePath], {
    cwd: join(__dirname, "..", ".."),
    encoding: "utf8",
    timeout: 240_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout (status=${result.status}): ${(result.stdout + result.stderr).slice(-800)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: R95 关键令牌在两套主题下解析", () => {
  it("所有步骤通过(无失败步骤)", () => {
    const probe = runProbe();
    expect(
      (probe.steps ?? []).filter((s) => !s.ok),
      JSON.stringify((probe.steps ?? []).filter((s) => !s.ok), null, 2),
    ).toEqual([]);
    expect(probe.ok).toBe(true);
  });

  it("每个被审计的令牌都在浅色与深色下有定义", () => {
    const probe = runProbe();
    for (const theme of ["light", "dark"]) {
      const read = probe[theme]?.read ?? {};
      for (const value of Object.values(read)) expect(typeof value).toBe("string");
      expect(Object.keys(read).length).toBeGreaterThan(0);
    }
  });

  it("令牌的 var() 真的生效(不是被丢弃后回落)", () => {
    const probe = runProbe();
    // `substituted` 是"把 var(--token) 塞进另一个自定义属性再看解析结果"的
    // 直接证据。`missing`/`sentinel` 都意味着令牌在那个主题下没有值。
    for (const theme of ["light", "dark"]) {
      const resolved = probe[theme]?.resolved ?? {};
      const broken = Object.entries(resolved)
        .filter(([, info]) => info.resolved !== true)
        .map(([token]) => token);
      expect(broken, `${theme} 下未解析: ${JSON.stringify(broken)}`).toEqual([]);
    }
  });

  it("主题真的切换了画布与文字色", () => {
    const probe = runProbe();
    expect(probe.light.read["--wb-bg-primary"]).not.toBe(probe.dark.read["--wb-bg-primary"]);
    expect(probe.light.read["--wb-text-secondary"]).not.toBe(probe.dark.read["--wb-text-secondary"]);
  });

  it("无渲染异常", () => {
    const probe = runProbe();
    expect(probe.pageErrors ?? []).toEqual([]);
  });
});
