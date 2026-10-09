/**
 * registry-defaults — 内置消息部件实现注册表
 *
 * 任何 part 类型只需要在这里登记 `kind → Component` 即可被 `MessagePart` 渲染,
 * 而不需要修改 `MessageItem` 主干。新部件位于 `packages/ui/openbuddy-ui-conversation/src/parts/`。
 *
 * 设计约束:
 * 1. 全部默认实现保持与改造前 `MessageItem.tsx:430-475` 的视觉逐字一致——
 *    现有 33 个 `__tests__/*` snapshot 与 `data-testid` 不变。
 * 2. 任何插件想覆盖某个 kind,使用 `SlotProvider` 注册
 *    `conversation.message.<kind>` 槽;`MessagePartRouter` 会优先用插件实现。
 * 3. 内置默认部件仅消费 `MessagePart` 与少量通用 props,不依赖 Electron / 主进程。
 */
import type { ComponentType } from "react";
import type { MessagePart } from "@openbuddy/ui-state/session-store";
import { TextMessagePart } from "./TextMessagePart";
import { ThoughtMessagePart } from "./ThoughtMessagePart";
import { FileMessagePart } from "./FileMessagePart";
import { ToolCallMessagePart } from "./ToolCallMessagePart";

export type MessagePartRenderProps = {
  part: MessagePart;
  messageId: string;
  isStreaming: boolean;
  complete: boolean;
  theme?: "light" | "dark";
  markdownConfig?: unknown;
  onOpenTool?: (toolCallId: string) => void;
  onToast?: (msg: string) => void;
};

export type MessagePartKindMap = {
  text: ComponentType<MessagePartRenderProps>;
  thought: ComponentType<MessagePartRenderProps>;
  file: ComponentType<MessagePartRenderProps>;
  tool_call: ComponentType<MessagePartRenderProps>;
};

/**
 * 内置默认注册表:把 `MessagePart` 的四种 kind 映射到对应部件。
 * 命名与 `MessagePart["kind"]` 字面量保持一致,
 * 便于编译器在 part 类型扩展时(例如新增 `kind: "image"`)提示这里需要补一个分支。
 */
export const DEFAULT_PART_RENDERERS: MessagePartKindMap = {
  text: TextMessagePart,
  thought: ThoughtMessagePart,
  file: FileMessagePart,
  tool_call: ToolCallMessagePart,
};

/** 给 `MessagePartRegistry` 用的 kind 联合。 */
export type MessagePartKind = keyof MessagePartKindMap;

/**
 * 默认渲染器集合:暴露给 `MessagePartRegistry` 的"内置实现"。
 * 插件如果注册了同名槽位,该 kind 会优先走插件实现;否则落到这里的内置实现。
 */
export const defaultPartRenderers: Readonly<
  Record<MessagePartKind, ComponentType<MessagePartRenderProps>>
> = DEFAULT_PART_RENDERERS;
