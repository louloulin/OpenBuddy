/**
 * @openbuddy/ui-billing/client — apply() 注册 5 个计费面板到 placeholder.* slot。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { BillingPanel } from "./BillingPanel";
import { CreditPricingPanel } from "./CreditPricingPanel";
import { CreditReconciliationPanel } from "./CreditReconciliationPanel";
import { CreditWalletPanel } from "./CreditWalletPanel";
import { UsageQuotaPanel } from "./UsageQuotaPanel";

const PANELS = [
  { name: "placeholder.billing", component: BillingPanel as never },
  { name: "placeholder.credit-pricing", component: CreditPricingPanel as never },
  { name: "placeholder.credit-reconciliation", component: CreditReconciliationPanel as never },
  { name: "placeholder.credit-wallet", component: CreditWalletPanel as never },
  { name: "placeholder.usage-quota", component: UsageQuotaPanel as never },
];

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers = PANELS.map((p) =>
    ctx.slots.register(
      { name: p.name, kind: "single", scope: "root", registrant: "@openbuddy/ui-billing" },
      p.component as never
    )
  );
  return () => { for (let i = disposers.length - 1; i >= 0; i--) disposers[i](); };
}
