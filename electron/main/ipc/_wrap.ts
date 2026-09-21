/**
 * electron/main/ipc/_wrap.ts — IPC handler 通用包装（Phase 2 R1+R4）
 *
 * 6 个最大 IPC 文件（misc 112 / casdoor 98 / email 61 / connectors 42 /
 * collaboration 40 / plugin 37 = 共 ~390 handler）的 `ipcMain.handle(...)`
 * 直接暴露给 renderer，无 try/catch 也几乎无 logger。
 *
 * 修法：handler 经 `wrapIpcHandler(channel, fn)` 注册，自动 try/catch + 结构
 * 化日志。**wrap 签名与 ipcMain.handle 完全同形** —— fn 收 (event, args)，
 * handler 函数零改动：原本写 `async (_e, args) => body` 的就直接传。
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { createMainLogger } from "@openbuddy/logging-main";

const log = createMainLogger({ name: "ipc-wrap" });

export type WrappedHandler<TArgs, TResult> = (
  event: IpcMainInvokeEvent,
  args: TArgs,
) => Promise<TResult> | TResult;

export function wrapIpcHandler<TArgs = unknown, TResult = unknown>(
  channel: string,
  fn: WrappedHandler<TArgs, TResult>,
): void {
  ipcMain.handle(channel, async (event, args) => {
    try {
      return await fn(event, args as TArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`ipc:${channel} handler failed: ${message}`);
      throw error;
    }
  });
}
