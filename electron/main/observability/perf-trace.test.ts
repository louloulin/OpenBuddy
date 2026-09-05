import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalUserData = process.env.OPENBUDDY_TEST_USER_DATA;
let appReady = true;
let userDataDir = "";

vi.mock("electron", () => ({
  get app() {
    return {
      isReady: () => appReady,
      getPath: (key: string) => (key === "userData" ? userDataDir : tmpdir()),
    };
  },
}));

async function loadModule() {
  return import("./perf-trace");
}

afterEach(() => {
  if (originalUserData === undefined) delete process.env.OPENBUDDY_TEST_USER_DATA;
  else process.env.OPENBUDDY_TEST_USER_DATA = originalUserData;
  appReady = true;
  vi.resetModules();
});

describe("perfTraceMark", () => {
  it("appends one JSONL line per mark with timestamp, name, and payload", async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "openbuddy-perf-trace-"));
    const { perfTraceMark, perfTraceResetForTests, perfTraceFilePath } = await loadModule();
    perfTraceResetForTests();

    perfTraceMark("app-whenReady");
    perfTraceMark("connectors-register-end", { phase: "ok" });
    perfTraceMark("final");

    const path = perfTraceFilePath();
    expect(path).toBeTruthy();
    const raw = await readFile(path ?? join(userDataDir, "missing.jsonl"), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const entries = lines.map((line) => JSON.parse(line));
    expect(entries[0]).toMatchObject({ name: "app-whenReady" });
    expect(entries[1]).toMatchObject({ name: "connectors-register-end", phase: "ok" });
    for (const entry of entries) {
      expect(typeof entry.ts).toBe("number");
      expect(Number.isFinite(entry.ts)).toBe(true);
    }
    // deltaMs is present from the second mark onward.
    expect(typeof entries[1]?.deltaMs).toBe("number");
  });

  it("is a no-op when app is not ready", async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "openbuddy-perf-trace-deferred-"));
    appReady = false;
    const { perfTraceMark, perfTraceFilePath } = await loadModule();
    perfTraceMark("ignored");
    expect(perfTraceFilePath()).toBeNull();
  });

  it("swallows write errors and never throws", async () => {
    userDataDir = "/this/path/does/not/exist/and/cannot/be/created";
    const { perfTraceMark } = await loadModule();
    expect(() => perfTraceMark("boom")).not.toThrow();
  });
});
