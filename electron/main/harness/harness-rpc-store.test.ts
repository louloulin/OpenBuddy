import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessRpcRevisionConflict, HarnessRpcStore, harnessRpcIdentity } from "./harness-rpc-store";

describe("HarnessRpcStore", () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	it("writes atomically with a token-scoped identity and restores completed results", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-rpc-store-"));
		roots.push(root);
		const path = join(root, "cache.json");
		const store = new HarnessRpcStore(path, harnessRpcIdentity("token-a"));
		await store.write([{ rpcId: "rpc-1", fingerprint: "fingerprint", expiresAt: Date.now() + 10_000, result: { ok: true, value: { answer: 42 } } }]);
		expect(await store.read()).toEqual([{ rpcId: "rpc-1", fingerprint: "fingerprint", expiresAt: expect.any(Number), result: { ok: true, value: { answer: 42 } } }]);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1, identity: harnessRpcIdentity("token-a") });
		expect(await new HarnessRpcStore(path, harnessRpcIdentity("token-b")).read()).toEqual([]);
	});

	it("drops expired and malformed entries instead of restoring them", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-rpc-store-"));
		roots.push(root);
		const path = join(root, "cache.json");
		const store = new HarnessRpcStore(path, "identity");
		await store.write([
			{ rpcId: "expired", fingerprint: "old", expiresAt: Date.now() - 1, result: { ok: true, value: null } },
			{ rpcId: "live", fingerprint: "new", expiresAt: Date.now() + 10_000, result: { ok: false, error: { code: "internal", message: "x", details: {} } } },
		]);
		const parsed = JSON.parse(await readFile(path, "utf8")) as { entries: unknown[] };
		parsed.entries.push({ rpcId: "bad", fingerprint: 1, expiresAt: "never", result: null });
		writeFile(path, `${JSON.stringify(parsed)}\n`, "utf8");
		expect((await store.read()).map((entry) => entry.rpcId)).toEqual(["live"]);
	});

  it("persists side-effect intents separately from completed receipts", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-rpc-store-"));
		roots.push(root);
		const path = join(root, "cache.json");
		const store = new HarnessRpcStore(path, "identity");
		await store.writeState([], [{
			rpcId: "rpc-pending",
			fingerprint: "fingerprint",
			method: "workspace.write",
			createdAt: Date.now(),
			expiresAt: Date.now() + 10_000,
			status: "pending",
		}]);
		await expect(store.readState()).resolves.toMatchObject({
			entries: [],
			intents: [{ rpcId: "rpc-pending", method: "workspace.write", status: "pending" }],
		});
	});

	it("restores the optional session correlation without changing v1 fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-rpc-store-"));
    roots.push(root);
    const store = new HarnessRpcStore(join(root, "cache.json"), "identity");
    await store.writeState([], [{
      rpcId: "rpc-session",
      fingerprint: "fingerprint",
      method: "workspace.write",
      sessionId: "session-1",
      createdAt: Date.now(),
      expiresAt: Date.now() + 10_000,
      status: "pending",
    }]);
    await expect(store.readState()).resolves.toMatchObject({ intents: [{ rpcId: "rpc-session", sessionId: "session-1" }] });
	});

	it("increments revisions and rejects stale compare-and-set writes", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-rpc-store-"));
		roots.push(root);
		const store = new HarnessRpcStore(join(root, "cache.json"), "identity");
		const first = await store.writeState([], []);
		expect(first).toBe(1);
		const second = await store.writeState([], [], first);
		expect(second).toBe(2);
		await expect(store.writeState([], [], first)).rejects.toBeInstanceOf(HarnessRpcRevisionConflict);
		await expect(store.readState()).resolves.toMatchObject({ revision: 2 });
	});

	it("allows only one writer from two processes sharing a stale revision", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-rpc-store-"));
		roots.push(root);
		const path = join(root, "cache.json");
		const firstStore = new HarnessRpcStore(path, "identity");
		const secondStore = new HarnessRpcStore(path, "identity");
		const expectedRevision = (await firstStore.readState()).revision;
		const results = await Promise.allSettled([
			firstStore.writeState([], [], expectedRevision),
			secondStore.writeState([], [], expectedRevision),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected" && result.reason instanceof HarnessRpcRevisionConflict)).toHaveLength(1);
		await expect(firstStore.readState()).resolves.toMatchObject({ revision: 1 });
	});

	it("reclaims an expired lock left by a crashed writer", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-rpc-store-"));
		roots.push(root);
		const path = join(root, "cache.json");
		const lockPath = `${path}.lock`;
		await writeFile(lockPath, JSON.stringify({ version: 1, owner: "crashed-writer", pid: 999999, createdAt: 1, expiresAt: Date.now() - 1 }), { mode: 0o600 });
		const store = new HarnessRpcStore(path, "identity", { lockTtlMs: 1, lockWaitMs: 100 });
		await expect(store.writeState([], [])).resolves.toBe(1);
		await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("reclaims a malformed stale lock using its file age", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-rpc-store-"));
		roots.push(root);
		const path = join(root, "cache.json");
		const lockPath = `${path}.lock`;
		await writeFile(lockPath, "not-json", { mode: 0o600 });
		const store = new HarnessRpcStore(path, "identity", { lockTtlMs: 1, lockWaitMs: 100 });
		await new Promise((resolve) => setTimeout(resolve, 5));
		await expect(store.writeState([], [])).resolves.toBe(1);
	});

	it("does not reclaim an expired lock while its owner process is alive", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-rpc-store-"));
		roots.push(root);
		const path = join(root, "cache.json");
		const lockPath = `${path}.lock`;
		await writeFile(lockPath, JSON.stringify({ version: 1, owner: "live-writer", pid: process.pid, createdAt: 1, expiresAt: Date.now() - 1 }), { mode: 0o600 });
		const store = new HarnessRpcStore(path, "identity", { lockTtlMs: 1, lockWaitMs: 15, lockRetryMs: 1 });
		await expect(store.writeState([], [])).rejects.toThrow("timed out acquiring Harness RPC cache lock");
	});
});
