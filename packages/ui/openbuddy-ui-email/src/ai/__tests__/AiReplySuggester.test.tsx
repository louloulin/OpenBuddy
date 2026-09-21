import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiReplySuggester } from "../components/AiReplySuggester";
import { phaseError, phaseLoading, phaseReady } from "../types";
import type { AiReplySuggestion } from "../types";

const suggestions: AiReplySuggestion[] = [
  { id: "r1", tone: "concise", subject: "Re: Q4", body: "OK，W2 上线。", confidence: 0.9, reason: "确认排期" },
  { id: "r2", tone: "inquisitive", subject: "Re: Q4", body: "PWA 还是 manifest?", confidence: 0.7, reason: "追问细节" },
  { id: "r3", tone: "delegate", subject: "Fwd: Q4", body: "@王然 你看一下。", confidence: 0.5, reason: "委派" },
];

beforeEach(() => { swrCacheInternal.reset(); });
describe("AiReplySuggester", () => {
  it("auto requests suggestions on idle", async () => {
    const onEnsure = vi.fn().mockResolvedValue(suggestions);
    render(
      <AiReplySuggester
        threadId="t1"
        suggestions={{ status: "idle" }}
        onEnsure={onEnsure}
        onAdopt={vi.fn()}
      />,
    );
    await waitFor(() => expect(onEnsure).toHaveBeenCalledWith("t1", 3));
  });

  it("renders tone labels and adopt buttons when ready", () => {
    render(
      <AiReplySuggester
        threadId="t1"
        suggestions={phaseReady(suggestions)}
        onEnsure={vi.fn()}
        onAdopt={vi.fn()}
      />,
    );
    expect(screen.getAllByText("简短").length).toBeGreaterThan(0);
    expect(screen.getAllByText("追问").length).toBeGreaterThan(0);
    expect(screen.getAllByText("委派").length).toBeGreaterThan(0);
    expect(screen.getByTestId("adopt-reply-1")).toBeTruthy();
    expect(screen.getByTestId("adopt-reply-2")).toBeTruthy();
    expect(screen.getByTestId("adopt-reply-3")).toBeTruthy();
  });

  it("invokes onAdopt when adopt button is clicked", () => {
    const onAdopt = vi.fn();
    render(
      <AiReplySuggester
        threadId="t1"
        suggestions={phaseReady(suggestions)}
        onEnsure={vi.fn()}
        onAdopt={onAdopt}
      />,
    );
    fireEvent.click(screen.getByTestId("adopt-reply-2"));
    expect(onAdopt).toHaveBeenCalledWith(suggestions[1]);
  });

  it("shows loading", () => {
    render(
      <AiReplySuggester
        threadId="t1"
        suggestions={phaseLoading()}
        onEnsure={vi.fn()}
        onAdopt={vi.fn()}
      />,
    );
    expect(screen.getByText(/AI 正在起草/)).toBeTruthy();
  });

  it("shows error with retry", () => {
    const onRetry = vi.fn();
    render(
      <AiReplySuggester
        threadId="t1"
        suggestions={phaseError("失败")}
        onEnsure={vi.fn()}
        onAdopt={vi.fn()}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledWith("t1");
  });
});
