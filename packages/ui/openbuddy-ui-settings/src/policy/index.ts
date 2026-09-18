/**
 * policy/ —— 「策略设置」的区块总线实现。
 *
 * 内置两个区块(插件准入名单 / 插件策略审计)也走 `settings.policy.section`
 * 槽位注册,而不是写死在 `PolicySettingsPanel` 里 —— 插件可以再追加自己的
 * 策略区块,或者用更高优先级顶掉这两块中的任意一块。
 */
export {
  POLICY_SECTION_IDS,
  definePolicySection,
  readPolicySectionMeta,
} from "./section-contract";
export type {
  PolicySectionComponent,
  PolicySectionMeta,
  PolicySectionProps,
} from "./section-contract";
export { ExtensionAuditPanel } from "./ExtensionAuditPanel";
export type { ExtensionAuditPanelProps } from "./ExtensionAuditPanel";
export { ExtensionPolicyEditor } from "./ExtensionPolicyEditor";
export type { ExtensionPolicyEditorProps } from "./ExtensionPolicyEditor";
export { ExtensionPolicySection } from "./ExtensionPolicySection";
export { ExtensionAuditSection } from "./ExtensionAuditSection";
export { EXTENSION_POLICY_SECTIONS } from "./sections";
