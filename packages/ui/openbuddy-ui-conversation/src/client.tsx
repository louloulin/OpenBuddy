/**
 * @openbuddy/ui-conversation/client — apply() 注册会话层的内置贡献。
 *
 * 注册两类东西:
 *
 *  1. **顶层 `conversation` 槽**(single / session-maybe) —— `ChatView` 本体。
 *     由 ui-layout 的 AppFrame 通过 `runtime.slots.entries("conversation")[0]`
 *     读取并渲染。
 *
 *  2. `conversation.view` 不再注册内置视图:「结果 / 内容」两个过滤视图让
 *     视图切换条常驻顶部,却很少有人用(2026-10-31 对齐 WorkBuddy 精简)。
 *     组件仍从包入口导出,插件可按需注册;不装插件时切换条不出现。
 *
 * SlotMap 声明见 src/index.ts。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { ChatView } from "./ChatView";

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
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
