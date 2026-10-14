/**
 * memory-client.ts —— 本地两层记忆的渲染层调用面(阶段 1.5)。
 *
 * 两层:user(全局)/ workspace(按 cwd)。云层明确不做。
 * 通道与主进程 `electron/main/ipc/memory.ts` 一一对应。
 */
export type OpenBuddyMemoryScope = "user" | "workspace";

export interface OpenBuddyMemoryEntry {
  id: string;
  scope: OpenBuddyMemoryScope;
  cwd?: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OpenBuddyMemoryListQuery {
  scope?: OpenBuddyMemoryScope;
  cwd?: string;
  query?: string;
  limit?: number;
}

type Invoke = <T>(channel: string, payload?: unknown) => Promise<T>;

function invokeWith(invoke: Invoke) {
  return {
    /** 列记忆。**不传 cwd 时看不到工作区层**(避免跨工作区串味)。 */
    async list(query: OpenBuddyMemoryListQuery = {}): Promise<OpenBuddyMemoryEntry[]> {
      return invoke<OpenBuddyMemoryEntry[]>("memory:list", { ...query });
    },
    async add(input: { title: string; body: string; scope?: OpenBuddyMemoryScope; cwd?: string; tags?: string[] }): Promise<OpenBuddyMemoryEntry> {
      return invoke<OpenBuddyMemoryEntry>("memory:add", { ...input });
    },
    async update(id: string, patch: { title?: string; body?: string; tags?: string[] }): Promise<OpenBuddyMemoryEntry> {
      return invoke<OpenBuddyMemoryEntry>("memory:update", { id, ...patch });
    },
    async remove(id: string): Promise<boolean> {
      const result = await invoke<{ deleted: boolean }>("memory:delete", { id });
      return result?.deleted === true;
    },
  };
}

export type OpenBuddyMemoryClient = ReturnType<typeof invokeWith>;

/** 绑定到具体 invoke 实现(测试/多窗口复用同一套 API)。 */
export function createMemoryClient(invoke: Invoke): OpenBuddyMemoryClient {
  return invokeWith(invoke);
}
