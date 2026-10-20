/**
 * ToolCallMessagePart — 消息中的工具调用卡片部件。
 *
 * 与 `MessageItem.tsx` 改造前的 tool_call 分支保持一致:
 *   - 始终渲染一个 `<ToolCallCard>`(compact 模式 + onOpen 回调)
 *   - 把回调透传给 `onOpenTool`,由 ChatView 决定打开侧栏还是 inline 展开
 */
import { ToolCallCard } from "../ToolCallCard";
import type { MessagePartRenderProps } from "./registry-defaults";

export function ToolCallMessagePart(props: MessagePartRenderProps) {
  if (props.part.kind !== "tool_call") return null;
  const tc = props.part.toolCall;
  return (
    <ToolCallCard
      tc={tc}
      onOpen={(t) => props.onOpenTool?.(t.toolCallId)}
    />
  );
}
