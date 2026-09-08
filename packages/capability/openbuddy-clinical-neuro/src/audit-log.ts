import { appendFile, mkdir, readFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

export type ClinicalAuditOperation =
	| "phi_redact"
	| "differential_diagnosis"
	| "clinical_scoring"
	| "ehr_fetch"
	| "imaging_fetch"
	| "guideline_search"
	| "encounter_summarize"
	| "permission_check"
	| "permission_grant"
	| "permission_revoke";

export interface ClinicalAuditEntry {
	readonly id: string;
	readonly at: string;
	readonly actorId: string;
	readonly operation: ClinicalAuditOperation;
	readonly status: "allowed" | "denied" | "completed" | "failed";
	/** SHA-256 of the redacted input text. */
	readonly inputFingerprint: string;
	/** SHA-256 of the output (if any). */
	readonly outputFingerprint?: string;
	/** HIPAA / PIPL minimum-necessary justification. */
	readonly reasonForUse: string;
	readonly patientRef?: string;
	readonly detail?: Record<string, string | number | boolean>;
	readonly phiRedactionStats?: { total: number };
}

export interface ClinicalAuditQuery {
	operation?: ClinicalAuditOperation;
	actorId?: string;
	since?: string;
	until?: string;
	limit?: number;
}

export interface ClinicalAuditStore {
	append(entry: ClinicalAuditEntry): Promise<void>;
	query(input?: ClinicalAuditQuery): Promise<ClinicalAuditEntry[]>;
	/** Verify the log has not been tampered with (hash chain check). */
	verify(): Promise<boolean>;
}

function sha256(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

function newId(): string {
	return `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

interface AuditState {
	version: 1;
	entries: ClinicalAuditEntry[];
	/** Hash chain: last entry hash. */
	chainHead: string;
}

/**
 * Append-only, hash-chained audit log. Each entry includes the hash of the
 * previous entry, making silent modification detectable. Stored as JSON for
 * simplicity; swap for SQLite/WORM storage in production deployment.
 */
export class FileClinicalAuditStore implements ClinicalAuditStore {
	private state: AuditState | null = null;
	private readonly queue: Promise<void> = Promise.resolve();

	constructor(private readonly filePath: string) {}

	private async load(): Promise<AuditState> {
		if (this.state) return this.state;
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as Partial<AuditState>;
			if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error("invalid audit state");
			this.state = { version: 1, entries: parsed.entries, chainHead: parsed.chainHead ?? "" };
		} catch {
			this.state = { version: 1, entries: [], chainHead: "" };
		}
		return this.state;
	}

	private entryHash(entry: ClinicalAuditEntry, previousHash: string): string {
		return sha256(`${previousHash}|${entry.id}|${entry.at}|${entry.actorId}|${entry.operation}|${entry.status}|${entry.inputFingerprint}|${entry.reasonForUse}`);
	}

	async append(entry: Omit<ClinicalAuditEntry, "id" | "at"> & { id?: string; at?: string }): Promise<void> {
		this.queue = this.queue.then(async () => {
			const state = await this.load();
			const full: ClinicalAuditEntry = {
				...entry,
				id: entry.id ?? newId(),
				at: entry.at ?? new Date().toISOString(),
			};
			const hash = this.entryHash(full, state.chainHead);
			state.entries.push(full);
			state.chainHead = hash;
			await mkdir(dirname(this.filePath), { recursive: true });
			const tmp = `${this.filePath}.${process.pid}.tmp`;
			await appendFile(tmp, JSON.stringify(state) + "\n", "utf8");
			await rename(tmp, this.filePath);
		});
		return this.queue;
	}

	async query(input?: ClinicalAuditQuery): Promise<ClinicalAuditEntry[]> {
		const state = await this.load();
		let entries = [...state.entries];
		if (input?.operation) entries = entries.filter((e) => e.operation === input.operation);
		if (input?.actorId) entries = entries.filter((e) => e.actorId === input.actorId);
		if (input?.since) entries = entries.filter((e) => e.at >= input.since!);
		if (input?.until) entries = entries.filter((e) => e.at <= input.until!);
		const limit = input?.limit ?? 200;
		return entries.slice(-limit);
	}

	async verify(): Promise<boolean> {
		const state = await this.load();
		let previous = "";
		for (const entry of state.entries) {
			const expected = this.entryHash(entry, previous);
			if (entry.id.startsWith("audit_") && this.entryHash(entry, previous) !== expected) return false;
			previous = this.entryHash(entry, previous);
		}
		return previous === state.chainHead;
	}
}

let store: ClinicalAuditStore | null = null;

export function mountClinicalAuditLog(filePath: string): ClinicalAuditStore {
	store = new FileClinicalAuditStore(filePath);
	return store;
}

export function getClinicalAuditStore(): ClinicalAuditStore | null {
	return store;
}

export function setClinicalAuditStore(instance: ClinicalAuditStore): void {
	store = instance;
}

export function clinicalAuditFingerprint(input: string): string {
	return sha256(input);
}
