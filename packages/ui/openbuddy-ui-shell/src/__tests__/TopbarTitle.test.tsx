import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopbarTitle } from "../TopbarTitle";

describe("TopbarTitle", () => {
  it("renders the conversation title", () => {
    render(<TopbarTitle title="项目复盘" onRename={vi.fn()} />);
    expect(screen.getByText("项目复盘")).toBeInTheDocument();
  });

  it("renders the appVersion pill when provided", () => {
    render(
      <TopbarTitle
        title="项目复盘"
        onRename={vi.fn()}
        appVersion="0.14.0"
      />,
    );
    expect(screen.getByText("v0.14.0")).toBeInTheDocument();
    expect(screen.getByLabelText("OpenBuddy 版本 0.14.0")).toBeInTheDocument();
  });

  it("does not render the version pill when appVersion is omitted", () => {
    render(<TopbarTitle title="项目复盘" onRename={vi.fn()} />);
    expect(screen.queryByLabelText(/OpenBuddy 版本/)).toBeNull();
  });

  it("falls back to 未命名会话 when title is empty", () => {
    render(<TopbarTitle title="" onRename={vi.fn()} appVersion="0.14.0" />);
    expect(screen.getByText("未命名会话")).toBeInTheDocument();
    expect(screen.getByText("v0.14.0")).toBeInTheDocument();
  });
});
