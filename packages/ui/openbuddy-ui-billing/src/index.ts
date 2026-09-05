/**
 * @openbuddy/ui-billing — 统一对外入口
 *
 * 计费与配额层。包含账单面板、积分定价、积分对账、积分钱包、用量配额等面板。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染
 *   - 公共工具 (Utilities)    → 函数 / 常量 / hooks,无 JSX 输出
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client        → apply() 槽位注册入口(由 ui-runtime 在 SlotProvider 挂载时调用)
 *   - ./invariant     → 不变式同伴(debug 模式下激活)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
export { BillingPanel } from "./BillingPanel";
export { CreditPricingPanel } from "./CreditPricingPanel";
export { CreditReconciliationPanel } from "./CreditReconciliationPanel";
export { CreditWalletPanel } from "./CreditWalletPanel";
export { UsageQuotaPanel } from "./UsageQuotaPanel";
