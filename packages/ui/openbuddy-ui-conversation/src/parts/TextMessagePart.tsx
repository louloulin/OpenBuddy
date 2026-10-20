/**
 * TextMessagePart — assistant 消息的正文 markdown 部件。
 *
 * 行为完全等价于改造前 `MessageItem.tsx:430-447` 中的 `text` part 分支:
 *   - 流式时:走轻量级 `StreamingMarkdown`(性能反不起必要)
 *   - 完成时:走完整 `Markdown` 流水线(gfm / math / katex / sanitize / lowlight)
 *
 * 通过 `ConversationMarkdown` 走 `SlotProvider`,未注册时落到内置 StreamingMarkdown / Markdown,
 * 与接线前的 JSX 行为一致 —— `MessageItem-thought-collapse.test` / `MessageItem-just-completed.test`
 * 等 snapshot 不会变化。
 */
import { useThemeSnapshot } from "@openbuddy/ui-theme/client";
import { ConversationMarkdown } from "../conversation-slots";
import type { MessagePartRenderProps } from "./registry-defaults";

export function TextMessagePart(props: MessagePartRenderProps) {
  // hook 必须在类型守卫之前调用(React 错误 300 号):虽然 MessagePartRouter 按 kind
  // 派发,但虚拟化/复用时同一位置换 kind 的部件会让 hook 数量先降后升。
  const currentTheme = useThemeSnapshot((s) => s.current());
  // 类型守卫:本部件只处理 `kind: "text"`,由 `MessagePartRouter` 在派发前保证。
  if (props.part.kind !== "text") return null;
  const resolvedTheme = (props.theme ?? currentTheme) as "light" | "dark";
  return (
    <ConversationMarkdown
      text={props.part.text}
      streaming={props.isStreaming}
      complete={props.complete}
      markdownTheme="loose"
      theme={resolvedTheme}
      config={props.markdownConfig as never}
    />
  );
}
