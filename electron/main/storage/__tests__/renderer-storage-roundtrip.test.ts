import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 用临时目录替换 storage 路径
let tempDir: string;
beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-storage-test-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
  process.env.PI_HOME = tempDir;
});
afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

// 这些 import 必须在 process.env 设置之后
import {
  rendererRead,
  rendererList,
  rendererWriteVersioned,
  rendererRemove,
  resetRendererStorageGateway,
} from "../renderer-storage";

describe("Agent renderer storage roundtrip (real SQLite)", () => {
  beforeEach(async () => {
    await resetRendererStorageGateway();
  });

  it("writes and reads back a value through the renderer gateway", async () => {
    const write = await rendererWriteVersioned({
      namespace: "agent-test",
      key: "session-cursor",
      value: { cursor: 42, lastPrompt: "hello" },
    });
    expect(write.ok).toBe(true);

    const read = await rendererRead({ namespace: "agent-test", key: "session-cursor" });
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value?.value).toEqual({ cursor: 42, lastPrompt: "hello" });
      expect(read.value?.version).toBe(1);
    }
  });

  it("returns undefined for missing keys without erroring", async () => {
    const read = await rendererRead({ namespace: "agent-test", key: "absent" });
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toBeUndefined();
  });

  it("rejects stale expectedVersion with a structured version-conflict error", async () => {
    await rendererWriteVersioned({
      namespace: "agent-test",
      key: "versioned",
      value: { n: 1 },
      version: 1,
    });

    const stale = await rendererWriteVersioned({
      namespace: "agent-test",
      key: "versioned",
      value: { n: 2 },
      version: 2,
      expectedVersion: 99,
    });

    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.code).toBe("version-conflict");
      expect(typeof stale.error).toBe("string");
    }
  });

  it("lists keys inside the same namespace only", async () => {
    await rendererWriteVersioned({ namespace: "isolated-ns", key: "k1", value: { v: 1 }, version: 1 });
    await rendererWriteVersioned({ namespace: "isolated-ns", key: "k2", value: { v: 2 }, version: 1 });
    await rendererWriteVersioned({ namespace: "other-ns", key: "k3", value: { v: 3 }, version: 1 });

    const list = await rendererList({ namespace: "isolated-ns" });
    expect(list.ok).toBe(true);
    if (list.ok) {
      const keys = list.values.map((entry) => entry.key).sort();
      expect(keys).toEqual(["k1", "k2"]);
    }
  });

  it("removes a key and reports removed=true", async () => {
    await rendererWriteVersioned({ namespace: "agent-test", key: "tmp", value: { ok: true } });
    const removed = await rendererRemove({ namespace: "agent-test", key: "tmp" });
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.removed).toBe(true);

    const missing = await rendererRead({ namespace: "agent-test", key: "tmp" });
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.value).toBeUndefined();
  });

  it("supports version increments across writes", async () => {
    const w1 = await rendererWriteVersioned({ namespace: "agent-test", key: "v", value: { step: 1 }, version: 1 });
    expect(w1.ok).toBe(true);
    if (w1.ok) expect(w1.value.version).toBe(1);

    const w2 = await rendererWriteVersioned({ namespace: "agent-test", key: "v", value: { step: 2 }, version: 2 });
    expect(w2.ok).toBe(true);
    if (w2.ok) expect(w2.value.version).toBe(2);
  });
});
