/**
 * @openbuddy/ui-settings-models/client — apply() 注册扩展设置面板到 placeholder.* slot。
 *
 * 该包让第三方插件可声明设置扩展;自身没有 UI 主面板,但暴露 slot 命名空间。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";

export function apply(ctx: UiRuntimeContext): () => void {
  // 当前 settings-models 还没有具体 panel;声明扩展 slot 让第三方注入。
  const dispose = ctx.slots.register(
    {
      name: "settings.extension",
      kind: "list",
      scope: "root",
      registrant: "@openbuddy/ui-settings-models",
    },
    (() => null) as never
  );
  return dispose;
}
