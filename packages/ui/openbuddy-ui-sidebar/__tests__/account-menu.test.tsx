/**
 * R16 — 左下角账户菜单契约测试。
 *
 * 覆盖用户反馈的三件事:
 *   1. 点击用户按钮弹出账户菜单(而不是直接跳设置);
 *   2. 未登录时主按钮「登录」打开 Casdoor 登录对话框(R48 恢复的历史语义);
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

  it("R48 — 已配置但未登录时主按钮是「登录」,打开 Casdoor 登录对话框", () => {
    const onOpenAccount = vi.fn();
    const onLogin = vi.fn();
    renderSidebar({ accountStatus: "signed_out", onOpenAccount, onLogin });
    fireEvent.click(document.querySelector(".sidebar__user") as HTMLElement);

    const primary = document.querySelector(".sidebar__account-menu-item--primary") as HTMLElement;
    expect(primary?.textContent?.trim()).toBe("登录");
    fireEvent.click(primary);
    // R48 — 登录入口优先走 onLogin(打开 overlay.sign-in 对话框),
    //   再回落到 onOpenAccount,而不是把人送去设置表单。
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onOpenAccount).not.toHaveBeenCalled();
    // 点击后菜单关闭
    expect(document.querySelector(".sidebar__account-menu")).toBeNull();
  });

  it("R48 — 未配置时主按钮仍是「登录」,点一下必须弹出登录流程(不再只是跳设置)", () => {
    const onOpenSettings = vi.fn();
    const onOpenSettingsSection = vi.fn();
    const onOpenAccount = vi.fn();
    const onLogin = vi.fn();
    renderSidebar({
      accountStatus: "configuration_needed",
      onOpenSettings,
      onOpenSettingsSection,
      onOpenAccount,
      onLogin,
    });
    fireEvent.click(document.querySelector(".sidebar__user") as HTMLElement);

    const primary = document.querySelector(".sidebar__account-menu-item--primary") as HTMLElement;
    expect(primary?.textContent?.trim()).toBe("登录");
    fireEvent.click(primary);
    // 登录对话框内部负责"先补 Casdoor 配置再发起授权",入口本身不再分流。
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onOpenSettingsSection).not.toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("R48 — 未登录副标题去术语:不出现「企业登录」「配置企业身份服务」", () => {
    renderSidebar({ accountStatus: "configuration_needed" });
    fireEvent.click(document.querySelector(".sidebar__user") as HTMLElement);
    const head = document.querySelector(".sidebar__account-menu-sub");
    expect(head?.textContent ?? "").not.toContain("企业");
    expect(head?.textContent ?? "").toContain("数据只保存在这台机器上");
  });

  it("R48 — 左下角是单行身份条:头像 + 名字,没有第二行副标", () => {
    for (const status of ["configuration_needed", "signed_out"] as const) {
      renderSidebar({ accountStatus: status });
      expect(document.querySelector(".sidebar__user-sub")).toBeNull();
      expect(document.querySelector(".sidebar__user-chevron")).toBeNull();
      expect(document.querySelector(".sidebar__user-name")?.textContent?.trim()).toBe("OpenBuddy");
      // 状态改由圆点 + tooltip 表达,不再写一行小字。
      const dot = document.querySelector(".sidebar__user-dot");
      expect(dot?.getAttribute("data-state")).toBe(status);
      expect(document.querySelector(".sidebar__user")?.getAttribute("data-tip")).toContain("本地优先 · 开源");
      expect(document.querySelector(".sidebar__user")?.textContent ?? "").not.toContain("企业登录");
      cleanup();
    }
  });

  it("R26 — 上次登录出错时主按钮是「重新登录」", () => {
    const onOpenAccount = vi.fn();
    renderSidebar({ accountStatus: "error", onOpenAccount });
    fireEvent.click(document.querySelector(".sidebar__user") as HTMLElement);
    const primary = document.querySelector(".sidebar__account-menu-item--primary") as HTMLElement;
    expect(primary?.textContent?.trim()).toBe("重新登录");
    fireEvent.click(primary);
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
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

  it("已登录时账号名显示在身份条上,并带已登录圆点", () => {
    renderSidebar({ accountStatus: "signed_in", accountLabel: "ada@example.com" });
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(document.querySelector(".sidebar__user-dot")?.getAttribute("data-state")).toBe("signed_in");
    expect(document.querySelector(".sidebar__user")?.getAttribute("data-tip")).toContain("ada@example.com");
  });
});
