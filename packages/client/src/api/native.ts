// §5.3 `native` module (desktop only): export_text_file, clipboard_save_image, and thin
// invoke-based dialog wrappers so feature code never reaches the preload bridge directly.
import { invoke } from "../ipc";

// Re-exported here so renderers can ask without importing the bridge module (R5).
export { hasPreloadBridge } from "../ipc";

// ---------- dialogs ----------

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Native open dialog; null when cancelled. Picked files are granted by the app. */
export const openFileDialog = (options: { title?: string; filters?: FileFilter[]; directory?: boolean } = {}) =>
  invoke<string | null>("dialog_open", options);

/** Native save dialog; null when cancelled. The chosen path is granted for export. */
export const saveFileDialog = (options: { title?: string; defaultPath?: string; filters?: FileFilter[] } = {}) =>
  invoke<string | null>("dialog_save", options);

// ---------- export ----------

/** Export text content to an absolute path chosen by the user via the save
 *  dialog (e.g. "导出会话为 Markdown"). Unlike write_text_file, this is NOT
 *  restricted to the workspace — the path comes from explicit user consent
 *  in the native save dialog. */
export async function exportTextFile(path: string, content: string): Promise<string> {
  return invoke<string>("export_text_file", { path, content });
}

/** Saves an image on the clipboard as a granted attachment; null when there is none. */
export const clipboardSaveImage = () => invoke<{ path: string; name: string; size: number } | null>("clipboard_save_image", {});

// ---------- tray (W4.4) ----------

/** 托盘常驻当前是否开启；浏览器里为 false。 */
export const trayGet = () => invoke<{ enabled: boolean }>("tray_get", {});

/** 开关托盘常驻；主进程写入 userData/tray.json，下次启动仍生效。 */
export const traySet = (enabled: boolean) => invoke<{ enabled: boolean }>("tray_set", { enabled });

// ---------- 窗口与唤起 (pii W7) ----------

/** 在独立窗口打开一个会话（主进程按 `#/session/<id>` 路由新建窗口）。 */
export const openSessionWindow = (sessionId: string) => invoke<void>("window_open_session", { sessionId });

/** 打开全局快速输入小窗。 */
export const openQuickWindow = () => invoke<void>("window_open_quick", {});

/** 当前全局快速输入快捷键。 */
export const quickShortcutGet = () => invoke<string>("quick_shortcut_get", {});

/** 修改全局快速输入快捷键；注册失败时主进程保留旧值并抛错。 */
export const quickShortcutSet = (accelerator: string) => invoke<string>("quick_shortcut_set", { accelerator });
