 export type TrustLevel = "local" | "org" | "known_peer" | "public"
 export type BuddyPresence = "offline" | "idle" | "working" | "paused"

export type BuddyCollaborationMode = "personal" | "organization" | "network"

export const OPENBUDDY_COLLABORATION_PROTOCOL_VERSION = "collaboration/1" as const

export type BuddyCollaborationCapabilityId =
	| "identity"
	| "rooms"
	| "tasks"
	| "workflows"
	| "policy"
	| "approval"
	| "evidence"
	| "verification"
	| "side-effects"
	| "directory"
	| "relay"
	| "a2a"

export interface BuddyCollaborationCapabilityDescriptor {
	id: BuddyCollaborationCapabilityId
	version: typeof OPENBUDDY_COLLABORATION_PROTOCOL_VERSION
	modes: BuddyCollaborationMode[]
	transport: "local" | "ipc" | "relay" | "a2a"
	redactedProjection: boolean
}

export interface BuddyCollaborationManifest {
	protocol: typeof OPENBUDDY_COLLABORATION_PROTOCOL_VERSION
	pluginId: "openbuddy-collaboration"
	capabilities: BuddyCollaborationCapabilityDescriptor[]
	invariants: readonly [
		"single-runtime-source-of-truth",
		"discovery-is-not-authorization",
		"provider-cannot-self-verify",
		"renderer-receives-redacted-projection",
	]
}

export type BuddyAgentRefType = "expert" | "personal-buddy" | "organization-buddy" | "external-buddy"

export interface BuddyAgentRef {
	type: BuddyAgentRefType
	id: string
}

export interface BuddyCollaborationCommand {
  mode: BuddyCollaborationMode
  title: string
  objective: string
  capability?: string
  roomId?: string
  projectId?: string
  contextRefs?: string[]
  dataScopes?: string[]
  artifactTypes?: string[]
  expiresAt?: string
  providerId?: string
  capabilityInput?: Record<string, unknown>
  agentRef?: BuddyAgentRef
  sideEffectIntentId?: string
  sideEffectFingerprint?: string
}

export interface BuddyIdentity {
 	id: string
 	handle: string
 	displayName: string
 	ownerUserId: string
 	organizationId?: string
 	trustLevel: TrustLevel
 	publicKeyRef?: string
 status: BuddyPresence
}

export interface BuddyAgentCardCapability {
	id: string
	description: string
	acceptedDataScopes: string[]
	acceptedArtifactTypes: string[]
	approval: "never" | "before_external_commit" | "always"
}

export interface BuddyAgentCard {
	protocol: "agent-card/1"
	identity: BuddyIdentity
	communityId: string
	organizationId?: string
	capabilities: BuddyAgentCardCapability[]
	endpoints: string[]
	issuedAt: string
	expiresAt: string
	signature?: BuddySignature
}
 
 export interface BuddyRoomMember {
 	principalId: string
 	role: "owner" | "member" | "observer" | "agent"
 	joinedAt: string
 	active: boolean
 }
 
 export interface BuddyRoomPolicy {
 	visibility: "private" | "org" | "invite" | "public"
 	allowedTrustLevels: TrustLevel[]
 	retention: "task" | "room" | "owner"
 	allowExternalSideEffects: boolean
 }
 
 export interface BuddyChannel {
 	id: string
 	handle: string
 	kind: "channel" | "dm" | "thread"
 	rootEventId?: string
 }
 
 export interface BuddyRoom {
 	id: string
 	handle: string
 	kind: "personal" | "team" | "open"
 	ownerUserId: string
 	organizationId?: string
 	visibility: "private" | "org" | "invite" | "public"
 	channels: BuddyChannel[]
 	members: BuddyRoomMember[]
 	policy: BuddyRoomPolicy
 }
 
 export interface BuddyAcceptanceTest {
 	id: string
 	description: string
 	command?: string
 	expectedArtifactTypes?: string[]
 }
 
 export interface BuddyProcedureStep {
 	id: string
 	name: string
 	capability: string
 	inputRefs: string[]
 	outputArtifactTypes: string[]
 	acceptanceTests: BuddyAcceptanceTest[]
 }
 
 export interface BuddyCost {
 	tokens?: number
 	money?: number
 	currency?: string
 }
 
 export interface BuddyCapability {
 	id: string
 	providerId: string
 	description: string
 	inputSchema: Record<string, unknown>
 	outputSchema: Record<string, unknown>
 	procedure: BuddyProcedureStep[]
 	allowedDataScopes: string[]
 	forbiddenDataScopes: string[]
 	allowedActions: string[]
 	forbiddenActions: string[]
 	acceptanceTests: BuddyAcceptanceTest[]
 	requiredApproval: "never" | "before_external_commit" | "always"
 	allowDelegation: boolean
 	maxDelegationDepth: number
 	estimatedCost?: BuddyCost
 	visibility: "private" | "room" | "org" | "directory"
 }
 
export interface BuddyTaskPolicy {
 	dataScopes: string[]
 	allowedActions: string[]
 	forbiddenActions: string[]
 	budget?: BuddyCost
 	approval: "never" | "before_external_commit" | "always"
 	allowDelegation: boolean
 	maxDelegationDepth: number
 	retention: "task" | "room" | "owner"
	expiresAt: string
}

export type BuddySideEffectIntentStatus = "pending" | "approved" | "consumed" | "completed" | "failed" | "rejected" | "cancelled" | "expired"

export interface BuddySideEffectIntent {
	intentId: string
	taskId: string
	approvalId: string
	roomId: string
	capability: string
	action: string
	resourceId?: string
	fingerprint: string
	summary: string
	createdAt: string
	expiresAt: string
	status: BuddySideEffectIntentStatus
	consumedAt?: string
	completedAt?: string
	error?: string
}
 
 export interface BuddyDeliveryPolicy {
 	acceptedArtifactTypes: string[]
 	retention: "task" | "room" | "owner"
 	redactionRequired: boolean
 }
 
 export interface BuddySignature {
 	algorithm: string
 	keyRef: string
 	value: string
 }
 
 export type BuddyTaskMessageType =
 	| "task.propose"
 	| "task.bid"
 	| "task.award"
 	| "task.authorize"
 	| "task.progress"
 	| "task.deliver"
 	| "task.verify"
 	| "task.accept"
 	| "task.revoke"
 	| "task.fail"
 	| "task.revision_requested"
 	| "task.dispute"
 
export interface BuddyTaskEnvelope {
 	protocol: "buddy/1.0"
 	messageType: BuddyTaskMessageType
 	messageId: string
 	traceId: string
 	taskId: string
 	nonce: string
 	sender: BuddyIdentity
 	recipient?: BuddyIdentity
 	roomRef?: string
 	createdAt: string
 	expiresAt: string
 	objective: string
 	capability: string
 	input: {
 		constraints?: Record<string, unknown>
 		contextRefs?: string[]
 		locale?: string
 	}
 	output: {
 		schema: Record<string, unknown>
 		acceptanceTests: BuddyAcceptanceTest[]
 		artifactTypes: string[]
 	}
	policy: BuddyTaskPolicy
	delivery: BuddyDeliveryPolicy
	sideEffectIntentId?: string
	sideEffectFingerprint?: string
	executionRef?: BuddyExecutionRef
	capabilityToken?: string
	signature?: BuddySignature
}

export interface BuddyExecutionRef {
	executionId: string
	taskId: string
	workflowId?: string
	stepId?: string
	teamId?: string
	memberId?: string
	sessionId?: string
}
 
 export interface BuddyScope {
 	communityId: string
 	organizationId?: string
 	roomId?: string
 	taskId?: string
 }

 export type BuddyFederatedRoomGrantOperation = "endpoint.register" | "task.send" | "events.query"

 export interface FederatedRoomGrant {
	grantId: string
	projectId: string
	communityId: string
	organizationId?: string
	roomId: string
	taskId?: string
	requesterOrganizationId?: string
	providerOrganizationId?: string
	allowedPrincipals: string[]
	allowedCapabilities: string[]
	allowedDataScopes: string[]
	allowedActions: string[]
	allowedOperations: BuddyFederatedRoomGrantOperation[]
	issuedAt: string
	expiresAt: string
	revokedAt?: string
	issuerId: string
	signature?: BuddySignature
 }
 
 export interface BuddyEvent<T = Record<string, unknown>> extends BuddyScope {
 	id: string
 	kind: string
 	actor: BuddyIdentity
 	subject?: string
 	nonce: string
 	createdAt: string
 	payload: T
 	payloadDigest: string
 	previousEventId?: string
 	signature?: BuddySignature
 }
 
 export type BuddyArtifactKind = "brief" | "plan" | "code" | "document" | "dataset" | "message" | "other"
 
 export interface BuddyArtifact {
 	id: string
 	taskId: string
 	kind: BuddyArtifactKind
 	title: string
 	uri?: string
 	digest: string
 	visibility: "requester" | "provider" | "verifier" | "room" | "public"
 }
 
 export type BuddyEvidenceType = "source" | "execution" | "test" | "approval" | "signature"
 
 export interface BuddyEvidence {
 	id: string
 	taskId: string
 	type: BuddyEvidenceType
 	title: string
 	artifactRefs: string[]
 	digest: string
 	metadata?: Record<string, unknown>
 }
 
 export type VerificationStatus = "verified" | "unverified" | "rejected"
 
 export interface BuddyVerification {
 	status: VerificationStatus
 	providerId: string
 	verifierId?: string
 	reason?: string
 	createdAt: string
 }
 
 export interface BuddyEvidenceBundle {
 	taskId: string
 	providerId: string
 	artifacts: BuddyArtifact[]
 	evidence: BuddyEvidence[]
 	verification?: BuddyVerification
 	bundleDigest: string
 }
 
 export interface OwnerDelegation {
 	ownerUserId: string
 	agentId: string
 	organizationId?: string
 	allowedRooms: string[]
 	allowedCapabilities: string[]
 	expiresAt: string
 	revokedAt?: string
 	proofRef?: string
 }
 
 export interface EventQueryScope {
 	communityId?: string
 	organizationId?: string
 	roomId?: string
 	taskId?: string
 }
 
 export interface EventStore {
 	append<T>(event: BuddyEvent<T>): Promise<{ event: BuddyEvent<T>; duplicate: boolean }>
	query(scope: EventQueryScope): Promise<BuddyEvent[]>
 }
 
 export interface IdentityProvider {
 	get(identityId: string): Promise<BuddyIdentity | undefined>
 	resolve(handle: string, scope: EventQueryScope): Promise<BuddyIdentity | undefined>
 }
 
export interface Transport {
	send(envelope: BuddyTaskEnvelope, scope: BuddyScope): Promise<void>
 	subscribe(scope: EventQueryScope, handler: (event: BuddyEvent) => void): () => void
 }
 
	export interface CapabilityProvider {
	list(scope: EventQueryScope): Promise<BuddyCapability[]>
	invoke(input: {
		capability: BuddyCapability
		envelope: BuddyTaskEnvelope
		sideEffectIntentAuthorized?: boolean
		signal?: AbortSignal
	}): Promise<{ artifacts: BuddyArtifact[]; evidence: BuddyEvidence[]; executionRef?: BuddyExecutionRef }>
}
 
 export function stableDigest(value: unknown): string {
 	const text = stableSerialize(value)
 	let hash = 1469598103934665603n
 	for (let index = 0; index < text.length; index += 1) {
 		hash ^= BigInt(text.charCodeAt(index))
 		hash = BigInt.asUintN(64, hash * 1099511628211n)
 	}
 	return hash.toString(16).padStart(16, "0")
 }
 
 export function stableSerialize(value: unknown): string {
 	if (value === undefined) return "undefined"
 	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined"
 	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`
 	const record = value as Record<string, unknown>
 	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`
 }

 export function matchesDataScope(allowedScope: string, requestedScope: string): boolean {
	if (allowedScope === requestedScope) return true
	if (!allowedScope.endsWith("*")) return false
	return requestedScope.startsWith(allowedScope.slice(0, -1))
 }
 
 export function createEvent<T>(input: Omit<BuddyEvent<T>, "payloadDigest">): BuddyEvent<T> {
 	return { ...input, payloadDigest: stableDigest(input.payload) }
 }
