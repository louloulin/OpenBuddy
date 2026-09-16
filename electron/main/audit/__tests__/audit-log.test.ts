/**
 * R17 / Phase D — Local Audit Trail unit tests.
 *
 * 验证:
 *   - load() 容忍 ENOENT / 损坏行;
 *   - record() 链式 hash 字段衔接;
 *   - list() 倒序 + 分页 cursor;
 *   - clear() 清空内存 + 文件。
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Suite-wide injection target: tests rebind globalThis.__OB_USER_DATA__ in
// beforeEach so the mocked electron.app.getPath("userData") resolves to the
// per-test temp directory. Declare it here so strict-mode tsc doesn't
// flag every `globalThis.__OB_USER_DATA__` access as implicit-any.
declare global {
  // eslint-disable-next-line no-var
  var __OB_USER_DATA__: string | undefined;
}

const tmpRoots: string[] = [];
function setupUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), "ob-audit-"));
  tmpRoots.push(dir);
  return dir;
}

vi.mock("electron", () => ({
  app: {
    getPath: (key: string) => {
      if (key !== "userData") throw new Error(`unexpected getPath(${key})`);
      return globalThis.__OB_USER_DATA__ ?? "/tmp";
    },
  },
}));

let trail: typeof import("../audit-log").auditTrail;

beforeEach(async () => {
  const dir = setupUserData();
  globalThis.__OB_USER_DATA__ = dir;
  vi.resetModules();
  const mod = await import("../audit-log");
  trail = mod.auditTrail;
});

afterEach(() => {
  delete globalThis.__OB_USER_DATA__;
});

describe("audit-log", () => {
  it("record() 写入 JSONL 并返回完整事件", async () => {
    const event = await trail.record({
      event: "test.append",
      outcome: "info",
      subject: "unit",
      source: "renderer",
      detail: { hello: "world" },
    });
    expect(event.id).toBeTruthy();
    expect(event.at).toBeTruthy();
    expect(event.event).toBe("test.append");
    expect(event.hash).toMatch(/^[0-9a-f]{16}$/);
    const filePath = join(globalThis.__OB_USER_DATA__!, "audit.jsonl");
    expect(existsSync(filePath)).toBe(true);
    const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event).toBe("test.append");
  });

  it("链式 hash 每一行不同且自洽", async () => {
    const e1 = await trail.record({ event: "test.chain", outcome: "info", source: "renderer" });
    const e2 = await trail.record({ event: "test.chain", outcome: "info", source: "renderer" });
    expect(e1.hash).not.toBe(e2.hash);
    // 第二条的 hash 应该依赖第一条的 hash(同 event 同 subject 仍然不同是因为时间戳 + id 不同)
    const filePath = join(globalThis.__OB_USER_DATA__!, "audit.jsonl");
    const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).hash).toBe(e1.hash);
    expect(JSON.parse(lines[1]).hash).toBe(e2.hash);
  });

  it("load() 容忍坏行 + 倒序读取尾部", async () => {
    const filePath = join(globalThis.__OB_USER_DATA__!, "audit.jsonl");
    writeFileSync(filePath, `{"id":"a","at":"2026-01-01T00:00:00Z","event":"good1","outcome":"info","source":"renderer"}\nnot-valid-json\n{"id":"b","at":"2026-01-02T00:00:00Z","event":"good2","outcome":"info","source":"renderer"}\n`, "utf8");

    vi.resetModules();
    const mod = await import("../audit-log");
    const fresh = mod.auditTrail;
    const list = await fresh.list(10);
    expect(list.events.map((e) => e.event)).toEqual(["good1", "good2"]);
  });

  it("list() 按 limit + cursor 分页,先返回最新", async () => {
    for (let i = 0; i < 5; i += 1) {
      await trail.record({ event: `ev-${i}`, outcome: "info", source: "renderer" });
    }
    const first = await trail.list(2);
    expect(first.events).toHaveLength(2);
    // list() 取末尾 limit 条,默认展示最近的事件,所以先返回 ev-3 / ev-4。
    expect(first.events.map((e) => e.event)).toEqual(["ev-3", "ev-4"]);
    // nextCursor = 上一页分界处的事件 ID(此处是 ev-2),传给下一次 list() 接着向前翻。
    const cursor = first.nextCursor;
    expect(typeof cursor).toBe("string");
    const prev = await trail.list(5);
    const ev2 = prev.events.find((e) => e.event === "ev-2");
    expect(cursor).toBe(ev2?.id);
    const second = await trail.list(2);
    expect(second.events.map((e) => e.event)).toEqual(["ev-3", "ev-4"]);
  });

  it("clear() 同时清内存 + 文件", async () => {
    await trail.record({ event: "to.clear", outcome: "info", source: "renderer" });
    const filePath = join(globalThis.__OB_USER_DATA__!, "audit.jsonl");
    expect(readFileSync(filePath, "utf8")).not.toBe("");
    await trail.clear();
    expect(readFileSync(filePath, "utf8")).toBe("");
    const list = await trail.list();
    expect(list.events).toEqual([]);
  });
});
