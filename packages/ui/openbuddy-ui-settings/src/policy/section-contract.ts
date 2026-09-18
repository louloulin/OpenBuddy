/**
 * section-contract —— 「策略设置」区块(plugin section)的数据契约。
 *
 * 与 `@openbuddy/ui-library` 的 `library.section` 同构,理由也一样:
 *   策略设置面板 = 一串纵向区块(模型白名单 / 技能上传 / 权限模式 / 禁用功能 / …)。
 *   这些区块**都**应该能由插件追加 —— Pi 扩展的准入名单、插件策略决策审计,
 *   本来就是插件域的东西,不该写死在 `ui-settings` 里。
 *
 * 约定(见 packages/ui/AGENTS.md):
 *   - 注册值仍然是**组件**;
 *   - 区块元数据(叫什么、排第几)挂在组件上,由 `definePolicySection` 完成;
 *   - 区块自己负责画标题 —— 宿主不替它渲染标题,所以"标题能不能点/带不带徽标"
 *     这种自由度留给区块作者。
 */
import type { ComponentType } from "react";

/** 宿主交给每个策略区块的 props。 */
export interface PolicySectionProps {
  /** 瞬时反馈(成功 / 失败提示)。 */
  onToast?: (message: string) => void;
}

/** 区块元数据。 */
export interface PolicySectionMeta {
  /** 稳定 id,同时是测试锚点(`policy-section-<id>`)。 */
  id: string;
  /** 排序权重,小的靠前;缺省 0。 */
  order?: number;
}

/** 带元数据的区块组件(组件本身 + 挂在它上面的元数据)。 */
export type PolicySectionComponent = ComponentType<PolicySectionProps> & {
  readonly policySection: PolicySectionMeta;
};

/**
 * 给区块组件挂上元数据 —— 注册到 `settings.policy.section` 前必须调用。
 *
 * ```tsx
 * export const MyPolicySection = definePolicySection(
 *   { id: "my-policy", order: 100 },
 *   function MyPolicySection({ onToast }) { ... },
 * );
 * ```
 */
export function definePolicySection(
  meta: PolicySectionMeta,
  Component: ComponentType<PolicySectionProps>,
): PolicySectionComponent {
  Object.defineProperty(Component, "policySection", {
    value: meta,
    enumerable: true,
    configurable: true,
  });
  return Component as unknown as PolicySectionComponent;
}

/** 从槽位注册值里读出区块元数据;不是区块组件时返回 null(宿主会跳过它)。 */
export function readPolicySectionMeta(value: unknown): PolicySectionMeta | null {
  if (typeof value !== "function") return null;
  const meta = (value as Partial<PolicySectionComponent>).policySection;
  if (!meta || typeof meta.id !== "string" || meta.id.length === 0) return null;
  return meta;
}

/** 内置区块的 id 常量(宿主与测试共用的单一来源)。 */
export const POLICY_SECTION_IDS = {
  extensionPolicy: "extension-policy",
  extensionAudit: "extension-audit",
} as const;
