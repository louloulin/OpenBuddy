import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "@openbuddy/ui-sidebar";
import { useSessionsStore } from "@/stores/sessions-store";

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
  it("渲染导航项(主导航只留四项,对齐 WorkBuddy)", () => {
    render(<Sidebar {...base} />);
    for (const label of ["新建任务", "专家·技能·连接器", "自动化", "更多"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // 助理 / 项目 / 邮件 / 记忆 收进「更多 → 工作区」,菜单未打开时不在主导航。
    for (const label of ["助理", "项目", "邮件", "记忆"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("「更多 → 工作区」打开助理 / 项目 / 邮件 / 记忆", () => {
    const onNavigate = vi.fn();
    render(<Sidebar {...base} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("更多"));
    expect(screen.getByText("工作区")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "助理" }));
    // 助理落在本地助理视图(工作台顶部 tabs 切换其他子页)。
    expect(onNavigate).toHaveBeenCalledWith("助理·本地助理");
    for (const label of ["项目", "邮件", "记忆"]) {
      fireEvent.click(screen.getByText("更多"));
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
      expect(onNavigate).toHaveBeenLastCalledWith(label);
    }
  });

  it("当前页是工作区入口时,「更多」显示为选中", () => {
    render(<Sidebar {...base} activeNav="助理·本地助理" />);
    expect(screen.getByText("更多").closest("button")).toHaveClass("sidebar__nav-item--active");
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

  it("任务与空间折叠按钮暴露展开状态", () => {
    render(<Sidebar {...base} />);
    const tasks = screen.getByRole("button", { name: /^任务/ });
    const spaces = screen.getByRole("button", { name: /^空间/ });
    expect(tasks).toHaveAttribute("aria-expanded", "true");
    expect(spaces).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(tasks);
    expect(tasks).toHaveAttribute("aria-expanded", "false");
  });

  it("搜索按钮触发 onOpenSearch,设置按钮触发 onOpenSettings", () => {
    const onOpenSearch = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <Sidebar {...base} onOpenSearch={onOpenSearch} onOpenSettings={onOpenSettings} />
    );
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
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

  it("hover「更多」展开右侧菜单并可进入灵感", () => {
    const onNavigate = vi.fn();
    render(<Sidebar {...base} onNavigate={onNavigate} />);
    fireEvent.mouseEnter(screen.getByText("更多").closest(".sidebar__more-wrap")!);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("我的文件")).toBeInTheDocument();
    expect(screen.getByText("腾讯文档")).toBeInTheDocument();
    expect(screen.getByText("知识库")).toBeInTheDocument();
    expect(screen.getByText("乐享知识库")).toBeInTheDocument();
    expect(screen.getByText("网页预览")).toBeInTheDocument();
    expect(screen.getByText("灵感")).toBeInTheDocument();
    fireEvent.click(screen.getByText("灵感"));
    expect(onNavigate).toHaveBeenCalledWith("灵感");
  });

  it("「更多」菜单可进入知识库", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar {...base} onNavigate={onNavigate} onToast={vi.fn()} />);
    await user.hover(screen.getByText("更多"));
    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    fireEvent.click(screen.getByText("知识库"));
    expect(onNavigate).toHaveBeenCalledWith("知识库");
  });
});
