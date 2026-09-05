/**
 * @openbuddy/ui-shell/client — apply() 注册 SecondarySidebar 到 details slot。
 *
 * TitleBar / TopbarActions / TopbarTitle 由 ui-layout 的 AppFrame 直接 import(它们是
 * 持久 chrome,不该走 slot 替换)。SecondarySidebar 是会话激活时显示的左导轨,
 * 注册到 `details` slot 让用户可以替换或扩展。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { SecondarySidebar } from "./SecondarySidebar";

export function apply(ctx: UiRuntimeContext): () => void {
  const dispose = ctx.slots.register(
    { name: "details", kind: "single", scope: "session-maybe", registrant: "@openbuddy/ui-shell" },
    SecondarySidebar as never
  );
  return dispose;
}
