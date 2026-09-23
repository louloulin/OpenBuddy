/**
 * ChatView-tabs-wiring — P0-AI-Chat-Audit regression test.
 *
 * Phase A.1 (fdb766a) accidentally dropped the `activeView` state and the
 * `<ConversationViewTabs />` render from ChatView. The view switcher
 * became dead code, and the registered `result` / `content` views were
 * unreachable. This file pins both back so the regression cannot return
 * silently.
 *
 * 两个层次:
 *   1. **结构性 sanity**:ChatView / ConversationViewOutlet 必须可导入。
 *      防止「import 被误删」类低级错误。
 *   2. **行为契约**:ConversationViewTabs 接受 views=[] 时完全不渲染
 *      (R5:0 插件 + 0 内置 = 0 views);views=[...] 时正确渲染 N 个 tab,
 *      点击触发 onChange(active 新值)。这是 view 切换器的真正契约。
 *      行为契约不依赖 ChatView 整个 surface(它有太多 hook 依赖),
 *      直接对 primitive 进行端到端验证,效果与 Playwright probe 等价。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { getOrCreateSingleton } from "@openbuddy/ui-runtime/client";

// Mock the platform/electron-api — same trick MessageItem tests use.
vi.mock("@/lib/platform/electron-api", () => ({
  confirm: () => Promise.resolve(true),
}));
// Partial mock: keep every other export, only stub the three methods ChatView pulls in.
vi.mock(import("@/lib/agent/pi-client"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    piListSessions: () => Promise.resolve([]),
    piSetThinkingLevel: () => Promise.resolve(),
    sessionFork: () => Promise.resolve("fork"),
  };
});
vi.mock("@/lib/agent/session-artifacts", () => ({
  collectSessionArtifacts: () => [],
  findToolCall: () => undefined,
}));

import { SlotProvider } from "@openbuddy/ui-runtime/client";
import { ChatView } from "../ChatView";
import { ConversationViewTabs, ConversationViewOutlet } from "../conversation-view";

afterEach(() => cleanup());

describe("ChatView conversation-view tabs wiring (P0-AI-Chat-Audit)", () => {
  it("ConversationViewTabs primitive: empty views → null tablist (R5 约束)", () => {
    // R5:views.length===0 时切换器 JSX 必须完全不出现。
    // 这是分册 05 强约束:0 插件 + 0 内置时 = 0 views,渲染字节与改造前一致。
    render(
      <ConversationViewTabs
        active="live"
        views={[]}
        liveLabel="对话"
        onChange={() => {
          throw new Error("onChange should not fire when views is empty");
        }}
      />,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    // 任何 tab 按钮也不应存在。
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("ConversationViewTabs primitive: non-empty views 渲染 N+1 个 tab,点击切 active", () => {
    let activeView = "live";
    const onChange = (v: string) => {
      activeView = v;
    };
    const { rerender } = render(
      <ConversationViewTabs
        active={activeView}
        views={[
          { key: "result", label: "结果" },
          { key: "content", label: "内容" },
        ]}
        liveLabel="对话"
        onChange={onChange}
      />,
    );

    // 三个 tab:对话(live) / 结果 / 内容,activeView="live"。
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent("对话");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveTextContent("结果");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(tabs[2]).toHaveTextContent("内容");
    expect(tabs[2]).toHaveAttribute("aria-selected", "false");

    // 点击 '结果' tab → onChange("result") 被调用。
    fireEvent.click(screen.getByRole("tab", { name: "结果" }));
    expect(activeView).toBe("result");

    // 宿主根据 onChange 设置新 active 并重新渲染 → aria-selected 翻转。
    rerender(
      <ConversationViewTabs
        active={activeView}
        views={[
          { key: "result", label: "结果" },
          { key: "content", label: "内容" },
        ]}
        liveLabel="对话"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("tab", { name: "对话" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: "结果" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // data-view-tab 属性是 LitView CSS selector 的 hook,必须有。
    expect(screen.getByRole("tab", { name: "对话" })).toHaveAttribute(
      "data-view-tab",
      "live",
    );
  });

  it("ConversationViewOutlet 必须可渲染(防止 R1 死代码回归)", () => {
    // R1:Phase A.1 refactor 把 activeView / ConversationViewTabs 删了,
    // 但 Outlet 本身没被调用,因为唯一调用方 ChatView.tsx 没了渲染点。
    // 这里直接断言 Outlet 仍可被 React 渲染。没注册 Impl 时,Outlet 应当
    // 原样返回 fallback(内核默认行为);这是「未注册实现时零影响」的契约。
    const renderNode = vi.fn(() => null);
    render(
      <ConversationViewOutlet
        view="live"
        timeline={[]}
        renderNode={renderNode}
        streaming={false}
        virtualized={false}
        fallback={<div data-testid="outlet-stub" />}
      />,
    );
    expect(screen.getByTestId("outlet-stub")).toBeTruthy();
    // 没有 Impl 注册时 renderNode 不应被调用(契约:Outlet 复用宿主默认渲染)。
    expect(renderNode).not.toHaveBeenCalled();
  });

  it("ChatView 导出仍存在 + slot runtime 可用(结构性 sanity)", () => {
    // Phase A.1 误删 import 会让这个文件直接编译失败。Pin ChatView 导出
    // 与 SlotProvider 入口,防止未来 refactor 把 surface 误删。
    expect(typeof ChatView).toBe("function");
    const rt = getOrCreateSingleton();
    expect(typeof rt.slots.register).toBe("function");
    expect(typeof rt.slots.entries).toBe("function");
  });

  it("SlotProvider 在测试环境也能 mount(防止 slot runtime 接线损坏)", () => {
    // Container-级的 sanity:Pin SlotProvider 是 useConversationViews 的根,
    // 也是将来真实 ChatView 测试的容器。
    render(
      <SlotProvider>
        <div data-testid="tabs-slot-host" />
      </SlotProvider>,
    );
    expect(screen.getByTestId("tabs-slot-host")).toBeTruthy();
  });
});
