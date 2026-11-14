// Deferred (20261115-md Appendix B, 记忆): memory_* commands. Not in the protocol COMMANDS list.
import type { MemoryEntry } from "@openbuddy/protocol/dto";
import { invoke } from "../../ipc";

/** List memory notes from global + workspace scope. */
export async function memoryList(cwd?: string): Promise<MemoryEntry[]> {
  return invoke<MemoryEntry[]>("memory_list", { cwd: cwd ?? null });
}

/** Read a single memory file. */
export async function memoryGet(scope: string, path: string, cwd?: string): Promise<string> {
  return invoke<string>("memory_get", { scope, path, cwd: cwd ?? null });
}

/** Create or overwrite a memory note. */
export async function memorySave(
  scope: string,
  path: string,
  content: string,
  cwd?: string,
): Promise<MemoryEntry> {
  return invoke<MemoryEntry>("memory_save", { scope, path, content, cwd: cwd ?? null });
}

/** Delete a memory note. */
export async function memoryDelete(scope: string, path: string, cwd?: string): Promise<void> {
  await invoke<void>("memory_delete", { scope, path, cwd: cwd ?? null });
}


export async function memoryRewrite(): Promise<void> {
  await invoke<void>("memory_rewrite");
}

/** Flush in-flight memory writes to disk (`x.ai/memory/flush`). */
export async function memoryFlush(): Promise<void> {
  await invoke<void>("memory_flush");
}
