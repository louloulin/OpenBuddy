/**
 * Tests for scripts/check-i18n.mjs.
 *
 * 每个检查项都要有一个"改了会红"的用例 —— 门禁本身如果不被测试锁住,
 * 就会退化成永远为真的装饰。真实仓库当前是干净的(基线已生成),所以这里全部
 * 在合成 fixture 上验证:把脚本复制进临时目录,让它的 repoRoot 指向 fixture。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const SOURCE_SCRIPT = join(REPO_ROOT, "scripts", "check-i18n.mjs");

const LOCALES = ["zh-CN", "en-US"];

/** 造一个最小可用仓库:两套词表 + 基线,默认是"全绿"状态。 */
function scaffold(scratch, { product, kernel }) {
  mkdirSync(join(scratch, "scripts"), { recursive: true });
  copyFileSync(SOURCE_SCRIPT, join(scratch, "scripts", "check-i18n.mjs"));
  for (const [locale, dict] of Object.entries(product)) {
    mkdirSync(join(scratch, "src", "locales"), { recursive: true });
    writeFileSync(join(scratch, "src", "locales", `${locale}.json`), JSON.stringify(dict));
  }
  for (const [locale, dict] of Object.entries(kernel)) {
    const dir = join(scratch, "packages/ui/openbuddy-ui-locale/src/dictionaries");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${locale}.json`), JSON.stringify(dict));
  }
}

function run(scratch, args = []) {
  const result = spawnSync("node", [join(scratch, "scripts", "check-i18n.mjs"), ...args], {
    cwd: scratch,
    encoding: "utf8",
  });
  return {
    code: result.status ?? -1,
    output: `${result.stdout}${result.stderr}`,
  };
}

const CLEAN = {
  product: {
    "zh-CN": { common: { save: "保存", renamed: "已重命名 {count} 项" } },
    "en-US": { common: { save: "Save", renamed: "Renamed {count} items" } },
  },
  kernel: {
    "zh-CN": { common: { cancel: "取消" } },
    "en-US": { common: { cancel: "Cancel" } },
  },
};

describe("check-i18n gate", () => {
  let scratch;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "ob-i18n-"));
    scaffold(scratch, CLEAN);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("passes on a consistent dictionary set", () => {
    const { code, output } = run(scratch, ["--update-baseline"]);
    expect(output).toContain("基线已更新");
    expect(run(scratch).code).toBe(0);
  });

  it("[1] rejects a key missing from one locale", () => {
    const product = structuredClone(CLEAN.product);
    delete product["en-US"].common.save;
    scaffold(scratch, { ...CLEAN, product });
    const { code, output } = run(scratch);
    expect(code).toBe(1);
    expect(output).toContain("en-US 缺少 key \"common.save\"");
  });

  it("[2] rejects mismatched interpolation placeholders", () => {
    const product = structuredClone(CLEAN.product);
    product["en-US"].common.renamed = "Renamed {total} items";
    scaffold(scratch, { ...CLEAN, product });
    const { code, output } = run(scratch);
    expect(code).toBe(1);
    expect(output).toContain("占位符不一致");
  });

  it("[3] rejects a key duplicated across both dictionaries with a different value", () => {
    const product = structuredClone(CLEAN.product);
    product["zh-CN"].common.cancel = "储存";
    scaffold(scratch, { product, kernel: CLEAN.kernel });
    const { code, output } = run(scratch);
    expect(code).toBe(1);
    expect(output).toContain("两套词表取值不一致");
  });

  it("[4] rejects an untranslated value left in a non-Chinese locale", () => {
    const product = structuredClone(CLEAN.product);
    product["en-US"].common.save = "保存";
    scaffold(scratch, { ...CLEAN, product });
    const { code, output } = run(scratch);
    expect(code).toBe(1);
    expect(output).toContain("[untranslated]");
  });

  it("[5] rejects a t() reference with no matching dictionary key", () => {
    mkdirSync(join(scratch, "src", "components"), { recursive: true });
    writeFileSync(
      join(scratch, "src", "components", "Panel.tsx"),
      'export const Panel = () => <div>{useT("nope.missing.key")}</div>;\n',
    );
    const { code, output } = run(scratch);
    expect(code).toBe(1);
    expect(output).toContain("[missing-key]");
    expect(output).toContain("nope.missing.key");
  });

  it("[6] ratchets: a new hardcoded CJK string fails, and lowering the count is a warning", () => {
    expect(run(scratch, ["--update-baseline"]).code).toBe(0);
    expect(run(scratch).code).toBe(0);

    const panel = join(scratch, "src", "components", "Panel.tsx");
    mkdirSync(join(scratch, "src", "components"), { recursive: true });

    // Baseline at zero, then introduce one hardcoded string. That is growth:
    // the gate fails, and it must NOT quietly raise the baseline to match.
    writeFileSync(panel, 'export const Panel = () => <button title="停止">x</button>;\n');
    const grown = run(scratch);
    expect(grown.code).toBe(1);
    expect(grown.output).toContain("[hardcoded-cjk]");
    expect(run(scratch, ["--update-baseline"]).output).toContain("基线已更新:1 处");

    // Shrinking below the recorded baseline is never an error — only a nudge
    // to re-baseline, so the ratchet can be tightened as debt is paid.
    writeFileSync(panel, "export const Panel = () => <button>x</button>;\n");
    const shrunk = run(scratch);
    expect(shrunk.code).toBe(0);
    expect(shrunk.output).toContain("--update-baseline");
  });

  it("fails when the baseline file is missing", () => {
    const { code, output } = run(scratch);
    expect(code).toBe(1);
    expect(output).toContain("基线文件缺失");
  });

  it("scans every locale pair it is given, not just the ones on disk", () => {
    const { output } = run(scratch, ["--update-baseline"]);
    for (const locale of LOCALES) expect(output).toContain("2 个 locale");
  });
});
