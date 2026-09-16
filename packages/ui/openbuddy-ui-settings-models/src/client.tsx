/**
 * @openbuddy/ui-settings-models/client — 目前不向微内核注册任何东西。
 *
 * 「插件往设置面板加一节」的扩展点在**渲染端 contribution 注册表**里
 * (`settings.section`,由 `SettingsPanel` 消费,见 `useRendererSlot("settings.section")`),
 * 不在 ui-slots 微内核里。这里以前注册过一个 `settings.extension` 槽 + `() => null`
 * 组件:槽名既没有 `declare module` 的契约,也没有任何消费者,组件还是空壳 ——
 * 唯一效果是让「注册数」好看、让审计表把这块记成已实现。这种占位注册比不注册更糟,
 * 所以删掉,等真有面板时再以真实组件注册。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";

export function apply(_ctx: UiRuntimeContext): () => void {
  return () => {
    /* 无注册,无需回收 */
  };
}
