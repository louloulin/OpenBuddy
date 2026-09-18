/**
 * @openbuddy/ui-conversation/client — apply() 注册会话层的内置贡献。
 *
 * 注册两类东西:
 *
 *  1. **顶层 `conversation` 槽**(single / session-maybe) —— `ChatView` 本体。
 *     由 ui-layout 的 AppFrame 通过 `runtime.slots.entries("conversation")[0]`
 *     读取并渲染。
 *
 *  2. **`conversation.view` 的内置视图**(keyed / session) —— P0-4 新增。
 *     只注册 `result` / `content` 两个**增量**视图;`live` 刻意**不注册**,
 *     它走 `ChatView` 现有的转录 JSX(= fallback),这样不装任何插件时界面与
 *     改造前逐像素一致(见 `docs/plan/05-target-architecture.md` R5)。
 *
 * SlotMap 声明见 src/index.ts。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { ChatView } from "./ChatView";
import { ConversationContentView, ConversationResultView } from "./conversation-view";

/** 注册者标识,用于诊断与插件面板展示。 */
const REGISTRANT = "@openbuddy/ui-conversation";

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers = [
    ctx.slots.register(
      {
        name: "conversation",
        kind: "single",
        scope: "session-maybe",
        registrant: REGISTRANT,
      },
      ChatView as never
    ),
    // P0-4 内置视图。id 必须显式给出:它是「同一条目重复注册」的幂等判据,
    // 缺省时内核按 `<registrant>#<seq>` 派生,HMR 重挂载会丢掉跨 pass 的
    // 稳定性(见分册 05 L2)。
    ctx.slots.register(
      {
        name: "conversation.view",
        kind: "keyed",
        scope: "session",
        key: "result",
        id: "conversation.view:result",
        order: 20,
        registrant: REGISTRANT,
        payload: { label: "结果" },
      },
      ConversationResultView as never
    ),
    ctx.slots.register(
      {
        name: "conversation.view",
        kind: "keyed",
        scope: "session",
        key: "content",
        id: "conversation.view:content",
        order: 30,
        registrant: REGISTRANT,
        payload: { label: "内容" },
      },
      ConversationContentView as never
    ),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
