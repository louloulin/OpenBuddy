/**
 * PC-5 of WU-E: actual JSX render-cost benchmark for the chat surface.
 *
 * Runs under vitest with the jsdom environment, so we exercise the real
 * `react-dom/server.renderToString` path that React reconciles at runtime.
 * The numbers establish a regression baseline for:
 *
 *   - ChatMinimap render (200 segments)
 *   - BranchNavigator render (balanced 3-level / 4-ary tree = 170 nodes)
 *   - Long-session list render (200 flat messages)
 *
 * At the end we write a JSON artifact to evidence/perf/ matching the
 * schema produced by `streaming-bench.mjs`, so the dashboard and CI
 * budget-check can consume both uniformly.
 *
 * Usage:
 *   pnpm exec vitest run scripts/perf/_chat-render-jsdom.test.ts
 *   OUT_PATH=evidence/perf/x.json pnpm exec vitest run scripts/perf/_chat-render-jsdom.test.ts
 */
import { describe, it } from "vitest";
import { renderToString } from "react-dom/server";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createElement } from "react";

import { ChatMinimap } from "@openbuddy/ui-conversation";
import { BranchNavigator } from "@openbuddy/ui-conversation";
import type { BranchNode } from "@openbuddy/ui-conversation";

import {
  makeMinimapSegments,
  makeBranchTree,
  countBranchNodes,
  makeLongSessionMessages,
  buildChatRenderSummary,
} from "./_chat-render-lib.mjs";

function timed(label, fn, ops) {
  // Warm up V8 + module-init side effects
  fn(8);
  const start = performance.now();
  fn(ops);
  const totalMs = performance.now() - start;
  const perIterUs = (totalMs / ops) * 1000;
  const opsPerSec = (ops / totalMs) * 1000;
  return { label, totalMs, perIterUs, ops, opsPerSec };
}

describe("PC-5 chat-render-bench (real JSX render)", () => {
  const iterations = 100;
  const messageCount = 200;

  const segments = makeMinimapSegments(200);
  const tree = makeBranchTree({ roots: 2, depth: 3, fanout: 4 });
  const branchNodes = countBranchNodes(tree);
  const longMessages = makeLongSessionMessages(messageCount);

  it("ChatMinimap render 200 segments", () => {
    const r = timed("minimap", () => {
      for (let i = 0; i < iterations; i++) {
        renderToString(
          createElement(ChatMinimap, {
            segments,
            activeId: "m100",
            onJump: undefined,
          }),
        );
      }
    }, iterations);
    expect(r.perIterUs).toBeGreaterThan(0);
    // Sanity: render at least once outside the timer
    const html = renderToString(
      createElement(ChatMinimap, { segments: segments.slice(0, 3), activeId: "m0" }),
    );
    expect(html).toContain("chat-minimap");
    expect(html).toContain("chat-minimap__block--active");
    // Attach for the JSON dump step
    (globalThis as { __minimap?: unknown }).__minimap = r;
  });

  it("BranchNavigator render balanced 3-level / 4-ary tree", () => {
    const r = timed("branch", () => {
      for (let i = 0; i < iterations; i++) {
        renderToString(
          createElement(BranchNavigator, {
            tree: tree as BranchNode[],
            activeId: "root1.2",
            onSelect: undefined,
          }),
        );
      }
    }, iterations);
    expect(r.perIterUs).toBeGreaterThan(0);
    const html = renderToString(
      createElement(BranchNavigator, { tree: tree.slice(0, 1) as BranchNode[] }),
    );
    expect(html).toContain("branch-navigator");
    expect(html).toContain("branch-navigator__node-button");
    (globalThis as { __branch?: unknown }).__branch = r;
  });

  it("Long-session list render 200 messages", () => {
    const r = timed("long", () => {
      for (let i = 0; i < iterations; i++) {
        renderToString(
          createElement(
            "ul",
            { className: "chat-message-list" },
            ...longMessages.map((m) =>
              createElement(
                "li",
                {
                  key: m.id,
                  className: `chat-message chat-message--${m.role}`,
                  "data-message-id": m.id,
                },
                createElement("div", { className: "chat-message__role" }, m.role),
                createElement(
                  "div",
                  { className: "chat-message__body" },
                  m.parts.map((p) => p.text).join("\n"),
                ),
              ),
            ),
          ),
        );
      }
    }, iterations);
    expect(r.perIterUs).toBeGreaterThan(0);
    (globalThis as { __long?: unknown }).__long = r;
  });

  it("frame-budget analysis + JSON artifact", () => {
    const minimap = (globalThis as { __minimap?: { perIterUs: number; opsPerSec: number } })
      .__minimap!;
    const branch = (globalThis as { __branch?: { perIterUs: number; opsPerSec: number } })
      .__branch!;
    const longSession = (globalThis as { __long?: { perIterUs: number; opsPerSec: number } })
      .__long!;

    const summary = buildChatRenderSummary({
      iterations,
      messageCount,
      branchNodes,
      minimap,
      branch,
      longSession,
    });

    const out =
      process.env.CHAT_RENDER_OUT_PATH ||
      process.env.OUT_PATH ||
      resolve(
        __dirname,
        "..",
        "..",
        "evidence",
        "perf",
        `chat-render-bench-${summary.timestamp.replace(/[:.]/g, "-")}.json`,
      );
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(summary, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[chat-render-bench] wrote ${out}`);
    // eslint-disable-next-line no-console
    console.log(
      `[chat-render-bench] minimap=${summary.results.chatMinimap200UsPerRender}µs ` +
        `branch=${summary.results.branchNavigatorFullUsPerRender}µs ` +
        `long=${summary.results.longSession200MsgsUsPerRender}µs ` +
        `sum=${summary.budget.sumWorstCaseMsPerFrame}ms ` +
        `headroom=${summary.budget.frameHeadroomMs}ms ` +
        `within60Fps=${summary.budget.within60Fps}`,
    );

    // The frame budget analysis is a soft assertion: we expect the typical
    // chat surface to stay under 16.6ms even at 200 messages. If this ever
    // flips, the PC-5 reviewer's "must-fill" precondition is at risk.
    expect(summary.budget.frameBudgetMsAt60fps).toBeCloseTo(16.667, 2);
    expect(summary.budget.within60Fps).toBe(true);
  });
});
