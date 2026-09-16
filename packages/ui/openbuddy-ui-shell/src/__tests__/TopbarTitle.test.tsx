import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TopbarTitle } from "../TopbarTitle";

describe("TopbarTitle", () => {
  it("renders the conversation title", () => {
    render(<TopbarTitle title="项目复盘" onRename={vi.fn()} />);
    expect(screen.getByText("项目复盘")).toBeInTheDocument();
  });

  it("renders the appVersion pill when provided", () => {
    render(<TopbarTitle title="项目复盘" onRename={vi.fn()} appVersion="0.15.0" />);
    expect(screen.getByText("v0.15.0")).toBeInTheDocument();
    expect(screen.getByLabelText("OpenBuddy 版本 0.15.0")).toBeInTheDocument();
  });

  it("does not render the version pill when appVersion is omitted", () => {
    render(<TopbarTitle title="项目复盘" onRename={vi.fn()} />);
    expect(screen.queryByLabelText(/OpenBuddy 版本/)).toBeNull();
  });

  it("falls back to 未命名会话 when title is empty", () => {
    render(<TopbarTitle title="" onRename={vi.fn()} appVersion="0.15.0" />);
    expect(screen.getByText("未命名会话")).toBeInTheDocument();
    expect(screen.getByText("v0.15.0")).toBeInTheDocument();
  });
});

describe("TopbarTitle — Phase B 增补(全部可选)", () => {
  it("不传 breadcrumb / status 时不渲染额外节点(向后兼容)", () => {
    const { container } = render(<TopbarTitle title="项目复盘" onRename={vi.fn()} />);
    expect(container.querySelector(".main-topbar__breadcrumb")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("breadcrumb 按路径渲染并标记当前页", () => {
    const { container } = render(
      <TopbarTitle title="周报" onRename={vi.fn()} breadcrumb={["项目", "调研", "周报"]} />,
    );
    const nav = container.querySelector(".main-topbar__breadcrumb");
    expect(nav).not.toBeNull();
    expect(nav?.textContent).toBe("项目/调研/周报");
    expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe("周报");
  });

  it("breadcrumb 超过 3 段折叠成 首段 / … / 末段", () => {
    const { container } = render(
      <TopbarTitle
        title="详情"
        onRename={vi.fn()}
        breadcrumb={["项目", "调研", "2026", "09", "详情"]}
      />,
    );
    expect(container.querySelector(".main-topbar__breadcrumb")?.textContent).toBe("项目/…/详情");
  });

  it("空 / 空白 breadcrumb 段被忽略", () => {
    const { container } = render(
      <TopbarTitle title="周报" onRename={vi.fn()} breadcrumb={["", "  "]} />,
    );
    expect(container.querySelector(".main-topbar__breadcrumb")).toBeNull();
  });

  it("status 传入时才渲染状态胶囊,并带上 detail", () => {
    const { container } = render(
      <TopbarTitle title="周报" onRename={vi.fn()} status="working" detail="gpt-5" />,
    );
    const status = container.querySelector('[data-tone="working"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("生成中");
    expect(status?.textContent).toContain("gpt-5");
  });

  it("status 与 appVersion 可同时出现,且标题仍可编辑", async () => {
    render(
      <TopbarTitle
        title="周报"
        onRename={vi.fn()}
        appVersion="0.16.0"
        status="ready"
        breadcrumb={["项目", "周报"]}
      />,
    );
    expect(screen.getByText("v0.16.0")).toBeInTheDocument();
    expect(screen.getByText("就绪")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("编辑标题"));
    expect(screen.getByDisplayValue("周报")).toBeInTheDocument();
  });
});
