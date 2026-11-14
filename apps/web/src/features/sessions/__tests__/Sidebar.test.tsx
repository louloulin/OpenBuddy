import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../Sidebar";
import { useSessionsStore } from "@/features/sessions/state/sessions-store";

const base = {
  onNewSession: vi.fn(),
  onSelect: vi.fn(),
  onNavigate: vi.fn(),
  onOpenSettings: vi.fn(),
  onToggleCollapse: vi.fn(),
  onToggleWorkspace: vi.fn(),
  onOpenSearch: vi.fn(),
  onPlaceholder: vi.fn(),
  activeNav: "新建任务",
};

describe("Sidebar", () => {
  it("渲染导航项", () => {
    render(<Sidebar {...base} />);
    for (const label of ["新建任务", "项目", "技能与 MCP", "更多"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("点击占位导航触发 onNavigate", () => {
    const onNavigate = vi.fn();
    render(<Sidebar {...base} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("技能与 MCP"));
    expect(onNavigate).toHaveBeenCalledWith("技能与 MCP");
  });

  it("渲染会话列表并可选中", () => {
    const onSelect = vi.fn();
    // cwd-less session ⇒ 任务 group (independent). onSelect now also receives cwd.
    useSessionsStore.getState().setIndependent([{ sessionId: "s1", title: "测试会话", cwd: "" } as any]);
    render(<Sidebar {...base} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("测试会话"));
    expect(onSelect).toHaveBeenCalledWith("s1", "");
    useSessionsStore.getState().setIndependent([]);
  });

  it("搜索按钮打开任务搜索(Ctrl/Cmd+K),设置按钮可打开", () => {
    const onOpenSearch = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <Sidebar {...base} onOpenSearch={onOpenSearch} onOpenSettings={onOpenSettings} />
    );
    fireEvent.click(screen.getByRole("button", { name: "搜索任务" }));
    expect(onOpenSearch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("收起侧边栏按钮触发 onToggleCollapse", () => {
    const onToggleCollapse = vi.fn();
    render(<Sidebar {...base} onToggleCollapse={onToggleCollapse} />);
    fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(onToggleCollapse).toHaveBeenCalled();
  });

  it("更多菜单隐藏暂缓功能并保留文件入口", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar {...base} onNavigate={onNavigate} />);
    await user.hover(screen.getByText("更多"));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    for (const label of ["灵感", "云存储", "专家·技能·连接器", "自动化", "腾讯文档"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    fireEvent.click(screen.getByText("我的文件"));
    expect(onNavigate).toHaveBeenCalledWith("我的文件");
  });
});
