// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createEngineHandlers } from "@openbuddy/host/handlers";
import type { SessionSearchHit } from "@openbuddy/protocol/search";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "keychain",
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString(),
};
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

describe("session_search through the host session module (pii W1.4)", () => {
  it("returns titled, highlighted hits for saved sessions and honours cwd, archive flags and renames", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "openbuddy-search-host-")));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const host = await createEngineHandlers({ userDataDir: root, safeStorage, emit: () => {}, shell: { openPath: async () => "", openExternal: async () => {}, showItemInFolder: () => {} } });
    cleanups.push(host.dispose);
    const call = async (name: string, payload: Record<string, unknown> = {}) => host.handlers[name]!(payload);
    const sessions = join(root, "pi", "sessions");
    const make = (cwd: string, question: string, answer: string) => {
      const manager = SessionManager.create(cwd, sessions);
      manager.appendMessage({ role: "user", content: question, timestamp: Date.now() } as never);
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: answer }], api: "openai-completions", provider: "fixture", model: "fixture", usage, stopReason: "stop", timestamp: Date.now() } as never);
      return manager.getSessionId();
    };
    const a = make(root, "整理一下季度报告的要点", "季度报告的三个要点如下");
    const b = make(join(root, "pi"), "无关的会话", "完全不同的内容");

    const hits = (await call("session_search", { query: "季度报告" })) as SessionSearchHit[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sessionId: a, cwd: root, title: "整理一下季度报告的要点", matchedIn: "both", archived: false });
    expect(hits[0].snippet.slice(...hits[0].matches[0])).toBe("季度报告");
    expect(typeof hits[0].updatedAt).toBe("string");

    await call("agent_rename_session", { sessionId: b, title: "周报 草稿" });
    await call("agent_set_session_archived", { sessionId: b, archived: true });
    const renamed = (await call("session_search", { query: "周报" })) as SessionSearchHit[];
    expect(renamed.map((h) => [h.sessionId, h.title, h.matchedIn, h.archived])).toEqual([[b, "周报 草稿", "title", true]]);
    expect(((await call("session_search", { query: "内容", cwd: root })) as SessionSearchHit[]).length).toBe(0);
    await expect(call("session_search", { query: "  " })).rejects.toThrow();
  }, 30_000);

  it("re-reads only changed session files and leaves the sidebar's list cache alone", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "openbuddy-search-host-")));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const host = await createEngineHandlers({ userDataDir: root, safeStorage, emit: () => {}, shell: { openPath: async () => "", openExternal: async () => {}, showItemInFolder: () => {} } });
    cleanups.push(host.dispose);
    const call = async (name: string, payload: Record<string, unknown> = {}) => host.handlers[name]!(payload);
    const sessions = join(root, "pi", "sessions");
    const make = (question: string) => {
      const manager = SessionManager.create(root, sessions);
      manager.appendMessage({ role: "user", content: question, timestamp: Date.now() } as never);
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "好的" }], api: "openai-completions", provider: "fixture", model: "fixture", usage, stopReason: "stop", timestamp: Date.now() } as never);
      return manager;
    };
    make("第一个会话 alpha");
    const second = make("第二个会话 beta");
    const listAll = vi.spyOn(SessionManager, "listAll");
    cleanups.push(async () => listAll.mockRestore());
    expect(((await call("agent_list_sessions", { cwd: root })) as unknown[]).length).toBe(2);
    expect(listAll).toHaveBeenCalledTimes(1);
    expect(((await call("session_search", { query: "alpha" })) as SessionSearchHit[]).length).toBe(1);
    second.appendMessage({ role: "user", content: "新的问题 gamma", timestamp: Date.now() } as never);
    second.appendMessage({ role: "assistant", content: [{ type: "text", text: "回答" }], api: "openai-completions", provider: "fixture", model: "fixture", usage, stopReason: "stop", timestamp: Date.now() } as never);
    expect(((await call("session_search", { query: "gamma" })) as SessionSearchHit[]).map((h) => h.sessionId)).toEqual([second.getSessionId()]);
    // Searching never parsed every session through listAll, and the sidebar's cached list is still served.
    expect(listAll).toHaveBeenCalledTimes(1);
    await call("agent_list_sessions", { cwd: root });
    expect(listAll).toHaveBeenCalledTimes(1);
  }, 30_000);
});
