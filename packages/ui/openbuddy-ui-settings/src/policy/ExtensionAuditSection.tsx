/**
 * ExtensionAuditSection —— 「策略设置」里的插件策略审计区块(order 60)。
 *
 * 和名单区块同一条总线(`settings.policy.section`),但职责相反:
 * 上面那块是**写**策略,这块是**看** agent host 实际做出的决策。
 * 两块并排放在设置里,用户才能回答"我改了名单,到底生效了没有"。
 */
import { definePolicySection, type PolicySectionProps } from "./section-contract";
import { ExtensionAuditPanel } from "./ExtensionAuditPanel";

export const ExtensionAuditSection = definePolicySection(
  { id: "extension-audit", order: 60 },
  function ExtensionAuditSection(_props: PolicySectionProps) {
    return (
      <div className="policy-panel__section" data-testid="policy-section-extension-audit">
        {/* 这里**不**再画一遍标题:面板自带 header("插件策略审计" + 最近一次解析
            时间戳),再套一层 section-title 就成了同一个标题连着出现两次。 */}
        <ExtensionAuditPanel />
      </div>
    );
  },
);
