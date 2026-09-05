import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  rendererList,
  rendererRead,
  rendererRemove,
  rendererStorageGateway,
  rendererWriteVersioned,
  resetRendererStorageGateway,
} from "./renderer-storage";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-renderer-storage-ipc-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
  await resetRendererStorageGateway();
});

afterEach(async () => {
  await resetRendererStorageGateway();
  delete process.env.PI_CODING_AGENT_DIR;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = "";
});

describe("renderer-storage IPC façade", () => {
  it("writes a versioned value, lists it under the namespace, and reads it back", async () => {
    const write = await rendererWriteVersioned({ namespace: "session.bootstrap", key: "snapshot", value: { workspace: "/tmp/fixture", sessionCount: 3 } });
    expect(write.ok).toBe(true);
    if (write.ok) expect(write.value).toMatchObject({ namespace: "session.bootstrap", key: "snapshot", version: 1 });

    const read = await rendererRead({ namespace: "session.bootstrap", key: "snapshot" });
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value?.value).toEqual({ workspace: "/tmp/fixture", sessionCount: 3 });

    const list = await rendererList({ namespace: "session.bootstrap" });
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.values.map((entry) => entry.key)).toEqual(["snapshot"]);
  });

  it("returns a structured version-conflict error on stale writes", async () => {
    await rendererWriteVersioned({ namespace: "session.bootstrap", key: "snapshot", value: { v: 1 }, version: 2 });
    const stale = await rendererWriteVersioned({ namespace: "session.bootstrap", key: "snapshot", value: { v: 2 }, expectedVersion: 0 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.code).toBe("version-conflict");
      expect(stale.currentVersion).toBe(2);
    }
  });

  it("rejects secret-shaped namespaces and keys", async () => {
    const invalid = await rendererWriteVersioned({ namespace: "session.apiToken", key: "snapshot", value: { v: 1 } });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe("invalid");
    const invalidKey = await rendererWriteVersioned({ namespace: "session.bootstrap", key: "apiKey", value: { v: 1 } });
    expect(invalidKey.ok).toBe(false);
    if (!invalidKey.ok) expect(invalidKey.code).toBe("invalid");
  });

  it("rejects secret-shaped payload fields", async () => {
    const secret = await rendererWriteVersioned({ namespace: "session.bootstrap", key: "snapshot", value: { apiKey: "fixture-secret" } });
    expect(secret.ok).toBe(false);
    if (!secret.ok) expect(secret.error).toMatch(/secret/);
  });

  it("removes an existing key and reports not-found on subsequent reads", async () => {
    await rendererWriteVersioned({ namespace: "session.bootstrap", key: "snapshot", value: { v: 1 } });
    const removed = await rendererRemove({ namespace: "session.bootstrap", key: "snapshot" });
    expect(removed).toEqual({ ok: true, removed: true });
    const missing = await rendererRemove({ namespace: "session.bootstrap", key: "snapshot" });
    expect(missing).toEqual({ ok: true, removed: false });
    const read = await rendererRead({ namespace: "session.bootstrap", key: "snapshot" });
    expect(read).toEqual({ ok: true, value: undefined });
  });

  it("serialized state never contains secret-shaped payload bytes", async () => {
    const safeWrite = await rendererWriteVersioned({ namespace: "session.bootstrap", key: "snapshot", value: { theme: "dark", sessionCount: 7 } });
    expect(safeWrite.ok).toBe(true);
    const secretWrite = await rendererWriteVersioned({ namespace: "session.bootstrap", key: "secret", value: { apiKey: "fixture-secret" } });
    expect(secretWrite.ok).toBe(false);
    await resetRendererStorageGateway();
    const files = await readdir(tempDir);
    const target = files.find((name) => name.startsWith("openbuddy-renderer.sqlite") && !name.endsWith("-wal") && !name.endsWith("-shm")) ?? "openbuddy-renderer.sqlite";
    const raw = await readFile(join(tempDir, target), "utf8");
    expect(raw).not.toContain("fixture-secret");
    expect(raw).toContain("dark");
    expect(rendererStorageGateway()).toBeDefined();
  });
});
