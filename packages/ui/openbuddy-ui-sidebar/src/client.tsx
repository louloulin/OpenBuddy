/**
 * @openbuddy/ui-sidebar/client — apply() 注册 Sidebar 到 sidebar slot。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { Sidebar } from "./Sidebar";

export function apply(ctx: UiRuntimeContext): () => void {
  const dispose = ctx.slots.register(
    { name: "sidebar", kind: "single", scope: "root", registrant: "@openbuddy/ui-sidebar" },
    Sidebar as never
  );
  return dispose;
}
