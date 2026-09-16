/**
 * @openbuddy/ui-editor/client — apply() 槽位注册入口。
 *
 * 注册策略:
 *   - `editor.body` 注册本包的 `TiptapEditor` 作为默认实现。宿主或第三方
 *     插件可以用更高 priority 覆盖它(例如 Notion 风格的 block 编辑器),
 *     卸载插件后自动回落到这里。
 *   - `editor.toolbar` / `editor.slash-commands` / `editor.mention-sources`
 *     是**数据 + 组件混合**的 list 槽:本包不预填任何条目,只声明契约,
 *     由 ui-conversation / ui-home 等消费方或插件追加。
 *
 * 为什么预填为空:编辑器是"被嵌入"的组件,工具栏按钮必须知道当前 editor
 * 实例;由宿主在渲染点用 `useSlotPayloads` 拉取条目并注入 editor,比让本包
 * 去猜宿主状态更符合 packages/ui 的解耦约定。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { TiptapEditor } from "./components/TiptapEditor";

export function apply(ctx: UiRuntimeContext): () => void {
  const dispose = ctx.slots.register(
    {
      name: "editor.body",
      kind: "single",
      scope: "session-maybe",
      registrant: "@openbuddy/ui-editor",
    },
    TiptapEditor as never,
  );
  return dispose;
}
