/**
 * 发布工具的回归守卫。
 *
 * 覆盖两个脚本的**契约**,而不是它们的实现细节:
 *   - `scripts/bump-version.mjs`  —— 版本号只能有一张「该改哪些文件」的表;
 *   - `scripts/extract-release-notes.mjs` —— Release 正文必须来自 CHANGELOG。
 *
 * 为什么值得放进 CI:这两个脚本是发布路径上的单点。此前 CHANGELOG 抽取写的是
 * `^## v`(H2),而 CHANGELOG 的真实标题是 `### vX.Y.Z`(H3) —— 结果每次发布
 * 正文都退化成自动生成的提交列表,而且**没有任何测试会发现**。下面这些断言
 * 就是为了让这类「静默退化」在 CI 里可见。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const run = (script: string, args: string[], allowFailure = false) => {
  try {
    return { ok: true, stdout: execFileSync("node", [join(repoRoot, script), ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }) };
  } catch (error) {
    if (!allowFailure) throw error;
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { ok: false, status: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
};

const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };

describe("scripts/extract-release-notes.mjs", () => {
  it("抽得到当前版本的 CHANGELOG 段落", () => {
    const { stdout } = run("scripts/extract-release-notes.mjs", [packageJson.version]);
    expect(stdout.trim().length).toBeGreaterThan(100);
    // 版本标题本身不该出现在正文里(调用方自己加标题)。
    expect(stdout).not.toMatch(/^###\s+v?\d+\.\d+\.\d+/m);
  });

  it("段落里不含历史「里程碑」小节", () => {
    const { stdout } = run("scripts/extract-release-notes.mjs", [packageJson.version]);
    expect(stdout).not.toMatch(/Milestone|里程碑/);
  });

  it("`v` 前缀可有可无,结果一致", () => {
    const withPrefix = run("scripts/extract-release-notes.mjs", [`v${packageJson.version}`]).stdout;
    const withoutPrefix = run("scripts/extract-release-notes.mjs", [packageJson.version]).stdout;
    expect(withPrefix).toBe(withoutPrefix);
  });

  it("找不到的版本以退出码 2 失败(调用方据此回退到提交列表)", () => {
    const result = run("scripts/extract-release-notes.mjs", ["v0.0.0-does-not-exist"], true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(2);
  });

  it("--json 输出带 found 字段,便于 CI 判断", () => {
    const { stdout } = run("scripts/extract-release-notes.mjs", [packageJson.version, "--json"]);
    const parsed = JSON.parse(stdout) as { found: boolean; version: string };
    expect(parsed.found).toBe(true);
    expect(parsed.version).toBe(packageJson.version);
  });
});

describe("scripts/bump-version.mjs", () => {
  it("--current 打印 package.json 的版本", () => {
    const { stdout } = run("scripts/bump-version.mjs", ["--current"]);
    expect(stdout.trim()).toBe(packageJson.version);
  });

  it("目标版本与当前版本相同时拒绝执行(退出码 1)", () => {
    const result = run("scripts/bump-version.mjs", [packageJson.version], true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(1);
  });

  it("非法 semver 被拒绝(退出码 1)", () => {
    const result = run("scripts/bump-version.mjs", ["not-a-version"], true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(1);
  });

  it("--dry-run 覆盖所有版本消费点,且不落盘", () => {
    const before = readFileSync(join(repoRoot, "package.json"), "utf8");
    const { stdout } = run("scripts/bump-version.mjs", ["99.0.0-guard", "--dry-run", "--json"]);
    const parsed = JSON.parse(stdout) as {
      dryRun: boolean;
      changeCount: number;
      problems: string[];
      changes: Array<{ path: string; kind: string }>;
    };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.problems).toEqual([]);

    const paths = parsed.changes.map((change) => change.path);
    const kinds = Object.fromEntries(parsed.changes.map((c) => [c.path, c.kind]));

    // 三类必须被覆盖:workspace manifest、示例插件、已经从硬编码改成读源的「守卫」位置。
    expect(paths).toContain("package.json");
    expect(paths).toContain("examples/openbuddy-plugin-hello/manifest.json");
    expect(kinds["electron/main/ipc/index.ts"]).toBe("guard");
    expect(kinds["apps/openbuddy-website/src/app/layout.tsx"]).toBe("guard");
    expect(kinds["apps/openbuddy-website/src/components/DownloadView.tsx"]).toBe("guard");
    expect(kinds["apps/openbuddy-website/src/lib/i18n.ts"]).toBe("guard");
    expect(kinds["packages/capability/openbuddy-mcp-client/src/index.ts"]).toBe("guard");
    expect(kinds["scripts/electron/probe-dmg.mjs"]).toBe("guard");
    expect(kinds["scripts/electron/probe-dmg2.mjs"]).toBe("guard");
    expect(paths.filter((path) => path.endsWith("package.json")).length).toBeGreaterThan(50);

    // fixture 故意不跟着 bump —— 它们是「老版本插件」样本。
    expect(paths.some((path) => path.includes("__fixtures__") || path.includes("tests/fixtures"))).toBe(false);

    // dry-run 真的没写盘。
    expect(readFileSync(join(repoRoot, "package.json"), "utf8")).toBe(before);
  });

  it("--dry-run 在已经漂移的仓库上会报错(守卫拦截硬编码回归)", () => {
    // 把守卫位置之一临时写上一个字面量版本,确认守卫能拦住。
    const guardPath = "electron/main/ipc/index.ts";
    const absolute = join(repoRoot, guardPath);
    const original = readFileSync(absolute, "utf8");
    const tampered = original.replace("hostVersion: app.getVersion()", 'hostVersion: "9.9.9"');
    if (tampered === original) {
      throw new Error("guard test could not locate the hostVersion line to tamper with");
    }
    try {
      // 重置 status 到 0,失败时设 2
      require("node:fs").writeFileSync(absolute, tampered, "utf8");
      const result = run("scripts/bump-version.mjs", ["9.9.10", "--dry-run", "--json"], true);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(2);
      const parsed = JSON.parse(result.stdout) as { problems: string[] };
      expect(parsed.problems.some((p) => p.includes(guardPath) && p.includes("hard-coded"))).toBe(true);
    } finally {
      require("node:fs").writeFileSync(absolute, original, "utf8");
    }
  });
});
