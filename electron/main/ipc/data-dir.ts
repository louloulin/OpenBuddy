/**
 * IPC surface — 数据目录(userData)覆盖 (R23).
 *
 * 四个 channel,都直接挂在 ipcMain 上(与 `audit:*` 同一模式:不经过
 * `dsh:rpc` 的方法白名单,避免为一个设置项去动 RPC schema):
 *   - host:data-dir        读取当前 / 默认 / 覆盖状态
 *   - host:data-dir-set    写入覆盖(重启后生效)
 *   - host:data-dir-reset  清掉覆盖(重启后生效)
 *   - host:relaunch        立刻重启以应用
 *
 * 校验全部在 `../data-dir.ts`(那里才握有绝对路径语义);这里只做参数形状检查。
 */
import { app, ipcMain } from "electron";

import { describeDataDir, resetDataDir, setDataDir } from "../data-dir";

export function registerDataDirIpc(): void {
  ipcMain.handle("host:data-dir", () => describeDataDir());

  ipcMain.handle("host:data-dir-set", (_event, args?: { path?: unknown }) => {
    const path = typeof args?.path === "string" ? args.path : "";
    if (!path.trim()) return { ok: false as const, error: "缺少目录路径" };
    try {
      return setDataDir(path);
    } catch (cause) {
      return { ok: false as const, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });

  ipcMain.handle("host:data-dir-reset", () => resetDataDir());

  ipcMain.handle("host:relaunch", () => {
    // 先回复再退出:渲染进程要先把 toast 画出来,用户才知道"为什么窗口没了"。
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 150);
    return { ok: true as const };
  });
}
