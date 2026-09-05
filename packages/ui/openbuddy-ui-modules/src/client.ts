/**
 * @openbuddy/ui-modules/client — apply() 是 no-op。
 *
 * 该包仅 re-export @openbuddy/renderer-host 的 ClientModuleSystem surface。
 *  ClientModuleSystem 由 renderer-plugin-runtime 在 app boot 时初始化;
 *  此处不重复注册。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";

export function apply(_ctx: UiRuntimeContext): () => void {
  return () => {};
}
