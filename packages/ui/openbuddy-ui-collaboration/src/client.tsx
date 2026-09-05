/**
 * @openbuddy/ui-collaboration/client — apply() 注册 Projects + Subagent 面板。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { ProjectsPanel } from "./ProjectsPanel";
import { SubagentPanel } from "./SubagentPanel";

const PANELS = [
  { name: "placeholder.projects", component: ProjectsPanel as never },
  { name: "placeholder.subagent", component: SubagentPanel as never },
];

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers = PANELS.map((p) =>
    ctx.slots.register(
      { name: p.name, kind: "single", scope: "root", registrant: "@openbuddy/ui-collaboration" },
      p.component as never
    )
  );
  return () => { for (let i = disposers.length - 1; i >= 0; i--) disposers[i](); };
}
