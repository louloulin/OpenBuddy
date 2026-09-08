/**
 * Pure helper functions for the chat-render perf bench.
 *
 * PC-5 of WU-E: regression baseline for the chat-surface pieces introduced
 * by WU-D — `ChatMinimap`, `BranchNavigator`, and the long-session list
 * render path. These helpers are kept dependency-free (no React imports)
 * so they can be unit-tested with `node:test` directly, matching the
 * `cold-start` / `streaming-bench` precedent in this repo.
 *
 * The actual JSX-rendering benchmark lives in
 * `chat-render-bench.test.mjs` (vitest + jsdom) because it needs React's
 * `renderToString` and the TypeScript/JSX transform pipeline.
 */

// =============================================================================
// Data factories — produce realistic inputs for the benchmark.
// =============================================================================
const MINIMAP_KINDS = ["user", "assistant", "tool", "system", "compaction", "branch"];

export function makeMinimapSegments(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    kind: MINIMAP_KINDS[i % MINIMAP_KINDS.length],
    label: i % 7 === 0 ? `compaction #${i}` : undefined,
  }));
}

const BRANCH_KINDS = ["message", "compaction", "branch_summary", "model_change"];

export function makeBranchNode(id, depth, fanout, maxDepth) {
  const node = {
    id,
    parentId: null,
    branch: BRANCH_KINDS[depth % BRANCH_KINDS.length],
    summary: depth === 0 ? `branch ${id}` : undefined,
    createdAt: "2026-09-08T00:00:00Z",
    children: [],
  };
  if (depth < maxDepth) {
    node.children = Array.from({ length: fanout }, (_, i) => {
      const child = makeBranchNode(`${id}.${i}`, depth + 1, fanout, maxDepth);
      child.parentId = id;
      return child;
    });
  }
  return node;
}

export function makeBranchTree({ roots = 2, depth = 3, fanout = 4 } = {}) {
  return Array.from({ length: roots }, (_, i) =>
    makeBranchNode(`root${i}`, 0, fanout, depth),
  );
}

export function countBranchNodes(nodes) {
  return nodes.reduce((acc, n) => acc + 1 + countBranchNodes(n.children), 0);
}

export function makeLongSessionMessages(n) {
  const roles = ["user", "assistant", "tool"];
  return Array.from({ length: n }, (_, i) => ({
    id: `msg-${i}`,
    role: roles[i % 3],
    parts: [
      { kind: "text", text: `message ${i}: lorem ipsum dolor sit amet`.repeat(3) },
    ],
    complete: i % 3 !== 0,
  }));
}

// =============================================================================
// Frame-budget analysis (pure, dependency-free).
// =============================================================================

/**
 * The classic 60 fps budget for a single frame in milliseconds.
 * Kept as a function (not constant) so test code can override it for
 * regression scenarios.
 */
export function frameBudgetMsAt60fps() {
  return 1000 / 60;
}

/**
 * Sum per-render µs across multiple benchmarks and report whether the
 * combination fits inside one 60 fps frame.
 *
 * @param {number[]} perRenderUs  per-render cost in microseconds, one per piece
 * @returns {{ totalUs: number; totalMs: number; headroomMs: number; ok: boolean }}
 */
export function frameBudgetCheck(perRenderUs) {
  const totalUs = perRenderUs.reduce((a, b) => a + b, 0);
  const totalMs = totalUs / 1000;
  const budget = frameBudgetMsAt60fps();
  const headroomMs = budget - totalMs;
  return { totalUs, totalMs, headroomMs, ok: headroomMs >= 0, budget };
}

/**
 * Build the JSON summary that the benchmark emits to disk.
 *
 * @param {object} input
 * @param {number} input.iterations
 * @param {number} input.messageCount
 * @param {number} input.branchNodes
 * @param {{perIterUs: number; opsPerSec: number}} input.minimap
 * @param {{perIterUs: number; opsPerSec: number}} input.branch
 * @param {{perIterUs: number; opsPerSec: number}} input.longSession
 */
export function buildChatRenderSummary({
  iterations,
  messageCount,
  branchNodes,
  minimap,
  branch,
  longSession,
}) {
  const budget = frameBudgetCheck([
    minimap.perIterUs,
    branch.perIterUs,
    longSession.perIterUs,
  ]);
  return {
    iterations,
    messageCount,
    branchNodes,
    results: {
      chatMinimap200UsPerRender: Number(minimap.perIterUs.toFixed(3)),
      chatMinimap200OpsPerSec: Math.round(minimap.opsPerSec),
      branchNavigatorFullUsPerRender: Number(branch.perIterUs.toFixed(3)),
      branchNavigatorFullOpsPerSec: Math.round(branch.opsPerSec),
      longSession200MsgsUsPerRender: Number(longSession.perIterUs.toFixed(3)),
      longSession200MsgsOpsPerSec: Math.round(longSession.opsPerSec),
    },
    budget: {
      frameBudgetMsAt60fps: Number(budget.budget.toFixed(3)),
      sumWorstCaseMsPerFrame: Number(budget.totalMs.toFixed(3)),
      frameHeadroomMs: Number(budget.headroomMs.toFixed(3)),
      within60Fps: budget.ok,
    },
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// Argument parsing (shared between the .mjs driver and tests).
// =============================================================================

export function parseBenchArgs(argv, defaults = {}) {
  const argValue = (key, fallback) => {
    const hit = argv.find((arg) => arg.startsWith(`--${key}=`));
    return hit ? Number(hit.split("=")[1]) : fallback;
  };
  const argString = (key, fallback) => {
    const hit = argv.find((arg) => arg.startsWith(`--${key}=`));
    return hit ? hit.split("=")[1] : fallback;
  };
  return {
    iterations: argValue("iterations", defaults.iterations ?? 200),
    messageCount: argValue("messages", defaults.messageCount ?? 200),
    jsonPath: argString("json", defaults.jsonPath ?? ""),
  };
}
