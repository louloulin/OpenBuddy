/**
 * conversation-slots — `conversation.*` 子区域的内核出口。
 *
 * ## 为什么必须有这个文件
 *
 * `packages/ui/openbuddy-ui-conversation/src/index.ts` 的 `SlotMap` 里长期声明着
 * `conversation.body` / `conversation.composer` / `conversation.toolside` /
 * `conversation.message.markdown` 四个槽 —— 但**没有任何消费者**。插件作者按
 * 契约实现其中任意一个,注册成功、审计通过、界面纹丝不动。声明了却没人读的
 * 契约比没有契约更糟:它把"能扩展"变成了"看起来能扩展"。
 *
 * 这里把四个槽接上真实消费者,并把 props 契约导出成类型,让插件作者在编辑器里
 * 就能看到自己会收到什么:
 *
 *   - `conversation.message.markdown`  → `ConversationMarkdown`(单条消息的
 *     markdown 正文渲染;流式/完成两态走同一个出口)
 *   - `conversation.body`              → `ConversationBody`(转录区布局:
 *     空态 / 虚拟列表 / 普通列表;宿主把默认节点渲染器一起交出去)
 *   - `conversation.composer`          → `ConversationComposer`(整块输入区)
 *   - `conversation.toolside`          → `ConversationToolSide`(右侧面板的
 *     追加区,list 语义:所有注册项都会渲染)
 *
 * ## 回退语义
 *
 * 四个出口都是"内核优先、本地实现兜底":内核里没有实现时渲染的组件与接线前
 * **完全一样**(同一个 `Markdown` / `StreamingMarkdown` / `Composer` / JSX),
 * 所以卸载插件后视觉零变化 —— 这是微内核"内置即默认插件"的一致做法。
 */
import type { ComponentType, ReactNode, RefObject } from "react";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";
import { Markdown, type MarkdownConfig, type MarkdownTheme } from "@openbuddy/ui-markdown";
import type { TimelineNode } from "@/lib/ui/timeline-utils";
import { StreamingMarkdown } from "./StreamingMarkdown";
import type { ComposerProps } from "./Composer";

// ─── conversation.message.markdown ──────────────────────────────────

export type ConversationMarkdownProps = {
  /** markdown 源码。 */
  text: string;
  /** 这条消息是否仍在流式增量中(流式时宿主默认走轻量渲染器)。 */
  streaming: boolean;
  /** 消息是否已完整结束。 */
  complete: boolean;
  markdownTheme: MarkdownTheme;
  /** 宿主 UI 主题(light/dark),供 mermaid / 图表等二次渲染使用。 */
  theme?: "light" | "dark";
  config?: MarkdownConfig;
};

/**
 * 一条消息的 markdown 正文。
 *
 * 插件可以借此换成自己的渲染器(换 markdown 引擎、加批注、加 diff 视图……),
 * 而消息气泡、操作栏、工具卡片仍由宿主负责。
 */
export function ConversationMarkdown(props: ConversationMarkdownProps): ReactNode {
  const impls = useSlotComponents("conversation.message.markdown");
  const Impl = impls[0] as ComponentType<ConversationMarkdownProps> | undefined;
  if (Impl) return <Impl {...props} />;
  // 回退:与接线前的分支逐字一致。
  if (props.streaming) {
    return <StreamingMarkdown text={props.text} markdownTheme={props.markdownTheme} />;
  }
  return (
    <Markdown
      complete={props.complete}
      markdownTheme={props.markdownTheme}
      theme={props.theme}
      config={props.config}
    >
      {props.text}
    </Markdown>
  );
}

// ─── conversation.body ──────────────────────────────────────────────

export type ConversationBodyProps = {
  /** 时间线节点(分隔符 + 消息),由宿主 `buildTimeline()` 产出。 */
  timeline: readonly TimelineNode[];
  /** 宿主的默认节点渲染器 —— 插件只改布局时可直接复用,不必自己渲染消息。 */
  renderNode: (args: { node: TimelineNode; index: number }) => ReactNode;
  sessionId?: string;
  streaming: boolean;

  /** 宿主是否在用虚拟列表渲染(插件可据此决定要不要自己虚拟化)。 */
  virtualized: boolean;
  /** 滚动容器 ref。插件若接管布局,应把这个 ref 挂到自己的滚动容器上,
   *  否则「跳到末尾 / 未读计数」会失效。 */
  scrollRef?: RefObject<HTMLElement | null>;
};

/**
 * 转录区出口。`fallback` 由宿主传入当前的默认渲染(空态 / 虚拟列表 / 列表),
 * 内核里没有实现时原样渲染 —— 所以这个包装对现有行为是零影响。
 */
export function ConversationBody({
  fallback,
  ...props
}: ConversationBodyProps & { fallback: ReactNode }): ReactNode {
  const impls = useSlotComponents("conversation.body");
  const Impl = impls[0] as ComponentType<ConversationBodyProps> | undefined;
  if (!Impl) return fallback;
  return <Impl {...props} />;
}

// ─── conversation.composer ──────────────────────────────────────────

/**
 * 输入区出口。`props` 就是宿主传给内置 `<Composer>` 的那一整包 props ——
 * 插件实现会收到完全相同的契约,因此可以"只包一层"(加自己的按钮 / 提示条)
 * 再把剩余 props 转发给内置 Composer。
 */
export function ConversationComposer({
  fallback,
  ...props
}: ComposerProps & { fallback: ReactNode }): ReactNode {
  const impls = useSlotComponents("conversation.composer");
  const Impl = impls[0] as ComponentType<ComposerProps> | undefined;
  if (!Impl) return fallback;
  return <Impl {...props} />;
}

// ─── conversation.toolside ──────────────────────────────────────────

export type ConversationToolSideProps = {
  /** 当前右侧面板视图(tool / artifacts / files / browser …)。 */
  view: string;
  sessionId?: string;
  cwd?: string;
  /** 右侧面板是否处于打开状态。 */
  open: boolean;
};

/**
 * 右侧面板的**追加区**(list 语义):每个注册项都会渲染。内置不注册任何内容,
 * 因此默认完全不占位 —— 这是给插件的"加一块自己的面板"口子,而不是替换口子。
 */
export function ConversationToolSide(props: ConversationToolSideProps): ReactNode {
  const impls = useSlotComponents("conversation.toolside");
  if (impls.length === 0) return null;
  return (
    <>
      {impls.map((impl, index) => {
        const Impl = impl as ComponentType<ConversationToolSideProps>;
        return <Impl key={index} {...props} />;
      })}
    </>
  );
}
