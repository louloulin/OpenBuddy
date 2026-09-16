/**
 * 内置策略区块清单 —— 注册顺序的唯一来源。
 *
 * `client.tsx` 按这份清单往 `settings.policy.section` 注册,和插件注册完全同路;
 * 谁排前面由 `definePolicySection` 的 `order` 决定,不靠数组顺序(数组顺序只是
 * 注册顺序,渲染顺序看 order)。
 */
import { ExtensionAuditSection } from "./ExtensionAuditSection";
import { ExtensionPolicySection } from "./ExtensionPolicySection";

export const EXTENSION_POLICY_SECTIONS = [
  ExtensionPolicySection,
  ExtensionAuditSection,
] as const;
