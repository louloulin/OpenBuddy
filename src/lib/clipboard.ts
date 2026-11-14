import { invoke } from "./ipc";

/** Write text to the system clipboard through the main process (renderer clipboard permission is denied). */
export async function copyText(text: string): Promise<void> {
  if (typeof window !== "undefined" && window.openbuddy) {
    await invoke("clipboard_write_text", { text });
    return;
  }
  if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
  await navigator.clipboard.writeText(text);
}

/** Run a native edit command (paste etc.) on the focused element. */
export async function editCommand(action: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll"): Promise<void> {
  await invoke("window_edit", { action });
}
