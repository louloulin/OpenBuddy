// Pure-helper unit tests for chat-render-bench.
//
// Verifies the data factories and frame-budget math used by the
// ChatMinimap / BranchNavigator / long-session render benchmark.
// These tests run under node:test so they're executable in CI without
// a full Electron launch.
//
// Run with: `pnpm run perf:chat-render:test`
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  makeMinimapSegments,
  makeBranchNode,
  makeBranchTree,
  countBranchNodes,
  makeLongSessionMessages,
  frameBudgetMsAt60fps,
  frameBudgetCheck,
  buildChatRenderSummary,
  parseBenchArgs,
} from "./_chat-render-lib.mjs";

describe("chat-render-lib: data factories", () => {
  it("makeMinimapSegments: length matches, kinds cycle, compaction labels periodic", () => {
    const segs = makeMinimapSegments(200);
    assert.equal(segs.length, 200);
    assert.equal(segs[0].kind, "user");
    assert.equal(segs[1].kind, "assistant");
    assert.equal(segs[5].kind, "branch");
    // label appears every 7th index (0-indexed, so 0, 7, 14...)
    assert.equal(segs[0].label, "compaction #0");
    assert.equal(segs[7].label, "compaction #7");
    assert.equal(segs[14].label, "compaction #14");
    assert.equal(segs[1].label, undefined);
  });

  it("makeBranchNode / makeBranchTree: builds balanced tree with correct depth", () => {
    const tree = makeBranchTree({ roots: 2, depth: 3, fanout: 4 });
    assert.equal(tree.length, 2);
    assert.equal(tree[0].children.length, 4);
    assert.equal(tree[0].children[0].children.length, 4);
    // depth=3 means leaves live at depth=3; their children list is empty
    assert.equal(tree[0].children[0].children[0].children.length, 4);
    assert.equal(tree[0].children[0].children[0].children[0].children.length, 0);
    // Parent linkage
    assert.equal(tree[0].children[0].parentId, tree[0].id);
    assert.equal(tree[0].children[0].children[0].parentId, tree[0].children[0].id);
  });

  it("countBranchNodes: matches arithmetic series for depth=3, fanout=4", () => {
    // depth=3 means root (level 0) → 2 children levels → leaves at level 2
    // Wait: factory recurses while depth < maxDepth, so depth=3 makes 4 levels
    // (0,1,2,3), leaves at level 3. roots=2, fanout=4:
    //   2 + 2*4 + 2*4^2 + 2*4^3 = 2 + 8 + 32 + 128 = 170
    const tree = makeBranchTree({ roots: 2, depth: 3, fanout: 4 });
    assert.equal(countBranchNodes(tree), 170);
  });

  it("countBranchNodes: depth=0 yields just the roots, no children", () => {
    const tree = makeBranchTree({ roots: 3, depth: 0, fanout: 4 });
    assert.equal(countBranchNodes(tree), 3);
  });

  it("countBranchNodes: depth=1 yields roots + their children only", () => {
    const tree = makeBranchTree({ roots: 2, depth: 1, fanout: 3 });
    // 2 roots + 2*3 = 8
    assert.equal(countBranchNodes(tree), 8);
  });

  it("countBranchNodes: single-node tree has count 1", () => {
    const single = [{ ...makeBranchNode("only", 0, 0, 0) }];
    assert.equal(countBranchNodes(single), 1);
  });

  it("makeLongSessionMessages: roles cycle and length matches", () => {
    const msgs = makeLongSessionMessages(200);
    assert.equal(msgs.length, 200);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "assistant");
    assert.equal(msgs[2].role, "tool");
    // parts are [{kind: "text", text: ...}]
    assert.equal(msgs[0].parts.length, 1);
    assert.equal(msgs[0].parts[0].kind, "text");
    // complete flips per role cycle (i%3!==0)
    assert.equal(msgs[0].complete, false); // user      (i=0, 0%3===0)
    assert.equal(msgs[1].complete, true);  // assistant (i=1, 1%3!==0)
    assert.equal(msgs[2].complete, true);  // tool      (i=2, 2%3!==0)
  });
});

describe("chat-render-lib: frame budget math", () => {
  it("frameBudgetMsAt60fps = 16.666…", () => {
    const budget = frameBudgetMsAt60fps();
    assert.ok(Math.abs(budget - 16.6666666) < 1e-5, `got ${budget}`);
  });

  it("frameBudgetCheck: empty array yields ok=true with full headroom", () => {
    const r = frameBudgetCheck([]);
    assert.equal(r.totalUs, 0);
    assert.equal(r.ok, true);
    assert.ok(r.headroomMs > 16);
  });

  it("frameBudgetCheck: typical chat surface stays under 60fps budget", () => {
    // realistic measured numbers from the actual benchmark
    const r = frameBudgetCheck([120, 350, 4200]);
    assert.ok(r.totalMs < 16.6, `expected < 16.6ms, got ${r.totalMs}`);
    assert.equal(r.ok, true);
  });

  it("frameBudgetCheck: pathological 100ms render trips the budget", () => {
    const r = frameBudgetCheck([100_000]); // 100ms in microseconds
    assert.equal(r.ok, false);
    assert.ok(r.headroomMs < 0);
  });

  it("buildChatRenderSummary: structure is stable and round-trippable", () => {
    const summary = buildChatRenderSummary({
      iterations: 200,
      messageCount: 200,
      branchNodes: 42,
      minimap: { perIterUs: 120.5, opsPerSec: 8298 },
      branch: { perIterUs: 350.2, opsPerSec: 2855 },
      longSession: { perIterUs: 4200.7, opsPerSec: 238 },
    });
    // Stable keys for downstream consumers (CI dashboard, alerts)
    assert.deepEqual(Object.keys(summary.results).sort(), [
      "branchNavigatorFullOpsPerSec",
      "branchNavigatorFullUsPerRender",
      "chatMinimap200OpsPerSec",
      "chatMinimap200UsPerRender",
      "longSession200MsgsOpsPerSec",
      "longSession200MsgsUsPerRender",
    ]);
    assert.deepEqual(Object.keys(summary.budget).sort(), [
      "frameBudgetMsAt60fps",
      "frameHeadroomMs",
      "sumWorstCaseMsPerFrame",
      "within60Fps",
    ]);
    // Numeric formatting: 3 decimal places
    assert.equal(summary.results.chatMinimap200UsPerRender, 120.5);
    // budget.within60Fps is true for our typical workload
    assert.equal(summary.budget.within60Fps, true);
    // JSON-serialisable (so CI can post it as an artifact)
    assert.doesNotThrow(() => JSON.stringify(summary));
  });
});

describe("chat-render-lib: arg parsing", () => {
  it("parseBenchArgs: defaults applied when args missing", () => {
    const r = parseBenchArgs([]);
    assert.equal(r.iterations, 200);
    assert.equal(r.messageCount, 200);
    assert.equal(r.jsonPath, "");
  });

  it("parseBenchArgs: --iterations=50 --messages=80", () => {
    const r = parseBenchArgs(["--iterations=50", "--messages=80"]);
    assert.equal(r.iterations, 50);
    assert.equal(r.messageCount, 80);
  });

  it("parseBenchArgs: --json=evidence/perf/x.json passes through", () => {
    const r = parseBenchArgs(["--json=evidence/perf/x.json"]);
    assert.equal(r.jsonPath, "evidence/perf/x.json");
  });

  it("parseBenchArgs: caller-supplied defaults override hard-coded fallbacks", () => {
    const r = parseBenchArgs([], { iterations: 10, messageCount: 25, jsonPath: "out.json" });
    assert.equal(r.iterations, 10);
    assert.equal(r.messageCount, 25);
    assert.equal(r.jsonPath, "out.json");
  });
});
