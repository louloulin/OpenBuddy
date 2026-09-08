import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileClinicalAuditStore } from "../audit-log";

let tempDir: string | null = null;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
		tempDir = null;
	}
});

describe("FileClinicalAuditStore", () => {
	it("appends and queries entries", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "clinical-audit-"));
		const store = new FileClinicalAuditStore(join(tempDir, "audit.json"));
		await store.append({
			at: "2026-01-01T00:00:00Z",
			actorId: "dr-001",
			operation: "differential_diagnosis",
			status: "completed",
			inputFingerprint: "abc123",
			reasonForUse: "辅助鉴别诊断评估",
		});
		await store.append({
			at: "2026-01-01T01:00:00Z",
			actorId: "dr-002",
			operation: "permission_check",
			status: "denied",
			inputFingerprint: "def456",
			reasonForUse: "查看病历但权限不足",
		});
		const all = await store.query();
		expect(all).toHaveLength(2);
		const filtered = await store.query({ actorId: "dr-001" });
		expect(filtered).toHaveLength(1);
		expect(filtered[0].operation).toBe("differential_diagnosis");
	});

	it("verifies hash chain integrity", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "clinical-audit-"));
		const store = new FileClinicalAuditStore(join(tempDir, "audit.json"));
		await store.append({ at: "2026-01-01T00:00:00Z", actorId: "a", operation: "ehr_fetch", status: "allowed", inputFingerprint: "x", reasonForUse: "test reason here" });
		await store.append({ at: "2026-01-01T01:00:00Z", actorId: "b", operation: "ehr_fetch", status: "completed", inputFingerprint: "y", reasonForUse: "another reason here" });
		expect(await store.verify()).toBe(true);
	});

	it("returns empty for fresh store", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "clinical-audit-"));
		const store = new FileClinicalAuditStore(join(tempDir, "audit.json"));
		expect(await store.query()).toEqual([]);
	});
});
