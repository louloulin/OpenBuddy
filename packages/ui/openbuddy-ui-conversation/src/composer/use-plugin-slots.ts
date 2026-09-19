/**
 * composer/use-plugin-slots — owns the renderer-slot / slot-payload wiring for
 * the Composer's pluggable toolbars (contributions, slots, toolbar actions,
 * and command payloads).
 *
 * Goal mu7rpkze-gc769z / phase3-composer-split. The slot wiring used to live
 * inline in `Composer.tsx` (~40 lines). Phase-3 split moved it into this hook
 * so the orchestrator file stays under the 800-line cap.
 */
import { useRendererContributions, useRendererSlot } from "@/lib/runtime/renderer-plugin-runtime";
import { RendererSlotView, type PluginCommandPayload } from "@openbuddy/ui-workbench";
import { useSlotPayloads } from "@openbuddy/ui-runtime/client";

export interface UsePluginSlotsArgs {
  pluginCommandsRef?: unknown;
}

export interface UsePluginSlotsResult {
  pluginComposerContributions: ReturnType<typeof useRendererContributions>;
  pluginComposerSlots: ReturnType<typeof useRendererSlot>;
  pluginToolbarActions: ReturnType<
    typeof useSlotPayloads<{
      id: string;
      label: string;
      icon?: React.ReactNode;
      description?: string;
      insertText?: string;
      placeholder?: string;
      onClick?: (ctx: { insertText: (text: string) => void }) => void;
      onActivate?: () => void;
    }>
  >;
  pluginCommands: PluginCommandPayload[];
}

export function usePluginSlots(_args: UsePluginSlotsArgs = {}): UsePluginSlotsResult {
  const pluginComposerContributions = useRendererContributions("composer");
  const pluginComposerSlots = useRendererSlot("conversation.input.dock");
  // 插件贡献的工具栏按钮(\`composer.toolbar.action\` slot)。
  // 数据型贡献：插件只描述按钮长什么样、点了做什么，UI 由 Composer 渲染。
  const pluginToolbarActions = useSlotPayloads<{
    id: string;
    label: string;
    icon?: React.ReactNode;
    description?: string;
    insertText?: string;
    placeholder?: string;
    onClick?: (ctx: { insertText: (text: string) => void }) => void;
    onActivate?: () => void;
  }>("composer.toolbar.action");

  /**
   * Plugin SDK 注册的命令(内核 \`plugin.command\` 的数据型 payload)。
   * 它们既能出现在 \`/\` 补全菜单里,也在发送路径上被识别成「渲染端动作」而不是
   * 要发给 agent 的 prompt —— 否则插件注册的命令永远只能靠 ⌘K 才能执行。
   */
  const pluginCommands = useSlotPayloads<PluginCommandPayload>("plugin.command");

  return { pluginComposerContributions, pluginComposerSlots, pluginToolbarActions, pluginCommands };
}
