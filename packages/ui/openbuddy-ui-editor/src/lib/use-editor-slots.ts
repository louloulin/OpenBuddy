/**
 * use-editor-slots —— 把内核里的三个编辑器扩展点读成 props。
 *
 * 为什么编辑器自己消费槽位(而不是让宿主注入):
 *   `editor.body` 槽位注册的是 `TiptapEditor` 本体,宿主拿到的是一个组件,
 *   它**不知道**编辑器内部有哪些扩展点。若要求宿主把 `editor.toolbar` 的
 *   payload 一个个透传下来,宿主就得认识编辑器的私有类型 —— 耦合方向错了。
 *   编辑器在渲染点自取,插件贡献才能"注册即可见"。
 *
 * 缺内核时(单元测试 / 独立挂载)全部退化为空数组,行为与不装插件一致。
 * 依赖方向:`@openbuddy/ui-runtime/client` 是内核侧,ui-editor 只是消费者,
 * 与 ui-conversation(`Composer.tsx` 读 `plugin.command`)保持同一模式。
 */
import { useSlotPayloads } from "@openbuddy/ui-runtime/client";
import type { EditorToolbarAction } from "./toolbar-actions";
import type { EditorSlashCommandContribution } from "./slash-command";
import type { EditorMentionSource } from "./mention";

/** 插件贡献的工具栏按钮(`editor.toolbar`)。 */
export function useEditorToolbarActions(): readonly EditorToolbarAction[] {
  return useSlotPayloads<EditorToolbarAction>("editor.toolbar");
}

/** 插件贡献的 `/` 命令(`editor.slash-commands`)。 */
export function useEditorSlashCommands(): readonly EditorSlashCommandContribution[] {
  return useSlotPayloads<EditorSlashCommandContribution>("editor.slash-commands");
}

/** 插件贡献的 `@` 候选来源(`editor.mention-sources`)。 */
export function useEditorMentionSources(): readonly EditorMentionSource[] {
  return useSlotPayloads<EditorMentionSource>("editor.mention-sources");
}
