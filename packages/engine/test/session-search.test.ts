// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionSearchIndex, highlightRanges, makeSnippet, searchTerms, searchableText } from "../src/session-search";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const user = (text: string) => ({ role: "user", content: text, timestamp: Date.now() }) as never;
const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "fixture", model: "fixture", usage, stopReason: "stop", timestamp: Date.now() }) as never;

async function sessionDir() {
  const dir = await mkdtemp(join(tmpdir(), "openbuddy-search-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function write(dir: string, cwd: string, turns: Array<[string, string]>) {
  const manager = SessionManager.create(cwd, dir);
  for (const [question, answer] of turns) {
    manager.appendMessage(user(question));
    manager.appendMessage(assistant(answer));
  }
  return manager;
}
function counting(dir: string) {
  const calls = { list: 0 };
  const index = new SessionSearchIndex(dir, () => { calls.list++; return SessionManager.listAll(dir); });
  return { index, calls };
}

describe("session search helpers (pii W1.4)", () => {
  it("drops what the host injected into prompts but keeps attachment and skill names", () => {
    const raw = "<openbuddy-plan-mode>\n先调研，给出计划\n</openbuddy-plan-mode>\n整理  季度报告 <!--EXPERT_PERSONA_BEGIN-->你是分析师<!--EXPERT_PERSONA_END--> <attachment name=\"data.csv\">a,b,c</attachment> <skill name=\"pdf\" location=\"x\">body</skill>";
    expect(searchableText(raw)).toBe("整理 季度报告 data.csv pdf");
  });

  it("splits terms, highlights every occurrence and cuts a snippet around the first hit", () => {
    expect(searchTerms("  Report  report 季度 ")).toEqual(["report", "季度"]);
    expect(highlightRanges("Report on the report", ["report"])).toEqual([[0, 6], [14, 20]]);
    expect(highlightRanges("abcabc", ["abc", "bca"])).toEqual([[0, 6]]);
    const text = `${"前文".repeat(100)}这里提到季度报告的结论${"后文".repeat(100)}`;
    const { snippet, matches } = makeSnippet(text, ["季度报告"]);
    expect(snippet.startsWith("…") && snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(122);
    expect(matches).toHaveLength(1);
    expect(snippet.slice(matches[0][0], matches[0][1])).toBe("季度报告");
    expect(makeSnippet("short text", ["text"])).toEqual({ snippet: "short text", matches: [[6, 10]] });
  });
});

describe("SessionSearchIndex (pii W1.4)", () => {
  it("finds sessions by message text with AND terms, ranks title hits and filters by cwd", async () => {
    const dir = await sessionDir();
    write(dir, "/work/a", [["帮我整理季度报告", "好的，季度报告已经整理完成"]]);
    write(dir, "/work/b", [["写一个 Python 脚本", "这是脚本，可以生成报告"]]);
    write(dir, "/work/b", [["随便聊聊", "今天天气不错"]]);
    const { index } = counting(dir);
    const hits = await index.search("季度报告");
    expect(hits.map((h) => h.session.cwd)).toEqual(["/work/a"]);
    expect(hits[0].matchedIn).toBe("content");
    expect(hits[0].matchCount).toBe(2);
    expect(hits[0].snippet.slice(hits[0].matches[0][0], hits[0].matches[0][1])).toBe("季度报告");
    expect((await index.search("脚本 报告")).map((h) => h.session.cwd)).toEqual(["/work/b"]);
    expect(await index.search("脚本 天气")).toEqual([]);
    expect((await index.search("报告", { cwd: "/work/b" })).map((h) => h.session.cwd)).toEqual(["/work/b"]);
    const titled = await index.search("天气 周报", { title: (s) => (s.cwd === "/work/b" && s.firstMessage === "随便聊聊" ? "周报草稿" : "") });
    expect(titled).toHaveLength(1);
    expect(titled[0].matchedIn).toBe("both");
    expect(await index.search("   ")).toEqual([]);
  });

  it("200 sessions: cached searches stay under 300 ms and only changed files are re-indexed", async () => {
    const dir = await sessionDir();
    const managers = Array.from({ length: 200 }, (_, i) =>
      write(dir, `/work/p${i % 5}`, Array.from({ length: 6 }, (_, t) => [`第 ${i} 个任务的第 ${t} 轮提问：分析数据集 ${i}-${t}`, `回答 ${i}-${t}：${"这是一些较长的分析内容，包含表格和结论。".repeat(8)}${i === 137 && t === 3 ? "独特关键词 zebra-137" : ""}`] as [string, string])),
    );
    const { index, calls } = counting(dir);
    const cold = performance.now();
    expect((await index.search("zebra-137")).map((h) => h.session.id)).toEqual([managers[137].getSessionId()]);
    const coldMs = performance.now() - cold;
    expect(index.lastRefresh).toEqual({ rebuilt: 200, total: 200, skipped: false });

    const timings: number[] = [];
    for (const query of ["zebra-137", "分析数据集 42-3", "表格 结论", "不存在的词"]) {
      const start = performance.now();
      await index.search(query);
      timings.push(performance.now() - start);
    }
    expect(calls.list).toBe(1);
    expect(index.lastRefresh.skipped).toBe(true);
    expect(Math.max(...timings)).toBeLessThan(300);
    expect((await index.search("表格 结论", { limit: 500 })).length).toBe(100);

    // One session gets a new turn: the next search sees it and re-indexes only that file.
    managers[7].appendMessage(user("新的提问：长颈鹿"));
    managers[7].appendMessage(assistant("关于长颈鹿的回答"));
    const hits = await index.search("长颈鹿");
    expect(hits.map((h) => h.session.id)).toEqual([managers[7].getSessionId()]);
    expect(index.lastRefresh).toEqual({ rebuilt: 1, total: 200, skipped: false });
    expect(calls.list).toBe(2);
    console.log(`session search: cold ${coldMs.toFixed(0)} ms, cached max ${Math.max(...timings).toFixed(1)} ms over 200 sessions`);
  }, 60_000);

  it("drops deleted sessions and handles a missing directory", async () => {
    const dir = await sessionDir();
    const kept = write(dir, "/w", [["保留的会话", "内容 alpha"]]);
    const gone = write(dir, "/w", [["要删除的会话", "内容 alpha"]]);
    const { index } = counting(dir);
    expect(await index.search("alpha")).toHaveLength(2);
    await rm(gone.getSessionFile()!);
    expect((await index.search("alpha")).map((h) => h.session.id)).toEqual([kept.getSessionId()]);
    const empty = new SessionSearchIndex(join(dir, "missing"), async () => []);
    expect(await empty.search("alpha")).toEqual([]);
  });
});
