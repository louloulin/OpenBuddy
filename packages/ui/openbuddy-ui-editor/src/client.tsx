/**
 * @openbuddy/ui-editor/client — apply() 槽位注册入口。
 *
 * 注册策略:
 *   - `editor.body` 注册本包的 `TiptapEditor` 作为默认实现。宿主或第三方
 *     插件可以用更高 priority 覆盖它(例如 Notion 风格的 block 编辑器),
 *     卸载插件后自动回落到这里。
 *   - `editor.toolbar` / `editor.slash-commands` / `editor.mention-sources`
 *     是**数据型** list 槽:本包不预填任何条目,只声明契约,由插件追加。
 *     消费方就是本包的 `TiptapEditor`(`use-editor-slots.ts` 里读三个槽),
 *     所以插件"注册即可见",宿主不需要认识编辑器的私有类型。
 *
 * 为什么预填为空:编辑器是"被嵌入"的组件,内置按钮 / 内置 `/` 命令 /
 * 内置 `@` 来源都是本包自己的默认实现,写在组件里而不是槽位里 —— 槽位只
 * 承载**增量贡献**,这样卸载全部插件后编辑器仍然完整可用(退化路径清晰)。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { TiptapEditor } from "./components/TiptapEditor";
import { DraftEditor } from "./components/DraftEditor";

export function apply(ctx: UiRuntimeContext): () => void {
  const disposeBody = ctx.slots.register(
    {
      name: "editor.body",
      kind: "single",
      scope: "session-maybe",
      registrant: "@openbuddy/ui-editor",
    },
    TiptapEditor as never,
  );
  // R70 — 「📝 新草稿」入口。Modal + TiptapEditor + 应用/复制/取消 三动作面;
  // 第三方插件以更高 priority 注册同名 single 槽即可整体接管草稿 UI。
  const disposeDraft = ctx.slots.register(
    {
      name: "editor.draft",
      kind: "single",
      scope: "root",
      registrant: "@openbuddy/ui-editor",
    },
    DraftEditor as never,
  );
  return () => {
    disposeBody();
    disposeDraft();
  };
}
