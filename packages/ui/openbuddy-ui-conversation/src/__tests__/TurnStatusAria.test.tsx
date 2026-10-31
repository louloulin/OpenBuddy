/**
 * TurnStatusAria.test — plan1030 批 4b/4c。
 *
 * 锁定四条不变量（lumos：StreamingIndicator role=status ×3 / TurnCompletionStamp hover 精确时间）：
 *   1. LoadingRow 容器 role="status"（插入时播报一次）；
 *   2. 内层 elapsed 不再单独 aria-live（每秒播报属噪音）；
 *   3. MessageMeta 流式态无 live region（避免计时连续播报）；
 *   4. MessageMeta 完成态 role="status" + title 含精确绝对时间戳。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { LoadingRow } from "../LoadingRow";
import { MessageMeta } from "../parts/MessageMeta";

// LoadingRow 依赖 locale provider —— 沙箱渲染最小 props。
describe("回合状态可访问性（plan1030 批 4b/4c）", () => {
  it("LoadingRow 容器是 role=status，elapsed 无独立 aria-live", () => {
    const { container } = render(<LoadingRow />);
    const root = container.querySelector(".msg__loading");
    expect(root?.getAttribute("role")).toBe("status");
    const elapsed = container.querySelector(".msg__loading-elapsed");
    // elapsed 前 2s 不渲染；即使渲染也不得带 aria-live
    if (elapsed) expect(elapsed.getAttribute("aria-live")).toBeNull();
  });

  it("MessageMeta 流式态无 live region，完成态 role=status", () => {
    const streaming = render(
      <MessageMeta createdAt={Date.now()} durationMs={1200} isStreaming />,
    );
    expect(
      streaming.container.querySelector(".msg__meta")?.getAttribute("role"),
    ).toBeNull();

    const done = render(
      <MessageMeta createdAt={Date.now() - 12_000} durationMs={12_000} isStreaming={false} />,
    );
    expect(
      done.container.querySelector(".msg__meta")?.getAttribute("role"),
    ).toBe("status");
  });

  it("MessageMeta 完成态 title 含精确绝对时间戳与用时", () => {
    const createdAt = new Date("2026-10-30T12:00:00").getTime();
    const { container } = render(
      <MessageMeta createdAt={createdAt} durationMs={12_000} isStreaming={false} />,
    );
    const title = container.querySelector(".msg__meta")?.getAttribute("title") ?? "";
    expect(title).toContain(new Date(createdAt).toLocaleString());
    expect(title).toContain("12s");
  });
});
