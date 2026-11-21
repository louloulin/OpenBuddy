// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogReader } from "../src/support/log-reader";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-logs-"));
  dirs.push(dir);
  return dir;
}

const line = (level: string, scope: string, message: string, data?: unknown) =>
  `${JSON.stringify({ ts: "2026-11-20T10:00:00.000Z", level, scope, message, ...(data ? { data } : {}) })}\n`;

describe("运行日志读取 (O1)", () => {
  it("lists only the logger's own files, newest first", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "openbuddy-2026-11-19.log"), line("info", "app", "old"));
    writeFileSync(join(dir, "openbuddy-2026-11-20.log"), line("info", "app", "new"));
    writeFileSync(join(dir, "notes.txt"), "not a log");
    writeFileSync(join(dir, "openbuddy-2026-11-18.log.1700000000000"), line("warn", "app", "rotated"));
    utimesSync(join(dir, "openbuddy-2026-11-19.log"), new Date("2026-11-19T10:00:00Z"), new Date("2026-11-19T10:00:00Z"));
    utimesSync(join(dir, "openbuddy-2026-11-20.log"), new Date("2026-11-20T10:00:00Z"), new Date("2026-11-20T10:00:00Z"));
    utimesSync(join(dir, "openbuddy-2026-11-18.log.1700000000000"), new Date("2026-11-18T10:00:00Z"), new Date("2026-11-18T10:00:00Z"));

    const list = new LogReader(dir).list();
    expect(list.dir).toBe(dir);
    expect(list.files.map((file) => file.name)).toEqual([
      "openbuddy-2026-11-20.log",
      "openbuddy-2026-11-19.log",
      "openbuddy-2026-11-18.log.1700000000000",
    ]);
    expect(list.totalBytes).toBeGreaterThan(0);
  });

  it("reads newest first and honours limit / level / query", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "openbuddy-2026-11-20.log"),
      line("info", "app", "started") +
        line("warn", "renderer", "slow paint") +
        line("error", "engine", "turn failed", { code: "boom" }) +
        line("info", "engine", "turn done"),
    );
    const reader = new LogReader(dir);

    const all = reader.read("openbuddy-2026-11-20.log");
    expect(all.entries.map((entry) => entry.message)).toEqual(["turn done", "turn failed", "slow paint", "started"]);
    expect(all.entries[2].level).toBe("warn");
    expect(all.entries[1].data).toEqual({ code: "boom" });
    expect(all.malformed).toBe(0);
    expect(all.truncated).toBe(false);

    const limited = reader.read("openbuddy-2026-11-20.log", { limit: 2 });
    expect(limited.entries.map((entry) => entry.message)).toEqual(["turn done", "turn failed"]);
    expect(limited.truncated).toBe(true);

    const errors = reader.read("openbuddy-2026-11-20.log", { level: "error" });
    expect(errors.entries.map((entry) => entry.message)).toEqual(["turn failed"]);

    const searched = reader.read("openbuddy-2026-11-20.log", { query: "SLOW" });
    expect(searched.entries.map((entry) => entry.message)).toEqual(["slow paint"]);
  });

  it("merges every file newest-first for cross-file search (all)", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "openbuddy-2026-11-19.log"),
      JSON.stringify({ ts: "2026-11-19T10:00:00.000Z", level: "info", scope: "app", message: "older" }) + "\n",
    );
    writeFileSync(
      join(dir, "openbuddy-2026-11-20.log"),
      JSON.stringify({ ts: "2026-11-20T11:00:00.000Z", level: "error", scope: "renderer", message: "newer" }) + "\n" +
        JSON.stringify({ ts: "2026-11-20T09:00:00.000Z", level: "info", scope: "app", message: "middle" }) + "\n",
    );
    utimesSync(join(dir, "openbuddy-2026-11-19.log"), new Date("2026-11-19T10:00:00Z"), new Date("2026-11-19T10:00:00Z"));
    utimesSync(join(dir, "openbuddy-2026-11-20.log"), new Date("2026-11-20T10:00:00Z"), new Date("2026-11-20T10:00:00Z"));

    const reader = new LogReader(dir);
    const all = reader.read("all", { limit: 10 });
    expect(all.name).toBe("all");
    expect(all.entries.map((entry) => entry.message)).toEqual(["newer", "middle", "older"]);

    const limited = reader.read("all", { limit: 2 });
    expect(limited.entries.map((entry) => entry.message)).toEqual(["newer", "middle"]);
    expect(limited.truncated).toBe(true);

    const errors = reader.read("all", { level: "error" });
    expect(errors.entries.map((entry) => entry.message)).toEqual(["newer"]);
  });

  it("counts malformed lines, redacts secrets, and refuses other names", () => {
    const dir = tempDir();
    const fakeKey = ["sk", "live"].join("-") + "abcdef123456";
    writeFileSync(
      join(dir, "openbuddy-2026-11-20.log"),
      "not json\n" +
        JSON.stringify({ ts: "t", level: "info", scope: "app", message: `key ${fakeKey} at /Users/me/app`, data: { token: "secret", note: "mail a@b.com" } }) +
        "\n",
    );
    const result = new LogReader(dir).read("openbuddy-2026-11-20.log");
    expect(result.malformed).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].message).toBe("key [redacted] at [path]");
    expect(result.entries[0].data).toEqual({ token: "[redacted]", note: "mail [email]" });

    expect(() => new LogReader(dir).read("../../etc/passwd")).toThrow("invalid_log_name");
    expect(() => new LogReader(dir).read("openbuddy-2026-01-01.log")).toThrow("log_not_found");
    expect(() => new LogReader(dir).read("openbuddy-2026-11-20.log", { level: "trace" })).toThrow("invalid_log_level");
  });
});
