/**
 * @openbuddy/ui-shell/client — apply() 注册 SecondarySidebar 到 details slot、
 * StatusBar 到 shell.statusbar slot。
 *
 * TitleBar / TopbarActions / TopbarTitle 由 ui-layout 的 AppFrame 直接 import(它们是
 * 持久 chrome,不该走 slot 替换)。SecondarySidebar 是会话激活时显示的左导轨,
 * 注册到 `details` slot 让用户可以替换或扩展。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { SecondarySidebar } from "./SecondarySidebar";
import { StatusBar } from "./StatusBar";

export function apply(ctx: UiRuntimeContext): () => void {
  const disposeDetails = ctx.slots.register(
    { name: "details", kind: "single", scope: "session-maybe", registrant: "@openbuddy/ui-shell" },
    SecondarySidebar as never
  );
  // 状态栏注册进内核:宿主(ui-shell 自身)是默认实现,插件可以用更高优先级
  // 注册同名单例槽整体替换它 —— 这也是 StatusBar 文档里一直写着、但之前没接上的契约。
  const disposeStatusBar = ctx.slots.register(
    { name: "shell.statusbar", kind: "single", scope: "root", registrant: "@openbuddy/ui-shell" },
    StatusBar as never
  );
  return () => {
    disposeStatusBar();
    disposeDetails();
  };
}
