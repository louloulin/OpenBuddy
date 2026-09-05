/**
 * @openbuddy/ui-files/client — apply() 注册 3 个文件面板。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { CloudStoragePanel } from "./CloudStoragePanel";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
import { MyFilesPanel } from "./MyFilesPanel";

const PANELS = [
  { name: "placeholder.cloud-storage", component: CloudStoragePanel as never },
  { name: "placeholder.knowledge-base", component: KnowledgeBasePanel as never },
  { name: "placeholder.my-files", component: MyFilesPanel as never },
];

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers = PANELS.map((p) =>
    ctx.slots.register(
      { name: p.name, kind: "single", scope: "root", registrant: "@openbuddy/ui-files" },
      p.component as never
    )
  );
  return () => { for (let i = disposers.length - 1; i >= 0; i--) disposers[i](); };
}
