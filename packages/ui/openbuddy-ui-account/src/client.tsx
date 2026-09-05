/**
 * @openbuddy/ui-account/client — apply() 注册 7 个账户面板到 keyed slot。
 *
 * 改造要点(L4 子任务 1):
 *   - 把原本 N 个独立 single-slot("placeholder.account-linking" 等)合并为一个 keyed slot
 *     "placeholder.account",通过 key 维度寻址任一面板。
 *   - 这种 keyed dispatch 让第三方插件能精确替换单一面板(按 key),且不让其它面板被无差别覆盖。
 *   - 名称保持向后兼容:每个 panel 同时注册到一个名称等同旧 slot 名的 single slot,
 *     这样遗留消费者(按旧名 slots.entries(name)[0] 取)也能继续工作,确保迁移期兼容。
 *
 * panel 索引:
 *   - "account-linking"       AccountLinkingPanel
 *   - "gateway-health"        GatewayHealthPanel
 *   - "session-management"    SessionManagementPanel
 *   - "tenant-members"        TenantMembersPanel
 *   - "tenant-policy"         TenantPolicyPanel
 *   - "token-introspection"   TokenIntrospectionPanel
 *   - "webhook-subscription"  WebhookSubscriptionPanel
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { AccountLinkingPanel } from "./AccountLinkingPanel";
import { GatewayHealthPanel } from "./GatewayHealthPanel";
import { SessionManagementPanel } from "./SessionManagementPanel";
import { TenantMembersPanel } from "./TenantMembersPanel";
import { TenantPolicyPanel } from "./TenantPolicyPanel";
import { TokenIntrospectionPanel } from "./TokenIntrospectionPanel";
import { WebhookSubscriptionPanel } from "./WebhookSubscriptionPanel";

interface PanelEntry {
  /** panel 的 key 维度(用于 keyed slot 寻址)。 */
  key: string;
  /** 历史 slot 名(single-slot 兼容层使用)。 */
  legacySlot: string;
  component: React.ComponentType<Record<string, unknown>>;
}

const PANELS: PanelEntry[] = [
  { key: "account-linking",      legacySlot: "placeholder.account-linking",      component: AccountLinkingPanel as never },
  { key: "gateway-health",       legacySlot: "placeholder.gateway-health",       component: GatewayHealthPanel as never },
  { key: "session-management",   legacySlot: "placeholder.session-management",   component: SessionManagementPanel as never },
  { key: "tenant-members",       legacySlot: "placeholder.tenant-members",       component: TenantMembersPanel as never },
  { key: "tenant-policy",        legacySlot: "placeholder.tenant-policy",        component: TenantPolicyPanel as never },
  { key: "token-introspection",  legacySlot: "placeholder.token-introspection",  component: TokenIntrospectionPanel as never },
  { key: "webhook-subscription", legacySlot: "placeholder.webhook-subscription", component: WebhookSubscriptionPanel as never },
];

/** 统一 keyed slot 名,所有 ui-account 面板聚合在此。 */
const KEYED_SLOT = "placeholder.account";

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers: Array<() => void> = [];

  for (const p of PANELS) {
    // 1) keyed slot — 精确寻址,后续插件可按 key 替换
    disposers.push(
      ctx.slots.register(
        {
          name: KEYED_SLOT,
          kind: "keyed",
          key: p.key,
          scope: "root",
          registrant: "@openbuddy/ui-account",
        },
        p.component as never
      )
    );
    // 2) 兼容层:同名 single slot — 历史消费者按旧名查 entries(name)[0] 仍可用
    disposers.push(
      ctx.slots.register(
        {
          name: p.legacySlot,
          kind: "single",
          scope: "root",
          registrant: "@openbuddy/ui-account",
        },
        p.component as never
      )
    );
  }

  return () => {
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
  };
}
