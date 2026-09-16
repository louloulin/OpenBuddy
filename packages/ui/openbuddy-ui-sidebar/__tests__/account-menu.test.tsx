/**
 * R16 — 左下角账户菜单契约测试。
 *
 * 覆盖用户反馈的三件事:
 *   1. 点击用户按钮弹出账户菜单(而不是直接跳设置);
 *   2. 未登录时主按钮「企业登录」走历史 openAccountSettings 流程;
 *   3. 已登录时菜单提供「账户管理」+「退出登录」。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// vi.mock 工厂会被 hoist 到文件顶部,不能引用顶层 const;
// vi.hoisted 让这些桩在 mock 工厂执行前就存在。
const { noop, asyncNoop } = vi.hoisted(() => ({
  noop: () => undefined,
  asyncNoop: async () => undefined,
}));

vi.mock("@/stores/sessions-store", () => {
  const state = {
    independent: [],
    workspaces: [],
    workspaceSessions: {},
    homeCwd: "",
    currentSessionId: null,
    drafts: {},
    query: "",
    filterStatus: null,
    filterDate: null,
    showArchived: false,
    expanded: {},
  };
  const hook = (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state);
  hook.getState = () => state;
  return {
    useSessionsStore: hook,
    selectHasFilter: () => false,
    selectArchivedCount: () => 0,
  };
});

vi.mock("@/stores/session-store", () => {
  const state = { streaming: false, reset: noop };
  const hook = (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state);
  hook.getState = () => state;
  return { useSessionStore: hook };
});

vi.mock("@/stores/projects-store", () => {
  const state = { projects: [] };
  const hook = (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state);
  hook.getState = () => state;
  return { useProjectsStore: hook };
});

vi.mock("@/lib/platform/platform", () => ({ IS_MACOS: false }));

vi.mock("@/lib/agent/pi-client", () => ({
  // assistant-facade 会被 Sidebar → ui-workbench 的懒加载树间接拉起,
  // 这里只需要提供它用到的 collaboration 钩子。
  collaborationOnUpdate: noop,
  collaborationSnapshot: async () => ({ agents: [], tasks: [] }),
  collaborationPropose: async () => ({}),
  collaborationExecute: async () => ({}),
  collaborationProposeNetworkService: async () => ({}),
  calendarList: async () => [],
  piRenameSession: asyncNoop,
  piDeleteSession: asyncNoop,
  piSetSessionPinned: asyncNoop,
  piSetSessionArchived: asyncNoop,
  piSetAllSessionsArchived: asyncNoop,
  piRenameWorkspace: asyncNoop,
  piDeleteWorkspace: asyncNoop,
}));

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  getRendererPluginRuntime: () => undefined,
  useRendererSlot: () => [],
  useRendererContributions: () => [],
  RendererSlotView: () => null,
}));

vi.mock("@openbuddy/ui-slots", () => ({
  useRendererSlot: () => [],
  useRendererContributions: () => [],
  RendererSlotView: () => null,
}));

import { Sidebar } from "../src/Sidebar";

function renderSidebar(overrides: Record<string, unknown> = {}) {
  const props = {
    onNewSession: noop,
    onSelect: noop,
    onNavigate: noop,
    onOpenSettings: noop,
    onToggleCollapse: noop,
    onToggleWorkspace: noop,
    onOpenSearch: noop,
    onPlaceholder: noop,
    activeNav: "新建任务",
    ...overrides,
  };
  return render(<Sidebar {...(props as never)} />);
}

describe("R16 左下角账户菜单", () => {
  beforeEach(() => cleanup());

  it("未登录时点击用户按钮弹出账户菜单(不直接跳设置)", () => {
    const onOpenSettings = vi.fn();
    renderSidebar({ onOpenSettings, accountStatus: "signed_out" });
    const userBtn = document.querySelector(".sidebar__user") as HTMLElement;
    expect(userBtn).toBeTruthy();
    expect(document.querySelector(".sidebar__account-menu")).toBeNull();

    fireEvent.click(userBtn);
    expect(document.querySelector(".sidebar__account-menu")).not.toBeNull();
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("未登录时「企业登录」调用 onOpenAccount(历史 openAccountSettings 流程)", () => {
    const onOpenAccount = vi.fn();
    const onLogin = vi.fn();
    renderSidebar({ accountStatus: "configuration_needed", onOpenAccount, onLogin });
    fireEvent.click(document.querySelector(".sidebar__user") as HTMLElement);

    const primary = document.querySelector(".sidebar__account-menu-item--primary") as HTMLElement;
    expect(primary?.textContent?.trim()).toBe("企业登录");
    fireEvent.click(primary);
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
    expect(onLogin).not.toHaveBeenCalled();
    // 点击后菜单关闭
    expect(document.querySelector(".sidebar__account-menu")).toBeNull();
  });

  it("未登录 + 只提供 onLogin 时回退到 onLogin", () => {
    const onLogin = vi.fn();
    renderSidebar({ accountStatus: "signed_out", onLogin });
    fireEvent.click(document.querySelector(".sidebar__user") as HTMLElement);
    fireEvent.click(document.querySelector(".sidebar__account-menu-item--primary") as HTMLElement);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("已登录时菜单提供「账户管理」和「退出登录」", () => {
    const onOpenAccount = vi.fn();
    const onLogout = vi.fn();
    renderSidebar({
      accountStatus: "signed_in",
      accountLabel: "ada@example.com",
      onOpenAccount,
      onLogout,
    });
    fireEvent.click(document.querySelector(".sidebar__user") as HTMLElement);

    const items = Array.from(document.querySelectorAll(".sidebar__account-menu-item")).map(
      (el) => el.textContent?.trim(),
    );
    expect(items).toEqual(["账户管理", "退出登录"]);
    expect(document.querySelector(".sidebar__account-menu-name")?.textContent?.trim()).toBe(
      "ada@example.com",
    );

    fireEvent.click(
      Array.from(document.querySelectorAll(".sidebar__account-menu-item")).find(
        (el) => el.textContent?.trim() === "退出登录",
      ) as HTMLElement,
    );
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("用户按钮暴露 aria-haspopup=menu 与 aria-expanded 状态", () => {
    renderSidebar({ accountStatus: "signed_out" });
    const btn = document.querySelector(".sidebar__user") as HTMLElement;
    expect(btn.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(
      (document.querySelector(".sidebar__user") as HTMLElement).getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("已登录时账号名显示在用户名与副标题上", () => {
    renderSidebar({ accountStatus: "signed_in", accountLabel: "ada@example.com" });
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText("已登录")).toBeTruthy();
  });
});
