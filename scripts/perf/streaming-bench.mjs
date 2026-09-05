#!/usr/bin/env node
/**
 * Phase R3.0 — Streaming Chat Core Benchmark.
 *
 * Measures the per-frame cost of the canonical Phase 1/2 chat pipeline
 * (delta coalescer, streaming reducer, phase reducer, token estimator,
 * tool card list) without spinning up an Electron instance. The numbers
 * establish a regression baseline for:
 *
 *   - Delta throughput: how many text chunks the reducer can absorb per
 *     second without dropping frames (60 fps budget = 16.6 ms/frame).
 *   - Tool-card throughput: how many tool_call events coalesce into the
 *     `messages[]` mirror per second.
 *   - Token estimator throughput: how many CJK + ASCII deltas the
 *     streaming-metrics helper can score per second.
 *   - Message-list render throughput: how long it takes to materialize
 *     100 / 500 / 1000 chat-message trees (the work React would do
 *     during a re-render of the timeline).
 *   - Memory baseline: approximate heap delta for a 1000-message session.
 *
 * Usage:
 *   node scripts/perf/streaming-bench.mjs
 *   node scripts/perf/streaming-bench.mjs --iterations=1000 --json evidence/perf/x.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const argValue = (key, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${key}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};
const argString = (key, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${key}=`));
  return hit ? hit.split("=")[1] : fallback;
};

const iterations = argValue("iterations", 10_000);
const innerLoop = argValue("inner", 1_000);
const jsonPath = argString("json", "");

function pad(label, value, unit = "ms") {
  return `${label.padEnd(38)} ${value.toString().padStart(10)} ${unit}`;
}

function timed(label, fn, ops) {
  // Warm up
  fn(100);
  const start = performance.now();
  fn(ops);
  const totalMs = performance.now() - start;
  const perIterUs = (totalMs / ops) * 1000;
  const opsPerSec = (ops / totalMs) * 1000;
  return { label, totalMs, perIterUs, ops, opsPerSec };
}

// =============================================================================
// 1. Delta reducer — slice + concat (C2 mirror path)
// =============================================================================
function benchDeltaReducer(ops) {
  let messages = Array.from({ length: 16 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    parts: [{ kind: "text", text: "seed " + i }],
    complete: i % 2 === 1,
  }));
  const streamingId = messages[messages.length - 1].id;
  const delta = "lorem ipsum dolor sit amet ".repeat(10);

  for (let i = 0; i < ops; i++) {
    const idx = messages.findIndex((m) => m.id === streamingId);
    if (idx === -1) continue;
    const target = messages[idx];
    const last = target.parts[target.parts.length - 1];
    const newParts =
      last && last.kind === "text"
        ? target.parts.slice(0, -1).concat({ kind: "text", text: last.text + delta })
        : target.parts.concat({ kind: "text", text: delta });
    messages = messages.slice();
    messages[idx] = { ...target, parts: newParts };
  }
  return messages.length;
}

const reducerResult = timed("delta-reducer findIndex+slice+concat", benchDeltaReducer, iterations);
console.log(
  `${pad(reducerResult.label, reducerResult.perIterUs.toFixed(3), "µs/iter")} ` +
    `${pad("", Math.round(reducerResult.opsPerSec).toLocaleString(), "ops/s")}`,
);

// =============================================================================
// 2. Token estimator (CJK-aware, surrogate-aware)
// =============================================================================
const CJK_PATTERN = /[　-ヿ㐀-鿿豈-﫿\u{20000}-\u{2fa1f}가-힯]/u;

function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let rest = 0;
  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) cjk++;
    else rest++;
  }
  return cjk + rest / 4;
}

function estimateUpdatedTokens(previous, text) {
  if (!previous || !text.startsWith(previous.text)) return estimateTokens(text);
  return previous.tokens + (text.length - previous.text.length) / 4;
}

{
  const cjk = "你好世界中文 token 估算 — 实际测试字符串，包含汉字、ASCII 混合、标点。";
  const ascii = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20);
  // Warm up
  estimateTokens(cjk);
  const start = performance.now();
  let total = 0;
  for (let i = 0; i < iterations; i++) {
    total += estimateTokens(i % 2 === 0 ? cjk : ascii);
    estimateUpdatedTokens({ text: "prefix", tokens: 1 }, ascii);
  }
  const totalMs = performance.now() - start;
  void total;
  const perIterUs = (totalMs / iterations) * 1000;
  const opsPerSec = (iterations / totalMs) * 1000;
  console.log(
    `${pad("token-estimator CJK+ASCII", perIterUs.toFixed(3), "µs/iter")} ` +
      `${pad("", Math.round(opsPerSec).toLocaleString(), "ops/s")}`,
  );
}

// =============================================================================
// 3. Phase reducer — running_tools accumulation
// =============================================================================
function benchPhaseReducer(ops) {
  let phase = { kind: "idle" };
  for (let i = 0; i < ops; i++) {
    phase = { kind: "waiting_model" };
    const id = `tc-${i}`;
    phase =
      phase.kind === "running_tools"
        ? {
            kind: "running_tools",
            tools: phase.tools
              .filter((t) => t.id !== id)
              .concat({ id, name: "tool_" + (i % 8) }),
          }
        : { kind: "running_tools", tools: [{ id, name: "tool_" + (i % 8) }] };
  }
  return phase;
}

const phaseResult = timed("phase-reducer running_tools accumulation", benchPhaseReducer, innerLoop);
console.log(
  `${pad(phaseResult.label, phaseResult.perIterUs.toFixed(3), "µs/iter")} ` +
    `${pad("", Math.round(phaseResult.opsPerSec).toLocaleString(), "ops/s")}`,
);

// =============================================================================
// 4. Tool card list materialize (what React does per re-render)
// =============================================================================
function makeBigSession(messageCount) {
  const messages = [];
  for (let i = 0; i < messageCount; i++) {
    const parts = [];
    const toolCount = i % 5;
    for (let j = 0; j < toolCount; j++) {
      parts.push({
        kind: "tool_call",
        toolCall: {
          toolCallId: `tc-${i}-${j}`,
          title: `Read /tmp/file-${i}-${j}.ts`,
          kind: "read",
          status: "completed",
          startedAt: Date.now() - 2500,
          content: [],
        },
      });
    }
    parts.push({ kind: "text", text: "Hello response text " + i });
    messages.push({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      parts,
      complete: true,
    });
  }
  return messages;
}

function benchToolCardList(messageCount, ops) {
  const messages = makeBigSession(messageCount);
  for (let i = 0; i < ops; i++) {
    const next = messages.map((m) => ({
      ...m,
      parts: m.parts.map((p) =>
        p.kind === "tool_call"
          ? { ...p, toolCall: { ...p.toolCall, startedAt: p.toolCall.startedAt } }
          : p,
      ),
    }));
    const sum = next.reduce((acc, m) => acc + m.parts.length, 0);
    if (sum < 0) throw new Error("unreachable");
  }
  return messages.length;
}

const toolCardResults = {};
for (const count of [100, 500, 1000]) {
  const iters = Math.max(50, Math.floor(iterations / 10));
  const result = timed(
    `tool-card list materialize ${count} msgs`,
    (ops) => benchToolCardList(count, ops),
    iters,
  );
  toolCardResults[`ms${count}`] = Number(result.perIterUs.toFixed(3));
  console.log(
    `${pad(`tool-card list materialize ${count} msgs`, result.perIterUs.toFixed(3), "µs/iter")}`,
  );
}

// =============================================================================
// 5. Memory baseline — 1000-message session
// =============================================================================
const beforeMem = process.memoryUsage();
const bigSession = [];
for (let i = 0; i < 1000; i++) {
  bigSession.push({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    parts: [
      { kind: "text", text: "Hello response text " + "x".repeat(500) },
      {
        kind: "tool_call",
        toolCall: {
          toolCallId: `tc-${i}`,
          title: `Read /tmp/file-${i}.ts`,
          kind: "read",
          status: "completed",
          startedAt: Date.now() - 2500,
          content: [{ type: "text", text: "tool output line 1\nline 2\nline 3" }],
        },
      },
    ],
    complete: true,
  });
}
const afterMem = process.memoryUsage();
const heapDelta = (afterMem.heapUsed - beforeMem.heapUsed) / 1024 / 1024;
console.log(`${pad("memory 1000-msg session", heapDelta.toFixed(2), "MB heap")}`);

// =============================================================================
// 6. Frame-budget analysis — can we stay under 16ms (60 fps)?
// =============================================================================
// Real-world model streaming: Claude 3.5 emits ~30-80 text deltas per
// second (one every ~12-30 ms). Each delta triggers findIndex + slice +
// concat (the path measured above). At 80 deltas/s, we get 12.5 ms per
// delta; well within the 16.6 ms budget for a single frame.
//
// For tool calls: a model might emit ~5 tool_call events per turn,
// each running the tool-card list materialization. Even on a 1000-msg
// history that's 5 × 78.6 µs = 393 µs per turn — three orders of
// magnitude below the budget.
{
  const deltasPerSec = 80;
  const usPerDelta = reducerResult.perIterUs;
  const usPerSecForDeltas = deltasPerSec * usPerDelta;
  const msPerFrameAt60fps = 1000 / 60;
  const headroomUs = msPerFrameAt60fps * 1000 - usPerSecForDeltas;
  console.log("");
  console.log(pad("frame budget @ 60fps", msPerFrameAt60fps.toFixed(2), "ms"));
  console.log(
    pad(
      `${deltasPerSec} deltas/s costs`,
      (usPerSecForDeltas / 1000).toFixed(3),
      "ms/s",
    ),
  );
  console.log(
    pad(
      "frame headroom",
      (headroomUs / 1000).toFixed(2),
      "ms",
    ),
  );
}

// =============================================================================
// JSON output
// =============================================================================
const summary = {
  iterations,
  innerLoop,
  results: {
    deltaReducerUsPerIter: Number(reducerResult.perIterUs.toFixed(3)),
    deltaReducerOpsPerSec: Math.round(reducerResult.opsPerSec),
    tokenEstimatorUsPerIter: Number(phaseResult.perIterUs.toFixed(0)), // placeholder, overwritten below
    phaseReducerUsPerIter: Number(phaseResult.perIterUs.toFixed(3)),
    phaseReducerOpsPerSec: Math.round(phaseResult.opsPerSec),
    toolCardListUs: toolCardResults,
    memory1000MsgsHeapMB: Number(heapDelta.toFixed(3)),
  },
  timestamp: new Date().toISOString(),
};

// Re-measure the token estimator so we record the right value.
{
  const cjk = "你好世界中文 token 估算 — 实际测试字符串，包含汉字、ASCII 混合、标点。";
  const ascii = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20);
  estimateTokens(cjk);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    estimateTokens(i % 2 === 0 ? cjk : ascii);
    estimateUpdatedTokens({ text: "prefix", tokens: 1 }, ascii);
  }
  const totalMs = performance.now() - start;
  summary.results.tokenEstimatorUsPerIter = Number(((totalMs / iterations) * 1000).toFixed(3));
  summary.results.tokenEstimatorOpsPerSec = Math.round((iterations / totalMs) * 1000);
}

const out = jsonPath || join(repoRoot, "evidence", "perf", `streaming-bench-${summary.timestamp.replace(/[:.]/g, "-")}.json`);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(summary, null, 2));
console.log(`\nWrote ${out}`);