/**
 * IPC surface — 产物中心(阶段 5 / 1.6)。
 *
 * 数据源复用 rewind 快照存储(`openbuddy-rewind-snapshots.json`,工具写/改
 * 文件前自动捕获),不另造一份副本:
 *   - `artifacts:index`   会话内所有被改过的文件 + 每个文件的版本时间线;
 *   - `artifacts:history` 单个文件的快照序列(倒序,含删除态);
 *   - `artifacts:restore` 回到某个 prompt 之前的文件状态(走既有
 *     restoreFileSnapshots,与「回退对话」同一条恢复路径);
 *   - `artifacts:diff`    快照版本 vs 当前内容的 unified diff。
 *
 * 安全:返回的 path 全部是快照里已记录的工作区内路径;restore 复用既有实现
 * 自身的 isWithinWorkspace 判定,不新增写入面。
 */
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { wrapIpcHandler } from "./_wrap";
import { recordValue, requiredString } from "./validation";
import { listFileSnapshots, restoreFileSnapshots, type FileSnapshot } from "../agent/host-modules/rewind-snapshot";
// state 是 agent-host 导出的 AgentHostState 实例(快照/恢复要用 cwd 与
// sessionManager 判定工作区与 prompt 顺序)。
import { state as agentHostState } from "../agent/agent-host";

export interface ArtifactIndexEntry {
  path: string;
  name: string;
  /** 该文件在本会话里被记录的次数(快照条数)。 */
  revisions: number;
  firstTouchedAt: number;
  lastTouchedAt: number;
  /** 最后一次记录该文件时文件是否存在(false = 那一刻是删除态)。 */
  lastKnownExists: boolean;
  tools: string[];
}

function groupByPath(entries: FileSnapshot[]): ArtifactIndexEntry[] {
  const byPath = new Map<string, ArtifactIndexEntry>();
  for (const entry of entries) {
    const existing = byPath.get(entry.path);
    if (!existing) {
      byPath.set(entry.path, {
        path: entry.path,
        name: entry.path.split(/[\\/]/).pop() || entry.path,
        revisions: 1,
        firstTouchedAt: entry.capturedAt,
        lastTouchedAt: entry.capturedAt,
        lastKnownExists: entry.exists,
        tools: [entry.tool],
      });
      continue;
    }
    existing.revisions += 1;
    existing.firstTouchedAt = Math.min(existing.firstTouchedAt, entry.capturedAt);
    // entries 已按时间倒序,第一次遇到的即最新。
    existing.lastKnownExists = entry.exists;
    if (!existing.tools.includes(entry.tool)) existing.tools.push(entry.tool);
  }
  return [...byPath.values()].sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
}

export function registerArtifactsIpc(): void {
  wrapIpcHandler("artifacts:index", async (_e, args?: unknown) => {
    const input = (args ?? {}) as { sessionId?: unknown };
    const sessionId = requiredString(input.sessionId, "sessionId");
    const snapshots = await listFileSnapshots(sessionId);
    return { sessionId, artifacts: groupByPath(snapshots), total: snapshots.length };
  });

  wrapIpcHandler("artifacts:history", async (_e, args: unknown) => {
    const input = recordValue(args, "artifacts:history payload");
    const sessionId = requiredString(input.sessionId, "sessionId");
    const path = requiredString(input.path, "path");
    const snapshots = (await listFileSnapshots(sessionId)).filter((entry) => entry.path === path);
    const current = await readCurrent(path);
    return {
      path,
      current,
      versions: snapshots.map((entry) => ({
        toolCallId: entry.toolCallId,
        promptId: entry.promptId,
        tool: entry.tool,
        exists: entry.exists,
        /** false 时 content 为 null(那一刻文件不存在)。 */
        bytes: entry.exists ? Buffer.byteLength(entry.content ?? "", "utf8") : 0,
        capturedAt: entry.capturedAt,
      })),
    };
  });

  // 回到某个 prompt 之前的文件状态(与回退对话共用恢复路径)。
  wrapIpcHandler("artifacts:restore", async (_e, args: unknown) => {
    const input = recordValue(args, "artifacts:restore payload");
    const sessionId = requiredString(input.sessionId, "sessionId");
    const promptId = requiredString(input.promptId, "promptId");
    const result = await restoreFileSnapshots(agentHostState, sessionId, promptId);
    return { ...result };
  });

  // 快照版本 vs 当前内容:统一 diff 文本交给渲染层现有的 diff 渲染器。
  wrapIpcHandler("artifacts:diff", async (_e, args: unknown) => {
    const input = recordValue(args, "artifacts:diff payload");
    const path = requiredString(input.path, "path");
    const snapshotContent = typeof input.content === "string" ? input.content : null;
    const before = snapshotContent ?? "";
    const after = await readCurrent(path);
    const patch = buildUnified(path, before, after);
    return { path, patch };
  });
}

/** 当前文件内容(不存在时返回空串 —— diff 侧表现为「文件被删」)。 */
async function readCurrent(path: string): Promise<string> {
  const absolute = resolve(isAbsolute(path) ? path : resolve(process.cwd(), path));
  try {
    const info = await stat(absolute, { throwIfNoEntry: false });
    if (!info || !info.isFile()) return "";
    return await readFile(absolute, "utf8");
  } catch {
    return "";
  }
}

/** 最小 unified diff 生成(只统计增删行,渲染层复用既有 diff 组件)。 */
function buildUnified(path: string, before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Map<string, number>();
  beforeLines.forEach((line, index) => {
    const count = beforeSet.get(line) ?? 0;
    beforeSet.set(line, count + 1);
  });
  const removed = beforeLines.filter((line) => {
    const count = beforeSet.get(line) ?? 0;
    if (count > 0) {
      beforeSet.set(line, count - 1);
      return false;
    }
    return true;
  });
  const afterSet = new Map<string, number>();
  afterLines.forEach((line) => afterSet.set(line, (afterSet.get(line) ?? 0) + 1));
  const added = afterLines.filter((line) => {
    const count = afterSet.get(line) ?? 0;
    if (count > 0) {
      afterSet.set(line, count - 1);
      return false;
    }
    return true;
  });
  const lines = [`--- a/${path}`, `+++ b/${path}`, `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`];
  for (const line of removed) lines.push(`-${line}`);
  for (const line of added) lines.push(`+${line}`);
  return `${lines.join("\n")}\n`;
}
