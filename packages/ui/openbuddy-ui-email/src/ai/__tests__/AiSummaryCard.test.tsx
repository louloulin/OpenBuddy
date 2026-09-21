import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiSummaryCard } from "../components/AiSummaryCard";
import { phaseError, phaseLoading, phaseReady } from "../types";
import type { AiThreadSummary } from "../types";

const sample: AiThreadSummary = {
  threadId: "t1",
  oneLiner: "Lin 希望你今天确认 Q4 roadmap。",
  keyPoints: ["mobile H5 兼容性是 blocking", "PWA 兜底可解决"],
  actionItems: [{ content: "回复 Lin" }],
  confidence: 0.92,
  citations: [],
  generatedAt: new Date().toISOString(),
};

beforeEach(() => { swrCacheInternal.reset(); });
describe("AiSummaryCard", () => {
  it("auto requests summary on idle mount", async () => {
    const onEnsure = vi.fn().mockResolvedValue(sample);
    render(
      <AiSummaryCard
        threadId="t1"
        summary={{ status: "idle" }}
        onEnsure={onEnsure}
        onAction={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(onEnsure).toHaveBeenCalledWith("t1");
    });
  });

  it("renders one-liner and key points when ready", () => {
    render(
      <AiSummaryCard
        threadId="t1"
        summary={phaseReady(sample)}
        onEnsure={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(sample.oneLiner)).toBeTruthy();
    expect(screen.getByText("mobile H5 兼容性是 blocking")).toBeTruthy();
    expect(screen.getAllByText((content, element) => element?.textContent?.includes("92%") ?? false)[0]).toBeTruthy();
  });

  it("shows loading state", () => {
    render(
      <AiSummaryCard
        threadId="t1"
        summary={phaseLoading()}
        onEnsure={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/正在生成摘要/)).toBeTruthy();
  });

  it("shows error state with retry", () => {
    const onRetry = vi.fn();
    render(
      <AiSummaryCard
        threadId="t1"
        summary={phaseError("AI 超时")}
        onEnsure={vi.fn()}
        onAction={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledWith("t1");
  });

  it("invokes onAction when reply button is clicked", () => {
    const onAction = vi.fn();
    render(
      <AiSummaryCard
        threadId="t1"
        summary={phaseReady(sample)}
        onEnsure={vi.fn()}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /生成回复/ }));
    expect(onAction).toHaveBeenCalledWith("reply", sample);
  });
});
