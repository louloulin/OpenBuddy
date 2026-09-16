/**
 * ExtensionPolicySection —— 「策略设置」里的插件准入名单区块(order 50)。
 *
 * 它自己只负责画标题 + 把 `ExtensionPolicyEditor` 接上宿主的 `onToast`,
 * 真正的读写逻辑在编辑器里(单一实现,不复制)。
 */
import { definePolicySection, type PolicySectionProps } from "./section-contract";
import { ExtensionPolicyEditor } from "./ExtensionPolicyEditor";

export const ExtensionPolicySection = definePolicySection(
  { id: "extension-policy", order: 50 },
  function ExtensionPolicySection({ onToast }: PolicySectionProps) {
    return (
      <div className="policy-panel__section" data-testid="policy-section-extension-policy">
        <div className="policy-panel__section-title">插件策略(Pi 扩展准入)</div>
        <ExtensionPolicyEditor onToast={onToast} />
      </div>
    );
  },
);
