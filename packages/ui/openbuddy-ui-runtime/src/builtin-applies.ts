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

/** builtin apply 列表(已剔除 ui-slots / ui-runtime / ui-theme / ui-locale,后者另走特殊通道) */
export const BUILTIN_UI_APPLIES: ReadonlyArray<{
  pkg: string;
  apply: UiPlugin["apply"];
}> = [
  { pkg: "@openbuddy/ui-account", apply: accountApply },
  { pkg: "@openbuddy/ui-automation", apply: automationApply },
  { pkg: "@openbuddy/ui-billing", apply: billingApply },
  { pkg: "@openbuddy/ui-collaboration", apply: collaborationApply },
  { pkg: "@openbuddy/ui-conversation", apply: conversationApply },
  { pkg: "@openbuddy/ui-dialogs", apply: dialogsApply },
  { pkg: "@openbuddy/ui-email", apply: emailApply },
  { pkg: "@openbuddy/ui-experts", apply: expertsApply },
  { pkg: "@openbuddy/ui-files", apply: filesApply },
  { pkg: "@openbuddy/ui-home", apply: homeApply },
  { pkg: "@openbuddy/ui-layout", apply: layoutApply },
  { pkg: "@openbuddy/ui-markdown", apply: markdownApply },
  { pkg: "@openbuddy/ui-mcp", apply: mcpApply },
  { pkg: "@openbuddy/ui-modules", apply: modulesApply },
  { pkg: "@openbuddy/ui-primitives", apply: primitivesApply },
  { pkg: "@openbuddy/ui-settings", apply: settingsApply },
  { pkg: "@openbuddy/ui-settings-models", apply: settingsModelsApply },
  { pkg: "@openbuddy/ui-shared", apply: sharedApply },
  { pkg: "@openbuddy/ui-shell", apply: shellApply },
  { pkg: "@openbuddy/ui-sidebar", apply: sidebarApply },
  { pkg: "@openbuddy/ui-workbench", apply: workbenchApply },
] as const;
