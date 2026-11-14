// §5.3 `native` module (desktop only): export_text_file, clipboard_save_image. (dialog_* / window_* go through ipc.ts directly.)
import { invoke } from "../ipc";

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
