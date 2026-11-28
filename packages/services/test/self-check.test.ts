// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bundledAppsCheck, crashKind, crashLogCheck, diskSpaceCheck, formatSelfCheckReport, runSelfCheck, saveSelfCheckReport, writableCheck,
} from "../src/support/self-check";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "openbuddy-selfcheck-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("启动自检 (§1.18)", () => {
  it("单项超时或抛错记为失败，其它项照常；报告去掉绝对路径", async () => {
    const report = await runSelfCheck([
      { id: "ok", title: "正常", run: async () => ({ status: "pass", summary: "目录 /Users/alice/Library 正常" }) },
      { id: "boom", title: "出错", run: async () => { throw new Error("坏了"); } },
      { id: "slow", title: "超时", timeoutMs: 20, run: () => new Promise(() => {}) },
    ]);
    expect(report.results.map((r) => r.status)).toEqual(["pass", "fail", "fail"]);
    expect(report.results[2].summary).toContain("超时");
    expect(report.counts).toEqual({ pass: 1, warning: 0, fail: 2, info: 0 });
    const text = formatSelfCheckReport(report);
    expect(text).toContain("[通过] 正常");
    expect(text).toContain("汇总：1 通过 / 0 警告 / 2 失败 / 0 信息（共 3 项）");
    expect(text).not.toContain("/Users/alice");
  });

  it("磁盘：<1 GB 失败、<5 GB 警告；数据目录可写", async () => {
    const GB = 1024 ** 3;
    const at = (free: number) => diskSpaceCheck("/x", async () => ({ bavail: free / 4096, bsize: 4096 })).run();
    expect((await at(0.5 * GB)).status).toBe("fail");
    expect((await at(3 * GB)).status).toBe("warning");
    expect((await at(50 * GB)).status).toBe("pass");
    const dir = tmp();
    expect((await writableCheck(dir).run()).status).toBe("pass");
    expect(readdirSync(dir)).toEqual([]);
    expect((await writableCheck(join(dir, "missing")).run()).status).toBe("fail");
  });

  it("内置应用：缺目录 / 缺依赖失败，缺版本标记警告，完整时给出版本", async () => {
    const root = tmp();
    const full = join(root, "upup");
    mkdirSync(join(full, "node_modules"), { recursive: true });
    writeFileSync(join(full, "package.json"), "{}");
    const noDeps = join(root, "nodeps");
    mkdirSync(noDeps);
    writeFileSync(join(noDeps, "package.json"), "{}");
    const read = (dir: string) => (dir === full ? { version: "2026.10.11", commit: "69050042abc" } : undefined);
    expect(await bundledAppsCheck([full], read).run()).toMatchObject({ status: "pass", summary: "upup：2026.10.11 · 6905004" });
    expect((await bundledAppsCheck([full, noDeps], read).run()).status).toBe("fail");
    expect((await bundledAppsCheck([join(root, "gone")], read).run()).summary).toContain("目录缺失");
    const noMarker = join(root, "nomarker");
    mkdirSync(join(noMarker, "node_modules"), { recursive: true });
    writeFileSync(join(noMarker, "package.json"), "{}");
    expect((await bundledAppsCheck([noMarker], read).run()).status).toBe("warning");
    expect((await bundledAppsCheck([], read).run()).status).toBe("info");
  });

  it("崩溃记录：只算真崩溃，正常退出、卡死快照、EPIPE 和 7 天前的不算", async () => {
    expect(crashKind({ message: "render-process-gone", data: { reason: "clean-exit" } })).toBeUndefined();
    expect(crashKind({ message: "render-process-gone", data: { reason: "crashed" } })).toBe("界面崩溃");
    expect(crashKind({ message: "uncaughtException", data: { message: "write EPIPE" } })).toBeUndefined();
    expect(crashKind({ level: "warn", message: "native-crash-dump" })).toBeUndefined();
    expect(crashKind({ level: "error", message: "native-crash-dump" })).toBe("原生崩溃");

    const dir = tmp();
    const now = Date.parse("2026-11-28T10:00:00Z");
    expect((await crashLogCheck(dir, { now: () => now }).run()).status).toBe("pass");
    const line = (ts: string, level: string, message: string, data: Record<string, unknown>) => JSON.stringify({ ts, level, scope: "main", message, data });
    writeFileSync(join(dir, "openbuddy-2026-11-28.log"), [
      line("2026-11-28T09:00:00Z", "warn", "render-process-gone", { reason: "crashed", decision: "reload" }),
      line("2026-11-28T09:01:00Z", "warn", "render-process-gone", { reason: "clean-exit" }),
      line("2026-11-28T09:02:00Z", "error", "uncaughtException", { message: "TypeError: x is undefined" }),
      line("2026-11-28T09:03:00Z", "error", "native-crash-dump", { file: "a.dmp", summary: { kind: "crash", exceptionName: "EXC_BAD_ACCESS" } }),
      line("2026-11-10T09:00:00Z", "error", "uncaughtException", { message: "old" }),
      "not json",
    ].join("\n"));
    const result = await crashLogCheck(dir, { now: () => now }).run();
    expect(result.status).toBe("warning");
    expect(result.summary).toBe("最近 7 天 3 次：原生崩溃 1，主进程异常 1，界面崩溃 1");
    expect(result.detail?.split("\n")[0]).toBe("[2026-11-28T09:03:00.000Z] 原生崩溃：EXC_BAD_ACCESS");
  });

  it("报告只保留最近 10 份", async () => {
    const dir = tmp();
    for (let i = 0; i < 12; i++) await saveSelfCheckReport(dir, `r${i}`, { now: Date.parse("2026-11-28T00:00:00Z") + i * 1000 });
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(10);
    expect(files[0]).toBe("self-check-2026-11-28T00-00-02-000Z.txt");
  });
});
