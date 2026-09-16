/**
 * Renderer-side wrappers for the Data Directory IPC (R23).
 *
 * 四个 channel 与 main 侧 `electron/main/ipc/data-dir.ts` 一一对应。这里保持
 * 薄:校验与写盘全在 main —— 渲染进程连"目录是否存在"都不去猜。
 */
import { invoke } from "@/lib/platform/electron-api";

export interface DataDirDescription {
  path: string;
  defaultPath: string;
  override: string | null;
  isOverridden: boolean;
}

export type DataDirSetResult =
  | { ok: true; path: string; requiresRestart: boolean }
  | { ok: false; error: string };

export function dataDirDescribe(): Promise<DataDirDescription> {
  return invoke("host:data-dir", undefined);
}

export function dataDirSet(path: string): Promise<DataDirSetResult> {
  return invoke("host:data-dir-set", { path });
}

export function dataDirReset(): Promise<{ ok: true; requiresRestart: boolean }> {
  return invoke("host:data-dir-reset", undefined);
}

/** 重启应用以应用新的数据目录。 */
export function relaunchApp(): Promise<{ ok: true }> {
  return invoke("host:relaunch", undefined);
}
