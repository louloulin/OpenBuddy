/**
 * @openbuddy/ui-dialogs/client — apply() 注册 AboutDialog + FolderTrustDialog。
 *
 * 两个 modal 各注册到**两个**槽:
 *   - `shell.overlay`(list)  —— ui-layout 的 AppFrame 把浮层作为浮动层统一渲染,
 *     供第三方 / 替代外壳使用;
 *   - `overlay.about` / `overlay.folder-trust`(single) —— 本产品外壳 AppShell
 *     走的是命名 `overlay.*` 路径。
 *
 * 为什么这里**不**用循环 + 变量槽名:槽名写成变量之后 `scripts/ui-slot-audit.mjs`
 * 的静态扫描看不见(`name: dialog.named` 匹配不到字面量),于是这两个槽在审计表
 * 里长期显示成 no-impl —— 而它们其实既注册了也被消费了。审计表的价值就在于
 * 每一行都是真的,所以这里宁可多写几行、把槽名字面量摊开。
 *
 * 其它的 dialog 组件(ConfirmDialog / PromptDialog / 等)走 dialogs.* 命名 slot
 * (见各自子模块),由调用方通过 useDialogs() 等 hook 弹出。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { AboutDialog } from "./AboutDialog";
import { CasdoorSignInDialog } from "./CasdoorSignInDialog";
import { FolderTrustDialog } from "./FolderTrustDialog";

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(
    ctx.slots.register(
      { name: "shell.overlay", kind: "list", scope: "root", id: "about", registrant: "@openbuddy/ui-dialogs/about" },
      AboutDialog as never
    )
  );
  disposers.push(
    ctx.slots.register(
      { name: "overlay.about", kind: "single", scope: "root", registrant: "@openbuddy/ui-dialogs/about" },
      AboutDialog as never
    )
  );

  disposers.push(
    ctx.slots.register(
      { name: "shell.overlay", kind: "list", scope: "root", id: "sign-in", registrant: "@openbuddy/ui-dialogs/sign-in" },
      CasdoorSignInDialog as never
    )
  );
  disposers.push(
    ctx.slots.register(
      { name: "overlay.sign-in", kind: "single", scope: "root", registrant: "@openbuddy/ui-dialogs/sign-in" },
      CasdoorSignInDialog as never
    )
  );

  disposers.push(
    ctx.slots.register(
      { name: "shell.overlay", kind: "list", scope: "root", id: "folder-trust", registrant: "@openbuddy/ui-dialogs/folder-trust" },
      FolderTrustDialog as never
    )
  );
  disposers.push(
    ctx.slots.register(
      { name: "overlay.folder-trust", kind: "single", scope: "root", registrant: "@openbuddy/ui-dialogs/folder-trust" },
      FolderTrustDialog as never
    )
  );

  return () => { for (let i = disposers.length - 1; i >= 0; i--) disposers[i](); };
}
