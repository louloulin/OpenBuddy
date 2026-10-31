/**
 * VirtualizedMessageList10kGate.test — plan1030 批 4d 滚动性能门禁。
 *
 * lumos 对应物：messageListScrollPerf（10k 消息、16ms 帧预算 p95，独立 CI
 * gate）。本仓是 jsdom 环境，测不了真实合成帧 —— 门禁退而求其次，锁定
 * 「10k 消息下挂载是有界的」这一决定帧预算的上游事实：
 *   1. 10k timeline 挂载后实际渲染行数有界（窗口 + overscan，与总量无关）；
 *   2. 容器 DOM 节点数有界（防"其实渲染了全量"的回归——虚拟化失效时
 *      DOM 会线性膨胀到 10k+）；
 *   3. 10k 挂载耗时预算（jsdom 代理，宽松阈值只用于抓数量级回归）。
 * 真实帧率门禁留给 scripts/perf/ 的 electron 基准（批 4 收尾项）。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { VirtualizedMessageList } from "../VirtualizedMessageList";
import type { TimelineNode } from "@/lib/ui/timeline-utils";

// jsdom 没有 ResizeObserver；tanstack/virtual-core 靠它获知视口尺寸。
// stub 必须真的回调，否则虚拟化器算出 0 个可见项。
class ROStub {
  private cb: ResizeObserverCallback | null = null;
  constructor(cb?: ResizeObserverCallback) {
    this.cb = cb ?? null;
  }
  observe(el: Element) {
    this.cb?.(
      [
        {
          target: el,
          contentRect: { width: 800, height: 800, x: 0, y: 0, top: 0, left: 0, bottom: 800, right: 800, toJSON: () => ({}) },
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = ROStub;
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 800;
    },
  });
  // virtual-core getRect() 读 offsetWidth/offsetHeight（jsdom 默认 0 → 视口 0）
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 800;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return 2_000_000; // 10k × ~200px
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      width: 800, height: 800, top: 0, left: 0, bottom: 800, right: 800, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect;
  };
});
afterEach(() => {
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
});

const TEN_K = 10_000;
const timeline: TimelineNode[] = Array.from({ length: TEN_K }, (_, i) => ({
  kind: "message",
  message: { id: `m${i}`, role: "assistant", parts: [], complete: true },
  index: i,
})) as unknown as TimelineNode[];

describe("10k 消息虚拟化门禁（plan1030 批 4d）", () => {
  it("10k timeline 只渲染窗口内行数（有界），DOM 节点不随总量线性增长", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const { container } = render(
      <div ref={scrollRef} style={{ height: 800, overflow: "auto" }}>
        <VirtualizedMessageList
          timeline={timeline}
          scrollRef={scrollRef}
          renderItem={() => <div className="gate-row" />}
        />
      </div>,
    );
    const rows = container.querySelectorAll(".gate-row").length;
    // 视口 800px / 估高 200px ≈ 4 行 + overscan 10×2 —— 上限放宽到 64 行，
    // 无论总量 10k 还是 100k 都不得突破（虚拟化失效时会 >10k）。
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(64);
    // 全容器 DOM 节点数有界（jsdom 下确定性可断言的"渲染规模"代理）
    expect(container.querySelectorAll("*").length).toBeLessThanOrEqual(400);
  });

  it("10k 挂载耗时在预算内（jsdom 代理，抓数量级回归）", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const t0 = performance.now();
    render(
      <div ref={scrollRef} style={{ height: 800, overflow: "auto" }}>
        <VirtualizedMessageList
          timeline={timeline}
          scrollRef={scrollRef}
          renderItem={() => <div className="gate-row" />}
        />
      </div>,
    );
    const elapsed = performance.now() - t0;
    // 本机实测 <100ms；放宽 8 倍容忍 CI 慢机。全量渲染 10k 行时该值
    // 会进入秒级 —— 那就是回归。
    expect(elapsed).toBeLessThan(1500);
  });
});
