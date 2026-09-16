/**
 * @openbuddy/ui-settings/client — apply() 注册 HomePage + SettingsPanel。
 *
 * HomePage → "home" slot(会话未激活时显示)
 * SettingsPanel → "shell.overlay" slot(modal 形式打开)
 *
 * 另外把「设置 → 个性化」里的两行宿主控件注册成内核槽位的**默认实现**:
 *   - `settings.appearance.theme`    → ui-theme 的 ThemePicker
 *   - `settings.appearance.language` → ui-locale 的 LanguagePicker
 * 这两个槽过去是纯声明(no-impl:零注册零消费),插件想替换「主题行 / 语言行」
 * 只能改宿主源码。现在注册 + 消费都落在设置面板里,插件可以注册更高优先级实现
 * 整体替换,而内置体验不变(与 ui-experts 的 `placeholder.experts` 同一模式)。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { LanguagePicker } from "@openbuddy/ui-locale/client";
import { ThemePicker } from "@openbuddy/ui-theme/client";
import { HomePage } from "./HomePage";
import { SettingsPanel } from "./SettingsPanel";

export function apply(ctx: UiRuntimeContext): () => void {
  const disposeHome = ctx.slots.register(
    { name: "home", kind: "single", scope: "session-maybe", registrant: "@openbuddy/ui-settings" },
    HomePage as never
  );
  const disposeSettings = ctx.slots.register(
    { name: "shell.overlay", kind: "list", scope: "root", id: "settings", registrant: "@openbuddy/ui-settings" },
    SettingsPanel as never
  );
  const disposeNamedSettings = ctx.slots.register(
    { name: "overlay.settings", kind: "single", scope: "root", registrant: "@openbuddy/ui-settings" },
    SettingsPanel as never
  );
  const disposeThemeRow = ctx.slots.register(
    { name: "settings.appearance.theme", kind: "single", scope: "root", registrant: "@openbuddy/ui-settings" },
    ThemePicker as never
  );
  const disposeLanguageRow = ctx.slots.register(
    { name: "settings.appearance.language", kind: "single", scope: "root", registrant: "@openbuddy/ui-settings" },
    LanguagePicker as never
  );
  return () => {
    disposeLanguageRow();
    disposeThemeRow();
    disposeNamedSettings();
    disposeHome();
    disposeSettings();
  };
}
