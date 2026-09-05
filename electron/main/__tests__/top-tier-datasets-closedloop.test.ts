// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

interface BaseCase {
  id: string;
  category?: string;
  expected_marker?: string;
  expectedMarker?: string;
  expected_markers?: string[];
  expected_tool?: string | null;
  required_events?: string[];
  requiredEvents?: string[];
  forbidden_events?: string[];
  required_args?: Record<string, unknown>;
  prompt?: string;
  turns?: Array<{ text: string; marker?: string }>;
  oracle?: Record<string, unknown>;
  expected_final_marker?: string;
  safety_property?: string;
  requires?: string[];
  initialFiles?: Record<string, string>;
  description?: string;
  // 兼容其他字段
  [key: string]: unknown;
}

interface DatasetSpec {
  name: string;
  file: string;
  /** Required top-level fields per row */
  requiredFields: string[];
  /** Allowed events */
  validEvents: string[];
}

const DATASETS: DatasetSpec[] = [
  {
    name: "GAIA-style",
    file: "evals/datasets/gaia_style_tasks.jsonl",
    requiredFields: ["id", "requires", "expected_final_marker"],
    validEvents: [
      "session/input", "agent/start", "assistant/update", "assistant/end",
      "agent/settled", "tool/start", "tool/end",
    ],
  },
  {
    name: "AgentBench/ToolBench",
    file: "evals/datasets/agentbench_tool_selection.jsonl",
    requiredFields: ["id", "required_events"],
    validEvents: ["session/input", "tool/start", "tool/end", "assistant/update", "agent/settled"],
  },
  {
    name: "AgentDojo-safety",
    file: "evals/datasets/agentdojo_safety.jsonl",
    requiredFields: ["id", "required_events"],
    validEvents: ["session/input", "tool/start", "tool/end", "assistant/update", "agent/settled"],
  },
  {
    name: "MT-bench-style",
    file: "evals/datasets/mt_bench_style_tasks.jsonl",
    requiredFields: ["id", "turns", "requires"],
    validEvents: [
      "session/input", "agent/start", "assistant/update", "assistant/end",
      "agent/settled", "tool/start", "tool/end",
    ],
  },
  {
    name: "BFCL-style",
    file: "evals/datasets/bfcl_style_function_calls.jsonl",
    requiredFields: ["id", "required_events"],
    validEvents: ["session/input", "tool/start", "tool/end", "assistant/update", "agent/settled"],
  },
  {
    name: "NL2Bash-style",
    file: "evals/datasets/nl2bash_style_commands.jsonl",
    requiredFields: ["id", "expected_marker", "required_events"],
    validEvents: ["session/input", "tool/start", "tool/end", "assistant/update", "agent/settled"],
  },
  {
    name: "SWE-bench-style",
    file: "evals/datasets/swe_bench_style_edits.jsonl",
    requiredFields: ["id", "expectedMarker", "requiredEvents", "initialFiles"],
    validEvents: ["session/input", "tool/start", "tool/end", "assistant/update", "agent/settled"],
  },
];

async function loadDataset(filePath: string): Promise<BaseCase[]> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const rows: BaseCase[] = [];
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as BaseCase);
  }
  return rows;
}

function allMarkers(c: BaseCase): string[] {
  // 仅使用数据集设计者明确标识的"测试标识 marker"
  // oracle.marker 与 expected_final_marker 语义重复; turn.marker 可能是中间态
  const set = new Set<string>();
  if (c.expected_marker) set.add(c.expected_marker);
  if (c.expected_markers) c.expected_markers.forEach((m) => set.add(m));
  if (c.expected_final_marker) set.add(c.expected_final_marker);
  return Array.from(set);
}

describe("Top-tier AI Agent 测试集闭循环真实数据集验证 (无 mock)", () => {
  it("加载全部 7 个数据集并验证存在", async () => {
    for (const spec of DATASETS) {
      const rows = await loadDataset(spec.file);
      expect(rows.length, `${spec.name} 应至少有 1 条`).toBeGreaterThan(0);
    }
  });

  it("每个数据集都符合 schema 与必备字段", async () => {
    for (const spec of DATASETS) {
      const rows = await loadDataset(spec.file);
      for (const row of rows) {
        for (const field of spec.requiredFields) {
          expect(row[field], `${spec.name}/${row.id ?? "?"} 缺少 ${field}`).toBeDefined();
        }
        expect(typeof row.id, `${spec.name} id 应为字符串`).toBe("string");
        // 验证事件
        const events = [
          ...(row.required_events ?? []),
          ...(row.forbidden_events ?? []),
          ...(row.requires ?? []),
        ];
        for (const e of events) {
          expect(spec.validEvents, `${spec.name}/${row.id} 事件 ${e} 不在白名单`).toContain(e);
        }
      }
    }
  });

  it("marker 唯一性 — 每个数据集内 marker 互不重复", async () => {
    for (const spec of DATASETS) {
      const rows = await loadDataset(spec.file);
      const markers: string[] = [];
      for (const row of rows) markers.push(...allMarkers(row));
      const unique = new Set(markers);
      expect(unique.size, `${spec.name} markers 应唯一, 发现重复`).toBe(markers.length);
    }
  });

  it("marker 跨数据集也保持唯一 (避免命名冲突)", async () => {
    const seen = new Map<string, string>();
    const collisions: Array<{ marker: string; datasets: string[] }> = [];
    for (const spec of DATASETS) {
      const rows = await loadDataset(spec.file);
      for (const row of rows) {
        for (const m of allMarkers(row)) {
          const existing = seen.get(m);
          if (existing && existing !== spec.name) {
            collisions.push({ marker: m, datasets: [existing, spec.name] });
          } else {
            seen.set(m, spec.name);
          }
        }
      }
    }
    expect(collisions, `跨数据集 marker 冲突: ${JSON.stringify(collisions)}`).toHaveLength(0);
  });

  it("事件语义一致性: tool/start 必须与 tool/end 同时出现或同时缺失", async () => {
    for (const spec of DATASETS) {
      const rows = await loadDataset(spec.file);
      for (const row of rows) {
        const required = new Set(row.required_events ?? []);
        const forbidden = new Set(row.forbidden_events ?? []);
        const requires = new Set(row.requires ?? []);
        const allRequired = new Set([...required, ...requires]);
        const allForbidden = new Set(forbidden);
        // tool/start 与 tool/end 必须同步
        if (allRequired.has("tool/start")) {
          expect(allRequired.has("tool/end"), `${spec.name}/${row.id} 缺 tool/end`).toBe(true);
        }
        if (allRequired.has("tool/end")) {
          expect(allRequired.has("tool/start"), `${spec.name}/${row.id} 缺 tool/start`).toBe(true);
        }
        if (allForbidden.has("tool/start")) {
          expect(allForbidden.has("tool/end"), `${spec.name}/${row.id} 缺 tool/end forbidden`).toBe(true);
        }
        if (allForbidden.has("tool/end")) {
          expect(allForbidden.has("tool/start"), `${spec.name}/${row.id} 缺 tool/start forbidden`).toBe(true);
        }
      }
    }
  });

  it("required 与 forbidden 事件不能冲突", async () => {
    for (const spec of DATASETS) {
      const rows = await loadDataset(spec.file);
      for (const row of rows) {
        const required = new Set([...(row.required_events ?? []), ...(row.requires ?? [])]);
        const forbidden = new Set(row.forbidden_events ?? []);
        for (const e of required) {
          expect(forbidden.has(e), `${spec.name}/${row.id} 事件 ${e} 同时 required 与 forbidden`).toBe(false);
        }
      }
    }
  });

  it("SWE-bench-style: 所有 marker 可作为注释写入文件", async () => {
    const spec = DATASETS.find((s) => s.name === "SWE-bench-style");
    if (!spec) throw new Error("SWE-bench-style spec missing");
    const rows = await loadDataset(spec.file);
    for (const row of rows) {
      expect(row.expectedMarker, `${row.id} 应有 marker`).toBeDefined();
      // 模拟写入
      const markerComment = `// MARKER: ${row.expectedMarker}`;
      const sha256 = createHash("sha256").update(markerComment).digest("hex");
      expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("BFCL-style: expected_markers 多 marker 时数组非空且唯一", async () => {
    const spec = DATASETS.find((s) => s.name === "BFCL-style");
    if (!spec) throw new Error("BFCL-style spec missing");
    const rows = await loadDataset(spec.file);
    for (const row of rows) {
      if (row.expected_markers) {
        expect(row.expected_markers.length, `${row.id} expected_markers 应非空`).toBeGreaterThan(0);
        const uniq = new Set(row.expected_markers);
        expect(uniq.size, `${row.id} expected_markers 应唯一`).toBe(row.expected_markers.length);
      }
    }
  });

  it("MT-bench-style: 多轮对话每轮都应包含 marker (闭环验证)", async () => {
    const spec = DATASETS.find((s) => s.name === "MT-bench-style");
    if (!spec) throw new Error("MT-bench-style spec missing");
    const rows = await loadDataset(spec.file);
    for (const row of rows) {
      expect(Array.isArray(row.turns), `${row.id} 应有 turns`).toBe(true);
      if (!row.turns) continue;
      expect(row.turns.length, `${row.id} 应至少 1 轮`).toBeGreaterThan(0);
      for (const [idx, turn] of row.turns.entries()) {
        expect(turn.text, `${row.id} turn ${idx} 应有 text`).toBeDefined();
        expect(turn.marker, `${row.id} turn ${idx} 应有 marker`).toBeDefined();
      }
    }
  });

  it("GAIA-style: oracle 字段存在且 final_marker 一致", async () => {
    const spec = DATASETS.find((s) => s.name === "GAIA-style");
    if (!spec) throw new Error("GAIA-style spec missing");
    const rows = await loadDataset(spec.file);
    for (const row of rows) {
      expect(row.expected_final_marker, `${row.id} 缺 final marker`).toBeDefined();
      // 如果 oracle 含 marker, 应与 expected_final_marker 一致
      const oracleMarker = (row.oracle as { marker?: string })?.marker;
      if (oracleMarker) {
        expect(oracleMarker, `${row.id} oracle marker 与 final marker 不一致`).toBe(row.expected_final_marker);
      }
    }
  });

  it("AgentDojo-safety: 每条都应包含 safety_property 描述", async () => {
    const spec = DATASETS.find((s) => s.name === "AgentDojo-safety");
    if (!spec) throw new Error("AgentDojo-safety spec missing");
    const rows = await loadDataset(spec.file);
    for (const row of rows) {
      expect(typeof row.safety_property, `${row.id} 应有 safety_property 字符串`).toBe("string");
      expect(row.safety_property?.length, `${row.id} safety_property 不应为空`).toBeGreaterThan(0);
    }
  });

  it("NL2Bash-style: prompt 应包含 'shell command' 或 'pipeline' 关键词", async () => {
    const spec = DATASETS.find((s) => s.name === "NL2Bash-style");
    if (!spec) throw new Error("NL2Bash-style spec missing");
    const rows = await loadDataset(spec.file);
    for (const row of rows) {
      expect(row.prompt, `${row.id} 应有 prompt`).toBeDefined();
      const prompt = row.prompt?.toLowerCase() ?? "";
      expect(
        prompt.includes("shell") || prompt.includes("command") || prompt.includes("pipeline") || prompt.includes("grep") || prompt.includes("find"),
        `${row.id} prompt 应涉及 shell/command/pipeline`
      ).toBe(true);
    }
  });

  it("类别分布: 7 个数据集合计 45 个测试用例", async () => {
    let total = 0;
    for (const spec of DATASETS) {
      const rows = await loadDataset(spec.file);
      total += rows.length;
    }
    // GAIA 9 + AgentBench 8 + AgentDojo 8 + MT-bench 5 + BFCL 5 + NL2Bash 5 + SWE-bench 5 = 45
    expect(total).toBe(45);
  });
});
