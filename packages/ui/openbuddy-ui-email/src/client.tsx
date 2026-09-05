/**
 * @openbuddy/ui-email/client — apply() 注册 EmailPanel + EmailComposer。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { EmailPanel } from "./EmailPanel";
import { EmailComposer } from "./EmailComposer";

const PANELS = [
  { name: "placeholder.email", component: EmailPanel as never },
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
