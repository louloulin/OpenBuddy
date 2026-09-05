/**
 * @openbuddy/ui-conversation/client — apply() 注册 ChatView 到 conversation slot。
 *
 * SlotMap 声明见 src/index.ts(`conversation.body` / `conversation.composer` / 等)。
 * 主 ChatView 注册到顶层 `conversation` slot,由 ui-layout 的 AppFrame 通过
 * runtime.slots.entries("conversation")[0] 读取并渲染。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { ChatView } from "./ChatView";

export function apply(ctx: UiRuntimeContext): () => void {
  const dispose = ctx.slots.register(
    {
      name: "conversation",
      kind: "single",
      scope: "session-maybe",
      registrant: "@openbuddy/ui-conversation",
    },
    ChatView as never
  );
  return dispose;
}
