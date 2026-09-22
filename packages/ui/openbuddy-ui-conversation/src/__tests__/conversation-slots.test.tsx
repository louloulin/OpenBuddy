/**
 * conversation-slots —— `conversation.*` 子区域的接线测试。
 *
 * 这四条槽(`body` / `composer` / `toolside` / `message.markdown`)在 SlotMap 里
 * 声明了很久却**零消费者**:插件按契约实现、注册成功、界面纹丝不动。所以这里的
 * 断言分两层,缺一不可:
 *
 *   1. **回退恒等** —— 内核里没有实现时渲染的必须是接线前那套组件(卸载插件后
 *      视觉零变化,否则"可替换"就变成了"必须有插件才正常");
 *   2. **插件真的接管** —— 用真内核(`getOrCreateSingleton`)注册一条实现之后,
 *      DOM 里出现的必须是插件的内容。
 *
 * 只断言"槽位里有几条 entry"是不够的 —— 那正是这次要修的毛病。
 */
const noop = () => {};
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { SlotProvider, getOrCreateSingleton } from "@openbuddy/ui-runtime/client";
import type { ChatMessage } from "@/stores/session-store";
import {
  ConversationBody,
  ConversationComposer,
  ConversationMarkdown,
  ConversationToolSide,
} from "../conversation-slots";

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));

// 只把 `useThemeSnapshot` 换成固定 light;其余导出(尤其是 `<ThemeProvider>`)
// 必须保留真实实现 —— `<SlotProvider>` 内部会挂 ThemeProvider,整体 mock 掉会
// 让内核根本装不起来,测试就退化成"永远走 fallback"。
vi.mock("@openbuddy/ui-theme/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/ui-theme/client")>();
  return {
    ...actual,
    useThemeSnapshot: (selector: (state: { current: () => string }) => unknown) =>
      selector({ current: () => "light" }),
  };
});

const disposers: Array<() => void> = [];

/**
 * 必须挂在内核里渲染:`useSlotComponents` 走的是 `useUiRuntimeOptional()`(读
 * React context),而不是模块单例 —— 没有 `<SlotProvider>` 就等于"没装内核",
 * 此时永远走 fallback。这与真实应用一致(应用根节点就是 `<SlotProvider>`)。
 */
function mount(node: ReactNode) {
  return render(<SlotProvider>{node}</SlotProvider>);
}

function contribute(name: string, impl: unknown) {
  const rt = getOrCreateSingleton();
  disposers.push(
    rt.slots.register(
      { name, kind: "single", scope: "session-maybe", registrant: "test-plugin" },
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
  vi.restoreAllMocks();
});

describe("conversation.message.markdown", () => {
  it("内核为空时回退到内置 Markdown(非流式)", () => {
    mount(
      <ConversationMarkdown
        text="**加粗**文本"
        streaming={false}
        complete
        markdownTheme="loose"
      />,
    );
    expect(screen.getByText("加粗")).toBeTruthy();
  });

  it("内核为空时回退到 StreamingMarkdown(流式中,不跑完整 markdown 管线)", () => {
    const { container } = mount(
      <ConversationMarkdown text="半句话" streaming complete={false} markdownTheme="loose" />,
    );
    // 流式路径渲染的是纯文本行,不会出现 <strong>。
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("半句话");
  });

  it("插件可以整体接管正文渲染", () => {
    contribute("conversation.message.markdown", ({ text }: { text: string }) => (
      <div data-testid="plugin-markdown">PLUGIN:{text}</div>
    ));
    mount(
      <ConversationMarkdown
        text="原始内容"
        streaming={false}
        complete
        markdownTheme="loose"
      />,
    );
    expect(screen.getByTestId("plugin-markdown").textContent).toBe("PLUGIN:原始内容");
    // 内置渲染器不该再出现。
    expect(screen.queryByText("原始内容")).toBeNull();
  });

  it("插件实现收到完整的 props 契约(流式标记 / 主题 / 配置)", () => {
    const seen: unknown[] = [];
    contribute("conversation.message.markdown", (props: unknown) => {
      seen.push(props);
      return <div />;
    });
    mount(
      <ConversationMarkdown
        text="x"
        streaming
        complete={false}
        markdownTheme="reasoning"
        theme="dark"
      />,
    );
    expect(seen[0]).toMatchObject({
      text: "x",
      streaming: true,
      complete: false,
      markdownTheme: "reasoning",
      theme: "dark",
    });
  });
});

describe("conversation.body", () => {
  it("内核为空时原样渲染 fallback(逐字不变)", () => {
    mount(
      <ConversationBody
        timeline={[]}
        renderNode={() => null}
        streaming={false}
        virtualized={false}
        fallback={<div data-testid="fallback-body">默认转录</div>}
      />,
    );
    expect(screen.getByTestId("fallback-body")).toBeTruthy();
  });

  it("插件接管布局时会收到 timeline / renderNode / 滚动 ref", () => {
    let received: Record<string, unknown> | null = null;
    contribute("conversation.body", (props: Record<string, unknown>) => {
      received = props;
      return <div data-testid="plugin-body">PLUGIN BODY</div>;
    });
    const scrollRef = { current: null };
    mount(
      <ConversationBody
        timeline={[{ kind: "date-divider", label: "今天", key: "k" }]}
        renderNode={() => null}
        sessionId="s1"
        streaming
        virtualized={false}
        scrollRef={scrollRef}
        fallback={<div data-testid="fallback-body">默认转录</div>}
      />,
    );
    expect(screen.getByTestId("plugin-body")).toBeTruthy();
    expect(screen.queryByTestId("fallback-body")).toBeNull();
    expect(received).toMatchObject({ sessionId: "s1", streaming: true, virtualized: false });
    // renderNode 一起交出去,插件只改布局时不必自己渲染消息。
    expect(typeof (received as unknown as { renderNode: unknown }).renderNode).toBe("function");
  });
});

describe("conversation.composer", () => {
  it("内核为空时渲染 fallback(内置 Composer)", () => {
    mount(
      <ConversationComposer
        streaming={false}
        onSend={noop}
        onCancel={noop}
        fallback={<div data-testid="fallback-composer">内置输入区</div>}
      />,
    );
    expect(screen.getByTestId("fallback-composer")).toBeTruthy();
  });

  it("插件接管输入区并且不会收到 fallback 这个内部字段", () => {
    let received: Record<string, unknown> | null = null;
    contribute("conversation.composer", (props: Record<string, unknown>) => {
      received = props;
      return <div data-testid="plugin-composer">PLUGIN COMPOSER</div>;
    });
    mount(
      <ConversationComposer
        streaming
        onSend={noop}
        onCancel={noop}
        modelId="gpt-x"
        fallback={<div data-testid="fallback-composer">内置输入区</div>}
      />,
    );
    expect(screen.getByTestId("plugin-composer")).toBeTruthy();
    expect(received).toMatchObject({ streaming: true, modelId: "gpt-x" });
    expect(received as unknown as Record<string, unknown>).not.toHaveProperty("fallback");
  });
});

describe("conversation.toolside", () => {
  it("零注册时完全不占位(不给右侧面板留空盒子)", () => {
    const { container } = mount(
      <ConversationToolSide view="tool" open sessionId="s1" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("list 语义:注册多个实现时全部渲染", () => {
    contributeList("conversation.toolside", () => <div data-testid="ext-a">A</div>);
    contributeList("conversation.toolside", () => <div data-testid="ext-b">B</div>);
    mount(<ConversationToolSide view="tool" open sessionId="s1" />);
    expect(screen.getByTestId("ext-a")).toBeTruthy();
    expect(screen.getByTestId("ext-b")).toBeTruthy();
  });
});

describe("MessageItem → conversation.message.markdown", () => {
  it("插件接管后,聊天记录里的正文渲染真的换了", async () => {
    const { MessageItem } = await import("../MessageItem");
    contribute("conversation.message.markdown", ({ text }: { text: string }) => (
      <div data-testid="plugin-markdown">PLUGIN:{text}</div>
    ));
    const message: ChatMessage = {
      id: "a-1",
      role: "assistant",
      parts: [{ kind: "text", text: "**hello**" }],
      complete: true,
    };
    mount(<MessageItem message={message} streaming={false} />);
    expect(screen.getByTestId("plugin-markdown").textContent).toBe("PLUGIN:**hello**");
  });
});
