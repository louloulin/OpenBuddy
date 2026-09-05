/**
 * @openbuddy/ui-settings/client — apply() 注册 HomePage + SettingsPanel。
 *
 * HomePage → "home" slot(会话未激活时显示)
 * SettingsPanel → "shell.overlay" slot(modal 形式打开)
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { HomePage } from "./HomePage";
import { SettingsPanel } from "./SettingsPanel";

export function apply(ctx: UiRuntimeContext): () => void {
  const disposeHome = ctx.slots.register(
    { name: "home", kind: "single", scope: "session-maybe", registrant: "@openbuddy/ui-settings" },
    HomePage as never
  );
  const disposeSettings = ctx.slots.register(
    { name: "shell.overlay", kind: "list", scope: "root", registrant: "@openbuddy/ui-settings" },
    SettingsPanel as never
  );
  return () => {
    disposeHome();
    disposeSettings();
  };
}
