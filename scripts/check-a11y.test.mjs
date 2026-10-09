/**
 * Tests for scripts/check-a11y.mjs.
 *
 * 这个门禁本身必须被锁住,否则它会退化成永远为真的装饰 —— 而且这正是仓库
 * 已经栽过的跟头:eslint 规则配了、插件装了、文件里还写着一堆
 * `eslint-disable jsx-a11y/*`,但规则集里只开了一条,于是"有 lint 配置"
 * 这件事从头到尾没有产生任何约束。
 *
 * 所以这里的关键用例是**红灯用例**:造一个真的有假按钮的 fixture,
 * 断言门禁确实失败,并点名那条规则 —— 只有这样才能证明门禁会咬人。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const SOURCE_SCRIPT = join(REPO_ROOT, "scripts", "check-a11y.mjs");

/**
 * 在临时目录里装一份脚本 + 最小 eslint 配置。
 * eslint 从当前工作目录向上找 flat config,fixture 目录里必须自带一份,
 * 否则它会捡到真实仓库的配置,测试就跟真实代码耦合了。
 */
function install(scratch, { source }) {
  mkdirSync(join(scratch, "scripts"), { recursive: true });
  copyFileSync(SOURCE_SCRIPT, join(scratch, "scripts", "check-a11y.mjs"));
  mkdirSync(join(scratch, "packages", "probe"), { recursive: true });
  // 门禁默认扫 src 和 packages 两个根。src 建出来并放一个干净文件 —— eslint
  // 对"目录存在但没有匹配文件"同样会退出码 2,那样测的就不是门禁而是 eslint 了。
  mkdirSync(join(scratch, "src"), { recursive: true });
  writeFileSync(
    join(scratch, "src", "app.tsx"),
    'export const App = () => <button type="button">确定</button>;\n',
  );

  // fixture 的 eslint.config.mjs 要 import 插件,而 ESM 是按**文件位置**向上
  // 找 node_modules 的。临时目录在 /var 下,向上找不到仓库,所以显式链一份。
  // 链真实仓库而不是仿造一份:门禁的可复现性正建立在"用钉住的版本"上。
  // install() 会被红灯用例重复调用(改 fixture 内容),所以幂等。
  const link = join(scratch, "node_modules");
  if (!existsSync(link)) symlinkSync(join(REPO_ROOT, "node_modules"), link, "dir");

  writeFileSync(
    join(scratch, "eslint.config.mjs"),
    `import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default [
  {
    files: ["**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: { "@typescript-eslint": tseslint, "jsx-a11y": jsxA11y },
    settings: { react: { version: "18.3" } },
    rules: { ...jsxA11y.flatConfigs.recommended.rules },
  },
];
`,
  );

  writeFileSync(join(scratch, "packages", "probe", "Widget.tsx"), source);
}

/** 在 fixture 目录里跑门禁脚本。eslint 二进制从真实仓库借,配置用 fixture 的。 */
function run(scratch) {
  const result = spawnSync("node", [join(scratch, "scripts", "check-a11y.mjs")], {
    cwd: scratch,
    encoding: "utf8",
    env: {
      ...process.env,
      // fixture 在临时目录里,没有自己的 node_modules;指向仓库装好的那份,
      // 保证测的是**这个版本**的 eslint —— 门禁的可复现性正建立在这上面。
      OPENBUDDY_A11Y_ESLINT: join(REPO_ROOT, "node_modules", ".bin", "eslint"),
    },
  });
  return { code: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

const CLEAN = `export const Widget = () => (
  <button type="button" onClick={() => undefined}>确定</button>
);
`;

/** 仓库里最常见的真实缺陷:span 冒充按钮,键盘永远到不了。 */
const FAKE_BUTTON = `export const Widget = () => (
  <span role="button" onClick={() => undefined}>确定</span>
);
`;

describe("check-a11y gate", () => {
  let scratch;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "ob-a11y-"));
    install(scratch, { source: CLEAN });
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("passes when there are no jsx-a11y findings", () => {
    const { code, output } = run(scratch);
    expect(code).toBe(0);
    expect(output).toContain("零告警");
  });

  // 这是整个门禁存在的理由。改错方向(比如脚本只统计不退出非零)时,
  // 下面这条会立刻红。
  it("fails on a keyboard-unreachable fake button and names the rule", () => {
    install(scratch, { source: FAKE_BUTTON });
    const { code, output } = run(scratch);
    expect(code).toBe(1);
    expect(output).toContain("jsx-a11y/click-events-have-key-events");
    expect(output).toContain("packages/probe/Widget.tsx:2");
  });

  it("warns against silencing with an eslint-disable comment", () => {
    install(scratch, { source: FAKE_BUTTON });
    const { output } = run(scratch);
    expect(output).toContain("不要加 eslint-disable-next-line jsx-a11y");
  });

  it("ignores non-a11y lint output", () => {
    // 一个纯格式问题不该让无障碍门禁失败:门禁只对 jsx-a11y/* 负责,
    // 其余规则归 eslint 自己的 CI job(而且那个 job 是 report-only)。
    writeFileSync(
      join(scratch, "eslint.config.mjs"),
      `import tsParser from "@typescript-eslint/parser";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default [
  {
    files: ["**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: { "jsx-a11y": jsxA11y },
    settings: { react: { version: "18.3" } },
    rules: { ...jsxA11y.flatConfigs.recommended.rules, "no-debugger": "error" },
  },
];
`,
    );
    writeFileSync(
      join(scratch, "packages", "probe", "Widget.tsx"),
      `export const Widget = () => {
  debugger;
  return <button type="button">确定</button>;
};
`,
    );
    const { code, output } = run(scratch);
    expect(code).toBe(0);
    expect(output).not.toContain("no-debugger");
  });
});