/**
 * @openbuddy/ui-markdown/client — apply() 是 no-op。
 *
 * Markdown 组件按需由 ui-conversation 等包直接 import,不在 apply() 中注册。
 *  如果未来需要 markdown 主题/全局语法配置,在此处通过 ctx.slots.register
 *  提供 markdown.* 命名 slot 或通过 ctx.events.emit('markdown.configure')。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";

export function apply(_ctx: UiRuntimeContext): () => void {
  return () => {};
}
