/**
 * @openbuddy/ui-shared/client — apply() 是 no-op。
 *
 * 该包提供跨包共享 UI 工具(McpEndpointCard / PermissionPicker / project-picker / 等),
 *  这些是消费方直接 import 的纯组件,不注册到 slot。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";

export function apply(_ctx: UiRuntimeContext): () => void {
  return () => {};
}
