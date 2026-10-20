/**
 * packages/ui/openbuddy-ui-runtime/builtin-applies — 单一来源的 ui-* 包 apply 聚合表。
 *
 * 为什么需要这张表:
 *   - AGENTS.md 契约:`@openbuddy/ui-runtime` 必须对每个挂载的内置 ui-* 包
 *     调用一次 `apply(ctx, config?)`。
 *   - 之前 (L1/L2) 仅在结构层面验证了 26 个包"存在且 tsc 通过",但运行时
 *     装配并没有真正把 26 个 apply 串起来;App.tsx 只直接 import 了 11 个包,
 *     另有 15 个包从未被运行时触发(通过 grep 验证)。
 *   - 引入本表后,ui-runtime 的 SlotProvider 挂载时一次性遍历所有 26 个
 *     apply,把"声明在 26 个包里"的 slot / theme / locale / store 真正合并
 *     到运行时。这是"包结构 -> 运行时装配"的桥梁。
 *
 * Phase K.2 调整:
 *   - 在原有 `pkg + apply` 二元组的基础上补充 `description + configDefaults`。
 *   - 通过 `toBUILTIN_UI_PLUGIN_MANIFESTS()` 把表项投影为 OpenBuddyPlugin SDK
 *     `serializeSlotTrack` 能吃的 manifest,这样三个 builtin 装载入口
 *     (pi-extension / harness / slot) 在 Phase K.2 后共用同一份 manifest 形状
 *     (`openbuddy.plugin.v1`)。SlotProvider 挂载时仍然调用
 *     `BUILTIN_UI_APPLIES[i].load()` 拿到 apply 再调用,只是 metadata 走 SDK 序列化。
 *   - `slot-plugin-manifest.ts` 提供 `serializeBuiltinUiSlotTrack` 转换器,
 *     便于 inventory / plugin panel / 动态加载场景复用同一份 metadata。
 *
 * P1/P2-09(性能)调整 —— 表项从 `apply` 引用改为 `load()` 动态 import:
 *   - 之前本表静态 import 全部 25 个包的 `/client`,而本表被 ui-runtime/client
 *     静态引用、ui-runtime 又被 entry(AppShell/ChatView)静态引用 —— 于是
 *     **25 个包全部静态可达 entry**,哪怕某个包的所有消费方都只用动态 import
 *     (PlaceholderPage)。实测 entry 4.59 MB,首屏 5.44 MB,几乎全是 packages/ui。
 *   - 改为 `load: () => import(".../client")` 后,每个包变成按需 chunk,
 *     SlotProvider 挂载后异步装配。AGENTS.md 的「每包调用一次 apply」契约
 *     不变,只是时机从「挂载即同步」变为「挂载后异步」;slot 订阅是响应式的
 *     (useSyncExternalStore),装配完成后 UI 自动补齐。
 *   - 测试需要等装配落定:用 `registerAllBuiltinUis().done`。
 *
 * 添加新包流程(全自动):
 *   1. 在 packages/ui/openbuddy-ui-<name>/ 起目录,写 src/client.tsx
 *   2. 在下方数组增加一行 `load: () => import("@openbuddy/ui-<name>/client").then((m) => m.apply)`
 *   3. 跑 `node scripts/sync-ui-aliases.mjs`(保持 paths / tsconfig 一致)
 *   4. (可选)写 vitest 测试覆盖本表项数 — 防止遗漏注册
 *
 * 顺序约定:
 *   - ui-slots / ui-runtime / ui-modules / ui-theme / ui-locale 必须先于
 *     其它业务包,因为后者依赖前者提供的 ctx.slots / ctx.theme / ctx.locale。
 *   - 业务包之间无强顺序,按字典序排列便于审查。
 */

import type { UiPlugin } from "@openbuddy/ui-slots";
import {
  serializeBuiltinUiSlotTrack,
  toOpenBuddyPluginManifest,
  type BuiltinUiPluginSlotTrack,
} from "./slot-plugin-manifest";

/** builtin apply 列表(已剔除 ui-slots / ui-runtime / ui-theme / ui-locale,后者另走特殊通道)
 *  每项包含一份简短 description,Phase K.2 后会被投影到 OpenBuddyPlugin manifest,
 *  供 inventory + plugin panel 显示。`load` 在 tests 中需要重新赋值(注入
 *  stub apply),因此保持 mutable;description 是只读 metadata。 */
export const BUILTIN_UI_APPLIES: ReadonlyArray<BuiltinUiPluginSlotTrack> = [
  { pkg: "@openbuddy/ui-account", load: () => import("@openbuddy/ui-account/client").then((m) => m.apply), description: "Account sidebar / profile / login surface." },
  { pkg: "@openbuddy/ui-automation", load: () => import("@openbuddy/ui-automation/client").then((m) => m.apply), description: "Automation rule list + triggers (delegates to PI). " },
  { pkg: "@openbuddy/ui-billing", load: () => import("@openbuddy/ui-billing/client").then((m) => m.apply), description: "Billing dashboard + plan / quota surface." },
  { pkg: "@openbuddy/ui-collaboration", load: () => import("@openbuddy/ui-collaboration/client").then((m) => m.apply), description: "Multi-user collaboration: rooms, inboxes, presence." },
  { pkg: "@openbuddy/ui-conversation", load: () => import("@openbuddy/ui-conversation/client").then((m) => m.apply), description: "Chat surface — composer, history, agent responses." },
  { pkg: "@openbuddy/ui-dialogs", load: () => import("@openbuddy/ui-dialogs/client").then((m) => m.apply), description: "Modal dialogs (confirm / input / form)." },
  { pkg: "@openbuddy/ui-editor", load: () => import("@openbuddy/ui-editor/client").then((m) => m.apply), description: "TipTap rich-text / markdown editor + slash commands + mentions." },
  { pkg: "@openbuddy/ui-email", load: () => import("@openbuddy/ui-email/client").then((m) => m.apply), description: "Email capability surface (auth + provider + composer)." },
  { pkg: "@openbuddy/ui-experts", load: () => import("@openbuddy/ui-experts/client").then((m) => m.apply), description: "Expert catalogue / configuration." },
  { pkg: "@openbuddy/ui-files", load: () => import("@openbuddy/ui-files/client").then((m) => m.apply), description: "Workspace file browser + metadata." },
  { pkg: "@openbuddy/ui-files-tree", load: () => import("@openbuddy/ui-files-tree/client").then((m) => m.apply), description: "Virtualized, multi-select file / knowledge tree." },
  { pkg: "@openbuddy/ui-home", load: () => import("@openbuddy/ui-home/client").then((m) => m.apply), description: "Home / dashboard surface." },
  { pkg: "@openbuddy/ui-layout", load: () => import("@openbuddy/ui-layout/client").then((m) => m.apply), description: "Layout chrome (panels, splits, resize). " },
  { pkg: "@openbuddy/ui-library", load: () => import("@openbuddy/ui-library/client").then((m) => m.apply), description: "资料库 — user library hub (files / knowledge / cloud / inspiration) with pluggable sections." },
  { pkg: "@openbuddy/ui-markdown", load: () => import("@openbuddy/ui-markdown/client").then((m) => m.apply), description: "Markdown renderer + editor primitives." },
  { pkg: "@openbuddy/ui-mcp", load: () => import("@openbuddy/ui-mcp/client").then((m) => m.apply), description: "MCP server picker / plugin panel." },
  { pkg: "@openbuddy/ui-modules", load: () => import("@openbuddy/ui-modules/client").then((m) => m.apply), description: "Module registry + activation surface." },
  { pkg: "@openbuddy/ui-onboarding", load: () => import("@openbuddy/ui-onboarding/client").then((m) => m.apply), description: "First-run wizard, product tour, data-dir prompt, feedback." },
  { pkg: "@openbuddy/ui-primitives", load: () => import("@openbuddy/ui-primitives/client").then((m) => m.apply), description: "Shared design primitives (Button / Menu / Input)." },
  { pkg: "@openbuddy/ui-settings", load: () => import("@openbuddy/ui-settings/client").then((m) => m.apply), description: "Generic settings surface (theme / language / privacy)." },
  { pkg: "@openbuddy/ui-settings-models", load: () => import("@openbuddy/ui-settings-models/client").then((m) => m.apply), description: "Model selection + provider CRUD surface." },
  { pkg: "@openbuddy/ui-shared", load: () => import("@openbuddy/ui-shared/client").then((m) => m.apply), description: "Shared cross-package UI utilities." },
  { pkg: "@openbuddy/ui-shell", load: () => import("@openbuddy/ui-shell/client").then((m) => m.apply), description: "Outer shell chrome (titlebar / statusbar)." },
  { pkg: "@openbuddy/ui-sidebar", load: () => import("@openbuddy/ui-sidebar/client").then((m) => m.apply), description: "Sidebar nav + secondary actions." },
  { pkg: "@openbuddy/ui-workbench", load: () => import("@openbuddy/ui-workbench/client").then((m) => m.apply), description: "Workbench view (split panes + tabs)." },
];

/** Phase K.2 — 把 builtin apply 表投影为 OpenBuddyPlugin manifest 列表。
 *  每个 manifest 都经过 K.1 SDK 的 `validateOpenBuddyPluginManifest`,
 *  以保证 `serializeSlotTrack` 能从单一来源输出所有 slot track 行。 */
export function toBUILTIN_UI_PLUGIN_MANIFESTS(): readonly ReturnType<typeof toOpenBuddyPluginManifest>[] {
  return BUILTIN_UI_APPLIES.map(toOpenBuddyPluginManifest);
}

/** Phase K.2 — 序列化为 slot track 行,直接交给 UiRuntime.registerBuiltinUi()。 */
export function serializeBUILTIN_UI_PLUGIN_SLOT_TRACKS(): ReturnType<typeof serializeBuiltinUiSlotTrack>[] {
  return BUILTIN_UI_APPLIES.map(serializeBuiltinUiSlotTrack);
}

/** 重新导出 builtin apply 表的形状,避免既有调用点破坏。 */
export type BuiltinUiApplyEntry = UiPlugin & {
  /** 包 id (e.g. `@openbuddy/ui-account`). Phase K.2 后与 BUILTIN_UI_APPLIES 表项的 `pkg` 字段一致。 */
  name: string;
};
