/**
 * Tests for electron/main/runtime/crashpad.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _resetForTests,
  getCrashpadDir,
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