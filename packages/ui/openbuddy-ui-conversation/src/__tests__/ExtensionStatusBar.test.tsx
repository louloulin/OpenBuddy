import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExtensionStatusBar } from "../ExtensionStatusBar";

describe("ExtensionStatusBar — extension status strip (phase 5)", () => {
  it("shows '无扩展' when there are no extensions", () => {
    render(<ExtensionStatusBar extensions={[]} />);
    expect(screen.getByTestId("extension-status-summary").textContent).toBe("无扩展");
  });

  it("summarizes loaded/failed/unloaded counts", () => {
    render(
      <ExtensionStatusBar
        extensions={[
          { id: "a", status: "loaded" },
          { id: "b", status: "loaded" },
          { id: "c", status: "failed", error: "boom" },
          { id: "d", status: "unloaded" },
        ]}
      />,
    );
    expect(screen.getByTestId("extension-status-summary").textContent).toContain("2 已加载");
    expect(screen.getByTestId("extension-status-summary").textContent).toContain("1 失败");
    expect(screen.getByTestId("extension-status-summary").textContent).toContain("1 未加载");
  });

  it("lists failed extensions and calls onInspect on click", () => {
    const onInspect = vi.fn();
    render(
      <ExtensionStatusBar
        extensions={[
          { id: "ok", status: "loaded" },
          { id: "bad", status: "failed", name: "broken-plugin", error: "boom" },
        ]}
        onInspect={onInspect}
      />,
    );
    const failed = screen.getByTestId("extension-status-failed");
    expect(failed).toBeInTheDocument();
    expect(failed.textContent).toContain("broken-plugin");
    fireEvent.click(screen.getByTestId("extension-status-failed-bad"));
    expect(onInspect).toHaveBeenCalledWith("bad");
  });

  it("does not render the failed list when there are no failures", () => {
    render(<ExtensionStatusBar extensions={[{ id: "a", status: "loaded" }]} />);
    expect(screen.queryByTestId("extension-status-failed")).toBeNull();
  });

  // PC-2: skeleton state when extensions is undefined (plugin discovery
  // still in flight). The skeleton must NOT render the "无扩展" empty
  // string, must mark the region aria-busy, and must be distinguishable
  // from a real empty list via data-skeleton.
  it("renders a skeleton placeholder when extensions is undefined", () => {
    render(<ExtensionStatusBar />);
    const bar = screen.getByTestId("extension-status-bar");
    expect(bar).toHaveAttribute("data-skeleton", "true");
    expect(bar).toHaveAttribute("aria-busy", "true");
    expect(bar).toHaveAttribute("aria-label", "扩展状态（加载中）");
    // Skeleton lines (shimmer placeholders), NOT the empty summary.
    expect(screen.getAllByTestId("extension-status-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("extension-status-summary")).toBeNull();
  });
});
