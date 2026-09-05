import type {
	BuddyAcceptanceTest,
	BuddyAgentCard,
	BuddyIdentity,
	BuddyTaskEnvelope,
	BuddyTaskPolicy,
} from "@openbuddy/collaboration-protocol"

export type A2ATaskState = "submitted" | "working" | "input-required" | "completed" | "failed" | "canceled"
export type A2APeerTrust = "pending" | "known" | "trusted" | "blocked" | "revoked"

export interface A2AAgentSkill {
	id: string
	name: string
	description: string
	inputModes: string[]
	outputModes: string[]
}

export interface A2AAgentCard {
	protocolVersion: string
	name: string
	description: string
	url: string
	version: string
	capabilities: {
		streaming: boolean
		pushNotifications: boolean
		stateTransitionHistory: boolean
	}
	skills: A2AAgentSkill[]
	metadata: {
		openbuddy: {
			identityId: string
			communityId: string
			organizationId?: string
			trust: A2APeerTrust
			agentCardStatus: "missing" | "unverified" | "verified"
		}
	}
}

export interface A2ATaskRequest {
	id: string
	contextId?: string
	skillId: string
	objective: string
	sender: BuddyIdentity
	recipient?: BuddyIdentity
	roomRef?: string
	contextRefs?: string[]
	dataScopes: string[]
	allowedActions: string[]
	approval?: BuddyTaskPolicy["approval"]
	artifactTypes: string[]
	acceptanceTests?: BuddyAcceptanceTest[]
	expiresAt: string
	traceId?: string
	nonce?: string
	capabilityToken?: string
}

export interface A2ATaskArtifact {
	id: string
	name: string
	parts: Array<{ kind: "data"; data: { artifactId: string; kind: string; digest: string; uri?: string } }>
	metadata: { openbuddy: { visibility: string; taskId: string } }
}

export interface A2ATaskView {
	id: string
	contextId: string
	status: { state: A2ATaskState; timestamp: string }
	artifacts: A2ATaskArtifact[]
	metadata: {
		openbuddy: {
			taskId: string
			status: string
			executionRef?: Record<string, string>
			verification: "unknown" | "unverified" | "verified" | "rejected"
		}
	}
}

export interface A2ABuddyTaskProjection {
	taskId: string
	status: string
	updatedAt: string
	projectId?: string
	executionRef?: Record<string, string>
	artifacts?: Array<{ id: string; title: string; kind: string; digest: string; uri?: string; visibility: string }>
	verification?: "unknown" | "unverified" | "verified" | "rejected"
}

const NETWORK_FORBIDDEN_SCOPE_PREFIXES = ["private:", "credential:", "secret:"]
const REF_PREFIXES = ["artifact:", "resource:", "room:", "task:"]

function required(value: string, name: string): string {
	const normalized = value.trim()
	if (!normalized) throw new Error(`${name} is required`)
	return normalized
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function validRefs(values: readonly string[]): string[] {
	return unique(values).map((value) => {
		if (value.length > 256 || !REF_PREFIXES.some((prefix) => value.startsWith(prefix))) throw new Error("A2A context refs must be stable authorized references")
		return value
	})
}

function assertPublicScopes(scopes: readonly string[]): void {
	if (scopes.some((scope) => NETWORK_FORBIDDEN_SCOPE_PREFIXES.some((prefix) => scope.startsWith(prefix)))) throw new Error("A2A network tasks cannot carry private, credential, or secret scopes")
}

function assertExpiry(expiresAt: string, now: string): void {
	const expiry = Date.parse(expiresAt)
	if (!Number.isFinite(expiry) || expiry <= Date.parse(now)) throw new Error("A2A task expiry is invalid or expired")
}

export function toA2AAgentCard(input: {
	card: BuddyAgentCard
	trust: A2APeerTrust
	agentCardStatus: A2AAgentCard["metadata"]["openbuddy"]["agentCardStatus"]
	url?: string
	protocolVersion?: string
	now?: string
}): A2AAgentCard {
	const { card } = input
	const now = Date.parse(input.now ?? new Date().toISOString())
	if (!Number.isFinite(now) || Date.parse(card.expiresAt) <= now || Date.parse(card.issuedAt) > Date.parse(card.expiresAt)) throw new Error("cannot expose an expired Agent Card")
	return {
		protocolVersion: input.protocolVersion ?? "0.3.0",
		name: card.identity.displayName,
		description: `OpenBuddy ${card.identity.handle} capability endpoint`,
		url: input.url ?? card.endpoints[0] ?? "",
		version: card.issuedAt,
		capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
		skills: card.capabilities.map((capability) => ({
			id: capability.id,
			name: capability.id,
			description: capability.description,
			inputModes: ["text", "data"],
			outputModes: capability.acceptedArtifactTypes.length > 0 ? ["data", "text"] : ["text"],
		})),
		metadata: {
			openbuddy: {
				identityId: card.identity.id,
				communityId: card.communityId,
				...(card.organizationId ? { organizationId: card.organizationId } : {}),
				trust: input.trust,
				agentCardStatus: input.agentCardStatus,
			},
		},
	}
}

export function toBuddyTaskEnvelopeFromA2A(input: A2ATaskRequest, options: { now: string; network?: boolean } = { now: new Date().toISOString(), network: true }): BuddyTaskEnvelope {
	const taskId = required(input.id, "A2A task id")
	const capability = required(input.skillId, "A2A skill id")
	const objective = required(input.objective, "A2A objective")
	const dataScopes = unique(input.dataScopes)
	const artifactTypes = unique(input.artifactTypes)
	if (dataScopes.length === 0) throw new Error("A2A task requires data scopes")
	if (artifactTypes.length === 0) throw new Error("A2A task requires artifact types")
	if (options.network !== false) assertPublicScopes(dataScopes)
	assertExpiry(input.expiresAt, options.now)
	return {
		protocol: "buddy/1.0",
		messageType: "task.propose",
		messageId: `a2a:${taskId}`,
		traceId: input.traceId?.trim() || `a2a-trace:${taskId}`,
		taskId,
		nonce: input.nonce?.trim() || `a2a-nonce:${taskId}`,
		sender: structuredClone(input.sender),
		...(input.recipient ? { recipient: structuredClone(input.recipient) } : {}),
		...(input.roomRef?.trim() ? { roomRef: input.roomRef.trim() } : {}),
		createdAt: options.now,
		expiresAt: input.expiresAt,
		objective,
		capability,
		input: {
			contextRefs: validRefs(input.contextRefs ?? []),
			constraints: input.contextId?.trim() ? { a2aContextId: input.contextId.trim() } : undefined,
		},
		output: { schema: {}, acceptanceTests: input.acceptanceTests ? structuredClone(input.acceptanceTests) : [], artifactTypes },
		policy: {
			dataScopes,
			allowedActions: unique(input.allowedActions),
			forbiddenActions: [],
			approval: input.approval ?? "before_external_commit",
			allowDelegation: false,
			maxDelegationDepth: 0,
			retention: "task",
			expiresAt: input.expiresAt,
		},
		delivery: { acceptedArtifactTypes: artifactTypes, retention: "task", redactionRequired: true },
		...(input.capabilityToken?.trim() ? { capabilityToken: input.capabilityToken.trim() } : {}),
	}
}

export function toA2ATaskView(input: A2ABuddyTaskProjection, now = new Date().toISOString()): A2ATaskView {
	const state: A2ATaskState = input.status === "accepted" || input.status === "delivered" ? "completed"
		: ["failed", "rejected", "disputed"].includes(input.status) ? "failed"
			: ["revoked", "cancelled"].includes(input.status) ? "canceled"
				: ["running", "progress"].includes(input.status) ? "working"
					: ["blocked", "paused", "revision_requested"].includes(input.status) ? "input-required"
						: "submitted"
	const verification = input.verification ?? (input.status === "accepted" ? "verified" : input.status === "delivered" ? "unverified" : "unknown")
	return {
		id: input.taskId,
		contextId: input.projectId ? `project:${input.projectId}` : `task:${input.taskId}`,
		status: { state, timestamp: input.updatedAt || now },
		artifacts: (input.artifacts ?? []).map((artifact) => ({
			id: artifact.id,
			name: artifact.title,
			parts: [{ kind: "data", data: { artifactId: artifact.id, kind: artifact.kind, digest: artifact.digest, ...(artifact.uri ? { uri: artifact.uri } : {}) } }],
			metadata: { openbuddy: { visibility: artifact.visibility, taskId: input.taskId } },
		})),
		metadata: {
			openbuddy: {
				taskId: input.taskId,
				status: input.status,
				...(input.executionRef ? { executionRef: structuredClone(input.executionRef) } : {}),
				verification,
			},
		},
	}
}
