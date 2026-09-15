/**
 * @openbuddy/ui-automation/client — apply() 注册 TasksPanel 到 shell.overlay slot。
 *
 * TasksPanel 是任务调度/灵感面板,以 modal 形式持久显示在右下角。
 * 其它子面板(QueuePanel / PlanPanel / InspirationPanel)由 PlaceholderPage 按需挂载,
 * 不在 apply() 中注册(避免初始运行时全量加载)。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { TasksPanel } from "./TasksPanel";

export function apply(ctx: UiRuntimeContext): () => void {
  const disposeOverlay = ctx.slots.register(
    { name: "shell.overlay", kind: "list", scope: "root", id: "tasks", registrant: "@openbuddy/ui-automation" },
    TasksPanel as never
  );
  const disposeNamed = ctx.slots.register(
    { name: "overlay.tasks", kind: "single", scope: "root", registrant: "@openbuddy/ui-automation" },
    TasksPanel as never
  );
  return () => { disposeNamed(); disposeOverlay(); };
}
