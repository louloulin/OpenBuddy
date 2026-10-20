/**
 * Tests for electron/main/runtime/crashpad.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _resetForTests,
  getCrashpadDir,
  installMainCrashHandlers,
  MAIN_CRASH_EXIT_CODE,
  recordMainCrash,
  recordRendererCrash,
  startCrashpad,
  type CrashReportLike,
} from "./crashpad.js";

describe("crashpad", () => {
  let scratch: string;
  afterEach(() => {
    _resetForTests();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("creates the crashpad directory and calls crashReport.start with uploadToServer: false", () => {
    scratch = mkdtempSync(join(tmpdir(), "ob-crash-"));
    const startCalls: unknown[] = [];
    const fake: CrashReportLike = {
      start(opts) { startCalls.push(opts); },
      getLastCrashReport: () => null,
      getUploadedReports: () => [],
    };
    const { crashpadDir } = startCrashpad({ dataDir: scratch, crashReport: fake });
    expect(existsSync(crashpadDir)).toBe(true);
    expect(crashpadDir.endsWith("crash-dumps")).toBe(true);
    expect(startCalls.length).toBe(1);
    const opts = startCalls[0] as { uploadToServer: boolean; crashpadDir: string };
    expect(opts.uploadToServer).toBe(false);
    expect(opts.crashpadDir).toBe(crashpadDir);
    expect("submitURL" in opts).toBe(false);
    expect(getCrashpadDir()).toBe(crashpadDir);
  });

  it("honours an explicit crashpadDir override", () => {
    scratch = mkdtempSync(join(tmpdir(), "ob-crash-"));
    const override = join(scratch, "alt");
    const fake: CrashReportLike = { start: () => {}, getLastCrashReport: () => null, getUploadedReports: () => [] };
    const { crashpadDir } = startCrashpad({ dataDir: scratch, crashpadDir: override, crashReport: fake });
    expect(crashpadDir).toBe(override);
    expect(existsSync(crashpadDir)).toBe(true);
  });

  it("is idempotent across repeated calls", () => {
    scratch = mkdtempSync(join(tmpdir(), "ob-crash-"));
    const startCalls: unknown[] = [];
    const fake: CrashReportLike = {
      start: (opts) => startCalls.push(opts),
      getLastCrashReport: () => null,
      getUploadedReports: () => [],
    };
    startCrashpad({ dataDir: scratch, crashReport: fake });
    startCrashpad({ dataDir: scratch, crashReport: fake });
    // Second call should not re-invoke `start`.
    expect(startCalls.length).toBe(1);
  });

  it("recordRendererCrash writes a JSONL line + a structured dump file", () => {
    scratch = mkdtempSync(join(tmpdir(), "ob-crash-"));
    const fake: CrashReportLike = { start: () => {}, getLastCrashReport: () => null, getUploadedReports: () => [] };
    const { crashpadDir } = startCrashpad({ dataDir: scratch, crashReport: fake });
    const entry = recordRendererCrash(crashpadDir, {
      windowLabel: "main",
      exitCode: -1,
      reason: "render-process-gone",
      rendererVersion: "1.0.0",
    });
    expect(entry.schema).toBe("openbuddy.crashpad.renderer.v1");
    const files = readdirSync(crashpadDir);
    expect(files.some((f) => f === "renderer-crashes.jsonl")).toBe(true);
    expect(files.some((f) => f.startsWith("renderer-main-") && f.endsWith(".json"))).toBe(true);
    const jsonl = readFileSync(join(crashpadDir, "renderer-crashes.jsonl"), "utf8");
    expect(jsonl.split("\n").filter(Boolean).length).toBe(1);
    expect(JSON.parse(jsonl.trim()).windowLabel).toBe("main");
  });

  it("recordMainCrash writes JSONL + structured dump for uncaughtException", () => {
    scratch = mkdtempSync(join(tmpdir(), "ob-crash-"));
    const fake: CrashReportLike = { start: () => {}, getLastCrashReport: () => null, getUploadedReports: () => [] };
    const { crashpadDir } = startCrashpad({ dataDir: scratch, crashReport: fake });
    const entry = recordMainCrash(crashpadDir, {
      kind: "uncaughtException",
      name: "TypeError",
      message: "boom",
      stack: "TypeError: boom\n    at test",
    });
    expect(entry.schema).toBe("openbuddy.crashpad.main.v1");
    expect(entry.kind).toBe("uncaughtException");
    expect(entry.message).toBe("boom");
    expect(entry.name).toBe("TypeError");
    // JSONL stream should have one line
    const jsonl = readFileSync(join(crashpadDir, "main-crashes.jsonl"), "utf8");
    expect(jsonl.split("\n").filter(Boolean)).toHaveLength(1);
    // Structured dump file should exist with the schema
    const files = readdirSync(crashpadDir).filter((f) => f.startsWith("main-uncaughtException-"));
    expect(files).toHaveLength(1);
    const parsed = JSON.parse(readFileSync(join(crashpadDir, files[0]), "utf8"));
    expect(parsed.schema).toBe("openbuddy.crashpad.main.v1");
    expect(parsed.kind).toBe("uncaughtException");
    expect(parsed.stack).toContain("TypeError");
  });

  it("recordMainCrash supports unhandledRejection kind", () => {
    scratch = mkdtempSync(join(tmpdir(), "ob-crash-"));
    const fake: CrashReportLike = { start: () => {}, getLastCrashReport: () => null, getUploadedReports: () => [] };
    const { crashpadDir } = startCrashpad({ dataDir: scratch, crashReport: fake });
    const entry = recordMainCrash(crashpadDir, {
      kind: "unhandledRejection",
      message: "promise rejected",
    });
    expect(entry.kind).toBe("unhandledRejection");
    expect(entry.stack).toBeUndefined();
  });
});

/**
 * P0-7「崩溃即退」—— 这组用例钉的是 **exit 语义**,不是落盘语义。
 *
 * 只要 main 进程注册了 `uncaughtException` 监听器,Node 的默认终止行为就
 * 被关掉了。曾经 handler 只写日志就返回,于是"崩溃"被降级成了"继续跑但状态
 * 已经不可信"——window 句柄、host-core IPC、SQLite 游标全都可能处于半完成
 * 状态,而用户界面看不出任何异常。这里保证 uncaughtException 一定会退,
 * 并且退出**发生在**落盘之后;unhandledRejection 则相反,只记录不退出。
 */
describe("installMainCrashHandlers — 崩溃即退", () => {
  let scratch: string;
  const disposers: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    _resetForTests();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * 装一次处理器并手动触发它的监听器 —— 真抛异常会把 vitest 一起带走。
   * `fire` 只调用我们刚装上的那一个,不去碰 vitest 自己的钩子。
   */
  function harness(crashpadDir: string) {
    const exitCodes: number[] = [];
    const logged: unknown[][] = [];
    const before = {
      uncaught: process.listeners("uncaughtException").length,
      rejection: process.listeners("unhandledRejection").length,
    };
    disposers.push(
      installMainCrashHandlers({
        crashpadDir,
        exit: (code) => exitCodes.push(code),
        log: (...args) => logged.push(args),
      }),
    );
    const fire = (event: "uncaughtException" | "unhandledRejection", payload: unknown): void => {
      const key = event === "uncaughtException" ? "uncaught" : "rejection";
      const ours = process.listeners(event)[before[key]];
      expect(ours, "installMainCrashHandlers 没有注册监听器").toBeTypeOf("function");
      // process.listeners() 的元素类型是 uncaughtException / unhandledRejection
      // 两个重载签名的联合；两者都以「第一个参数 = 事件载荷」调用，所以这里
      // 只取首参签名是安全的。经 unknown 中转是因为 TS 不允许直接把联合
      // 断言到其中一支（TS2352）。
      (ours as unknown as (arg: unknown) => void)(payload);
    };
    return { exitCodes, logged, fire };
  }

  it("uncaughtException 先落盘、再以非零码退出", () => {
    scratch = mkdtempSync(join(tmpdir(), "ob-crash-exit-"));
    const { exitCodes, fire } = harness(scratch);

    fire("uncaughtException", new TypeError("main exploded"));

    expect(exitCodes).toEqual([MAIN_CRASH_EXIT_CODE]);
    // 0 会被崩溃循环监控误读成「单实例锁让位,正常退出」。
    expect(MAIN_CRASH_EXIT_CODE).not.toBe(0);
    const dumps = readdirSync(scratch).filter((f) => f.startsWith("main-uncaughtException-"));
    expect(dumps).toHaveLength(1);
    const parsed = JSON.parse(readFileSync(join(scratch, dumps[0]), "utf8"));
    expect(parsed.message).toBe("main exploded");
    expect(parsed.stack).toContain("TypeError");
  });

  it("unhandledRejection 只记录,不退出", () => {
    scratch = mkdtempSync(join(tmpdir(), "ob-crash-exit-"));
    const { exitCodes, fire } = harness(scratch);

    fire("unhandledRejection", new Error("best-effort blew up"));

    expect(exitCodes).toEqual([]);
    const dumps = readdirSync(scratch).filter((f) => f.startsWith("main-unhandledRejection-"));
    expect(dumps).toHaveLength(1);
  });

  it("非 Error 的抛出物也照样落盘(throw 一个裸字符串)", () => {
    scratch = mkdtempSync(join(tmpdir(), "ob-crash-exit-"));
    const { exitCodes, fire } = harness(scratch);

    fire("uncaughtException", "just a string");

    expect(exitCodes).toEqual([MAIN_CRASH_EXIT_CODE]);
    const dumps = readdirSync(scratch).filter((f) => f.startsWith("main-uncaughtException-"));
    expect(JSON.parse(readFileSync(join(scratch, dumps[0]), "utf8")).message).toBe("just a string");
  });

  it("落盘本身抛错也照样退出 —— 否则 dump 失败会造出永不退出的僵尸进程", () => {
    // 把 crashpadDir 的祖先占成一个普通文件,mkdirSync 必然失败。
    const root = mkdtempSync(join(tmpdir(), "ob-crash-blocked-"));
    scratch = root;
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "not a directory");
    const { exitCodes, logged, fire } = harness(join(blocker, "crash-dumps"));

    expect(() => fire("uncaughtException", new Error("crash while dumping"))).not.toThrow();
    expect(exitCodes).toEqual([MAIN_CRASH_EXIT_CODE]);
    // 落盘失败必须留痕,否则原始崩溃原因会被这一条静默吃掉。
    expect(logged.flat().join(" ")).toContain("failed to persist dump");
  });

  it("disposer 摘掉监听器,把控制权交还给 Node 的默认行为", () => {
    scratch = mkdtempSync(join(tmpdir(), "ob-crash-exit-"));
    const { fire } = harness(scratch);
    fire("uncaughtException", new Error("first"));
    for (const dispose of disposers.splice(0)) dispose();
    const dumps = readdirSync(scratch).filter((f) => f.startsWith("main-uncaughtException-"));
    expect(dumps).toHaveLength(1);
    expect(process.listenerCount("uncaughtException")).toBe(1); // 只剩 vitest 自己的
  });
});
