import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { agentQuickAnswer } from "@openbuddy/client/agent-client";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { QuickQaSheet } from "../QuickQaSheet";

vi.mock("@openbuddy/client/agent-client", () => ({
  agentQuickAnswer: vi.fn(async () => ({ sessionId: "qa-1" })),
}));

describe("快速问答 (G1-31)", () => {
  it("shows the quoted fragment and asks in its own session", async () => {
    render(
      <ThemeProvider>
        <QuickQaSheet quote="引用的一段内容" cwd="/ws" modelId="model:fixture/fixture" onClose={vi.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByText("引用的一段内容")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "快速问答的问题" }), { target: { value: "这段在说什么" } });
    fireEvent.click(screen.getByRole("button", { name: "提问" }));
    await waitFor(() => expect(agentQuickAnswer).toHaveBeenCalledWith({
      prompt: "这段在说什么",
      context: "引用的一段内容",
      cwd: "/ws",
      modelId: "model:fixture/fixture",
    }));
  });

  it("does not send an empty question", () => {
    render(<ThemeProvider><QuickQaSheet quote="x" onClose={vi.fn()} /></ThemeProvider>);
    expect(screen.getByRole("button", { name: "提问" })).toBeDisabled();
  });
});
