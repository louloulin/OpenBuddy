import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionInlineCard } from "../QuestionInlineCard";
import { useQuestionStore, type QuestionRequest } from "@/features/approvals/state/question-store";
import { agentResolveUi } from "@openbuddy/client/agent-client";
vi.mock("@openbuddy/client/agent-client", () => ({ agentResolveUi: vi.fn(async () => {}) }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(agentResolveUi).mockResolvedValue(undefined); useQuestionStore.setState({ queues: {}, notices: {} }); });
const request = (patch: Partial<QuestionRequest> = {}) => useQuestionStore.getState().request({ requestId: "r", sessionId: "A", title: "选择方式", kind: "select", options: ["One", "Two"], ...patch });

describe("Pi extension inputs", () => {
  it("submits only an offered select option and dismisses after acknowledgement", async () => {
    request(); render(<QuestionInlineCard sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "Two" }));
    await waitFor(() => expect(agentResolveUi).toHaveBeenCalledWith({ sessionId: "A", requestId: "r", value: "Two" }));
    expect(screen.queryByText("选择方式")).toBeNull();
  });
  it("keeps failed requests for retry without logging their value", async () => {
    vi.mocked(agentResolveUi).mockRejectedValueOnce(new Error("IPC failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    request({ kind: "input", title: "API Key", initialValue: "" }); render(<QuestionInlineCard sessionId="A" />);
    const input = screen.getByLabelText("API Key", { selector: "input" });
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "secret-value" } }); fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("提交失败");
    expect(input).toHaveValue("secret-value"); expect(log).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    await waitFor(() => expect(screen.queryByLabelText("API Key", { selector: "input" })).toBeNull()); log.mockRestore();
  });
  it("confirms with a boolean and cancels with no input value", async () => {
    request({ kind: "confirm", title: "继续？" }); const view = render(<QuestionInlineCard sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(agentResolveUi).toHaveBeenCalledWith({ sessionId: "A", requestId: "r", value: true }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "确认" })).toBeNull());
    act(() => request({ requestId: "editor", kind: "editor", title: "编辑", initialValue: "draft" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(agentResolveUi).toHaveBeenLastCalledWith({ sessionId: "A", requestId: "editor", cancelled: true })); view.unmount();
  });
  it("clears a draft when changing requests or sessions and ignores another session dismissal", async () => {
    request({ kind: "editor", title: "编辑", initialValue: "first" });
    const view = render(<QuestionInlineCard sessionId="A" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "unsent secret" } });
    act(() => { useQuestionStore.getState().dismiss("r", "A"); request({ requestId: "second", kind: "input", title: "下一项", initialValue: "fresh" }); });
    expect(screen.getByRole("textbox")).toHaveValue("fresh");
    act(() => useQuestionStore.getState().dismiss("second", "B"));
    expect(screen.getByRole("textbox")).toHaveValue("fresh");
    view.rerender(<QuestionInlineCard sessionId="B" />); expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("expires the local form without sending a stale answer", async () => {
    vi.useFakeTimers();
    request({ kind: "input", timeoutMs: 100 }); render(<QuestionInlineCard sessionId="A" />);
    act(() => { vi.advanceTimersByTime(101); });
    expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.getByRole("status")).toHaveTextContent("超时");
    expect(agentResolveUi).not.toHaveBeenCalled(); vi.useRealTimers();
  });
});
