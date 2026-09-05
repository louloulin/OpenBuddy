/**
 * @openbuddy/ui-experts — 统一对外入口
 *
 * 专家(Experts)配置层。管理与调用场景化专家模板、提示词、工具集的 UI 入口。
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
import type { SlotMap } from "@openbuddy/ui-slots";

export type { SlotMap };

export { ExpertsPanel } from "./ExpertsPanel";
export { MarketPills } from "./MarketHeader";
export type { MarketTab } from "./MarketHeader";

// experts/
export { ExpertsTab } from "./experts/ExpertsTab";
export { ExpertCard } from "./experts/ExpertCard";
export { ExpertDetailModal } from "./experts/ExpertDetailModal";
export { FeaturedScenes } from "./experts/FeaturedScenes";
export { MyExpertsEmpty } from "./experts/MyExpertsEmpty";

// skills/
export { SkillsTab } from "./skills/SkillsTab";
export { SkillCatalogCard } from "./skills/SkillCatalogCard";
export { SkillCard } from "./skills/SkillCard";
export { SkillDetailModal } from "./skills/SkillDetailModal";
export { ImportSkillModal } from "./skills/ImportSkillModal";

// connectors/
export { ConnectorsTab } from "./connectors/ConnectorsTab";
export type { ConnectorAuthState } from "./connectors/ConnectorsTab";
export { ConnectorCard } from "./connectors/ConnectorCard";
export { ConnectorDetailModal } from "./connectors/ConnectorDetailModal";
export { ConnectorTokenForm } from "./connectors/ConnectorTokenForm";
export { ConnectorAuthModal } from "./connectors/ConnectorAuthModal";
export { ConnectorQrModal } from "./connectors/ConnectorQrModal";
export { McpModal } from "./connectors/McpModal";
export { McpConfigEditor } from "./connectors/McpConfigEditor";

// shared/
export { ConnectorIcon } from "./shared/ConnectorIcon";
export { LetterAvatar } from "./shared/LetterAvatar";
export { ThumbImg } from "./shared/ThumbImg";
export { Chip, SegmentTabs, ScrollRow } from "./shared/ui";

// data/
export { CONNECTOR_LIST } from "./data/connectors-catalog";
export { FEATURED_SCENES } from "./data/featured-scenes";
export { SKILL_CATEGORIES } from "./data/skills-catalog";

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    "experts.panel": { kind: "single"; scope: "root" };
  }
}
