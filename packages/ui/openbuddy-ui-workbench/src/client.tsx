/**
 * @openbuddy/ui-workbench/client — apply() 注册 SearchOverlay 到 shell.overlay slot。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { SearchOverlay } from "./SearchOverlay";

export function apply(ctx: UiRuntimeContext): () => void {
  // shell.overlay:向 AppFrame 这类「统一 overlay 层」消费者暴露（list 追加语义）。
  const disposeOverlay = ctx.slots.register(
    { name: "shell.overlay", kind: "list", scope: "root", id: "search", registrant: "@openbuddy/ui-workbench" },
    SearchOverlay as never
  );
  // overlay.search:给 AppShell 这样的「按名字取用」消费者一个可整体替换的入口。
  // 第三方插件注册同名单例 slot 即可接管搜索面板，无需改动 AppShell。
  const disposeNamed = ctx.slots.register(
    { name: "overlay.search", kind: "single", scope: "root", registrant: "@openbuddy/ui-workbench" },
    SearchOverlay as never
  );
  return () => { disposeNamed(); disposeOverlay(); };
}
