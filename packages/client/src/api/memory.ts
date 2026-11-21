// `memory` module (20261116-pii W5.1–W5.3): memory_list / get / save / delete / rewrite.
// `memory_flush` stays deferred (pii §3.3: not planned — memory is written straight to files).
import type { MemoryEntry } from "@openbuddy/protocol/dto";
import { invoke } from "../ipc";

export type { MemoryEntry };

export type MemoryScope = "global" | "workspace";

/** List memory notes from the global scope and, when the folder is trusted, the workspace scope. */
export async function memoryList(cwd?: string): Promise<MemoryEntry[]> {
  return invoke<MemoryEntry[]>("memory_list", { cwd: cwd ?? null });
}

/** Read a single memory note. */
export async function memoryGet(scope: MemoryScope, path: string, cwd?: string): Promise<string> {
  return invoke<string>("memory_get", { scope, path, cwd: cwd ?? null });
}

/** Create or overwrite a memory note. */
export async function memorySave(scope: MemoryScope, path: string, content: string, cwd?: string): Promise<MemoryEntry> {
  return invoke<MemoryEntry>("memory_save", { scope, path, content, cwd: cwd ?? null });
}

/** Delete a memory note. */
export async function memoryDelete(scope: MemoryScope, path: string, cwd?: string): Promise<void> {
  await invoke<void>("memory_delete", { scope, path, cwd: cwd ?? null });
}

/** 整理记忆: merge global notes into MEMORY.md, deduplicating bullets (the merged list is previewed in the UI). */
export async function memoryRewrite(): Promise<{ merged: number; kept: number }> {
  return invoke<{ merged: number; kept: number }>("memory_rewrite");
}
