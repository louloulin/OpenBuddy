/**
 * R43 — 侧栏任务/空间分组自适应滚动条测试。
 *
 * 覆盖:
 *   1. 滚动容器挂载到 .sidebar__scroll,内层是 .sidebar__scroll-inner
 *   2. 内容未溢出时,内层不带 overflow-top/bottom class
 *   3. 内容溢出后,通过 fireEvent.scroll 触发,top/bottom class 切换正确
 *   4. ResizeObserver 在 jsdom 不存在时优雅降级
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@openbuddy/ui-theme/client", () => ({
  useTheme: () => ({ setTheme: () => {}, theme: "dark" }),
}));
vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));
vi.mock("@/components/StatusIndicator", () => ({
  StatusIndicator: () => null,
}));
vi.mock("@/lib/agent/pi-client", () => ({
  piRenameSession: vi.fn(),
  piDeleteSession: vi.fn(),
  piSetSessionPinned: vi.fn(),
  piSetSessionArchived: vi.fn(),
  piSetAllSessionsArchived: vi.fn(async () => ({})),
  piRenameWorkspace: vi.fn(),
  piDeleteWorkspace: vi.fn(),
  piListSessions: vi.fn(async () => []),
  piListWorkspaces: vi.fn(async () => []),
  piNewSession: vi.fn(),
  piLoadSession: vi.fn(),
  piInit: vi.fn(),
  piDispose: vi.fn(),
  piAbort: vi.fn(),
  piPrompt: vi.fn(),
  piSteer: vi.fn(),
  piFollowUp: vi.fn(),
  piSetModel: vi.fn(),
  piSubscribe: vi.fn(() => () => {}),
  collaborationOnUpdate: () => () => {},
  collaborationSnapshot: vi.fn(async () => ({})),
  collaborationPropose: vi.fn(async () => ({})),
  collaborationExecute: vi.fn(),
  assistantFacade: {
    snapshot: vi.fn(async () => ({})),
    onUpdate: () => () => {},
    propose: vi.fn(async () => ({})),
    execute: vi.fn(),
  },
}));

import { Sidebar } from "../src/Sidebar";
import { useSessionsStore } from "@/stores/sessions-store";
import { useProjectsStore } from "@/stores/projects-store";

function makeSessions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    sessionId: `session-${i}`,
    title: `Session ${i}`,
    cwd: "",
    updatedAt: new Date(Date.now() - i * 1000).toISOString(),
    pinned: false,
    archived: false,
    status: "completed" as const,
  }));
}

function noop() {}

const PROPS = {
  onNewSession: noop,
  onSelect: noop,
  onNavigate: noop,
  onOpenSettings: noop,
  onToggleCollapse: noop,
  onToggleWorkspace: noop,
  onOpenSearch: noop,
  onPlaceholder: noop,
  activeNav: "助理",
};

describe("R43 侧栏自适应滚动条", () => {
  beforeEach(() => {
    useProjectsStore.setState({ projects: [] });
    useSessionsStore.setState({
      independent: [],
      workspaces: [],
      workspaceSessions: {},
      tasksOpen: true,
      spacesOpen: true,
      expanded: {},
      homeCwd: "",
      currentSessionId: null,
      filterStatus: null,
      filterDate: null,
      query: "",
    });
  });
  afterEach(() => cleanup());

  it("滚动容器是 .sidebar__scroll,内层是 .sidebar__scroll-inner", () => {
    useSessionsStore.setState({ independent: makeSessions(5) });
    const { container } = render(<Sidebar {...PROPS} />);
    const scroll = container.querySelector(".sidebar__scroll");
    expect(scroll).toBeTruthy();
    const inner = scroll?.querySelector(".sidebar__scroll-inner");
    expect(inner).toBeTruthy();
    // 滚动容器带有测试钩子
    expect(scroll?.getAttribute("data-testid")).toBe("sidebar-scroll");
    expect(inner?.getAttribute("data-testid")).toBe("sidebar-scroll-inner");
  });

  it("jsdom 没有 ResizeObserver 时优雅降级(不抛错)", () => {
    // 测试环境(jsdom)默认不提供 ResizeObserver,但 useEffect 里的
    // typeof 守卫必须确保 Sidebar 仍然可以 mount + render。
    useSessionsStore.setState({ independent: makeSessions(50) });
    expect(() => render(<Sidebar {...PROPS} />)).not.toThrow();
  });

  it("scrollTop=0 + 内容未溢出 → 不带 overflow class", () => {
    useSessionsStore.setState({ independent: makeSessions(3) });
    const { container } = render(<Sidebar {...PROPS} />);
    const scroll = container.querySelector(".sidebar__scroll") as HTMLElement;
    const inner = container.querySelector(".sidebar__scroll-inner") as HTMLElement;
    // jsdom 默认 clientHeight === scrollHeight 时不应触发 overflow。
    expect(scroll).toBeTruthy();
    expect(inner.classList.contains("sidebar__scroll-inner--overflow-top")).toBe(false);
    expect(inner.classList.contains("sidebar__scroll-inner--overflow-bottom")).toBe(false);
  });

  it("scroll 事件 → inner class 切换正确(模拟 scrollTop 变化)", () => {
    useSessionsStore.setState({ independent: makeSessions(20) });
    const { container } = render(<Sidebar {...PROPS} />);
    const scroll = container.querySelector(".sidebar__scroll") as HTMLElement;
    const inner = container.querySelector(".sidebar__scroll-inner") as HTMLElement;
    expect(scroll).toBeTruthy();
    expect(inner).toBeTruthy();

    // jsdom 不计算真实布局(clientHeight === 0, scrollHeight === 0),
    // 但 updateOverflow 内部读 scrollHeight / scrollTop,只要我们手动
    // 注入值,scroll listener 路径就能走到 class 切换。
    Object.defineProperty(scroll, "scrollTop", { value: 50, configurable: true });
    Object.defineProperty(scroll, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(scroll, "clientHeight", { value: 200, configurable: true });
    act(() => {
      fireEvent.scroll(scroll);
    });
    // scrollTop > 0 → top overflow 开启(上面还有内容)
    expect(inner.classList.contains("sidebar__scroll-inner--overflow-top")).toBe(true);
    // scrollTop + clientHeight (50+200=250) < scrollHeight - 1 (499) → bottom 也开
    expect(inner.classList.contains("sidebar__scroll-inner--overflow-bottom")).toBe(true);

    // 滚到底 → bottom 应该关(top 仍开,因为 scrollTop 仍 > 0)
    Object.defineProperty(scroll, "scrollTop", { value: 300, configurable: true });
    act(() => {
      fireEvent.scroll(scroll);
    });
    expect(inner.classList.contains("sidebar__scroll-inner--overflow-top")).toBe(true);
    expect(inner.classList.contains("sidebar__scroll-inner--overflow-bottom")).toBe(false);

    // 回顶 → top 也关
    Object.defineProperty(scroll, "scrollTop", { value: 0, configurable: true });
    act(() => {
      fireEvent.scroll(scroll);
    });
    expect(inner.classList.contains("sidebar__scroll-inner--overflow-top")).toBe(false);
  });
});
import { act } from "react";
