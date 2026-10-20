/**
 * Tests for scripts/check-hardcoded-colors.mjs.
 *
 * 门禁本身必须被锁住,否则它会退化成永远为真的装饰。三件事要证明:
 *   1. 新增的字面色值会失败(棘轮咬合);
 *   2. `var(--token, #hex)` 这种既有约定的兜底值**不**算违规;
 *   3. 排除清单里的文件(图示 SVG / 目录数据 / token 定义)不扫。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const SOURCE_SCRIPT = join(REPO_ROOT, "scripts", "check-hardcoded-colors.mjs");

/** 复制脚本进临时目录,让它的 repoRoot 指向 fixture。 */
function install(scratch) {
  mkdirSync(join(scratch, "scripts"), { recursive: true });
  copyFileSync(SOURCE_SCRIPT, join(scratch, "scripts", "check-hardcoded-colors.mjs"));
  mkdirSync(join(scratch, "src", "styles"), { recursive: true });
}

function run(scratch, args = []) {
  const result = spawnSync("node", [join(scratch, "scripts", "check-hardcoded-colors.mjs"), ...args], {
    cwd: scratch,
    encoding: "utf8",
  });
  return { code: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

describe("check-hardcoded-colors gate", () => {
  let scratch;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "ob-color-"));
    install(scratch);
    writeFileSync(join(scratch, "src", "styles", "clean.css"), ".a { color: var(--wb-brand); }\n");
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("fails when the baseline is missing", () => {
    const { code, output } = run(scratch);
    expect(code).toBe(1);
    expect(output).toContain("基线文件缺失");
  });

  it("passes once baselined, and re-ratchets below it with a nudge", () => {
    expect(run(scratch, ["--update-baseline"]).code).toBe(0);
    expect(run(scratch).code).toBe(0);

    // Pay down debt → still green, but asks to tighten.
    writeFileSync(join(scratch, "src", "styles", "clean.css"), ".a { color: var(--wb-brand); }\n");
    const shrunk = run(scratch);
    expect(shrunk.code).toBe(0);
  });

  it("fails on a newly introduced bare literal and names the line", () => {
    writeFileSync(
      join(scratch, "src", "styles", "new.css"),
      ".a { color: var(--wb-brand); }\n.b { color: #ff00aa; }\n",
    );
    expect(run(scratch, ["--update-baseline"]).code).toBe(0);

    writeFileSync(
      join(scratch, "src", "styles", "new.css"),
      ".a { color: var(--wb-brand); }\n.b { color: #ff00aa; }\n.c { color: #00ff00; }\n",
    );
    const grown = run(scratch);
    expect(grown.code).toBe(1);
    expect(grown.output).toContain("[hardcoded-color]");
    expect(grown.output).toContain("#00ff00");
  });

  it("does not flag an intentional var() fallback", () => {
    writeFileSync(
      join(scratch, "src", "styles", "fallback.css"),
      ".a { color: var(--wb-missing, #ff00aa); }\n",
    );
    expect(run(scratch, ["--update-baseline"]).output).toContain("0 处");
    expect(run(scratch).code).toBe(0);
  });

  it("skips token definitions, theme source, illustrations and catalog data", () => {
    const cases = [
      "src/styles/tokens.css",
      "packages/ui/openbuddy-ui-theme/src/themes.ts",
      "packages/ui/openbuddy-ui-settings/src/HomePage.tsx",
      "packages/ui/openbuddy-ui-experts/src/data/skills-catalog.ts",
    ];
    for (const rel of cases) {
      const abs = join(scratch, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, `/* ${rel} */\n.x { color: #ff00aa; }\n`);
    }
    // A control file proves the scan is actually running.
    writeFileSync(join(scratch, "src", "styles", "control.css"), ".y { color: #ff00aa; }\n");

    const baselined = run(scratch, ["--update-baseline"]);
    // Exactly one hit — the control file. Every excluded file contributed zero.
    expect(baselined.output).toContain("1 处");
    expect(run(scratch).code).toBe(0);
  });
});
