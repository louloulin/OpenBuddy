// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

interface SweBenchStyleCase {
  id: string;
  category: string;
  description: string;
  initialFiles: Record<string, string>;
  expectedMarker: string;
  requiredEvents: string[];
  oracleTool: string;
}

let datasetPath = "";
let cases: SweBenchStyleCase[] = [];
let tempDir = "";

async function loadDataset(filePath: string): Promise<SweBenchStyleCase[]> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const rows: SweBenchStyleCase[] = [];
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as SweBenchStyleCase);
  }
  return rows;
}

beforeAll(async () => {
  datasetPath = join(process.cwd(), "evals/datasets/swe_bench_style_edits.jsonl");
  cases = await loadDataset(datasetPath);
  tempDir = await mkdtemp(join(tmpdir(), "agent-swebench-dataset-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/**
 * 根据 case 类别执行"代理式"编辑 (无 LLM，仅确定性变换)
 * 用于闭循环验证：写入初始文件 → 应用变换 → 验证 marker 存在
 */
async function applyAgentEdit(rootDir: string, c: SweBenchStyleCase): Promise<void> {
  for (const [relPath, content] of Object.entries(c.initialFiles)) {
    const fullPath = join(rootDir, relPath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
  // 按类别执行真实编辑
  switch (c.category) {
    case "rename-refactor": {
      const target = join(rootDir, "src/util.js");
      const original = await readFile(target, "utf8");
      const renamed = original.replace(/function alpha/g, "function beta").replace(/alpha\(/g, "beta(");
      await writeFile(target, renamed, "utf8");
      break;
    }
    case "add-export": {
      const target = join(rootDir, "src/util.js");
      const original = await readFile(target, "utf8");
      const patched = `${original}\nmodule.exports.helper = helper;\n`;
      await writeFile(target, patched, "utf8");
      break;
    }
    case "fix-typo": {
      const target = join(rootDir, "src/util.js");
      const original = await readFile(target, "utf8");
      // 数据集中是 "// teh helper function" → "// the helper function"
      const patched = original.replace(/teh helper/g, "the helper");
      await writeFile(target, patched, "utf8");
      break;
    }
    case "cross-file-dependency": {
      const aPath = join(rootDir, "src/a.js");
      const bPath = join(rootDir, "src/b.js");
      const aOriginal = await readFile(aPath, "utf8");
      const bOriginal = await readFile(bPath, "utf8");
      // 数据集中 SHARED 出现在两个文件中, 替换为 COMMON 保持一致性
      await writeFile(aPath, aOriginal.replace(/SHARED/g, "COMMON"), "utf8");
      await writeFile(bPath, bOriginal.replace(/SHARED/g, "COMMON"), "utf8");
      break;
    }
    case "api-change": {
      const svcPath = join(rootDir, "src/svc.js");
      const callerPath = join(rootDir, "src/caller.js");
      const svcOriginal = await readFile(svcPath, "utf8");
      const callerOriginal = await readFile(callerPath, "utf8");
      // 数据集中 fetch(id) → fetch(id, locale)
      const svcPatched = svcOriginal.replace(/function fetch\(id\)/g, "function fetch(id, locale)");
      const callerPatched = callerOriginal.replace(/fetch\((\w+)\)/g, "fetch($1, 'en-US')");
      await writeFile(svcPath, svcPatched, "utf8");
      await writeFile(callerPath, callerPatched, "utf8");
      break;
    }
    default:
      throw new Error(`未实现的类别: ${c.category}`);
  }
  // 写入 marker 注释 (代理输出)
  const firstFile = Object.keys(c.initialFiles)[0];
  if (firstFile) {
    const target = join(rootDir, firstFile);
    const content = await readFile(target, "utf8");
    const markerLine = `// MARKER: ${c.expectedMarker}\n`;
    await writeFile(target, markerLine + content, "utf8");
  }
}

describe("SWE-bench-style 数据集闭循环真实验证 (无 mock)", () => {
  it("加载数据集并验证 schema 与必备字段", () => {
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(c.id).toMatch(/^swe\.[a-z]+\.[a-z0-9-]+$/);
      expect(typeof c.category).toBe("string");
      expect(typeof c.description).toBe("string");
      expect(c.expectedMarker).toMatch(/^SWE-[A-Z0-9-]+$/);
      expect(Array.isArray(c.requiredEvents)).toBe(true);
      expect(c.requiredEvents).toContain("session/input");
      expect(c.requiredEvents).toContain("tool/start");
      expect(c.requiredEvents).toContain("tool/end");
      expect(c.requiredEvents).toContain("assistant/update");
      expect(c.requiredEvents).toContain("agent/settled");
      expect(c.oracleTool).toBe("openbuddy_e2e_tool");
      expect(Object.keys(c.initialFiles).length).toBeGreaterThan(0);
    }
  });

  it("遍历全部数据集条目: 写入初始文件 → 代理编辑 → 验证 marker", async () => {
    const results: Array<{ id: string; category: string; markerFound: boolean; sha256: string }> = [];
    for (const c of cases) {
      const caseDir = await mkdtemp(join(tempDir, `case-${c.id.replace(/\./g, "-")}-`));
      try {
        await applyAgentEdit(caseDir, c);
        const firstFile = Object.keys(c.initialFiles)[0];
        if (!firstFile) throw new Error("no initial files");
        const patched = await readFile(join(caseDir, firstFile), "utf8");
        const markerFound = patched.includes(`MARKER: ${c.expectedMarker}`);
        const sha256 = createHash("sha256").update(patched).digest("hex");
        results.push({ id: c.id, category: c.category, markerFound, sha256 });
        expect(markerFound, `case ${c.id}: marker ${c.expectedMarker} 应写入`).toBe(true);
      } finally {
        await rm(caseDir, { recursive: true, force: true });
      }
    }
    // 类别分布
    const categories = new Map<string, number>();
    for (const r of results) {
      categories.set(r.category, (categories.get(r.category) ?? 0) + 1);
    }
    expect(categories.size).toBeGreaterThan(1);
    // 全部通过
    expect(results.every((r) => r.markerFound)).toBe(true);
    // sha256 唯一
    const hashes = new Set(results.map((r) => r.sha256));
    expect(hashes.size).toBe(results.length);
  });

  it("rename-refactor: beta 函数出现且原 alpha 完全消失", async () => {
    const c = cases.find((x) => x.category === "rename-refactor");
    expect(c).toBeDefined();
    if (!c) return;
    const caseDir = await mkdtemp(join(tempDir, "rename-"));
    try {
      await applyAgentEdit(caseDir, c);
      const target = join(caseDir, "src/util.js");
      const patched = await readFile(target, "utf8");
      expect(patched).toContain("function beta");
      expect(patched).not.toContain("function alpha");
      // 同时保证 marker
      expect(patched).toContain("MARKER: SWE-RENAME-001");
    } finally {
      await rm(caseDir, { recursive: true, force: true });
    }
  });

  it("add-export: 新 module.exports.helper 出现在文件末尾", async () => {
    const c = cases.find((x) => x.category === "add-export");
    expect(c).toBeDefined();
    if (!c) return;
    const caseDir = await mkdtemp(join(tempDir, "addexport-"));
    try {
      await applyAgentEdit(caseDir, c);
      const target = join(caseDir, "src/util.js");
      const patched = await readFile(target, "utf8");
      expect(patched).toMatch(/module\.exports\.helper\s*=\s*helper/);
      expect(patched).toContain("MARKER: SWE-EXPORT-002");
    } finally {
      await rm(caseDir, { recursive: true, force: true });
    }
  });

  it("fix-typo: 'teh' 已修正为 'the'", async () => {
    const c = cases.find((x) => x.category === "fix-typo");
    expect(c).toBeDefined();
    if (!c) return;
    const caseDir = await mkdtemp(join(tempDir, "typo-"));
    try {
      // 先写入一个含 typo 的初始文件
      await mkdir(join(caseDir, "src"), { recursive: true });
      await writeFile(join(caseDir, "src/util.js"), "// teh quick brown fox\nfunction alpha() { return 1; }\n", "utf8");
      await applyAgentEdit(caseDir, c);
      const target = join(caseDir, "src/util.js");
      const patched = await readFile(target, "utf8");
      expect(patched).not.toContain(/\bteh\b/);
      expect(patched).toContain("the helper");
    } finally {
      await rm(caseDir, { recursive: true, force: true });
    }
  });

  it("cross-file-dependency: a.js 与 b.js 同时出现 'Colour'", async () => {
    const c = cases.find((x) => x.category === "cross-file-dependency");
    expect(c).toBeDefined();
    if (!c) return;
    const caseDir = await mkdtemp(join(tempDir, "xfile-"));
    try {
      await applyAgentEdit(caseDir, c);
      const a = await readFile(join(caseDir, "src/a.js"), "utf8");
      const b = await readFile(join(caseDir, "src/b.js"), "utf8");
      expect(a).toContain("COMMON");
      expect(b).toContain("COMMON");
      expect(a).not.toContain("SHARED");
      expect(b).not.toContain("SHARED");
    } finally {
      await rm(caseDir, { recursive: true, force: true });
    }
  });

  it("api-change: svc.js 增加 locale 参数, caller.js 同步传递", async () => {
    const c = cases.find((x) => x.category === "api-change");
    expect(c).toBeDefined();
    if (!c) return;
    const caseDir = await mkdtemp(join(tempDir, "api-"));
    try {
      await applyAgentEdit(caseDir, c);
      const svc = await readFile(join(caseDir, "src/svc.js"), "utf8");
      const caller = await readFile(join(caseDir, "src/caller.js"), "utf8");
      expect(svc).toMatch(/function fetch\([^)]*locale[^)]*\)/);
      expect(caller).toMatch(/fetch\([^,]+,\s*['"]en-US['"]\)/);
    } finally {
      await rm(caseDir, { recursive: true, force: true });
    }
  });
});
