/**
 * peekSessionHeader / peekSubagentMode / scanSessionDir 单元测试.
 *
 * P0 perf: 这些 scanner 替代了 `SessionManager.list / .listAll / .open().getEntries()`
 * 在 session 列表路径. 这个文件验证 scanner 在常见 / 边界 / 大文件场景下输出
 * 与原 API 兼容 (字段名 + 类型), 且不会因为 readline / JSON.parse 全行 / allMessages.join
 * 而被大文件击穿.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { peekSessionHeader, peekSubagentMode, scanSessionDir } from "./session-metadata";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "peek-test-"));
}

function sessionHeader(overrides: Partial<{ id: string; cwd: string; parentSession: string; timestamp: string }> = {}): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: overrides.id ?? "01a0aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    timestamp: overrides.timestamp ?? "2026-09-15T05:00:00.000Z",
    cwd: overrides.cwd ?? "/tmp/proj",
    parentSession: overrides.parentSession,
  });
}

function message(role: "user" | "assistant", text: string, id = "m"): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-09-15T05:00:01.000Z",
    message: {
      role,
      content: text,
    },
  });
}

function sessionInfo(name: string): string {
  return JSON.stringify({
    type: "session_info",
    id: "si1",
    parentId: null,
    timestamp: "2026-09-15T05:00:00.500Z",
    name,
  });
}

function subagentCustom(mode: "continuable" | "one-shot"): string {
  return JSON.stringify({
    type: "custom",
    id: "c1",
    parentId: null,
    timestamp: "2026-09-15T05:00:02.000Z",
    customType: "openbuddy/subagent",
    data: { mode },
  });
}

let tmp: string;

beforeEach(async () => {
  tmp = await makeTempDir();
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("peekSessionHeader", () => {
  test("happy path: header + name + first user message + message count", async () => {
    const file = join(tmp, "session.jsonl");
    await writeFile(file, [
      sessionHeader({ id: "abc", cwd: "/tmp/proj" }),
      sessionInfo("My Session"),
      message("user", "hello world"),
      message("assistant", "hi there", "m2"),
      message("user", "follow up", "m3"),
      "",
    ].join("\n"));

    const info = await peekSessionHeader(file);
    expect(info).not.toBeNull();
    expect(info?.id).toBe("abc");
    expect(info?.cwd).toBe("/tmp/proj");
    expect(info?.name).toBe("My Session");
    expect(info?.firstMessage).toBe("hello world");
    expect(info?.messageCount).toBe(3);
    expect(info?.modified).toBeInstanceOf(Date);
  });

  test("missing file returns null without throwing", async () => {
    expect(await peekSessionHeader(join(tmp, "missing.jsonl"))).toBeNull();
  });

  test("empty file returns null", async () => {
    const file = join(tmp, "empty.jsonl");
    await writeFile(file, "");
    expect(await peekSessionHeader(file)).toBeNull();
  });

  test("malformed header returns null", async () => {
    const file = join(tmp, "bad.jsonl");
    await writeFile(file, "this is not json\n");
    expect(await peekSessionHeader(file)).toBeNull();
  });

  test("non-session header returns null", async () => {
    const file = join(tmp, "wrong-type.jsonl");
    await writeFile(file, JSON.stringify({ type: "message", id: "x" }) + "\n");
    expect(await peekSessionHeader(file)).toBeNull();
  });

  test("large file (>PEEK_MAX_BYTES) reports at least one message", async () => {
    // Synthesize a 5 MB file with header + many messages.
    const lines = [
      sessionHeader({ id: "big" }),
      sessionInfo("Big Session"),
    ];
    for (let i = 0; i < 20000; i++) {
      lines.push(message("user", "x".repeat(100), `m${i}`));
    }
    const content = lines.join("\n") + "\n";
    const file = join(tmp, "big.jsonl");
    await writeFile(file, content);

    const info = await peekSessionHeader(file);
    expect(info).not.toBeNull();
    expect(info?.id).toBe("big");
    expect(info?.name).toBe("Big Session");
    // The file is truncated (5 MB > 4 MB peek); we expect non-zero count from head peek.
    expect(info?.messageCount).toBeGreaterThan(0);
  });
});

describe("peekSubagentMode", () => {
  test("returns continuable when marker carries that mode", async () => {
    const file = join(tmp, "sa.jsonl");
    await writeFile(file, [
      sessionHeader(),
      message("user", "hi"),
      subagentCustom("continuable"),
      "",
    ].join("\n"));

    expect(await peekSubagentMode(file)).toBe("continuable");
  });

  test("returns one-shot when marker has one-shot mode", async () => {
    const file = join(tmp, "sa.jsonl");
    await writeFile(file, [
      sessionHeader(),
      message("user", "hi"),
      subagentCustom("one-shot"),
      "",
    ].join("\n"));

    expect(await peekSubagentMode(file)).toBe("one-shot");
  });

  test("returns one-shot default when marker missing", async () => {
    const file = join(tmp, "sa.jsonl");
    await writeFile(file, [
      sessionHeader(),
      message("user", "hi"),
      "",
    ].join("\n"));

    expect(await peekSubagentMode(file)).toBe("one-shot");
  });

  test("returns one-shot when file missing", async () => {
    expect(await peekSubagentMode(join(tmp, "missing.jsonl"))).toBe("one-shot");
  });
});

describe("scanSessionDir", () => {
  test("returns empty list for missing dir", async () => {
    expect(await scanSessionDir(join(tmp, "no-such-dir"))).toEqual([]);
  });

  test("skips non-jsonl entries", async () => {
    await writeFile(join(tmp, "session1.jsonl"), [
      sessionHeader({ id: "s1" }),
      message("user", "hi"),
      "",
    ].join("\n"));
    await writeFile(join(tmp, "notes.md"), "# not a session");
    await writeFile(join(tmp, "session2.jsonl"), [
      sessionHeader({ id: "s2" }),
      message("user", "world"),
      "",
    ].join("\n"));

    const results = await scanSessionDir(tmp);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(["s1", "s2"]);
  });
});