/**
 * @openbuddy/ui-hmr/client — apply() 是 no-op。
 *
 * 该包提供 useHmrPlugin hook 供 ui-* 包的 client.tsx 自行调用;
 * 它不持有自身 UI slot。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";

export function apply(_ctx: UiRuntimeContext): () => void {
  return () => {};
}
