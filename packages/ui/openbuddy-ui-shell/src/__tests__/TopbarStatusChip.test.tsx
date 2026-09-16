import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopbarStatusChip } from "../TopbarStatusChip";

describe("TopbarStatusChip", () => {
  it("渲染 label / detail 与 tone 标记", () => {
    render(<TopbarStatusChip tone="ready" label="就绪" detail="gpt-5" />);
    expect(screen.getByText("就绪")).toBeInTheDocument();
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.getByRole("status").closest('[data-tone="ready"]')).not.toBeNull();
  });

  it("只有 working 状态带 aria-live=polite", () => {
    const { unmount } = render(<TopbarStatusChip tone="working" label="生成中" />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    unmount();

    render(<TopbarStatusChip tone="offline" label="离线" />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBeNull();
  });

  it("tooltip 优先用 detail", () => {
    const { unmount } = render(<TopbarStatusChip tone="ready" label="就绪" detail="队列 0" />);
    expect(document.querySelector('[data-tip="就绪 · 队列 0"]')).not.toBeNull();
    unmount();

    render(<TopbarStatusChip tone="ready" label="就绪" />);
    expect(document.querySelector('[data-tip="就绪"]')).not.toBeNull();
  });

  it("有 onClick 时渲染成可点击按钮并保留 status 语义", () => {
    const onClick = vi.fn();
    render(<TopbarStatusChip tone="error" label="出错" detail="桥断开" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "出错，桥断开" });
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    // role=status 仍在内层,读屏器能拿到状态播报。
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("pulse 默认只在 working 打开,可显式覆盖", () => {
    const { unmount } = render(<TopbarStatusChip tone="working" label="生成中" />);
    expect(document.querySelector('[data-tone="working"]')?.getAttribute("data-pulse")).toBe(
      "true",
    );
    unmount();

    const idle = render(<TopbarStatusChip tone="ready" label="就绪" />);
    expect(document.querySelector('[data-tone="ready"]')?.getAttribute("data-pulse")).toBe("false");
    idle.unmount();

    render(<TopbarStatusChip tone="working" label="生成中" pulse={false} />);
    expect(document.querySelector('[data-tone="working"]')?.getAttribute("data-pulse")).toBe(
      "false",
    );
  });
});
