import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RpcResult } from "@openbuddy/plugin-host";

export type PersistedHarnessRpcEntry = {
	rpcId: string;
	fingerprint: string;
	expiresAt: number;
	result: RpcResult<unknown>;
};

export type PersistedHarnessRpcIntent = {
  rpcId: string;
  fingerprint: string;
  method: string;
  sessionId?: string;
	authority?: "trusted-host" | "loopback";
	createdAt: number;
	expiresAt: number;
	status: "pending" | "uncertain";
	claimedBy?: string;
	claimHash?: string;
	claimKeyId?: string;
	claimExpiresAt?: number;
};

type PersistedHarnessRpcFile = {
	version: 2;
	identity: string;
	revision?: number;
	entries: PersistedHarnessRpcEntry[];
	intents: PersistedHarnessRpcIntent[];
};

export type HarnessRpcState = {
	entries: PersistedHarnessRpcEntry[];
	intents: PersistedHarnessRpcIntent[];
	revision: number;
};

export const DEFAULT_HARNESS_RPC_LOCK_TTL_MS = 30_000;
export const DEFAULT_HARNESS_RPC_LOCK_RETRY_MS = 5;
export const DEFAULT_HARNESS_RPC_LOCK_WAIT_MS = 5_000;

export type HarnessRpcStoreOptions = {
	lockTtlMs?: number;
	lockRetryMs?: number;
	lockWaitMs?: number;
};

type HarnessRpcLock = {
	version: 1;
	owner: string;
	pid: number;
	createdAt: number;
	expiresAt: number;
};

export class HarnessRpcRevisionConflict extends Error {
	readonly code = "rpc-revision-conflict";
	constructor(readonly expectedRevision: number, readonly actualRevision: number) {
		super(`Harness RPC cache revision conflict: expected ${expectedRevision}, found ${actualRevision}`);
		this.name = "HarnessRpcRevisionConflict";
	}
}

export function defaultHarnessRpcCachePath(): string {
	const home = process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent");
	return join(home, "openbuddy-harness-rpc-cache.json");
}

export function harnessRpcIdentity(authToken?: string): string {
	return createHash("sha256").update(authToken ?? "anonymous").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRpcResult(value: unknown): value is RpcResult<unknown> {
	if (!isRecord(value) || typeof value.ok !== "boolean") return false;
	if (value.ok) return "value" in value;
	return isRecord(value.error)
		&& typeof value.error.code === "string"
		&& typeof value.error.message === "string"
		&& isRecord(value.error.details);
}

function isEntry(value: unknown): value is PersistedHarnessRpcEntry {
  return isRecord(value)
		&& typeof value.rpcId === "string"
		&& typeof value.fingerprint === "string"
		&& Number.isSafeInteger(value.expiresAt)
		&& isRpcResult(value.result);
}

function isIntent(value: unknown): value is PersistedHarnessRpcIntent {
	return isRecord(value)
		&& typeof value.rpcId === "string"
		&& typeof value.fingerprint === "string"
		&& typeof value.method === "string"
		&& (value.sessionId === undefined || typeof value.sessionId === "string")
		&& (value.authority === undefined || value.authority === "trusted-host" || value.authority === "loopback")
		&& (value.claimKeyId === undefined || typeof value.claimKeyId === "string")
		&& Number.isSafeInteger(value.createdAt)
		&& Number.isSafeInteger(value.expiresAt)
		&& (value.status === "pending" || value.status === "uncertain");
}

/**
 * Durable completed-request cache for the local Harness server.
 * Pending requests are intentionally never written: after a process crash the
 * caller must retry, while completed requests remain idempotent across restart.
 */
export class HarnessRpcStore {
	constructor(
		private readonly path: string,
		private readonly identity: string,
		private readonly options: HarnessRpcStoreOptions = {},
	) {}

	async read(now = Date.now()): Promise<PersistedHarnessRpcEntry[]> {
		return (await this.readState(now)).entries;
	}

	async readState(now = Date.now()): Promise<HarnessRpcState> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(await readFile(this.path, "utf8"));
		} catch {
			return { entries: [], intents: [], revision: 0 };
		}
		if (!isRecord(parsed) || parsed.identity !== this.identity || !Array.isArray(parsed.entries)) {
			return { entries: [], intents: [], revision: 0 };
		}
		const revision = Number.isSafeInteger(parsed.revision) && (parsed.revision as number) >= 0 ? parsed.revision as number : 0;
		const entries = parsed.entries.filter(isEntry).filter((entry) => entry.expiresAt > now);
		const intents = parsed.version === 2 && Array.isArray(parsed.intents)
			? parsed.intents.filter(isIntent).filter((intent) => intent.expiresAt > now)
			: [];
		return { entries, intents, revision };
	}

	async write(entries: readonly PersistedHarnessRpcEntry[]): Promise<void> {
		const body = `${JSON.stringify({ version: 1, identity: this.identity, entries: entries.map((entry) => ({ ...entry })) })}\n`;
		await mkdir(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, this.path);
	}

	async writeState(entries: readonly PersistedHarnessRpcEntry[], intents: readonly PersistedHarnessRpcIntent[], expectedRevision?: number): Promise<number> {
		await mkdir(dirname(this.path), { recursive: true });
		const lockPath = `${this.path}.lock`;
		let lock: Awaited<ReturnType<typeof open>> | undefined;
		let lockOwner: string | undefined;
		try {
			const retryMs = this.options.lockRetryMs ?? DEFAULT_HARNESS_RPC_LOCK_RETRY_MS;
			const waitMs = this.options.lockWaitMs ?? DEFAULT_HARNESS_RPC_LOCK_WAIT_MS;
			const deadline = Date.now() + waitMs;
			for (;;) {
				try {
					lock = await open(lockPath, "wx", 0o600);
					lockOwner = randomUUID();
					const now = Date.now();
					const lockMetadata: HarnessRpcLock = {
						version: 1,
						owner: lockOwner,
						pid: process.pid,
						createdAt: now,
						expiresAt: now + (this.options.lockTtlMs ?? DEFAULT_HARNESS_RPC_LOCK_TTL_MS),
					};
					await lock.writeFile(`${JSON.stringify(lockMetadata)}\n`, "utf8");
					break;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					await this.reclaimStaleLock(lockPath);
					if (Date.now() >= deadline) throw new Error("timed out acquiring Harness RPC cache lock");
					await new Promise((resolve) => setTimeout(resolve, retryMs));
				}
			}
			if (!lock || !lockOwner) throw new Error("timed out acquiring Harness RPC cache lock");
			const current = await this.readState();
			if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new HarnessRpcRevisionConflict(expectedRevision, current.revision);
			const revision = current.revision + 1;
		const payload: PersistedHarnessRpcFile = {
			version: 2,
			identity: this.identity,
			revision,
			entries: entries.map((entry) => ({ ...entry })),
			intents: intents.map((intent) => ({ ...intent })),
		};
		const body = `${JSON.stringify(payload)}\n`;
		const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, this.path);
		return revision;
		} finally {
			await lock?.close().catch(() => undefined);
			await this.releaseLock(lockPath, lockOwner).catch(() => undefined);
		}
	}

	private async reclaimStaleLock(lockPath: string): Promise<void> {
		let lock: Partial<HarnessRpcLock> | undefined;
		try {
			lock = JSON.parse(await readFile(lockPath, "utf8")) as Partial<HarnessRpcLock>;
		} catch {
			try {
				const metadata = await stat(lockPath);
				const ttl = this.options.lockTtlMs ?? DEFAULT_HARNESS_RPC_LOCK_TTL_MS;
				if (Date.now() - metadata.mtimeMs <= ttl) return;
			} catch {
				return;
			}
			await rm(lockPath, { force: true });
			return;
		}

		if (lock.version !== 1 || typeof lock.owner !== "string" || typeof lock.pid !== "number") {
			return;
		}
		if (lock.pid === process.pid) return;
		let alive = true;
		try {
			process.kill(lock.pid, 0);
		} catch (error) {
			alive = (error as NodeJS.ErrnoException).code === "EPERM";
		}
		if (!alive) await rm(lockPath, { force: true });
	}

	private async releaseLock(lockPath: string, owner?: string): Promise<void> {
		if (!owner) return;
		try {
			const lock = JSON.parse(await readFile(lockPath, "utf8")) as Partial<HarnessRpcLock>;
			if (lock.owner === owner) await rm(lockPath, { force: true });
		} catch {
			// Another process may have reclaimed the lock after a crash.
		}
	}
}
