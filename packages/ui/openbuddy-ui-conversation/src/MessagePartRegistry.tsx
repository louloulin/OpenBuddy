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
import { Fragment } from "react";
import type { ComponentType } from "react";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";
import type { MessagePart } from "@openbuddy/ui-state/session-store";
import {
  defaultPartRenderers,
  type MessagePartKind,
  type MessagePartRenderProps,
} from "./parts/registry-defaults";

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
  return (
    <>
      {partsProp.map((part, i) => (
        <PartDispatcher
          key={`${messageId}-${i}-${part.kind}`}
          part={part}
          messageId={messageId}
          isStreaming={isStreaming}
          complete={complete}
          theme={theme}
          markdownConfig={markdownConfig}
          onOpenTool={onOpenTool}
          onToast={onToast}
        />
      ))}
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

/** 给测试使用:导出派发器与默认渲染器集合。 */
export const __test__ = {
  slotNameForKind,
  PartDispatcher,
};

// 内置默认值装饰,防止 eslint no-unused 报错。
void Fragment;
