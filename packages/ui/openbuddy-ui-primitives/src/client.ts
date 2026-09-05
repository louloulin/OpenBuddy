/**
 * @openbuddy/ui-primitives/client — apply() 注册 Toast 到 notifications slot。
 *
 * Toast 是全局 toast 通知,通过 shell.overlay 旁路(named `notifications`)注册,
 * 让 ui-layout 的 AppFrame 把 Toast 与其它 overlay 分开渲染(z-index 更高)。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { Toast } from "./components/Toast";

export function apply(ctx: UiRuntimeContext): () => void {
  const dispose = ctx.slots.register(
    { name: "notifications", kind: "list", scope: "root", registrant: "@openbuddy/ui-primitives" },
    Toast as never
  );
  return dispose;
}
