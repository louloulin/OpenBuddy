// 我的指令 (20261116-pii W2.7 / S8): Pi prompt templates (`prompts_*`), served by the skills module.
import { invoke } from "../ipc";

export interface PromptInfo {
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
  scope: "global" | "workspace";
  path: string;
}

export interface PromptDraft {
  name: string;
  description?: string;
  argumentHint?: string;
  content: string;
}

export type { PromptInfo as PromptsInfo };

export async function promptsList(cwd?: string): Promise<PromptInfo[]> {
  return invoke<PromptInfo[]>("prompts_list", { cwd: cwd ?? null });
}

export async function promptsGet(scope: "global" | "workspace", name: string, cwd?: string): Promise<string> {
  return invoke<string>("prompts_get", { scope, name, cwd: cwd ?? null });
}

export async function promptsSave(draft: PromptDraft, scope: "global" | "workspace" = "global", cwd?: string): Promise<PromptInfo> {
  return invoke<PromptInfo>("prompts_save", { ...draft, scope, cwd: cwd ?? null });
}

export async function promptsDelete(scope: "global" | "workspace", name: string, cwd?: string): Promise<void> {
  await invoke<void>("prompts_delete", { scope, name, cwd: cwd ?? null });
}
