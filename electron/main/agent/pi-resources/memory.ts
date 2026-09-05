/**
 * P2-13: Memory + session search/fork/rewind sub-module.
 *
 * Owns the `.pi/memory` global/workspace key-value store, the `prompt-history.json`
 * ring buffer, the SessionManager-backed session search + fork + rewind surface,
 * and `flushMemory` (full rewrite of every memory file, mostly for tests).
 *
 * The Pi SDK's `SessionManager` is a Rust-backed NAPI binding — pulling it into
 * the entry chunk costs real cold-start time. Moving it here means the binding
 * only loads when the user actually opens the rewind timeline or the session
 * search box, not on every chat turn.
 */
import { readFile, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { MemoryEntry, RewindPoint, SearchHit } from "@openbuddy/shared-types";
import {
  agentRoot,
  filesIn,
  piRoot,
  readJson,
  within,
  workspaceRoot,
  writeJson,
  writeTextAtomic,
} from "./shared";

function memoryRoot(scope: string, cwd?: string | null): string {
  return scope === "workspace" ? join(workspaceRoot(cwd), ".pi", "memory") : join(agentRoot(), "memory");
}

export async function listMemory(cwd?: string | null): Promise<MemoryEntry[]> {
  const out: MemoryEntry[] = [];
  for (const scope of ["global", "workspace"]) for (const file of await filesIn(memoryRoot(scope, cwd), ".md")) { const content = await readFile(file, "utf8"); out.push({ scope, path: file.slice(memoryRoot(scope, cwd).length + 1), content, size: Buffer.byteLength(content) }); }
  return out;
}

export async function getMemory(scope: string, pathValue: string, cwd?: string | null): Promise<string> {
  return readFile(within(memoryRoot(scope, cwd), join(memoryRoot(scope, cwd), pathValue)), "utf8");
}

export async function saveMemory(scope: string, pathValue: string, content: string, cwd?: string | null): Promise<MemoryEntry> {
  const file = within(memoryRoot(scope, cwd), join(memoryRoot(scope, cwd), pathValue));
  if (extname(file) !== ".md") throw new Error("memory path must end with .md");
  await writeTextAtomic(file, content);
  return { scope, path: pathValue, content, size: Buffer.byteLength(content) };
}

export async function deleteMemory(scope: string, pathValue: string, cwd?: string | null): Promise<void> {
  await rm(within(memoryRoot(scope, cwd), join(memoryRoot(scope, cwd), pathValue)), { force: true });
}

export async function rewriteMemory(scope?: string, pathValue?: string, content?: string, cwd?: string | null): Promise<{ ok: number; removed: number }> {
  if (scope !== undefined && pathValue !== undefined && content !== undefined) {
    await saveMemory(scope, pathValue, content.replace(/\r\n/g, "\n").trimEnd() + "\n", cwd);
    return { ok: 1, removed: 0 };
  }
  const entries = await listMemory(cwd);
  let ok = 0;
  for (const entry of entries) {
    const normalized = entry.content.replace(/\r\n/g, "\n").trimEnd() + "\n";
    if (normalized !== entry.content) await saveMemory(entry.scope, entry.path, normalized, cwd);
    ok += 1;
  }
  return { ok, removed: 0 };
}

export async function searchSessions(query: string, cwd?: string | null, limit = 50): Promise<SearchHit[]> {
  const scoped = cwd ? await SessionManager.list(workspaceRoot(cwd), piRoot()) : [];
  const all = await SessionManager.listAll(piRoot());
  const sessions = [...new Map([...scoped, ...all].map((entry) => [entry.id, entry])).values()]
    .filter((entry) => !cwd || resolve(entry.cwd ?? "") === workspaceRoot(cwd));
  const needle = query.toLowerCase();
  return sessions.filter((entry) => `${entry.name ?? ""}\n${entry.allMessagesText}`.toLowerCase().includes(needle)).slice(0, Math.max(1, Math.min(limit, 200))).map((entry) => ({ sessionId: entry.id, cwd: entry.cwd, title: entry.name ?? entry.firstMessage.slice(0, 80), snippet: entry.allMessagesText.slice(0, 240), updatedAt: entry.modified.toISOString() }));
}

export async function forkSession(sessionId: string, cwd?: string | null, atSeq?: number): Promise<string> {
  const sessions = await SessionManager.list(workspaceRoot(cwd), piRoot());
  const source = sessions.find((entry) => entry.id === sessionId)
    ?? (await SessionManager.listAll(piRoot())).find((entry) => entry.id === sessionId);
  if (!source) throw new Error(`Pi session not found: ${sessionId}`);
  return forkSessionFromFile(source.path, cwd, atSeq);
}

export async function forkSessionFromFile(sourcePath: string, cwd?: string | null, atSeq?: number): Promise<string> {
  if (atSeq === undefined) return SessionManager.forkFrom(sourcePath, workspaceRoot(cwd), piRoot()).getSessionId();
  if (!Number.isSafeInteger(atSeq) || atSeq < 0) throw Object.assign(new Error("atSeq must be a non-negative safe integer"), { code: "bad-request" });
  const sourceManager = SessionManager.open(sourcePath, piRoot());
  const entries = sourceManager.getEntries();
  const selected = entries[atSeq];
  if (!selected || typeof selected.id !== "string") throw Object.assign(new Error(`Pi session has no entry at seq ${atSeq}`), { code: "lookup-not-found" });
  const branchedPath = sourceManager.createBranchedSession(selected.id);
  if (!branchedPath) throw new Error(`Pi session cannot create a branched session at seq ${atSeq}`);
  try {
    return SessionManager.forkFrom(branchedPath, workspaceRoot(cwd), piRoot()).getSessionId();
  } finally {
    await rm(branchedPath, { force: true }).catch(() => undefined);
  }
}

type PiSessionMessageEntry = Extract<SessionEntry, { type: "message" }>;
type PiSessionEntry = SessionEntry;
type PiAgentMessage = PiSessionMessageEntry["message"] & {
  role?: string;
  content?: unknown;
};

function isUserPromptEntry(entry: PiSessionEntry): entry is PiSessionMessageEntry {
  return entry.type === "message" && (entry as PiSessionMessageEntry).message?.role === "user";
}

function messageOf(entry: PiSessionEntry): PiAgentMessage | null {
  if (entry.type !== "message") return null;
  return entry.message as PiAgentMessage;
}

function assistantText(entry: PiSessionEntry | undefined): string {
  if (!entry) return "";
  const msg = messageOf(entry);
  if (msg?.role !== "assistant") return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((part): part is { type: "text"; text: string } => typeof part === "object" && part !== null && (part as { type?: string }).type === "text")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

function assistantToolNames(entry: PiSessionEntry | undefined): string[] {
  if (!entry) return [];
  const msg = messageOf(entry);
  if (msg?.role !== "assistant") return [];
  if (!Array.isArray(msg.content)) return [];
  const names: string[] = [];
  for (const part of msg.content) {
    if (typeof part !== "object" || part === null) continue;
    const obj = part as { type?: string; name?: string };
    if (obj.type === "toolUse" && typeof obj.name === "string") names.push(obj.name);
  }
  return names;
}

function summarizeToolNames(tools: string[]): { names: string[]; overflow: number } {
  if (tools.length <= 3) return { names: tools, overflow: 0 };
  return { names: tools.slice(0, 3), overflow: tools.length - 3 };
}

export async function rewindPoints(sessionFile: string): Promise<RewindPoint[]> {
  // Read through SessionManager so we get the typed tree (parent chain,
  // entry kinds, message shapes). The previous raw JSONL parse was
  // duplicating pi's loader and silently dropped assistant replies and
  // tool-call metadata that the timeline UI needs.
  const manager = SessionManager.open(sessionFile, undefined, "");
  const entries = manager.getEntries();
  const prompts = entries.filter(isUserPromptEntry);

  return prompts.map((promptEntry, promptIndex): RewindPoint => {
    const message = messageOf(promptEntry);
    const promptPreview = typeof message?.content === "string"
      ? message.content.slice(0, 160)
      : Array.isArray(message?.content)
        ? message.content
            .filter((part): part is { type: "text"; text: string } => typeof part === "object" && part !== null && (part as { type?: string }).type === "text")
            .map((part) => part.text)
            .join(" ")
            .slice(0, 160)
        : "";

    // Walk forward from the user prompt to collect everything until the
    // next user prompt (or session end) so we can summarise the assistant
    // turn that belongs to this rewind point.
    const turn: PiSessionEntry[] = [];
    let collecting = false;
    for (const entry of entries) {
      if (!collecting && entry.id === promptEntry.id) { collecting = true; }
      if (!collecting) continue;
      if (entry.id !== promptEntry.id && isUserPromptEntry(entry)) break;
      turn.push(entry);
    }

    const assistantTurn = turn.find((entry) => messageOf(entry)?.role === "assistant");
    const messagePreview = assistantText(assistantTurn);
    const toolNamesAll = turn.flatMap(assistantToolNames);
    const { names, overflow } = summarizeToolNames(toolNamesAll);
    const hasFileChanges = toolNamesAll.some((name) => /^(write|edit|create|delete|patch|apply_patch|applyPatch)$/i.test(name));
    const hasMemoryChanges = toolNamesAll.some((name) => /^(memory|remember|forget|memorize)$/i.test(name));

    return {
      promptIndex,
      promptPreview,
      timestamp: promptEntry.timestamp,
      messagePreview: messagePreview ? (messagePreview.length > 200 ? messagePreview.slice(0, 200) + "…" : messagePreview) : undefined,
      hasFileChanges,
      hasMemoryChanges,
      toolNames: names.length > 0 ? (overflow > 0 ? [...names, `+${overflow}`] : names) : undefined,
    };
  });
}

export async function readPromptHistory(limit = 100): Promise<string[]> {
  const file = join(agentRoot(), "prompt-history.json");
  const values = await readJson<unknown[]>(file, []);
  return values.filter((value): value is string => typeof value === "string").slice(-Math.max(1, Math.min(limit, 500)));
}

export async function writePromptHistory(prompt: string): Promise<void> {
  const values = await readPromptHistory(500);
  values.push(prompt);
  await writeJson(join(agentRoot(), "prompt-history.json"), values.slice(-500));
}

export async function flushMemory(cwd?: string | null): Promise<{ ok: number; removed: number }> {
  const entries = await listMemory(cwd);
  let ok = 0;
  for (const entry of entries) {
    await writeTextAtomic(join(memoryRoot(entry.scope, cwd), entry.path), entry.content);
    ok += 1;
  }
  return { ok, removed: 0 };
}
