import type {
	BuddyAgentCard,
	BuddyTaskEnvelope,
} from "@openbuddy/collaboration-protocol";
import { stableDigest } from "@openbuddy/collaboration-protocol";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
	toA2AAgentCard,
	toA2ATaskView,
	toBuddyTaskEnvelopeFromA2A,
	type A2AAgentCard,
	type A2ATaskRequest,
	type A2ATaskView,
} from "@openbuddy/collaboration-network";
import type { CollaborationRuntime, CollaborationSnapshot } from "./collaboration-runtime";

export interface A2AFacadeTaskResult {
	requestId: string;
	runtimeTaskId: string;
	envelope: BuddyTaskEnvelope;
	view: A2ATaskView;
}

interface A2AReplayRecord {
	requestId: string;
	fingerprint: string;
	runtimeTaskId: string;
	nonceKey: string;
	envelope: BuddyTaskEnvelope;
}

interface A2AReplayState {
	version: 1;
	requests: A2AReplayRecord[];
}

interface A2AReplayStore {
	load(): Promise<A2AReplayState | undefined>;
	save(state: A2AReplayState): Promise<void>;
}

class JsonA2AReplayStore implements A2AReplayStore {
	constructor(private readonly path: string) {}

	async load(): Promise<A2AReplayState | undefined> {
		try {
			const value = JSON.parse(await readFile(this.path, "utf8")) as Partial<A2AReplayState>;
			if (value.version !== 1 || !Array.isArray(value.requests)) return undefined;
			const requests = value.requests.filter((record): record is A2AReplayRecord => Boolean(
				record && typeof record === "object"
				&& typeof (record as A2AReplayRecord).requestId === "string"
				&& typeof (record as A2AReplayRecord).fingerprint === "string"
				&& typeof (record as A2AReplayRecord).runtimeTaskId === "string"
				&& typeof (record as A2AReplayRecord).nonceKey === "string"
				&& (record as A2AReplayRecord).envelope && typeof (record as A2AReplayRecord).envelope === "object",
			));
			return { version: 1, requests: structuredClone(requests) };
		} catch {
			return undefined;
		}
	}

	async save(state: A2AReplayState): Promise<void> {
		await mkdir(dirname(this.path), { recursive: true });
		const temporaryPath = `${this.path}.tmp.${randomUUID()}`;
		await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, "utf8");
		await rename(temporaryPath, this.path);
	}
}

function localAgentCard(snapshot: CollaborationSnapshot, now: string): BuddyAgentCard {
	const expiresAt = new Date(Date.parse(now) + 60 * 60_000).toISOString();
	return {
		protocol: "agent-card/1",
		identity: structuredClone(snapshot.identity),
		communityId: snapshot.network.communityId,
		...(snapshot.identity.organizationId ? { organizationId: snapshot.identity.organizationId } : {}),
		capabilities: snapshot.capabilityCards.map((card) => ({
			id: card.id,
			description: card.name,
			acceptedDataScopes: structuredClone(snapshot.policy.dataScopes),
			acceptedArtifactTypes: ["other"],
			approval: card.contract.approval === "before-external-commit" ? "before_external_commit" : card.contract.approval,
		})),
		endpoints: [],
		issuedAt: now,
		expiresAt,
	};
}

function taskView(snapshot: CollaborationSnapshot, taskId: string, now: string): A2ATaskView {
	const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
	const status = task ? task.status : snapshot.network.proposals.find((candidate) => candidate.id === taskId)?.status;
	if (!status) throw new Error("A2A task was not found in the local collaboration projection");
	const updatedAt = task?.updatedAt ?? snapshot.network.proposals.find((candidate) => candidate.id === taskId)?.expiresAt ?? now;
	return toA2ATaskView({
		taskId,
		status,
		updatedAt,
		...(task?.projectId ? { projectId: task.projectId } : {}),
		executionRef: task?.executionRef ? Object.fromEntries(Object.entries(task.executionRef).map(([key, value]) => [key, String(value)])) : undefined,
	}, now);
}

export class A2ARuntimeFacade {
	private readonly requests = new Map<string, { fingerprint: string; request: A2ATaskRequest; result: A2AFacadeTaskResult }>();
	private readonly nonces = new Map<string, string>();
	private readonly replayStore?: A2AReplayStore;

	constructor(
		private readonly runtime: Pick<CollaborationRuntime, "snapshot" | "proposeCollaboration"> & { getCollaborationStoragePath?: () => string; flush?: () => Promise<void> },
		private readonly now: () => Date = () => new Date(),
		replayStore?: A2AReplayStore,
	) {
		this.replayStore = replayStore ?? (runtime.getCollaborationStoragePath ? new JsonA2AReplayStore(`${runtime.getCollaborationStoragePath()}.a2a.json`) : undefined);
	}

	async init(): Promise<void> {
		if (!this.replayStore) return;
		if (this.runtime.flush) await this.runtime.flush();
		const state = await this.replayStore.load();
		for (const record of state?.requests ?? []) {
			this.requests.set(record.requestId, { fingerprint: record.fingerprint, request: this.requestFromEnvelope(record.requestId, record.envelope), result: this.resultForStoredRequest(record) });
			this.nonces.set(record.nonceKey, record.requestId);
		}
	}

	getAgentCard(): A2AAgentCard {
		const now = this.now().toISOString();
		const snapshot = this.runtime.snapshot().data;
		return toA2AAgentCard({
			card: localAgentCard(snapshot, now),
			trust: "trusted",
			agentCardStatus: "unverified",
			now,
		});
	}

	submitTask(request: A2ATaskRequest): A2AFacadeTaskResult {
		const now = this.now().toISOString();
		const fingerprint = stableDigest(request);
		const previous = this.requests.get(request.id);
		if (previous) {
			if (previous.fingerprint !== fingerprint) throw new Error("A2A request id was reused with a different task")
			return structuredClone(previous.result);
		}
		const currentSnapshot = this.runtime.snapshot().data;
		if (request.recipient && request.recipient.id !== currentSnapshot.identity.id) throw new Error("A2A task recipient does not match the local Buddy")
		if (request.sender.id !== currentSnapshot.identity.id) {
			const peer = currentSnapshot.network.peers.find((candidate) => candidate.identity.id === request.sender.id)
			if (!peer || !["known", "trusted"].includes(peer.trust)) throw new Error("A2A task sender is not an authorized local peer")
		}
		const envelope = toBuddyTaskEnvelopeFromA2A(request, { now, network: true });
		const nonceKey = `${envelope.sender.id}:${envelope.nonce}`;
		const previousNonce = this.nonces.get(nonceKey);
		if (previousNonce && previousNonce !== request.id) throw new Error("A2A task nonce has already been used")
		this.nonces.set(nonceKey, request.id);
		const result = this.runtime.proposeCollaboration({
			mode: "network",
			title: `A2A · ${envelope.capability}`,
			objective: envelope.objective,
			capability: envelope.capability,
			contextRefs: envelope.input.contextRefs,
			dataScopes: envelope.policy.dataScopes,
			artifactTypes: envelope.output.artifactTypes,
			expiresAt: envelope.expiresAt,
		});
		const facadeResult = {
			requestId: request.id,
			runtimeTaskId: result.taskId,
			envelope: { ...envelope, taskId: result.taskId, messageId: `a2a:${result.taskId}`, traceId: envelope.traceId },
			view: taskView(this.runtime.snapshot().data, result.taskId, now),
		};
		this.requests.set(request.id, { fingerprint, request: structuredClone(request), result: structuredClone(facadeResult) });
		void this.persistReplayState(request, fingerprint, envelope.nonce, result.taskId);
		return facadeResult;
	}

	getTask(taskId: string): A2ATaskView {
		const now = this.now().toISOString();
		return taskView(this.runtime.snapshot().data, taskId, now);
	}

	private resultForStoredRequest(record: A2AReplayRecord): A2AFacadeTaskResult {
		const now = this.now().toISOString();
		const taskEnvelope = { ...structuredClone(record.envelope), taskId: record.runtimeTaskId, messageId: `a2a:${record.runtimeTaskId}` };
		return {
			requestId: record.requestId,
			runtimeTaskId: record.runtimeTaskId,
			envelope: taskEnvelope,
			view: taskView(this.runtime.snapshot().data, record.runtimeTaskId, now),
		};
	}

	private requestFromEnvelope(requestId: string, envelope: BuddyTaskEnvelope): A2ATaskRequest {
		return {
			id: requestId,
			skillId: envelope.capability,
			objective: envelope.objective,
			sender: structuredClone(envelope.sender),
			...(envelope.recipient ? { recipient: structuredClone(envelope.recipient) } : {}),
			...(envelope.roomRef ? { roomRef: envelope.roomRef } : {}),
			contextRefs: structuredClone(envelope.input.contextRefs ?? []),
			dataScopes: structuredClone(envelope.policy.dataScopes),
			allowedActions: structuredClone(envelope.policy.allowedActions),
			approval: envelope.policy.approval,
			artifactTypes: structuredClone(envelope.output.artifactTypes),
			expiresAt: envelope.expiresAt,
			traceId: envelope.traceId,
			nonce: envelope.nonce,
			...(envelope.capabilityToken ? { capabilityToken: envelope.capabilityToken } : {}),
		};
	}

	private pendingPersist: Promise<void> = Promise.resolve();

	async flush(): Promise<void> {
		if (this.runtime.flush) await this.runtime.flush();
		await this.pendingPersist;
		if (this.replayStore) {
			const state = await this.replayStore.load();
			await this.replayStore.save(state ?? { version: 1, requests: [] });
		}
	}

	private async persistReplayState(request: A2ATaskRequest, fingerprint: string, nonce: string, runtimeTaskId: string): Promise<void> {
		if (!this.replayStore) return;
		const prior = this.pendingPersist;
		const records = [...this.requests].map(([requestId, entry]) => {
			return {
				requestId,
				fingerprint: entry.fingerprint,
				runtimeTaskId: entry.result.runtimeTaskId,
				nonceKey: `${entry.result.envelope.sender.id}:${entry.result.envelope.nonce}`,
				envelope: structuredClone(entry.result.envelope),
			};
		});
		const current = records.find((record) => record.requestId === request.id);
		if (current) {
			current.fingerprint = fingerprint;
			current.runtimeTaskId = runtimeTaskId;
			current.nonceKey = `${request.sender.id}:${nonce}`;
			current.envelope = structuredClone(this.requests.get(request.id)?.result.envelope ?? current.envelope);
		}
		this.pendingPersist = prior.then(() => this.replayStore!.save({ version: 1, requests: records }));
	}
}

const facadeByRuntime = new WeakMap<object, A2ARuntimeFacade>();

export function createA2ARuntimeFacade(runtime: CollaborationRuntime, now?: () => Date): A2ARuntimeFacade {
	if (now) return new A2ARuntimeFacade(runtime, now);
	const existing = facadeByRuntime.get(runtime);
	if (existing) return existing;
	const facade = new A2ARuntimeFacade(runtime);
	facadeByRuntime.set(runtime, facade);
	return facade;
}

export type { A2AAgentCard, A2ATaskRequest, A2ATaskView };
