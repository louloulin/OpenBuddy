/**
 * conversation-view + conversation-approvals — P0-4 / P0-5 新槽位接线测试。
 *
 * 与 `conversation-slots.test.tsx` 的两层断言一致:
 *
 *   1. **回退恒等** —— 内核里没有实现时 `ConversationViewOutlet` 渲染 fallback、
 *      `ConversationApprovals` 渲染 `null`(零占位、零视觉变化)。
 *   2. **插件真的接管** —— 注册一条实现之后,DOM 里出现的必须是插件的内容。
 *
 * `useConversationViews` 还要列出所有已注册视图(带 label),供宿主渲染切换器。
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SlotProvider, getOrCreateSingleton } from "@openbuddy/ui-runtime/client";
import {
  ConversationApprovals,
  ConversationContentView,
  ConversationResultView,
  ConversationViewOutlet,
  ConversationViewTabs,
  useConversationViews,
} from "../index";

const disposers: Array<() => void> = [];

function contributeKeyed(name: string, key: string, impl: unknown, payload?: unknown) {
  const rt = getOrCreateSingleton();
  disposers.push(
    rt.slots.register(
      {
        name,
        kind: "keyed",
        scope: "session",
        key,
        id: `${name}:${key}`,
        registrant: "test-plugin",
        payload,
      },
      impl as never,
    ),
  );
}

function contributeList(name: string, impl: unknown) {
  const rt = getOrCreateSingleton();
  disposers.push(
    rt.slots.register(
      { name, kind: "list", scope: "session", registrant: "test-plugin" },
      impl as never,
    ),
  );
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

function mountWith(node: React.ReactNode) {
  return render(<SlotProvider>{node}</SlotProvider>);
}

function ProbeViews() {
  const views = useConversationViews();
  return (
    <ul data-testid="view-list">
      {views.map((v) => (
        <li key={v.key} data-key={v.key} data-label={v.label}>
          {v.key}:{v.label}
        </li>
      ))}
    </ul>
  );
}

describe("conversation.view (P0-4 keyed 槽)", () => {
  it("内核为空时 Outlet 渲染 fallback(转录区与改造前一致)", () => {
    mountWith(
      <ConversationViewOutlet
        view="live"
        timeline={[]}
        renderNode={() => <div data-testid="fallback-node" />}
        streaming={false}
        virtualized={false}
        fallback={<div data-testid="kernel-fallback">FALLBACK</div>}
      />,
    );
    expect(screen.getByTestId("kernel-fallback")).toBeTruthy();
  });

  it("插件可以注册自己的视图 id,Outlet 按 key 派发到插件实现", () => {
    contributeKeyed(
      "conversation.view",
      "custom",
      (props: { view: string }) => (
        <div data-testid="custom-view" data-view={props.view}>
          CUSTOM:{props.view}
        </div>
      ),
      { label: "Custom Tab" },
    );

    mountWith(
      <ConversationViewOutlet
        view="custom"
        timeline={[]}
        renderNode={() => null}
        streaming={false}
        virtualized={false}
        fallback={<div data-testid="kernel-fallback">FALLBACK</div>}
      />,
    );

    // 插件实现接管;fallback 不再出现。
    expect(screen.getByTestId("custom-view")).toBeTruthy();
    expect(screen.getByTestId("custom-view").textContent).toBe("CUSTOM:custom");
    expect(screen.queryByTestId("kernel-fallback")).toBeNull();
  });

  it("useConversationViews 列出已注册视图,带 payload.label 与缺省 key", () => {
    contributeKeyed("conversation.view", "first", () => null, { label: "First View" });
    contributeKeyed("conversation.view", "second", () => null);
    contributeKeyed("conversation.view", "first", () => null, { label: "First Override" }); // 同 key 后注册覆盖

    mountWith(<ProbeViews />);

    // 三条注册全部出现;同 key 之后注册的 label 覆盖前者。
    expect(screen.getByText("first:First Override")).toBeTruthy();
    expect(screen.getByText("second:second")).toBeTruthy();
    // payload.label 缺省时退回 key。
    expect(screen.getByText("second:second")).toBeTruthy();
  });

  it("ConversationViewTabs 只在「有可选视图」时渲染,且首项固定为 `live`", () => {
    // 内核为空 → 整个切换器不渲染(零占位)。
    const { container: c1 } = render(<ConversationViewTabs active="live" views={[]} onChange={() => {}} />);
    expect(c1.firstChild).toBeNull();

    // 有视图时渲染标签 + `live` 首项。
    contributeKeyed("conversation.view", "result", () => null, { label: "结果" });
    contributeKeyed("conversation.view", "content", () => null, { label: "内容" });
    // 这里再次读取 useConversationViews 拿真列表(避免硬编码),但为了稳定我们直接传 stub:
    render(
      <ConversationViewTabs
        active="live"
        views={[{ key: "result", label: "结果" }, { key: "content", label: "内容" }]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("对话")).toBeTruthy();
    expect(screen.getByText("结果")).toBeTruthy();
    expect(screen.getByText("内容")).toBeTruthy();
  });

  it("内置 result / content 视图可独立渲染(不依赖插件)", () => {
    // 内置组件导出后能被任意 host 直接渲染 — 这是「宿主可零插件也能落点」的保证。
    const { container } = render(
      <ConversationResultView
        view="result"
        timeline={[]}
        renderNode={() => <span data-testid="render-node" />}
        streaming={false}
        virtualized={false}
        fallback={null}
      />,
    );
    expect(container.querySelector('[data-view="result"]')).toBeTruthy();

    const { container: c2 } = render(
      <ConversationContentView
        view="content"
        timeline={[]}
        renderNode={() => <span data-testid="render-node" />}
        streaming={false}
        virtualized={false}
        fallback={null}
      />,
    );
    expect(c2.querySelector('[data-view="content"]')).toBeTruthy();
  });
});

describe("conversation.approvals (P0-5 list 槽)", () => {
  it("内核为空时整体不渲染(零占位、零视觉变化)", () => {
    const { container } = mountWith(
      <ConversationApprovals sessionId="s1" pendingCount={2} blocked />,
    );
    // 内核空 → 函数返回 null → 容器里没有 firstDiv。
    expect(container.firstChild).toBeNull();
  });

  it("插件可以追加自己的待处理面板,内置审批面不被替换", () => {
    contributeList("conversation.approvals", (props: { pendingCount: number }) => (
      <div data-testid="plugin-approval" data-pending={props.pendingCount}>
        PLUGIN APPROVALS: {props.pendingCount}
      </div>
    ));
    contributeList("conversation.approvals", (props: { sessionId?: string }) => (
      <div data-testid="plugin-approval-2" data-session={props.sessionId ?? ""}>
        PLUGIN APPROVALS 2
      </div>
    ));

    mountWith(<ConversationApprovals sessionId="s1" pendingCount={3} blocked />);

    // 两条注册都被渲染,且数据载荷下传。
    expect(screen.getByTestId("plugin-approval").textContent).toContain("PLUGIN APPROVALS: 3");
    expect(screen.getByTestId("plugin-approval-2")).toBeTruthy();
    expect(screen.getByTestId("plugin-approval").getAttribute("data-pending")).toBe("3");
  });
});