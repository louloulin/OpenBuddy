// 资料库 (pii W5.5): persistent knowledge sources (`library.json`).
import type { LibrarySource } from "@openbuddy/protocol/library";
import { invoke } from "../ipc";

export type { LibrarySource };

export async function libraryList(): Promise<LibrarySource[]> {
  return invoke<LibrarySource[]>("library_list");
}

/** Add a folder as a knowledge source; returns the stored entry (id = folder path). */
export async function libraryAdd(path: string): Promise<LibrarySource> {
  return invoke<LibrarySource>("library_add", { path });
}

export async function libraryRemove(id: string): Promise<void> {
  await invoke<void>("library_remove", { id });
}
