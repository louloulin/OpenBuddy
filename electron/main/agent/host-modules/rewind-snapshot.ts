/**
 * host-modules/rewind-snapshot.ts — file rewind snapshot store.
 *
 * Phase 8.3 Batch C: 从 agent-host.ts 抽出 file-rewind machinery (~185 行):
 *   - FileSnapshot / RewindSnapshotFile interfaces (line 5177-5190)
 *   - rewindSnapshotCache module-level let (line 5192) — moves with the
 *     functions that own it
 *   - rewindSnapshotPath / loadRewindSnapshots / persistRewindSnapshots
 *   - captureFileSnapshot / restoreFileSnapshots
 *   - isWithinWorkspace / shellWords / extractBashMutationPaths /
 *     extractFileMutationPaths / currentPromptIdForSession — supporting
 *     helpers
 *
 * 设计:
 *   - state 通过环形 import 自 ../agent-host 注入 (state.session 用于
 *     currentPromptIdForSession, state.cwd 用于 resolve 工作目录)
 *   - piHome 同样从 agent-host 拿 (导出已存在)
 *   - captureFileSnapshot 在 agent-host.ts line 3215 还要被使用 (tool
 *     执行路径), 所以这次会从 agent-host.ts 加 export 关键字 + 在
 *     host-modules/rewind-snapshot.ts 里 export 它, 形成 "agent-host
 *     re-export 新模块的 export 物" 的反向依赖
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { piHome } from "./_host-paths";
import { type AgentHostState } from "./_state-shape";

interface FileSnapshot {
  toolCallId: string;
  promptId: string | null;
  tool: "write" | "edit" | string;
  path: string;
  exists: boolean;
  content: string | null;
  capturedAt: number;
}

interface RewindSnapshotFile {
  /** sessionId -> [promptId -> FileSnapshot[]] */
  sessions: Record<string, Record<string, FileSnapshot[]>>;
}

let rewindSnapshotCache: RewindSnapshotFile | null = null;

async function rewindSnapshotPath(): Promise<string> {
  return join(piHome(), "openbuddy-rewind-snapshots.json");
}

async function loadRewindSnapshots(): Promise<RewindSnapshotFile> {
  if (rewindSnapshotCache) return rewindSnapshotCache;
  try {
    const raw = await readFile(await rewindSnapshotPath(), "utf8");
    rewindSnapshotCache = JSON.parse(raw) as RewindSnapshotFile;
    if (!rewindSnapshotCache || typeof rewindSnapshotCache !== "object" || !rewindSnapshotCache.sessions) {
      rewindSnapshotCache = { sessions: {} };
    }
  } catch {
    rewindSnapshotCache = { sessions: {} };
  }
  return rewindSnapshotCache;
}

async function persistRewindSnapshots(): Promise<void> {
  const snapshot = rewindSnapshotCache ?? { sessions: {} };
  const path = await rewindSnapshotPath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function captureFileSnapshot(
  state: AgentHostState,
  sessionId: string,
  toolCallId: string,
  toolName: string,
  args: unknown,
): Promise<void> {
  const paths = extractFileMutationPaths(toolName, args);
  if (!paths.length) return;
  const snapshot = await loadRewindSnapshots();
  const sessionMap = snapshot.sessions[sessionId] ?? {};
  const promptId = currentPromptIdForSession(state, sessionId);
  const bucket = sessionMap[promptId ?? ""] ?? [];
  const workspace = state.cwd ? resolve(state.cwd) : resolve(process.cwd());
  for (const pathValue of paths) {
    const absolute = resolve(workspace, pathValue);
    if (!isWithinWorkspace(workspace, absolute)) continue;
    const existing = await stat(absolute, { throwIfNoEntry: false });
    if (existing && !existing.isFile()) continue;
    if (bucket.some((entry) => entry.toolCallId === toolCallId && entry.path === absolute)) continue;
    let content: string | null = null;
    if (existing?.isFile()) content = await readFile(absolute, "utf8");
    bucket.push({
      toolCallId,
      promptId,
      tool: toolName,
      path: absolute,
      exists: Boolean(existing?.isFile()),
      content,
      capturedAt: Date.now(),
    });
  }
  if (!bucket.length) return;
  sessionMap[promptId ?? ""] = bucket;
  snapshot.sessions[sessionId] = sessionMap;
  await persistRewindSnapshots();
}

function isWithinWorkspace(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${String.fromCharCode(47)}`) && !path.startsWith("/"));
}

function shellWords(command: string): string[] {
  return [...command.matchAll(/(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s;&|]+))/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter(Boolean);
}

function extractBashMutationPaths(command: string): string[] {
  const paths = new Set<string>();
  const add = (value: string): void => {
    const cleaned = value.replace(/[;,]+$/, "");
    if (!cleaned || cleaned === "-" || cleaned.startsWith("-") || cleaned.startsWith("$")) return;
    if (["/dev/null", "/dev/stdout", "/dev/stderr", "&1", "&2"].includes(cleaned)) return;
    paths.add(cleaned);
  };
  for (const match of command.matchAll(/>{1,2}\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g)) add(match[1] ?? match[2] ?? match[3] ?? "");
  for (const match of command.matchAll(/(?:^|[;&|]\s*)(?:touch|rm|mv|cp|install|truncate|tee)\b([^;&|]*)/g)) {
    for (const word of shellWords(match[1] ?? "")) add(word);
  }
  for (const match of command.matchAll(/\bsed\b[^;&|]*\s(?:-i(?:\S*)?\s+)?(?:"[^"]+"|'[^']+'|[^\s;&|]+)\s+([^;&|\s]+)/g)) add(match[1] ?? "");
  return [...paths];
}

function extractFileMutationPaths(toolName: string, args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  if (toolName === "write" || toolName === "edit") {
    const pathValue = (args as { path?: unknown }).path;
    return typeof pathValue === "string" && pathValue ? [pathValue] : [];
  }
  if (toolName === "bash") {
    const command = (args as { command?: unknown }).command;
    return typeof command === "string" ? extractBashMutationPaths(command) : [];
  }
  return [];
}

function currentPromptIdForSession(state: AgentHostState, sessionId: string): string | null {
  const session = state.session;
  if (!session || session.sessionId !== sessionId) return null;
  try {
    const entries = session.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry && entry.type === "message" && entry.message?.role === "user") return entry.id;
    }
  } catch {
    // session may be torn down mid-rewind; treat as no current prompt.
  }
  return null;
}

async function restoreFileSnapshots(
  state: AgentHostState,
  sessionId: string,
  targetPromptId: string,
): Promise<{ restored: number; skipped: number }> {
  const snapshot = await loadRewindSnapshots();
  const sessionMap = snapshot.sessions[sessionId];
  if (!sessionMap) return { restored: 0, skipped: 0 };
  // Snapshot buckets are keyed by the prompt under which the mutation
  // happened. Restoring `all` rewinds everything recorded after the
  // target prompt back to its pre-tool state.
  const promptOrder = new Map<string, number>();
  for (const [index, entry] of (state.session?.sessionManager.getEntries() ?? []).entries()) {
    if (entry.type === "message" && entry.message.role === "user") promptOrder.set(entry.id, index);
  }
  const targetOrder = promptOrder.get(targetPromptId);
  if (targetOrder === undefined) return { restored: 0, skipped: 0 };
  const buckets: Array<{ promptId: string; entries: FileSnapshot[]; order: number }> = [];
  for (const [promptId, entries] of Object.entries(sessionMap)) {
    const order = promptOrder.get(promptId);
    if (order !== undefined && order > targetOrder) buckets.push({ promptId, entries, order });
  }
  buckets.sort((a, b) => b.order - a.order);
  const workspace = state.cwd ? resolve(state.cwd) : resolve(process.cwd());
  let restored = 0;
  let skipped = 0;
  for (const bucket of buckets) {
    for (const entry of [...bucket.entries].reverse()) {
      try {
        if (!isWithinWorkspace(workspace, resolve(entry.path))) {
          skipped += 1;
          continue;
        }
        if (entry.exists) {
          await writeFile(entry.path, entry.content ?? "", "utf8");
        } else {
          await rm(entry.path, { force: true });
        }
        restored += 1;
      } catch {
        skipped += 1;
      }
    }
    delete sessionMap[bucket.promptId];
  }
  await persistRewindSnapshots();
  return { restored, skipped };
}

export {
  captureFileSnapshot,
  restoreFileSnapshots,
};
