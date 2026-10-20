/**
 * MessagePartRegistry — 统一的消息部件派发中心。
 *
 * 把 `ChatMessage.parts: MessagePart[]` 按 `kind` 派发到对应渲染器。
 *
 * 派发顺序:
 *   1. 插件通过 `useSlotComponents("conversation.message.<kind>")` 注册的实现(若存在)
 *   2. 内置默认实现(`defaultPartRenderers[kind]`)
 *   3. 未注册时:返回 `null`,调用方决定是否需要 fallback 占位
 *
 * 设计要点:
 *   - 完全等价于改造前 `MessageItem.tsx:430-475` 的 if-else 派发链,
 *     现有 snapshot 测试保持不变。
 *   - 新增 part 类型时,只需:
 *       (a) 在 `@openbuddy/ui-state/session-store` 的 `MessagePart` 联合中加新分支
 *       (b) 在 `parts/` 下写一个新组件
 *       (c) 在 `parts/registry-defaults.tsx` 的 `MessagePartKindMap` 中加上对应字段
 *       (d) 把 `parts/MessagePartKind` 联合扩展
 *     即可;`MessageItem` 与 `ChatView` 主干不需要改。
 */
import { Fragment, useMemo } from "react";
import type { ComponentType } from "react";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";
import type { MessagePart } from "@openbuddy/ui-state/session-store";
import {
  defaultPartRenderers,
  type MessagePartKind,
  type MessagePartRenderProps,
} from "./parts/registry-defaults";
import { ToolGroupSummary } from "./parts/ToolGroupSummary";
import { buildPartRenderables } from "@/lib/ui/message-part-renderables";

/**
 * `MessagePartRegistry` — 渲染一条消息的所有 parts。
 *
 * 用法:
 *   <MessagePartRegistry
 *     messageId={message.id}
 *     parts={message.parts}
 *     isStreaming={streaming}
 *     complete={message.complete}
 *     onOpenTool={openTool}
 *     onToast={onToast}
 *   />
 */
export function MessagePartRegistry({
  parts: partsProp,
  isStreaming,
  messageId,
  complete,
  theme,
  markdownConfig,
  onOpenTool,
  onToast,
}: Omit<MessagePartRenderProps, "part"> & {
  parts: readonly MessagePart[];
  messageId: string;
}) {
  // Plan5 B.9 — consecutive tool_calls that started within the same window
  // collapse into ONE `ToolGroupSummary` row ("3 个工具并行") instead of
  // three stacked cards. Everything else keeps the flat 1:1 dispatch, so the
  // rendered DOM of a serial transcript is byte-for-byte what it was.
  const partRenderables = useMemo(() => buildPartRenderables(partsProp), [partsProp]);

  return (
    <>
      {partRenderables.map((item, i) => {
        if (item.type === "cluster") {
          return (
            <ToolGroupSummary
              key={`${messageId}-cluster-${i}-${item.cluster.toolCallIds.join("_")}`}
              cluster={item.cluster}
              onOpenTool={(tc) => onOpenTool?.(tc.toolCallId)}
            />
          );
        }
        return (
          <PartDispatcher
            key={`${messageId}-${i}-${item.part.kind}`}
            part={item.part}
            messageId={messageId}
            isStreaming={isStreaming}
            complete={complete}
            theme={theme}
            markdownConfig={markdownConfig}
            onOpenTool={onOpenTool}
            onToast={onToast}
          />
        );
      })}
    </>
  );
}

/**
 * 单个 part 派发:优先尝试插件实现,其次内置默认实现。
 */
function PartDispatcher(props: MessagePartRenderProps) {
  const kind = props.part.kind as MessagePartKind;
  // 插件通过 SlotProvider 注册的实现;运行时未注册时 impls 为空数组。
  // 我们只接受与 kind 匹配的槽位(命名约定:conversation.message.<kind>)。
  const slotName = slotNameForKind(kind);
  const impls = useSlotComponents(slotName);
  const PluginImpl = impls[0] as ComponentType<MessagePartRenderProps> | undefined;
  const DefaultImpl = defaultPartRenderers[kind];
  const Impl = PluginImpl ?? DefaultImpl;
  if (!Impl) return null;
  return (
    <Impl
      part={props.part}
      messageId={props.messageId}
      isStreaming={props.isStreaming}
      complete={props.complete}
      theme={props.theme}
      markdownConfig={props.markdownConfig}
      onOpenTool={props.onOpenTool}
      onToast={props.onToast}
    />
  );
}

/** `text` → `conversation.message.text` 等。 */
function slotNameForKind(kind: MessagePartKind): string {
  return `conversation.message.${kind}`;
}

/** 兼容旧引用:分组算法已抽到 `@/lib/ui/message-part-renderables`。 */
export { buildPartRenderables as buildRenderables } from "@/lib/ui/message-part-renderables";
export type { PartRenderable } from "@/lib/ui/message-part-renderables";

/** 给测试使用:导出派发器与默认渲染器集合。 */
export const __test__ = {
  slotNameForKind,
  PartDispatcher,
};

// 内置默认值装饰,防止 eslint no-unused 报错。
void Fragment;
