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
