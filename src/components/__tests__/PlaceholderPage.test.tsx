import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlaceholderPage } from "../shared/PlaceholderPage";

describe("PlaceholderPage", () => {
  beforeEach(() => {
    // 面板已 React.lazy 化:每个用例首次渲染都要等 dynamic import resolve。
  });

  it("助理首页在工作台右上显示完整 Tab 菜单", async () => {
    render(<PlaceholderPage label="助理" onNavigate={() => {}} apiReady />);

    expect(await screen.findByRole("heading", { name: "助理工作台" })).toBeInTheDocument();
    expect(screen.getByLabelText("助理工作台导航")).toBeInTheDocument();
    for (const label of ["总览", "本地助理", "收件箱", "跨项目任务", "工作流", "开放网络"]) {
      expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /协作/ }));
    for (const label of ["日程", "Rooms", "助理与 Buddy"]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /治理/ }));
    for (const label of ["能力与策略", "证据与审计", "副作用恢复"]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("本地助理页面复用同一套工作台 Tab", async () => {
    const onNavigate = vi.fn();
    const onGoHome = vi.fn();
    render(<PlaceholderPage label="助理·本地助理" onNavigate={onNavigate} onGoHome={onGoHome} apiReady />);

    expect((await screen.findAllByRole("heading", { name: "本地助理" })).length).toBe(2);
    expect(screen.getByRole("tab", { name: /本地助理/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: /协作/ }));
    expect(screen.getByRole("menuitem", { name: /助理与 Buddy/ })).toBeInTheDocument();
    screen.getByRole("tab", { name: /总览/ }).click();
    expect(onNavigate).toHaveBeenCalledWith("助理");
    expect(onGoHome).not.toHaveBeenCalled();
  });

  it("对失效的助理子路由保留工作台菜单", async () => {
    render(<PlaceholderPage label="助理·已卸载扩展" onNavigate={() => {}} apiReady />);

    expect(await screen.findByRole("heading", { name: "助理工作台" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "助理工作台导航" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /跨项目任务/ })).toBeInTheDocument();
  });

  it("未实现的功能显示占位文案", async () => {
    // 助理/项目/专家·技能·连接器/自动化/更多 都已接入真实面板，不再走占位。
    // 用一个未映射的 label 触发兜底分支(静态内容,不经过 lazy)。
    render(<PlaceholderPage label="某个未实现功能" />);
    expect(screen.getByText("某个未实现功能")).toBeInTheDocument();
    expect(screen.getByText(/当前入口未配置可用功能/)).toBeInTheDocument();
  });
});

// 插件·市场 现在归在"专家·技能·连接器"视图下作为 MarketPills 的子 tab,
// 所以单独路由 "插件·市场" 已被移除。这里用兜底分支确认旧导航不再生效。
it("'插件·市场' 不再是独立路由,落到占位兜底", () => {
  render(<PlaceholderPage label="插件·市场" onNavigate={() => {}} />);
  expect(screen.getByText("当前入口未配置可用功能。")).toBeInTheDocument();
});
