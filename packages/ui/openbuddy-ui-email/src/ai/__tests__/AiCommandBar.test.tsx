import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiCommandBar } from "../components/AiCommandBar";

beforeEach(() => { swrCacheInternal.reset(); });
describe("AiCommandBar", () => {
  it("does not render when closed", () => {
    const { container } = render(
      <AiCommandBar open={false} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders starters when open", () => {
    render(<AiCommandBar open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText(/一键清噪声/)).toBeTruthy();
    expect(screen.getByText(/整理待我回复/)).toBeTruthy();
    expect(screen.getByTestId("ai-command-input")).toBeTruthy();
  });

  it("submits when starter is clicked", () => {
    const onSubmit = vi.fn();
    render(<AiCommandBar open={true} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText(/一键清噪声/));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("submits on Enter when input has text", () => {
    const onSubmit = vi.fn();
    render(<AiCommandBar open={true} onClose={vi.fn()} onSubmit={onSubmit} />);
    const input = screen.getByTestId("ai-command-input");
    fireEvent.change(input, { target: { value: "归档噪声" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("归档噪声");
  });

  it("calls onClose when scrim clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<AiCommandBar open={true} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.click(container.querySelector(".ai-command-bar__scrim")!);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape", async () => {
    const onClose = vi.fn();
    render(<AiCommandBar open={true} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows recent prompts when provided", () => {
    render(
      <AiCommandBar
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        recentPrompts={[{ id: "r1", prompt: "上周回顾", ranAt: new Date().toISOString() }]}
      />,
    );
    expect(screen.getByText("上周回顾")).toBeTruthy();
  });
});
