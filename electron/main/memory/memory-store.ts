/**
 * memory-store.ts —— 本地两层记忆的**唯一真相源**(阶段 1.5)。
 *
 * 两层:
 *   - user      —— 全局用户记忆(跨工作区、跨会话);
 *   - workspace —— 按 cwd 归一的工作区记忆(同一目录的会话共享)。
 *
 * 落盘: `<agentHome>/memory.json`,写入走串行队列 + 临时文件 rename(与
 * openbuddy-email 的 store 同一套路,防止并发写互相覆盖)。
 *
 * 云层**明确不做**(计划 §阶段 1.5)。
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";

import { agentHome } from "@openbuddy/storage";

export type MemoryScope = "user" | "workspace";

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  /** 工作区记忆的归一 cwd;用户级为空。 */
  cwd?: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface MemoryFile {
  version: 1;
  entries: MemoryEntry[];
}

function storePath(): string {
  return join(agentHome(), "memory.json");
}

/** 工作区键:绝对路径归一 + 去尾斜杠,相对 cwd 一律按当前进程解析成绝对。 */
export function workspaceKey(cwd: string | undefined): string {
  const raw = cwd && cwd.trim() ? cwd.trim() : process.cwd();
  return resolve(isAbsolute(raw) ? raw : join(process.cwd(), raw));
}

function emptyFile(): MemoryFile {
  return { version: 1, entries: [] };
}

let writeQueue: Promise<void> = Promise.resolve();

async function readFile_(): Promise<MemoryFile> {
  let raw: string;
  try {
    raw = await readFile(storePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MemoryFile>;
    return { version: 1, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch (error) {
    // 损坏时**不**静默当空:保留原始字节,让上层决定,避免下次写把用户记忆抹掉。
    const backup = `${storePath()}.corrupt-${Date.now()}`;
    await writeFile(backup, raw, { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
    throw new Error(`memory store is corrupt; a copy was preserved at ${backup} (${String(error)})`);
  }
}

async function writeFileNow(file: MemoryFile): Promise<void> {
  const target = storePath();
  await mkdir(agentHome(), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** 串行化的读-改-写(所有 mutation 都走这里,不要自己 read+write)。 */
async function mutate<T>(mutator: (file: MemoryFile) => T | Promise<T>): Promise<T> {
  const operation = writeQueue.then(async () => {
    const file = await readFile_();
    const result = await mutator(file);
    await writeFileNow(file);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export interface MemoryQuery {
  scope?: MemoryScope;
  cwd?: string;
  /** 大小写不敏感的子串,匹配 title/body/tags。 */
  query?: string;
  limit?: number;
}

export async function listMemories(query: MemoryQuery = {}): Promise<MemoryEntry[]> {
  const file = await readFile_();
  const cwd = query.cwd === undefined ? undefined : workspaceKey(query.cwd);
  const needle = query.query?.trim().toLowerCase() ?? "";
  const matched = file.entries.filter((entry) => {
    if (query.scope && entry.scope !== query.scope) return false;
    // 工作区层只在**该工作区**可见;不传 cwd 时工作区条目不返回(避免跨工作区串味)。
    if (entry.scope === "workspace") {
      if (!cwd) return false;
      if (entry.cwd !== cwd) return false;
    }
    if (!needle) return true;
    return (
      entry.title.toLowerCase().includes(needle)
      || entry.body.toLowerCase().includes(needle)
      || entry.tags.some((tag) => tag.toLowerCase().includes(needle))
    );
  });
  const limit = Math.max(1, Math.min(500, Math.floor(query.limit ?? 100)));
  // 新在前;同一条目 updatedAt 变化时也靠它前移。
  return matched
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export interface MemoryDraft {
  scope?: MemoryScope;
  cwd?: string;
  title: string;
  body: string;
  tags?: string[];
}

export async function addMemory(draft: MemoryDraft): Promise<MemoryEntry> {
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (!title) throw new Error("memory: title 不能为空");
  const scope: MemoryScope = draft.scope === "workspace" ? "workspace" : "user";
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: `memory-${randomUUID().slice(0, 8)}`,
    scope,
    ...(scope === "workspace" ? { cwd: workspaceKey(draft.cwd) } : {}),
    title: title.slice(0, 200),
    body: body.slice(0, 20_000),
    tags: [...new Set((draft.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
    createdAt: now,
    updatedAt: now,
  };
  return mutate((file) => {
    file.entries.push(entry);
    return entry;
  });
}

export async function updateMemory(id: string, patch: { title?: string; body?: string; tags?: string[] }): Promise<MemoryEntry | null> {
  return mutate((file) => {
    const entry = file.entries.find((item) => item.id === id);
    if (!entry) return null;
    if (patch.title !== undefined) entry.title = patch.title.trim().slice(0, 200) || entry.title;
    if (patch.body !== undefined) entry.body = patch.body.slice(0, 20_000);
    if (patch.tags !== undefined) {
      entry.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
    }
    entry.updatedAt = new Date().toISOString();
    return entry;
  });
}

export async function deleteMemory(id: string): Promise<boolean> {
  return mutate((file) => {
    const before = file.entries.length;
    file.entries = file.entries.filter((entry) => entry.id !== id);
    return file.entries.length !== before;
  });
}

/** 供 agent 工具用:把工作区记忆一起纳入召回(agent 看到的永远两层)。 */
export async function recallMemories(query: MemoryQuery = {}): Promise<MemoryEntry[]> {
  const cwd = query.cwd === undefined ? undefined : workspaceKey(query.cwd);
  const needle = query.query?.trim().toLowerCase();
  if (!needle) return [];
  const file = await readFile_();
  return file.entries
    .filter((entry) => (entry.scope === "user" || (cwd && entry.cwd === cwd))
      && (entry.title.toLowerCase().includes(needle)
        || entry.body.toLowerCase().includes(needle)
        || entry.tags.some((tag) => tag.toLowerCase().includes(needle))))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.max(1, Math.min(50, Math.floor(query.limit ?? 20))));
}
