/**
 * @openbuddy/ui-email/client — apply() 注册 EmailAiPanel + EmailComposer。
 *
 * 第 4 周(渐进迁移):把 placeholder.email 的内置实现换成 EmailAiPanel
 * (3 段 AI 闭环视图)。AiInboxShell 的 CSS 由 EmailAiPanel 在自己模块顶端
 * 直接 import,这样无论通过 slot 走哪个实现,样式都到位。
 *
 * 旧的 1632 LOC EmailPanel 仍以 `EmailPanel` 出口保留,
 * 留给 Settings → 高级邮件页(注册/规则/迁移) 等高级场景按需使用。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { EmailAiPanel } from "./ai/components/EmailAiPanel";
import { EmailComposer } from "./EmailComposer";

const PANELS = [
  { name: "placeholder.email", component: EmailAiPanel as never },
  { name: "placeholder.email-composer", component: EmailComposer as never },
];

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers = PANELS.map((p) =>
    ctx.slots.register(
      { name: p.name, kind: "single", scope: "root", registrant: "@openbuddy/ui-email" },
      p.component as never
    )
  );
  return () => { for (let i = disposers.length - 1; i >= 0; i--) disposers[i](); };
}
