// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface AdapterSpec {
  id: string;
  script: string;
  artifact: string;
  datasetRows: number;
  expectedFields: string[];
  minRows: number;
  maxRows: number;
}

const ADAPTERS: AdapterSpec[] = [
  { id: "gaia-style", script: "evals/node/run_gaia_local.mjs", artifact: "gaia-local-run.json", datasetRows: 9, expectedFields: ["schema", "datasetRows", "mode", "pass"], minRows: 5, maxRows: 50 },
  { id: "agentbench-toolbench", script: "evals/node/run_agentbench_tools.mjs", artifact: "agentbench-tools-local.json", datasetRows: 8, expectedFields: ["schema", "datasetRows", "mode", "pass"], minRows: 5, maxRows: 50 },
  { id: "agentdojo-safety", script: "evals/node/run_agentdojo_safety.mjs", artifact: "agentdojo-safety-local.json", datasetRows: 8, expectedFields: ["schema", "datasetRows", "mode", "pass"], minRows: 5, maxRows: 50 },
  { id: "mt-bench-style", script: "evals/node/run_mt_bench_style.mjs", artifact: "mt-bench-style.json", datasetRows: 5, expectedFields: ["schema", "datasetRows", "mode", "pass"], minRows: 3, maxRows: 20 },
  { id: "bfcl-style", script: "evals/node/run_bfcl_style.mjs", artifact: "bfcl-style.json", datasetRows: 5, expectedFields: ["schema", "datasetRows", "mode", "pass"], minRows: 3, maxRows: 20 },
  { id: "nl2bash-style", script: "evals/node/run_nl2bash_style.mjs", artifact: "nl2bash-style.json", datasetRows: 5, expectedFields: ["schema", "datasetRows", "mode", "pass"], minRows: 3, maxRows: 20 },
  { id: "swe-bench-style", script: "evals/node/run_swe_bench_style.mjs", artifact: "swe-bench-style.json", datasetRows: 5, expectedFields: ["schema", "datasetRows", "mode", "pass"], minRows: 3, maxRows: 20 },
];

let evidenceDir = "";
const adapterResults: Record<string, SpawnSyncReturns<string>> = {};

beforeAll(() => {
  evidenceDir = join(tmpdir(), `agent-top-tier-evidence-${Date.now()}`);
  mkdirSync(evidenceDir, { recursive: true });
  for (const adapter of ADAPTERS) {
    const result = spawnSync("node", [join(process.cwd(), adapter.script)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENBUDDY_EVIDENCE_DIR: join(evidenceDir, adapter.id),
      },
      encoding: "utf8",
    });
    adapterResults[adapter.id] = result;
  }
}, 60_000);

afterAll(() => {
  if (evidenceDir && existsSync(evidenceDir)) {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

describe("Top-tier benchmark orchestrator 真实执行 (无 mock)", () => {
  it("全部 7 个适配器均成功执行 (exit code 0)", () => {
    for (const adapter of ADAPTERS) {
      const result = adapterResults[adapter.id];
      expect(result, `${adapter.id} 应有执行结果`).toBeDefined();
      expect(result?.status, `${adapter.id} exit code 应为 0`).toBe(0);
    }
  });

  it("每个适配器都写入真实 JSON artifact 文件", () => {
    for (const adapter of ADAPTERS) {
      const artifactPath = join(evidenceDir, adapter.id, adapter.artifact);
      expect(existsSync(artifactPath), `${adapter.id} 应写入 ${artifactPath}`).toBe(true);
      const content = readFileSync(artifactPath, "utf8");
      expect(content.length).toBeGreaterThan(0);
      const parsed = JSON.parse(content) as Record<string, unknown>;
      for (const field of adapter.expectedFields) {
        expect(parsed[field], `${adapter.id} artifact 缺少字段 ${field}`).toBeDefined();
      }
    }
  });

  it("每个适配器的 datasetRows 与预期相符", () => {
    for (const adapter of ADAPTERS) {
      const artifactPath = join(evidenceDir, adapter.id, adapter.artifact);
      const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as { datasetRows?: number };
      expect(typeof parsed.datasetRows, `${adapter.id} datasetRows 应为数字`).toBe("number");
      const rows = parsed.datasetRows ?? 0;
      expect(rows, `${adapter.id} datasetRows 不少于 ${adapter.minRows}`).toBeGreaterThanOrEqual(adapter.minRows);
      expect(rows, `${adapter.id} datasetRows 不超过 ${adapter.maxRows}`).toBeLessThanOrEqual(adapter.maxRows);
    }
  });

  it("每个适配器在本地模式 (无 credentials) 下结构性发现数为 0", () => {
    for (const adapter of ADAPTERS) {
      const artifactPath = join(evidenceDir, adapter.id, adapter.artifact);
      const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as { structuralFindings?: unknown[]; pass?: boolean; mode?: string };
      expect(Array.isArray(parsed.structuralFindings), `${adapter.id} structuralFindings 应为数组`).toBe(true);
      expect(parsed.structuralFindings?.length ?? 0, `${adapter.id} 不应有结构性发现`).toBe(0);
      expect(parsed.pass, `${adapter.id} pass 应为 true`).toBe(true);
      // local 模式 (因为我们没设置 OPENBUDDY_E2E_REQUIRED)
      expect(parsed.mode, `${adapter.id} mode 应为 local-evidence-only 或类似`).toMatch(/local/i);
    }
  });

  it("合计算例数: 7 个适配器共 45 个用例", () => {
    let total = 0;
    for (const adapter of ADAPTERS) {
      const artifactPath = join(evidenceDir, adapter.id, adapter.artifact);
      const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as { datasetRows?: number };
      total += parsed.datasetRows ?? 0;
    }
    // GAIA 9 + AgentBench 8 + AgentDojo 8 + MT-bench 5 + BFCL 5 + NL2Bash 5 + SWE-bench 5 = 45
    expect(total).toBe(45);
  });

  it("每个适配器 stdout 包含结构化 JSON 输出", () => {
    for (const adapter of ADAPTERS) {
      const result = adapterResults[adapter.id];
      const stdout = result?.stdout ?? "";
      // stdout 应至少包含一个 { ... } 块
      expect(stdout.length, `${adapter.id} stdout 不应为空`).toBeGreaterThan(0);
      expect(stdout, `${adapter.id} stdout 应包含 JSON`).toMatch(/[\{\[]/);
    }
  });

  it("datasets/ 目录下全部 7 个 JSONL 数据集都存在且可读", () => {
    const expectedDatasets = [
      "evals/datasets/gaia_style_tasks.jsonl",
      "evals/datasets/agentbench_tool_selection.jsonl",
      "evals/datasets/agentdojo_safety.jsonl",
      "evals/datasets/mt_bench_style_tasks.jsonl",
      "evals/datasets/bfcl_style_function_calls.jsonl",
      "evals/datasets/nl2bash_style_commands.jsonl",
      "evals/datasets/swe_bench_style_edits.jsonl",
    ];
    for (const ds of expectedDatasets) {
      const fullPath = join(process.cwd(), ds);
      expect(existsSync(fullPath), `${ds} 应存在`).toBe(true);
      const content = readFileSync(fullPath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length, `${ds} 至少 1 行`).toBeGreaterThan(0);
      // 验证每行都是有效 JSON
      for (const line of lines) {
        expect(() => JSON.parse(line), `${ds} 行应为有效 JSON: ${line.slice(0, 50)}`).not.toThrow();
      }
    }
  });

  it("汇总 evidence 到单一 artifact 文件 (orchestrator 风格)", () => {
    const summary = {
      schema: "openbuddy.top-tier-test-summary.v1",
      generatedAt: new Date().toISOString(),
      totalAdapters: ADAPTERS.length,
      adapters: ADAPTERS.map((a) => {
        const artifactPath = join(evidenceDir, a.id, a.artifact);
        const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
        return {
          id: a.id,
          script: a.script,
          artifact: a.artifact,
          exitCode: adapterResults[a.id]?.status ?? null,
          datasetRows: parsed.datasetRows ?? 0,
          pass: parsed.pass ?? false,
          mode: parsed.mode ?? null,
        };
      }),
    };
    summary.adapters = summary.adapters as never;
    const summaryPath = join(evidenceDir, "summary.json");
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    expect(existsSync(summaryPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(summaryPath, "utf8")) as { totalAdapters: number; adapters: Array<{ pass: boolean }> };
    expect(parsed.totalAdapters).toBe(7);
    expect(parsed.adapters.every((a) => a.pass)).toBe(true);
  });
});
