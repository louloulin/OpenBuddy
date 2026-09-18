/**
 * @openbuddy/ui-settings — 统一对外入口
 *
 * 设置层。承载系统设置项面板、Tabs 导航、设置入口注册与各子面板的聚合入口。
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
import type { PolicySectionProps } from "./policy/section-contract";
export type { SlotMap };

export { HomePage } from "./HomePage";
export { SettingsPanel } from "./SettingsPanel";
export { AssistantsPanel } from "./AssistantsPanel";
export { PolicySettingsPanel } from "./PolicySettingsPanel";

// ─── 「策略设置」区块总线 ───────────────────────────────────────────
//
// 内置的两个策略区块(Pi 扩展准入名单 / 插件策略审计)与第三方插件的区块
// 走**同一条**总线,契约与 `@openbuddy/ui-library` 的 `library.section` 同构。
export {
  EXTENSION_POLICY_SECTIONS,
  ExtensionAuditPanel,
  ExtensionPolicyEditor,
  ExtensionPolicySection,
  ExtensionAuditSection,
  POLICY_SECTION_IDS,
  definePolicySection,
  readPolicySectionMeta,
} from "./policy";
export type {
  ExtensionAuditPanelProps,
  ExtensionPolicyEditorProps,
  PolicySectionComponent,
  PolicySectionMeta,
  PolicySectionProps,
} from "./policy";

export {
  PersonalizeSettingsPanel,
  ShortcutsSettingsPanel,
  HelpSettingsPanel,
  SecuritySettingsPanel,
  DataSettingsPanel,
  GeneralSettingsPanel,
  AccountSettingsPanel,
  AgentSettingsPanel,
  AssistantSettingsPanel,
} from "./SettingsSections";

// ─── 首页子区域的槽位契约 ────────────────────────────────────────────
//
// 这三条都**由本包消费**(本包注册的 `HomePage` 才是真正渲染首页的实现),
// 所以契约声明也放在这里:`@openbuddy/ui-home` 里那几条 `home.*` 描述的是
// 同一个区域,但没有任何消费者(见该包里的 deprecation 说明)。
//
// 其中 `home.scene.tab` 此前**完全没有声明** —— 而它是全仓最久经考验的插件
// 扩展点之一:`examples/openbuddy-plugin-hello`、`scripts/electron/_probe-plugin-sdk.mjs`
// 与 plugin-sdk 的 `author.ts` 文档都在用它,插件作者却在编辑器里拿不到类型。
declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /**
     * 设置面板(single,modal)。注册方 `client.tsx`(`SettingsPanel`),
     * 消费者 `src/features/app/AppShell.tsx` 的 `SettingsSurface`。
     */
    "overlay.settings": { kind: "single"; scope: "root" };
    /**
     * 首页整页(single)。消费者:`src/features/app/AppShell.tsx` 的 `HomeSurface`
     * —— 内核优先,回落到本包注册的 `HomePage`。
     *
     * 声明权归**注册方**,与 `details` / `shell.statusbar` 同一规则。这条槽此前
     * 只在代码里注册、没有 SlotMap 声明,于是登记表里它的 kind/scope 是空的,
     * 插件作者只能靠猜(或读实现)才知道能不能整页替换。
     */
    "home": {
      kind: "single";
      scope: "session-maybe";
      owner: {
        onSend: (text: string) => void;
        streaming: boolean;
        apiReady: boolean;
        onOpenSettings: () => void;
        onPlaceholder: (label: string) => void;
        modelId?: string;
        models?: readonly unknown[];
        onModelChange?: (id: string) => void;
        cwd?: string;
        workspaces?: readonly unknown[];
        onSelectWorkspace?: (cwd: string) => void;
        onSelectMode?: (modeId: string) => void;
        onSelectExpert?: (agent: unknown) => void;
        onNavigateConnectors?: () => void;
      };
    };
    /**
     * 首页场景行(list,数据型贡献)。消费者:`HomePage`。
     *
     * 插件只提供描述,UI 由宿主渲染 —— 第三方插件因此不必打包 React。
     * `onActivate` 被调用时宿主把它当成一次场景切换。
     */
    "home.scene.tab": {
      kind: "list";
      scope: "root";
      owner: {
        id: string;
        label: string;
        icon?: unknown;
        description?: string;
        onActivate?: () => void;
      };
    };
    /** 首页场景行**整行**替换(single)。消费者:`HomePage`(`home-slots.tsx`)。 */
    "home.scene-tabs": {
      kind: "single";
      scope: "root";
      owner: { modes: readonly { id: string; label: string }[]; activeMode: string; onSelect: (id: never) => void };
    };
    /** 最佳实践案例条**整条**替换(single)。消费者:`HomePage`。 */
    "home.practice-cases": {
      kind: "single";
      scope: "root";
      owner: { onSelect: (prompt: string) => void };
    };
    /**
     * 策略设置区块(list)。消费者:`PolicySettingsPanel`。
     * 内置两块(Pi 扩展准入名单 order 50 / 插件策略审计 order 60)也走这条总线,
     * 插件追加策略区块只需一次 `ctx.slots.register`,不需要改设置面板代码。
     * 注册值必须是 `definePolicySection(meta, Component)` 的产物。
     */
    "settings.policy.section": {
      kind: "list";
      scope: "root";
      owner: PolicySectionProps;
    };
  }
}
