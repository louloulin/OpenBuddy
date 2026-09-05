/**
 * @openbuddy/ui-primitives/icons — 统一对外的图标入口
 *
 * 包内 _foundation/ 子目录持有 Icon 基底组件 + 所有图标资源(原 src/foundation/components/Icon/)。
 * 本文件做一层薄导出,让消费方统一使用 `@openbuddy/ui-primitives/icons`,
 * 不需要再相对路径跨越多层回到根 src/。
 *
 * 历史背景:
 *   - 旧位置 `src/foundation/components/Icon/`(已迁移)曾被 60+ 处 ui-* 包代码引用;
 *   - 现在 `packages/ui/openbuddy-ui-primitives` 是 Icon 体系唯一源,
 *     真正满足"packages 不要依赖 root src/"的硬约束。
 *   - 包内子目录 `_foundation/` 加下划线前缀,提示:这是包内部资产,
 *     外部 ui-* 包应只通过本入口消费。
 */

export {
  Icon,
  createIcon,
} from "./_foundation/Icon";
export type {
  IconAsset,
  IconComponentProps,
  IconSize,
  CreateIconDefaults,
} from "./_foundation/Icon";

export * from "./_foundation/icons";
