/**
 * @openbuddy/ui-workbench/client — apply() 注册 SearchOverlay 到 shell.overlay slot。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { SearchOverlay } from "./SearchOverlay";

export function apply(ctx: UiRuntimeContext): () => void {
  const dispose = ctx.slots.register(
    { name: "shell.overlay", kind: "list", scope: "root", registrant: "@openbuddy/ui-workbench" },
    SearchOverlay as never
  );
  return dispose;
}
