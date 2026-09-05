/**
 * @openbuddy/ui-dialogs/client — apply() 注册 AboutDialog + FolderTrustDialog。
 *
 * 两个 modal 都注册到 `shell.overlay` slot(list kind),让 ui-layout 的 AppFrame
 * 把它们作为浮动层同时渲染。其它的 dialog 组件(ConfirmDialog / PromptDialog / 等)
 * 走 dialogs.* 命名 slot(见各自子模块),由调用方通过 useDialogs() 等 hook 弹出。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { AboutDialog } from "./AboutDialog";
import { FolderTrustDialog } from "./FolderTrustDialog";

export function apply(ctx: UiRuntimeContext): () => void {
  const disposeAbout = ctx.slots.register(
    { name: "shell.overlay", kind: "list", scope: "root", registrant: "@openbuddy/ui-dialogs/about" },
    AboutDialog as never
  );
  const disposeTrust = ctx.slots.register(
    { name: "shell.overlay", kind: "list", scope: "root", registrant: "@openbuddy/ui-dialogs/folder-trust" },
    FolderTrustDialog as never
  );
  return () => {
    disposeAbout();
    disposeTrust();
  };
}
