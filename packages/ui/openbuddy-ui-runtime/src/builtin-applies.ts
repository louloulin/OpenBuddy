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
 *     `BUILTIN_UI_APPLIES[i].apply`,只是 metadata 走 SDK 序列化。
 *   - `slot-plugin-manifest.ts` 提供 `serializeBuiltinUiSlotTrack` 转换器,
 *     便于 inventory / plugin panel / 动态加载场景复用同一份 metadata。
 *
 * 添加新包流程(全自动):
 *   1. 在 packages/ui/openbuddy-ui-<name>/ 起目录,写 src/client.tsx
 *   2. 在下方数组增加一行 `apply as <name>Apply`
 *   3. 跑 `node scripts/sync-ui-aliases.mjs`(保持 paths / tsconfig 一致)
 *   4. (可选)写 vitest 测试覆盖本表项数 — 防止遗漏注册
 *
 * 顺序约定:
 *   - ui-slots / ui-runtime / ui-modules / ui-theme / ui-locale 必须先于
 *     其它业务包,因为后者依赖前者提供的 ctx.slots / ctx.theme / ctx.locale。
 *   - 业务包之间无强顺序,按字典序排列便于审查。
 */

import { apply as accountApply } from "@openbuddy/ui-account/client";
import { apply as automationApply } from "@openbuddy/ui-automation/client";
import { apply as billingApply } from "@openbuddy/ui-billing/client";
import { apply as collaborationApply } from "@openbuddy/ui-collaboration/client";
import { apply as conversationApply } from "@openbuddy/ui-conversation/client";
import { apply as dialogsApply } from "@openbuddy/ui-dialogs/client";
import { apply as emailApply } from "@openbuddy/ui-email/client";
import { apply as expertsApply } from "@openbuddy/ui-experts/client";
import { apply as filesApply } from "@openbuddy/ui-files/client";
import { apply as homeApply } from "@openbuddy/ui-home/client";
import { apply as layoutApply } from "@openbuddy/ui-layout/client";
import { apply as markdownApply } from "@openbuddy/ui-markdown/client";
import { apply as mcpApply } from "@openbuddy/ui-mcp/client";
import { apply as modulesApply } from "@openbuddy/ui-modules/client";
import { apply as primitivesApply } from "@openbuddy/ui-primitives/client";
import { apply as settingsModelsApply } from "@openbuddy/ui-settings-models/client";
import { apply as settingsApply } from "@openbuddy/ui-settings/client";
import { apply as sharedApply } from "@openbuddy/ui-shared/client";
import { apply as shellApply } from "@openbuddy/ui-shell/client";
import { apply as sidebarApply } from "@openbuddy/ui-sidebar/client";
import { apply as workbenchApply } from "@openbuddy/ui-workbench/client";
import type { UiPlugin } from "@openbuddy/ui-slots";
import {
  serializeBuiltinUiSlotTrack,
  toOpenBuddyPluginManifest,
  type BuiltinUiPluginSlotTrack,
} from "./slot-plugin-manifest";

/** builtin apply 列表(已剔除 ui-slots / ui-runtime / ui-theme / ui-locale,后者另走特殊通道)
 *  每项包含一份简短 description,Phase K.2 后会被投影到 OpenBuddyPlugin manifest,
 *  供 inventory + plugin panel 显示。`as const` 在 tests 中需要重新赋值 apply,
 *  因此保持 mutable;description 是只读 metadata。 */
export const BUILTIN_UI_APPLIES: ReadonlyArray<BuiltinUiPluginSlotTrack> = [
  { pkg: "@openbuddy/ui-account", apply: accountApply, description: "Account sidebar / profile / login surface." },
  { pkg: "@openbuddy/ui-automation", apply: automationApply, description: "Automation rule list + triggers (delegates to PI). " },
  { pkg: "@openbuddy/ui-billing", apply: billingApply, description: "Billing dashboard + plan / quota surface." },
  { pkg: "@openbuddy/ui-collaboration", apply: collaborationApply, description: "Multi-user collaboration: rooms, inboxes, presence." },
  { pkg: "@openbuddy/ui-conversation", apply: conversationApply, description: "Chat surface — composer, history, agent responses." },
  { pkg: "@openbuddy/ui-dialogs", apply: dialogsApply, description: "Modal dialogs (confirm / input / form)." },
  { pkg: "@openbuddy/ui-email", apply: emailApply, description: "Email capability surface (auth + provider + composer)." },
  { pkg: "@openbuddy/ui-experts", apply: expertsApply, description: "Expert catalogue / configuration." },
  { pkg: "@openbuddy/ui-files", apply: filesApply, description: "Workspace file browser + metadata." },
  { pkg: "@openbuddy/ui-home", apply: homeApply, description: "Home / dashboard surface." },
  { pkg: "@openbuddy/ui-layout", apply: layoutApply, description: "Layout chrome (panels, splits, resize). " },
  { pkg: "@openbuddy/ui-markdown", apply: markdownApply, description: "Markdown renderer + editor primitives." },
  { pkg: "@openbuddy/ui-mcp", apply: mcpApply, description: "MCP server picker / plugin panel." },
  { pkg: "@openbuddy/ui-modules", apply: modulesApply, description: "Module registry + activation surface." },
  { pkg: "@openbuddy/ui-primitives", apply: primitivesApply, description: "Shared design primitives (Button / Menu / Input)." },
  { pkg: "@openbuddy/ui-settings", apply: settingsApply, description: "Generic settings surface (theme / language / privacy)." },
  { pkg: "@openbuddy/ui-settings-models", apply: settingsModelsApply, description: "Model selection + provider CRUD surface." },
  { pkg: "@openbuddy/ui-shared", apply: sharedApply, description: "Shared cross-package UI utilities." },
  { pkg: "@openbuddy/ui-shell", apply: shellApply, description: "Outer shell chrome (titlebar / statusbar)." },
  { pkg: "@openbuddy/ui-sidebar", apply: sidebarApply, description: "Sidebar nav + secondary actions." },
  { pkg: "@openbuddy/ui-workbench", apply: workbenchApply, description: "Workbench view (split panes + tabs)." },
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
