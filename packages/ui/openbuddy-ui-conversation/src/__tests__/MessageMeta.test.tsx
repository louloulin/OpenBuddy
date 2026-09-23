/**
 * MessageMeta.test.tsx — Plan5 组件化回归测试
 *
 * 验证从 MessageItem 抽出的 MessageMeta 部件:
 *   - 流式态:`{N}s 正在生成…` + hourglass
 *   - 完成态:相对时间 + 时长 + 模型 chip + 输入/输出 token chip
 *   - throughput chip 仅在 ≥ 1s 且 outputTokens > 0 时渲染
 *   - 通过 token 渲染与位置(in 在 out 前)
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageMeta } from "../parts/MessageMeta";

describe("MessageMeta (Plan5 componentization)", () => {
  it("streaming 时显示「正在生成…」+ 用时", () => {
    render(
      <MessageMeta
        createdAt={Date.now() - 1000}
        durationMs={4200}
        isStreaming
      />,
    );
    expect(screen.getByText(/4s 正在生成/)).toBeTruthy();
    expect(screen.getByLabelText(/正在生成/)).toBeTruthy();
  });

  it("完成态显示相对时间 + 时长 detail", () => {
    render(
      <MessageMeta
        createdAt={Date.now() - 60_000}
        durationMs={12_500}
        isStreaming={false}
      />,
    );
    // 60s ago → "1 分钟前"
    expect(screen.getByText(/1 分钟前/)).toBeTruthy();
    // duration detail: "· 13s" (rounded)
    expect(screen.getByText(/· 13s/)).toBeTruthy();
  });

  it("modelId 存在时渲染 model chip", () => {
    render(
      <MessageMeta
        createdAt={Date.now() - 5_000}
        durationMs={2_000}
        isStreaming={false}
        modelId="claude-3-5-sonnet"
      />,
    );
    expect(screen.getByText("claude-3-5-sonnet")).toBeTruthy();
  });

  it("inputTokens/outputTokens/throughput 顺序正确(in → out → tok/s)", () => {
    const { container } = render(
      <MessageMeta
        createdAt={Date.now() - 5_000}
        durationMs={2_000}
        isStreaming={false}
        modelId="m"
        inputTokens={1200}
        outputTokens={450}
      />,
    );
    const text = container.textContent ?? "";
    const inIdx = text.indexOf(" in");
    const outIdx = text.indexOf(" out");
    const tokIdx = text.indexOf(" tok/s");
    expect(inIdx).toBeGreaterThan(-1);
    expect(outIdx).toBeGreaterThan(inIdx);
    expect(tokIdx).toBeGreaterThan(outIdx);
  });

  it("duration < 1s 时不渲染 throughput chip", () => {
    render(
      <MessageMeta
        createdAt={Date.now() - 5_000}
        durationMs={500}
        isStreaming={false}
        outputTokens={100}
      />,
    );
    expect(screen.queryByText(/tok\/s/)).toBeNull();
  });
});
