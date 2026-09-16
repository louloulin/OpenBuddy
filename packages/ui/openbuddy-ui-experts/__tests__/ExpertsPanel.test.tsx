import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// MarketplacePanel pulls from electron preload at import time. Provide a
// minimal stub so the component can render in a JSDOM environment.
vi.mock("@openbuddy/ui-mcp", () => ({
  MarketplacePanel: ({ sessionId, onToast }: { sessionId?: string; onToast?: (msg: string) => void }) => (
    <div data-testid="marketplace-panel" data-session-id={sessionId ?? ""}>
      Marketplace stub
    </div>
  ),
}));

import { ExpertsPanel } from "../src/ExpertsPanel";

describe("ExpertsPanel (专家·技能·连接器)", () => {
  it("默认显示 '专家' tab", () => {
    render(<ExpertsPanel />);
    const pill = screen.getByRole("tab", { name: /专家/ });
    expect(pill.getAttribute("aria-selected")).toBe("true");
  });

  it("点击 '插件·市场' tab 渲染 MarketplacePanel", () => {
    render(<ExpertsPanel sessionId="abc-123" />);
    fireEvent.click(screen.getByRole("tab", { name: /插件·市场/ }));
    // After the state update ExpertsTab unmounts and PluginsTabContent mounts
    // a fresh MarketPills; re-query so we read the post-update DOM.
    expect(screen.getByRole("tab", { name: /插件·市场/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("marketplace-panel")).toBeInTheDocument();
    expect(screen.getByTestId("marketplace-panel").getAttribute("data-session-id")).toBe("abc-123");
  });

  it("包含全部 4 个 tab 标签", () => {
    render(<ExpertsPanel />);
    expect(screen.getByRole("tab", { name: /专家/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /技能/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /连接器/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /插件·市场/ })).toBeInTheDocument();
  });

  it("tablist aria-label 覆盖全部 4 个面板", () => {
    render(<ExpertsPanel />);
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe(
      "专家·技能·连接器·插件·市场",
    );
  });
});

/**
 * R40 — 「提示说打开了连接器目录」必须真的落在连接器 tab。
 *
 * 之前 tab 是 `useState("experts")` 写死的,侧栏「腾讯文档」跳过来只能停在
 * 专家页,用户还得自己找第二个 pill。这三条用例分别覆盖三种入口时序:
 * 挂载前(存储)、挂载后(事件)、显式 prop(宿主内嵌)。
 */
describe("ExpertsPanel 子 tab 深链 (R40)", () => {
  const selectedTab = () => screen.getByRole("tablist").querySelector('[aria-selected="true"]')?.textContent ?? "";

  beforeEach(() => {
    window.localStorage.clear();
    // 切到「连接器」会真的挂载 ConnectorsTab,它在 mount 时订阅 CLI 授权日志
    // (`events.on`)。没有桥时那些订阅会抛成 unhandled error —— 这里给一份最小
    // 桥,让用例测的是真实组件而不是被 mock 掉的空壳。
    (window as unknown as { api: unknown }).api = {
      apiVersion: 1,
      invoke: async () => undefined,
      rpc: { request: async () => undefined, onMessage: () => () => void 0 },
      events: { on: () => () => void 0 },
      dialog: { open: async () => [], save: async () => null },
      debug: { enabled: false },
      clipboard: { readText: async () => "", writeText: async () => void 0 },
    };
  });

  it("initialTab 决定初始 tab(宿主内嵌时用)", () => {
    render(<ExpertsPanel initialTab="connectors" />);
    expect(selectedTab()).toContain("连接器");
  });

  it("挂载前写入的深链意图被消费,且消费后不残留(下次进入回默认)", () => {
    window.localStorage.setItem("openbuddy.market.tab", "connectors");
    const { unmount } = render(<ExpertsPanel />);
    expect(selectedTab()).toContain("连接器");
    expect(window.localStorage.getItem("openbuddy.market.tab")).toBeNull();

    unmount();
    render(<ExpertsPanel />);
    expect(selectedTab()).toContain("专家");
  });

  it("面板已在屏幕上时靠事件即时切换(不会重新挂载)", () => {
    render(<ExpertsPanel />);
    expect(selectedTab()).toContain("专家");

    act(() => {
      window.dispatchEvent(new CustomEvent("openbuddy:market-tab", { detail: "connectors" }));
    });
    expect(selectedTab()).toContain("连接器");
  });

  it("非法深链值不会把面板切走(存储脏值 / 事件脏值都拒)", () => {
    window.localStorage.setItem("openbuddy.market.tab", "skills;alert(1)");
    render(<ExpertsPanel />);
    expect(selectedTab()).toContain("专家");

    act(() => {
      window.dispatchEvent(new CustomEvent("openbuddy:market-tab", { detail: "garbage" }));
    });
    expect(selectedTab()).toContain("专家");
  });
});
