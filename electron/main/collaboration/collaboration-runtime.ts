import {
	type BuddyEvent,
	type BuddyExecutionRef,
	type BuddyIdentity,
	type BuddyAgentCard,
	type BuddyAgentRef,
	type BuddyRoom,
	type BuddyRoomMember,
	type BuddyCollaborationCommand,
	createEvent,
	stableDigest,
	OPENBUDDY_COLLABORATION_PROTOCOL_VERSION,
	type BuddyCollaborationManifest,
	type FederatedRoomGrant,
	type BuddySideEffectIntent,
} from "@openbuddy/collaboration-protocol";
import {
	createTaskProposal,
	OrganizationCoordinator,
	OrganizationTaskExecutor,
	OrganizationWorkflowExecutor,
	projectTasks,
	type ApprovalRequest,
	type DelegationGrant,
	type OrganizationMember,
	type TaskControlProjection,
	type TaskProjection,
	type OrganizationRole,
	type TaskVerifier,
	type OrganizationTaskExecutionInput,
	type OrganizationWorkflowNode,
} from "@openbuddy/collaboration-coordinator";
import type { BuddyCapability, BuddyEvidenceBundle, BuddyTaskEnvelope, CapabilityProvider } from "@openbuddy/collaboration-protocol";
import { agentCardKeyRef, createEd25519AgentCardVerifier, DurableRelayOutbox, issueEd25519FederatedRoomGrant, issueFederatedRoomGrant, issueRelayCapabilityToken, JsonAgentCardTrustStore, JsonAgentDirectoryAdapter, JsonRelayOutboxStore, JsonRelaySyncCursorStore, LocalRelay, OpenNetworkCoordinator, RelayOutboxExpiredError, RelaySyncScheduler, verifyEd25519FederatedRoomGrant, verifyFederatedRoomGrant, type AgentCardTrustStore, type BuddyRelayPort, type LocalRelayEndpoint, type NetworkSnapshot, type NetworkMutation, type NetworkTrustRootProjection, type PeerTrust, type ServiceOffer, type ServiceBid, type ServiceProposal, type RelayOutboxRetryResult, type RelaySyncSchedulerSnapshot, type RemoteRelayTransport } from "@openbuddy/collaboration-network";
import { InboxProjection, type BuddyInboxItem, type InboxCursor } from "@openbuddy/collaboration-inbox";
import { InMemoryRoomStore, type RoomScope } from "@openbuddy/collaboration-room";
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, type KeyLike } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CollaborationTaskProjection = TaskProjection;

export interface CollaborationActivityProjection {
	id: string;
	kind: string;
	subject?: string;
	createdAt: string;
	taskId?: string;
	roomId?: string;
	executionRef?: BuddyExecutionRef;
}

export interface CollaborationUpdate {
	eventId: string;
	kind: string;
	taskId?: string;
	roomId?: string;
	updatedAt: string;
}

export interface CollaborationCapabilityProjection {
	id: string;
	providerId?: string;
	name: string;
	source: "pi-skill" | "pi-extension" | "prompt";
	visibility: "local" | "organization";
	status: "available" | "degraded";
	contract: {
		input: "context-refs";
		output: "artifact-or-message";
		approval: "before-external-commit";
	};
}

export interface McpCapabilityGovernanceProjection {
	serverName: string;
	toolName: string;
	providerId: string;
	roomId: string;
	dataScopes: string[];
	allowedActions: string[];
	approval: "before_external_commit";
	status: string;
}

export interface CollaborationSnapshot {
	protocol: "buddy/1.0";
	mode: "local-first";
	collaborationManifest?: BuddyCollaborationManifest;
	identity: BuddyIdentity;
	rooms: Array<{
		room: BuddyRoom;
		memberCount: number;
		channelCount: number;
	}>;
	inbox: BuddyInboxItem[];
	tasks: CollaborationTaskProjection[];
	workflows: WorkflowSnapshot[];
	activity: CollaborationActivityProjection[];
	capabilities: {
		local: number;
		room: number;
		organization: number;
		directory: number;
	};
	capabilityCards: CollaborationCapabilityProjection[];
	mcpCapabilities: McpCapabilityGovernanceProjection[];
	policy: {
		dataScopes: string[];
		allowedActions: string[];
		forbiddenActions: string[];
		approval: "before_external_commit";
		expiresAt: string;
	};
	organization: {
		id: string;
		members: OrganizationMember[];
		delegations: DelegationGrant[];
		approvals: ApprovalRequest[];
		taskControls: TaskControlProjection[];
	};
	federatedRoomGrants: FederatedRoomGrantProjection[];
	network: NetworkSnapshot;
	relay: {
		status: "local" | "unknown" | "connecting" | "ready" | "degraded" | "closed";
		sync?: RelaySyncSchedulerSnapshot;
		pending: Array<{
			messageId: string;
			taskId: string;
			attempts: number;
			createdAt: string;
			lastAttemptAt?: string;
			lastError?: string;
		}>;
	};
	sideEffectIntents: SideEffectIntent[];
	updatedAt: string;
}

export interface SnapshotOptions {
	since?: number;
}

export interface SnapshotResponse {
	version: number;
	data: CollaborationSnapshot;
	hasMore: {
		events: boolean;
		inbox: boolean;
	};
}

export interface ProposeTaskInput {
	title: string;
	objective: string;
	capability?: string;
	roomId?: string;
	projectId?: string;
	contextRefs?: string[];
	capabilityInput?: Record<string, unknown>;
	sideEffectIntentId?: string;
	sideEffectFingerprint?: string;
	agentRef?: BuddyAgentRef;
}

export interface ProposeTaskResult {
	taskId: string;
	eventId: string;
	status: "proposed";
	roomId: string;
	executionRef: BuddyExecutionRef;
}

export interface CollaborationCommandResult extends ProposeTaskResult {
	mode: BuddyCollaborationCommand["mode"];
	projectId?: string;
	roomId: string;
	contract: {
		dataScopes: string[];
		artifactTypes: string[];
		approval: "before_external_commit";
		execution: "local" | "organization-provider" | "network-proposal";
	};
}

export interface CollaborationExecutionResult {
	taskId: string;
	status: "accepted" | "failed" | "rejected";
	executionRef?: BuddyExecutionRef;
	providerId?: string;
	verifierId?: string;
	bundleDigest?: string;
	artifactIds: string[];
	evidenceCount: number;
}

export type SideEffectIntent = BuddySideEffectIntent;

export interface WorkflowNodeInput {
	id: string;
	dependsOn?: string[];
	taskId?: string;
	title?: string;
	objective?: string;
	capability?: string;
	projectId?: string;
	roomId?: string;
	contextRefs?: string[];
	dataScopes?: string[];
	artifactTypes?: string[];
	capabilityInput?: Record<string, unknown>;
	agentRef?: BuddyAgentRef;
	/** When true, the node is realized as an open-network service proposal; bids and the runtime re-execute the awarded delivery. */
	crossNetwork?: boolean;
	sideEffectIntentId?: string;
	sideEffectFingerprint?: string;
}

export interface WorkflowProposalInput {
	title: string;
	mode: "personal" | "organization";
	projectId?: string;
	nodes: WorkflowNodeInput[];
}

export interface WorkflowNodeSnapshot {
	id: string;
	taskId: string;
	dependsOn: string[];
	title: string;
	status: "pending" | "running" | "accepted" | "rejected" | "failed" | "blocked";
	agentRef?: BuddyAgentRef;
	providerId?: string;
	capability?: string;
	projectId?: string;
	roomId?: string;
	dataScopes?: string[];
	sideEffectIntentId?: string;
	sideEffectFingerprint?: string;
	execution?: CollaborationExecutionResult;
	reason?: string;
}

export type WorkflowControlAction = "pause" | "resume" | "cancel" | "takeover" | "revision";

export interface WorkflowControlProjection {
	state: WorkflowControlAction;
	actorId: string;
	updatedAt: string;
	reason?: string;
}

export interface WorkflowSnapshot {
	workflowId: string;
	title: string;
	mode: "personal" | "organization";
	projectId?: string;
	status: "proposed" | "running" | "paused" | "cancelled" | "accepted" | "rejected" | "failed" | "blocked";
	nodes: WorkflowNodeSnapshot[];
	control?: WorkflowControlProjection;
	createdAt: string;
	updatedAt: string;
}

export interface WorkflowExecutionResult {
	workflowId: string;
	status: Exclude<WorkflowSnapshot["status"], "proposed" | "running">;
	nodes: Array<WorkflowNodeSnapshot & { execution?: CollaborationExecutionResult }>;
}

interface LocalTaskContract {
	taskId: string;
	title: string;
	objective: string;
	capability: string;
	mode: "personal" | "organization";
	dataScopes: string[];
	artifactTypes: string[];
	createdAt: string;
	projectId?: string;
	roomId?: string;
	contextRefs: string[];
	capabilityInput?: Record<string, unknown>;
	agentRef?: BuddyAgentRef;
	sideEffectIntentId?: string;
	sideEffectFingerprint?: string;
	executionRef: BuddyExecutionRef;
}

interface NetworkTaskContract {
	taskId: string;
	title: string;
	objective: string;
	capability: string;
	dataScopes: string[];
	artifactTypes: string[];
	createdAt: string;
	expiresAt: string;
	mode: "network";
	projectId?: string;
	roomId?: string;
	agentRef?: BuddyAgentRef;
	sideEffectIntentId?: string;
	sideEffectFingerprint?: string;
	executionRef: BuddyExecutionRef;
}

type TaskContract = LocalTaskContract | NetworkTaskContract;

function readWorkflowsFile(path: string): Map<string, WorkflowSnapshot> {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, WorkflowSnapshot>;
		return new Map(Object.entries(value).filter(([, workflow]) => workflow && typeof workflow.workflowId === "string"));
	} catch {
		return new Map();
	}
}

function readTaskContractsFile(path: string): Map<string, TaskContract> {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, TaskContract>;
		return new Map(Object.entries(value)
			.filter(([, contract]) => contract && typeof contract.taskId === "string")
				.map(([taskId, contract]) => [taskId, contract.mode === "network"
					? { ...contract, dataScopes: [...contract.dataScopes], artifactTypes: [...contract.artifactTypes], ...(contract.agentRef ? { agentRef: normalizeAgentRef(contract.agentRef) } : {}), executionRef: contract.executionRef ?? executionRefFor(taskId) }
						: { ...contract, contextRefs: normalizeContextRefs(contract.contextRefs), ...(contract.agentRef ? { agentRef: normalizeAgentRef(contract.agentRef) } : {}), executionRef: contract.executionRef ?? executionRefFor(taskId) }]));
	} catch {
		return new Map();
	}
}

function normalizeContextRefs(values: readonly string[] | undefined): string[] {
	return [...new Set((values ?? [])
		.map((value) => value.trim())
		.filter((value) => /^(?:project|room|asset|artifact|session):[A-Za-z0-9._:/-]+$/u.test(value)))]
		.slice(0, 32)
}

function collaborationRoomId(projectId: string | undefined, mode: "personal" | "organization"): string {
	if (!projectId) return "personal-room";
	return `project-${stableDigest({ projectId, mode })}`;
}

function taskRoomId(contract: Pick<LocalTaskContract, "projectId" | "mode" | "roomId">): string {
	return contract.roomId ?? collaborationRoomId(contract.projectId, contract.mode);
}

function normalizeTaskDataScopes(values: readonly string[] | undefined, roomId: string): string[] {
	const scopes = [...new Set((values ?? [`room:${roomId}`]).map((value) => value.trim()).filter(Boolean))];
	if (scopes.some((scope) => scope.startsWith("room:") && scope !== `room:${roomId}` && scope !== "room:project-*")) {
		throw new Error("task data scope must match its collaboration room");
	}
	return scopes;
}

function executionRefFor(taskId: string, providerId?: string): BuddyExecutionRef {
	return {
		executionId: `execution:${taskId}`,
		taskId,
		workflowId: `workflow:${taskId}`,
		stepId: `step:${taskId}:root`,
		teamId: `team:${taskId}`,
		...(providerId ? { memberId: providerId } : {}),
	};
}

function normalizeAgentRef(value: BuddyAgentRef | undefined): BuddyAgentRef | undefined {
	if (!value) return undefined;
	const id = value.id.trim();
	if (!id || !/^[A-Za-z0-9._:@/-]{1,160}$/u.test(id)) throw new Error("agentRef id is invalid");
	return { type: value.type, id };
}

export interface SharedEmailThreadInput {
	accountId: string;
	threadId: string;
	channelId: string;
	subject?: string;
	message?: string;
}

export interface SharedEmailThreadResult {
	eventId: string;
	channelId: string;
	threadId: string;
}

export interface NetworkDeliveryResult {
	awardStatus: "awarded";
	status: "pending_delivery" | "delivered" | "failed";
	proposalId: string;
	bidId: string;
	providerId: string;
	reason?: string;
}

export interface AddOrganizationMemberInput {
	id: string;
	handle: string;
	displayName: string;
	ownerUserId: string;
	role?: OrganizationRole;
}

export interface GrantDelegationInput {
	granteeId: string;
	taskId?: string;
	roomId?: string;
	allowedCapabilities: string[];
	allowedDataScopes: string[];
	expiresAt: string;
}

export type FederatedGrantOperation = FederatedRoomGrant["allowedOperations"][number];

export interface FederatedRoomGrantProjection {
	grantId: string;
	projectId: string;
	communityId: string;
	organizationId?: string;
	roomId: string;
	taskId?: string;
	requesterOrganizationId?: string;
	providerOrganizationId?: string;
	allowedPrincipals: string[];
	allowedCapabilities: string[];
	allowedDataScopes: string[];
	allowedActions: string[];
	allowedOperations: FederatedGrantOperation[];
	issuedAt: string;
	expiresAt: string;
	revokedAt?: string;
	issuerId: string;
	status: "active" | "expired" | "revoked";
}

export interface IssueFederatedRoomGrantInput {
	projectId: string;
	roomId: string;
	principalId: string;
	providerOrganizationId?: string;
	taskId?: string;
	allowedCapabilities: string[];
	allowedDataScopes: string[];
	allowedActions: string[];
	allowedOperations: FederatedGrantOperation[];
	expiresAt: string;
}

export interface OrganizationRoomMemberInput {
	roomId: string;
	principalId: string;
	role?: "member" | "observer" | "agent";
}

export interface RegisterNetworkPeerInput {
	identity: BuddyIdentity;
	capabilities: import("@openbuddy/collaboration-protocol").BuddyCapability[];
	agentCard?: BuddyAgentCard;
}

	const LOCAL_SCOPE: RoomScope = {
	communityId: "local-community",
	organizationId: "local-organization",
	roomId: "personal-room",
};

const LOCAL_IDENTITY: BuddyIdentity = {
	id: "buddy-local",
	handle: "me",
	displayName: "我的 Buddy",
	ownerUserId: "local-user",
	organizationId: LOCAL_SCOPE.organizationId,
	trustLevel: "local",
	status: "idle",
};

// P1-12: batching constants for async I/O coalescing.
const APPEND_FLUSH_MS = 16;        // one macrotask ≈ one render frame
const APPEND_FLUSH_MAX = 64;       // cap buffer so a burst can never OOM
const FULL_REWRITE_DEBOUNCE_MS = 200; // task-contract / workflow full rewrites

function localRoom(scope: RoomScope, identity: BuddyIdentity, kind: BuddyRoom["kind"] = "personal", handle = "我的工作空间"): BuddyRoom {
	return {
		id: scope.roomId,
		handle,
		kind,
		ownerUserId: identity.ownerUserId,
		organizationId: scope.organizationId,
		visibility: "private",
		channels: [
			{ id: "inbox", handle: "收件箱", kind: "channel" },
			{ id: "work", handle: "工作", kind: "channel" },
		],
		members: [{
			principalId: identity.id,
			role: "owner",
			joinedAt: new Date().toISOString(),
			active: true,
		}],
		policy: {
			visibility: kind === "team" ? "org" : "private",
			allowedTrustLevels: kind === "team" ? ["local", "org"] : ["local"],
			retention: "owner",
			allowExternalSideEffects: false,
		},
	};
}

export class CollaborationRuntime {
	/**
	 * Resolves once the runtime has finished its synchronous bootstrap
	 * (storage path resolution, identity hydration, relay setup). Always
	 * resolved at construction time today — left as a Promise so callers
	 * that need to `await runtime.ready` (e.g. A2A facade init, remote
	 * provider worker bootstrap) keep a stable hook when async startup is
	 * introduced later.
	 */
	readonly ready: Promise<void> = Promise.resolve();
	private readonly rooms = new InMemoryRoomStore();
	private readonly inbox = new InboxProjection();
	private identity: BuddyIdentity;
	private readonly scope: RoomScope;
	private readonly storagePath: string;
	private readonly cursorPath: string;
	private readonly contractsPath: string;
	private readonly workflowsPath: string;
	private readonly outboxPath: string;
	private readonly now: () => Date;

	// P1-12: async I/O batching state.
	//   - appendQueue: per-event log lines pending fsync. Flushes every
	//     APPEND_FLUSH_MS (16ms — one macrotask) OR when APPEND_FLUSH_MAX
	//     lines accumulate, whichever comes first. Without batching, a
	//     50-event/sec workload = 50 sync fsyncs/sec on the event loop.
	//   - contractsDirtyTimer / workflowsDirtyTimer: debounced full-file
	//     rewrite coalescers. Most task/contract mutations happen in
	//     clusters (e.g. a single batch of capability grants triggers 5+
	//     writeTaskContracts calls in 50ms) — without debounce that's 5
	//     whole-file rewrites when 1 is enough.
	private appendQueue: string[] = [];
	private appendFlushTimer: ReturnType<typeof setTimeout> | null = null;
	private appendWriteInFlight: Promise<void> = Promise.resolve();
	private contractsDirtyTimer: ReturnType<typeof setTimeout> | null = null;
	private workflowsDirtyTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly events: BuddyEvent[];
	private readonly taskContracts: Map<string, TaskContract>;
	private readonly workflows: Map<string, WorkflowSnapshot>;
	private readonly workflowRuns = new Map<string, AbortController>();
	private readonly projectRooms = new Map<string, RoomScope>();
	private readonly organization: OrganizationCoordinator;
	private readonly federatedRoomGrants = new Map<string, FederatedRoomGrant>();
	private readonly grantSigningSecret?: string;
	private readonly relayCapabilitySecret?: string;
	private readonly grantSigningPrivateKey?: KeyLike;
	private readonly grantSigningKeyRef?: string;
	private readonly network: OpenNetworkCoordinator;
	private readonly localRelay?: BuddyRelayPort & { hasEndpoint?: (identityId: string, scope: RoomScope) => boolean; revokeRoomGrant?: (grantId: string) => void | Promise<void>; setRoomGrantVerifier?: (verify: (grant: FederatedRoomGrant, expected: import("@openbuddy/collaboration-network").FederatedRoomGrantExpectation) => void) => void };
	private readonly relayOutbox?: DurableRelayOutbox;
	private readonly relaySyncScheduler?: RelaySyncScheduler;
	private readonly agentCardTrustStore: AgentCardTrustStore;
	private readonly networkDeliveryRuns = new Map<string, Promise<void>>();
	private readonly updateListeners = new Set<(update: CollaborationUpdate) => void>();
	private provider: CapabilityProvider | null = null;
	private personalProvider: CapabilityProvider | null = null;
	private capabilityCards: CollaborationCapabilityProjection[] = [];
	private providerCapabilityCards: CollaborationCapabilityProjection[] = [];
	private readonly sideEffectIntents = new Map<string, SideEffectIntent>();

	constructor(options: { storagePath?: string; now?: () => Date; localRelay?: BuddyRelayPort & { hasEndpoint?: (identityId: string, scope: RoomScope) => boolean; revokeRoomGrant?: (grantId: string) => void | Promise<void>; setRoomGrantVerifier?: (verify: (grant: FederatedRoomGrant, expected: import("@openbuddy/collaboration-network").FederatedRoomGrantExpectation) => void) => void }; relay?: BuddyRelayPort & { hasEndpoint?: (identityId: string, scope: RoomScope) => boolean; revokeRoomGrant?: (grantId: string) => void | Promise<void>; setRoomGrantVerifier?: (verify: (grant: FederatedRoomGrant, expected: import("@openbuddy/collaboration-network").FederatedRoomGrantExpectation) => void) => void }; relayOutbox?: DurableRelayOutbox; relaySync?: { enabled?: boolean; intervalMs?: number; maxBackoffMs?: number }; relayCapabilitySecret?: string; identity?: BuddyIdentity; scope?: RoomScope; verifyAgentCard?: (card: BuddyAgentCard) => boolean; agentCardTrustStore?: AgentCardTrustStore; grantSigningSecret?: string; grantSigningPrivateKey?: KeyLike } = {}) {
		this.storagePath = options.storagePath ?? join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent"), "openbuddy-collaboration", "events.jsonl");
		this.cursorPath = `${this.storagePath}.cursor.json`;
		this.contractsPath = `${this.storagePath}.contracts.json`;
		this.workflowsPath = `${this.storagePath}.workflows.json`;
		this.outboxPath = `${this.storagePath}.outbox.json`;
		this.agentCardTrustStore = options.agentCardTrustStore ?? new JsonAgentCardTrustStore(join(dirname(this.storagePath), "agent-card-trust.json"));
		this.now = options.now ?? (() => new Date());
		this.scope = structuredClone(options.scope ?? LOCAL_SCOPE);
		this.identity = structuredClone(options.identity ?? LOCAL_IDENTITY);
		const configuredGrantSecret = options.grantSigningSecret ?? process.env.OPENBUDDY_FEDERATED_GRANT_SECRET;
		this.grantSigningPrivateKey = options.grantSigningPrivateKey ?? (configuredGrantSecret ? undefined : this.readOrCreateGrantSigningPrivateKey());
		if (this.grantSigningPrivateKey) {
			this.grantSigningKeyRef = agentCardKeyRef(createPublicKey(this.grantSigningPrivateKey));
		}
		this.grantSigningSecret = configuredGrantSecret;
		this.relayCapabilitySecret = options.relayCapabilitySecret ?? process.env.OPENBUDDY_RELAY_CAPABILITY_SECRET;
		this.localRelay = options.relay ?? options.localRelay;
		this.localRelay?.setRoomGrantVerifier?.((grant, expected) => {
			if (grant.signature?.algorithm === "Ed25519") return verifyEd25519FederatedRoomGrant(grant, (keyRef) => this.resolveGrantPublicKey(keyRef), expected, this.now().toISOString());
			return verifyFederatedRoomGrant(grant, this.grantSigningSecret!, expected, this.now().toISOString());
		});
		this.relayOutbox = this.localRelay
			? options.relayOutbox ?? new DurableRelayOutbox({ relay: this.localRelay, store: new JsonRelayOutboxStore(this.outboxPath), now: () => this.now().toISOString() })
			: undefined;
		this.events = this.readEvents();
		this.taskContracts = readTaskContractsFile(this.contractsPath);
		this.workflows = readWorkflowsFile(this.workflowsPath);
		this.network = new OpenNetworkCoordinator({
			communityId: this.scope.communityId,
			localIdentity: this.identity,
			initialEvents: this.events,
			now: () => this.now().toISOString(),
			emit: (event) => this.appendEvent(event),
			verifyAgentCard: options.verifyAgentCard ?? createEd25519AgentCardVerifier((keyRef, card) => this.agentCardTrustStore.resolvePublicKey(keyRef, card)),
			trustRoots: () => this.agentCardTrustRoots(),
			 directoryAdapter: new JsonAgentDirectoryAdapter(join(dirname(this.storagePath), "agent-directory.json")),
		});
		const localRevocationAwareRelay = this.localRelay && "applyLocalRevocations" in this.localRelay
			? this.localRelay as BuddyRelayPort & { applyLocalRevocations: (records: readonly import("@openbuddy/collaboration-network").RelayRevocationRecord[]) => void }
			: undefined;
		localRevocationAwareRelay?.applyLocalRevocations(this.network.snapshot().authorityRevocations);
		const remoteRelay = this.localRelay && "syncAuthorityState" in this.localRelay ? this.localRelay as BuddyRelayPort & Pick<RemoteRelayTransport, "syncAuthorityState"> : undefined;
		if (remoteRelay && options.relaySync?.enabled) {
			this.relaySyncScheduler = new RelaySyncScheduler({
				transport: remoteRelay,
				cursorStore: new JsonRelaySyncCursorStore(`${this.storagePath}.relay-sync.json`),
				intervalMs: options.relaySync.intervalMs,
				maxBackoffMs: options.relaySync.maxBackoffMs,
				now: this.now,
				onSync: async (result) => {
					for (const revocation of result.revocations) {
						this.network.applyAuthorityRevocation(revocation);
						if (revocation.kind === "room-grant" && this.federatedRoomGrants.has(revocation.identifier)) this.revokeFederatedRoomGrant(revocation.identifier);
					}
					for (const presence of result.presences) {
						if (presence.lease.communityId !== this.scope.communityId || !this.network.directory.get(presence.lease.identityId)) continue;
						this.network.setPeerPresence(presence.lease.identityId, presence.status === "active" ? presence.lease : undefined);
					}
					this.network.refreshAgentCardStatuses();
				},
			});
		}
		const cursor = this.readCursor();
		if (cursor) this.inbox.restoreCursor(cursor);
		const created = this.rooms.create(this.scope, localRoom(this.scope, this.identity), this.identity);
		this.persistIfMissing(created.event);
		this.rooms.setPresence(this.scope, {
			agentId: this.identity.id,
			bodyId: "electron-local-body",
			status: "idle",
			startedAt: created.event.createdAt,
			lastHeartbeatAt: created.event.createdAt,
			expiresAt: new Date(this.now().getTime() + 60_000).toISOString(),
		}, this.identity);
		const presenceEvent = this.rooms.queryEvents(this.scope).find((event) => event.kind === "agent.presence");
		if (presenceEvent) this.persistIfMissing(presenceEvent);
		for (const contract of this.taskContracts.values()) {
			if (contract.projectId) this.ensureProjectRoom(contract.projectId, contract.mode === "personal" ? "personal" : "organization", contract.roomId);
		}
		this.organization = new OrganizationCoordinator({
			scope: this.scope,
			owner: this.identity,
			initialEvents: this.events,
			emit: (event) => this.appendEvent(event),
			now: () => this.now().toISOString(),
		});
		this.restoreSideEffectIntents();
		this.restoreFederatedRoomGrants();
		this.relaySyncScheduler?.start();
	}

	private resolveGrantPublicKey(keyRef: string): KeyLike | undefined {
		if (keyRef === this.grantSigningKeyRef && this.grantSigningPrivateKey) return createPublicKey(this.grantSigningPrivateKey);
		return this.agentCardTrustStore.resolvePublicKey(keyRef, {} as BuddyAgentCard);
	}

	getCollaborationStoragePath(): string {
		return this.storagePath;
	}

	private readOrCreateGrantSigningSecret(): string {
		const secretPath = `${this.storagePath}.federated-grant-secret`;
		try {
			const existing = readFileSync(secretPath, "utf8").trim();
			if (existing.length >= 32) return existing;
		} catch {
			// Generate the local secret below when this is the first runtime start.
		}
		mkdirSync(dirname(secretPath), { recursive: true });
		const secret = randomBytes(32).toString("base64url");
		writeFileSync(secretPath, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
		try { chmodSync(secretPath, 0o600); } catch { /* best effort on platforms without POSIX modes */ }
		return secret;
	}

	private readOrCreateGrantSigningPrivateKey(): KeyLike {
		const keyPath = `${this.storagePath}.federated-grant-private-key.pem`;
		try {
			const existing = readFileSync(keyPath, "utf8").trim();
			if (existing) return createPrivateKey(existing);
		} catch {
			// Generate the local Ed25519 signing key below on first startup.
		}
		const { privateKey } = generateKeyPairSync("ed25519");
		const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
		mkdirSync(dirname(keyPath), { recursive: true });
		writeFileSync(keyPath, `${pem}\n`, { encoding: "utf8", mode: 0o600 });
		try { chmodSync(keyPath, 0o600); } catch { /* best effort on platforms without POSIX modes */ }
		return privateKey;
	}

	private syncRoomMember(scope: RoomScope, identity: BuddyIdentity, role: "member" | "agent"): void {
		if (this.rooms.listMembers(scope).some((member) => member.principalId === identity.id)) return;
		const added = this.rooms.addMember(scope, { principalId: identity.id, role, joinedAt: this.now().toISOString(), active: true }, this.identity);
		this.persistIfMissing(added.event);
	}

	private organizationRoomScope(roomId: string): RoomScope {
		const scope = [this.scope, ...this.projectRooms.values()].find((candidate) => candidate.roomId === roomId);
		if (!scope || scope.roomId === this.scope.roomId) throw new Error("organization project room is unavailable");
		const room = this.rooms.get(scope);
		if (!room || room.kind !== "team" || room.organizationId !== this.scope.organizationId) throw new Error("room is outside the organization scope");
		return scope;
	}

	private ensureProjectRoom(projectId: string, mode: "personal" | "organization", roomId = collaborationRoomId(projectId, mode)): RoomScope {
		const key = `${mode}:${projectId}`;
		const existing = this.projectRooms.get(key);
		if (existing) return existing;
		const scope: RoomScope = { ...this.scope, roomId };
		const room = localRoom(scope, this.identity, mode === "organization" ? "team" : "personal", `项目 ${projectId}`);
		const created = this.rooms.create(scope, room, this.identity);
		this.persistIfMissing(created.event);
		this.restoreRoomMembers(scope);
		this.projectRooms.set(key, scope);
		return scope;
	}

	private restoreRoomMembers(scope: RoomScope): void {
		const latest = new Map<string, { principalId: string; role: "owner" | "member" | "observer" | "agent"; joinedAt: string; active: boolean }>();
		for (const event of this.events) {
			if (event.communityId !== scope.communityId || event.organizationId !== scope.organizationId || event.roomId !== scope.roomId || (event.kind !== "room.member_added" && event.kind !== "room.member_removed")) continue;
			const payload = event.payload as { member?: unknown };
			if (!payload.member || typeof payload.member !== "object") continue;
			const member = payload.member as { principalId?: unknown; role?: unknown; joinedAt?: unknown; active?: unknown };
			if (typeof member.principalId !== "string" || typeof member.joinedAt !== "string") continue;
			if (member.role !== "owner" && member.role !== "member" && member.role !== "observer" && member.role !== "agent") continue;
			latest.set(member.principalId, {
				principalId: member.principalId,
				role: member.role,
				joinedAt: member.joinedAt,
				active: event.kind === "room.member_removed" ? false : member.active !== false,
			});
		}
		for (const member of latest.values()) {
			if (!member.active || this.rooms.listMembers(scope).some((candidate) => candidate.principalId === member.principalId)) continue;
			this.rooms.addMember(scope, member, this.identity);
		}
	}

	private scopeForTask(input: { projectId?: string; mode: "personal" | "organization"; roomId?: string }): RoomScope {
		if (!input.projectId) {
			if (input.roomId && input.roomId !== this.scope.roomId) throw new Error("task room is outside the local collaboration scope");
			return { ...this.scope };
		}
		const expectedRoomId = collaborationRoomId(input.projectId, input.mode);
		if (input.roomId && input.roomId !== expectedRoomId) throw new Error("project task room does not match its project and mode");
		return this.ensureProjectRoom(input.projectId, input.mode, expectedRoomId);
	}

	private knownRoom(roomId: string | undefined): boolean {
		return roomId === this.scope.roomId || [...this.projectRooms.values()].some((scope) => scope.roomId === roomId);
	}

	private allCollaborationEvents(): BuddyEvent[] {
		return this.events.filter((event) => event.communityId === this.scope.communityId && event.organizationId === this.scope.organizationId && this.knownRoom(event.roomId));
	}

	setCapabilityCards(cards: CollaborationCapabilityProjection[]): void {
		const merged = [...cards, ...this.providerCapabilityCards.filter((providerCard) => !cards.some((card) => card.id === providerCard.id))];
		this.capabilityCards = merged.map((card) => structuredClone(card));
		const provider = this.provider as (CapabilityProvider & { setCapabilities?: (capabilities: BuddyCapability[]) => void }) | null;
		const personalProvider = this.personalProvider as (CapabilityProvider & { setCapabilities?: (capabilities: BuddyCapability[]) => void }) | null;
		const organizationCards = this.capabilityCards.filter((card) => card.visibility === "organization");
		const personalCards = this.capabilityCards.filter((card) => card.visibility === "local");
		if (organizationCards.length > 0) provider?.setCapabilities?.(organizationCards.map((card) => this.capabilityFromCard(card, provider)));
		if (personalCards.length > 0) personalProvider?.setCapabilities?.(personalCards.map((card) => this.capabilityFromCard(card, personalProvider)));
		this.network.setLocalCapabilities(organizationCards.map((card) => this.capabilityFromCard(card, this.provider, this.identity.id)));
	}

	setProviderCapabilityCards(cards: CollaborationCapabilityProjection[]): void {
		this.providerCapabilityCards = cards.map((card) => structuredClone(card));
		this.setCapabilityCards(this.capabilityCards.filter((card) => !this.providerCapabilityCards.some((providerCard) => providerCard.id === card.id)));
	}

	async flush(): Promise<void> {
		// Best-effort flush of the underlying directory adapter if it exposes one.
		const flushable = (this.network as unknown as { directory?: { adapter?: { flush?: () => Promise<void> | void } } }).directory?.adapter;
		if (flushable?.flush) await flushable.flush();
	}

	onUpdate(listener: (update: CollaborationUpdate) => void): () => void {
		this.updateListeners.add(listener);
		return () => this.updateListeners.delete(listener);
	}

	registerNetworkPeer(input: RegisterNetworkPeerInput): void {
		this.network.registerPeer(input);
	}

	setNetworkPeerTrust(peerId: string, trust: PeerTrust): void {
		this.network.setPeerTrust(peerId, trust);
	}

	agentCardTrustRoots(): NetworkTrustRootProjection[] {
		return this.agentCardTrustStore.records().map(({ keyRef, addedAt, revokedAt }) => ({ keyRef, addedAt, ...(revokedAt ? { revokedAt } : {}) }));
	}

	addAgentCardTrustRoot(publicKeyPem: string): NetworkTrustRootProjection {
		const record = this.agentCardTrustStore.addPublicKeyPem(publicKeyPem.trim());
		this.network.refreshAgentCardStatuses();
		return { keyRef: record.keyRef, addedAt: record.addedAt, ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}) };
	}

	revokeAgentCardTrustRoot(keyRef: string): NetworkTrustRootProjection[] {
		this.agentCardTrustStore.revoke(keyRef.trim());
		this.network.refreshAgentCardStatuses();
		return this.agentCardTrustRoots();
	}

	networkSnapshot(): NetworkSnapshot {
		return this.network.snapshot();
	}

	stopRelaySync(): void {
		this.relaySyncScheduler?.stop();
	}

	collaborationManifest(): BuddyCollaborationManifest {
		return {
			protocol: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION,
			pluginId: "openbuddy-collaboration",
			capabilities: [
				{ id: "identity", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["personal", "organization", "network"], transport: "ipc", redactedProjection: true },
				{ id: "rooms", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["personal", "organization", "network"], transport: "relay", redactedProjection: true },
				{ id: "tasks", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["personal", "organization", "network"], transport: "ipc", redactedProjection: true },
				{ id: "workflows", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["personal", "organization"], transport: "ipc", redactedProjection: true },
				{ id: "policy", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["personal", "organization", "network"], transport: "ipc", redactedProjection: true },
				{ id: "approval", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["organization", "network"], transport: "ipc", redactedProjection: true },
				{ id: "evidence", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["personal", "organization", "network"], transport: "ipc", redactedProjection: true },
				{ id: "verification", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["personal", "organization", "network"], transport: "ipc", redactedProjection: true },
				{ id: "side-effects", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["personal", "organization", "network"], transport: "ipc", redactedProjection: true },
				{ id: "directory", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["network"], transport: "relay", redactedProjection: true },
				{ id: "relay", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["network"], transport: "relay", redactedProjection: true },
				{ id: "a2a", version: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, modes: ["network"], transport: "a2a", redactedProjection: true },
			],
			invariants: ["single-runtime-source-of-truth", "discovery-is-not-authorization", "provider-cannot-self-verify", "renderer-receives-redacted-projection"],
		};
	}

updateBuddyIdentity(patch: { handle?: string; displayName?: string; organizationId?: string; status?: "idle" | "working" | "offline" }): BuddyIdentity {
		// `id` / `ownerUserId` / `trustLevel` 不可改；handle/displayName/organizationId/status 可改。
		// 调用方（如 IPC handler）负责先持久化到 BuddyIdentityStore，再调本方法更新内存。
		const next: BuddyIdentity = {
			...this.identity,
			...(patch.handle !== undefined ? { handle: patch.handle.trim() || this.identity.handle } : {}),
			...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() || this.identity.displayName } : {}),
			...(patch.organizationId !== undefined ? { organizationId: patch.organizationId.trim() || this.identity.organizationId } : {}),
			...(patch.status !== undefined ? { status: patch.status } : {}),
		};
		if (next.handle === this.identity.handle && next.displayName === this.identity.displayName && next.organizationId === this.identity.organizationId && next.status === this.identity.status) {
			return structuredClone(this.identity);
		}
		this.identity = next;
		const update: CollaborationUpdate = {
			eventId: crypto.randomUUID(),
			kind: "identity.updated",
			updatedAt: this.now().toISOString(),
		};
		for (const listener of this.updateListeners) listener(update);
		return structuredClone(next);
	}

	networkPublishOffer(input: Omit<ServiceOffer, "id">): void {
		this.network.publishOffer(input);
	}

	networkProposeService(input: { capabilityId: string; objective: string; dataScopes: string[]; allowedActions?: string[]; artifactTypes: string[]; expiresAt: string }): NetworkMutation<ServiceProposal> {
		return this.network.proposeService(input);
	}

	networkNegotiateCapability(input: { offerId: string; proposalId: string; providerId: string }): NetworkMutation<import("@openbuddy/collaboration-network").NetworkCapabilityAgreement> {
		return this.network.negotiateCapability(input);
	}

	networkRevokeCapabilityAgreement(agreementId: string, reason: string): NetworkMutation<import("@openbuddy/collaboration-network").NetworkCapabilityAgreement> {
		return this.network.revokeCapabilityAgreement(agreementId, reason, this.identity.id);
	}

	networkSubmitBid(input: Omit<ServiceBid, "id" | "createdAt" | "status">): void {
		this.network.submitBid(input);
	}

	registerLocalNetworkEndpoint(endpoint: LocalRelayEndpoint, grant?: FederatedRoomGrant): () => void {
		if (!this.localRelay) throw new Error("local network relay is unavailable");
		if (endpoint.scope.communityId !== this.scope.communityId || endpoint.scope.organizationId !== this.scope.organizationId) throw new Error("network endpoint is outside the local collaboration scope");
		if (endpoint.scope.roomId !== this.scope.roomId) {
			if (!grant || grant.roomId !== endpoint.scope.roomId || grant.projectId.trim() === "") throw new Error("project network endpoint requires a matching room grant");
			this.ensureProjectRoom(grant.projectId, "organization", grant.roomId);
		}
		const registration = this.localRelay.registerEndpoint(endpoint, grant);
		if (typeof registration !== "function") throw new Error("remote relay endpoint registration requires async registration");
		return registration;
	}

	async registerRemoteNetworkEndpoint(endpoint: LocalRelayEndpoint, grant?: FederatedRoomGrant): Promise<() => void> {
		if (!this.localRelay) throw new Error("network relay is unavailable");
		if (endpoint.scope.communityId !== this.scope.communityId || endpoint.scope.organizationId !== this.scope.organizationId) throw new Error("network endpoint is outside the local collaboration scope");
		if (endpoint.scope.roomId !== this.scope.roomId) {
			if (!grant || grant.roomId !== endpoint.scope.roomId || grant.projectId.trim() === "") throw new Error("project network endpoint requires a matching room grant");
			this.ensureProjectRoom(grant.projectId, "organization", grant.roomId);
		}
		return await this.localRelay.registerEndpoint(endpoint, grant);
	}

	registerProviderNetworkEndpoint(provider: CapabilityProvider, endpointIdentity?: BuddyIdentity, grant?: FederatedRoomGrant): () => void {
		return this.registerLocalNetworkEndpoint(this.createProviderNetworkEndpoint(provider, endpointIdentity, grant), grant);
	}

	async registerRemoteProviderNetworkEndpoint(provider: CapabilityProvider, endpointIdentity?: BuddyIdentity, grant?: FederatedRoomGrant): Promise<() => void> {
		return await this.registerRemoteNetworkEndpoint(this.createProviderNetworkEndpoint(provider, endpointIdentity, grant), grant);
	}

	private createProviderNetworkEndpoint(provider: CapabilityProvider, endpointIdentity?: BuddyIdentity, grant?: FederatedRoomGrant): LocalRelayEndpoint {
		const providerIdentity = (provider as CapabilityProvider & { identitySnapshot?: () => BuddyIdentity }).identitySnapshot?.();
		if (!providerIdentity) throw new Error("network provider identity is unavailable");
		const identity = endpointIdentity ? structuredClone(endpointIdentity) : providerIdentity;
		const endpointProvider: CapabilityProvider = endpointIdentity && endpointIdentity.id !== providerIdentity.id
			? {
				list: async (scope) => (await provider.list(scope)).map((capability) => ({ ...capability, providerId: providerIdentity.id })),
				invoke: async (input) => {
						const capabilities = await provider.list(this.scope);
					const original = capabilities.find((capability) => capability.id === input.capability.id);
					if (!original) throw new Error("aliased network capability is unavailable in the provider");
					return provider.invoke({ ...input, capability: original });
				},
			}
			: provider;
		return {
			identity,
			scope: { ...this.scope, ...(grant ? { roomId: grant.roomId } : {}) },
			accept: async (envelope) => {
				await this.executeNetworkEnvelope(envelope, providerIdentity, endpointProvider, grant?.roomId, grant);
			},
		};
	}

	private async executeNetworkEnvelope(envelope: BuddyTaskEnvelope, providerIdentity: BuddyIdentity, provider: CapabilityProvider, roomId = this.scope.roomId, grant?: FederatedRoomGrant): Promise<void> {
		if (this.events.some((event) => event.kind === "task.evidence_verified" && event.taskId === envelope.taskId)) return;
		if (this.networkDeliveryRuns.has(envelope.messageId)) return this.networkDeliveryRuns.get(envelope.messageId);
		const run = (async () => {
			const verifierIdentity: BuddyIdentity = {
				id: `${providerIdentity.id}-network-verifier`,
				handle: `${providerIdentity.handle}-network-verifier`,
				displayName: "网络独立验证 Buddy",
				ownerUserId: this.identity.ownerUserId,
				organizationId: this.scope.organizationId,
				trustLevel: "org",
				status: "idle",
			};
			const verifier: TaskVerifier = {
				id: verifierIdentity.id,
				identity: verifierIdentity,
				verify: async (bundle) => ({ accepted: bundle.artifacts.length > 0 && bundle.evidence.length > 0 }),
			};
			const result = await new OrganizationTaskExecutor({
				scope: { ...this.scope, roomId },
				now: () => this.now().toISOString(),
				emit: (event) => this.appendScopedEvent(event),
			}).execute({
				envelope,
				scope: { ...this.scope, roomId },
				providerId: providerIdentity.id,
				providerIdentity: { ...providerIdentity, status: "working" },
					provider,
				verifier,
				requester: envelope.sender,
					...(grant ? { crossOrgGrant: grant } : {}),
					sideEffectIntentAuthorized: Boolean(envelope.sideEffectIntentId),
					...(envelope.sideEffectIntentId ? { sideEffectIntentRequired: true } : {}),
				});
				if (result.bundle) this.appendEvidenceEvent(result.bundle, providerIdentity, verifierIdentity, result.executionRef ?? envelope.executionRef, roomId);
				if (result.status !== "accepted") throw new Error(`network task ${result.status}`);
		})().finally(() => this.networkDeliveryRuns.delete(envelope.messageId));
		this.networkDeliveryRuns.set(envelope.messageId, run);
		return run;
	}

	async networkAwardBid(bidId: string): Promise<NetworkDeliveryResult> {
		const awarded = this.network.getAwardedBid(bidId) ?? this.network.awardBid(bidId).value;
		const contract = this.taskContracts.get(awarded.proposal.id);
		const existing = this.network.snapshot().deliveries.find((delivery) => delivery.bidId === bidId);
		const record = (status: NetworkDeliveryResult["status"], reason?: string): NetworkDeliveryResult => {
			if (existing?.status !== status || existing.reason !== reason) this.network.recordDelivery({ bidId: awarded.bid.id, proposalId: awarded.proposal.id, providerId: awarded.bid.providerId, status, ...(reason ? { reason } : {}) });
			return { awardStatus: "awarded", status, proposalId: awarded.proposal.id, bidId: awarded.bid.id, providerId: awarded.bid.providerId, ...(reason ? { reason } : {}) };
		};
		const pending = (reason: string): NetworkDeliveryResult => record("pending_delivery", reason);
		if (existing?.status === "delivered") {
			if (contract?.sideEffectIntentId) {
				const intent = this.sideEffectIntents.get(contract.sideEffectIntentId);
				if (intent?.status === "approved") this.consumeSideEffectIntent(intent.intentId, intent.fingerprint);
				if (intent?.status === "consumed") this.completeSideEffectIntent(intent.intentId, `relay:${awarded.proposal.id}`);
			}
			return record("delivered");
		}
		if (!contract || contract.mode !== "network") return pending("network task contract is unavailable");
		const peer = this.network.snapshot().peers.find((candidate) => candidate.identity.id === awarded.bid.providerId);
		if (!peer || !["known", "trusted"].includes(peer.trust)) return pending("provider trust is not active");
		const capability = peer.capabilities.find((candidate) => candidate.id === awarded.proposal.capabilityId);
		if (!capability) return pending("provider capability is unavailable");
		if (!this.localRelay) return pending("local network relay is unavailable");
		const scope = { ...this.scope, ...(contract.projectId && contract.roomId ? { roomId: contract.roomId } : {}), taskId: awarded.proposal.id };
		const grant = contract.projectId && contract.roomId
			? [...this.federatedRoomGrants.values()].find((candidate) => candidate.projectId === contract.projectId && candidate.roomId === contract.roomId && candidate.taskId === awarded.proposal.id && candidate.allowedPrincipals.includes(this.identity.id) && candidate.allowedPrincipals.includes(peer.identity.id) && candidate.allowedCapabilities.includes(capability.id) && candidate.allowedOperations.includes("task.send"))
			: undefined;
		if (contract.projectId && contract.roomId && !grant) return pending("federated room grant is unavailable");
		const envelope: BuddyTaskEnvelope = {
			protocol: "buddy/1.0",
			messageType: "task.propose",
			messageId: `network-message-${awarded.proposal.id}`,
			traceId: `network-trace-${awarded.proposal.id}`,
			taskId: awarded.proposal.id,
			nonce: `network:${awarded.proposal.id}:award`,
			sender: this.identity,
			recipient: peer.identity,
			roomRef: scope.roomId,
			createdAt: contract.createdAt,
			expiresAt: contract.expiresAt,
			objective: contract.objective,
			capability: capability.id,
			input: { contextRefs: [] },
			output: { schema: {}, acceptanceTests: capability.acceptanceTests, artifactTypes: contract.artifactTypes },
			policy: { dataScopes: awarded.bid.acceptedDataScopes, allowedActions: capability.allowedActions, forbiddenActions: capability.forbiddenActions, approval: capability.requiredApproval, allowDelegation: capability.allowDelegation, maxDelegationDepth: capability.maxDelegationDepth, retention: "task", expiresAt: contract.expiresAt },
				delivery: { acceptedArtifactTypes: contract.artifactTypes, retention: "task", redactionRequired: true },
				...(contract.sideEffectIntentId ? { sideEffectIntentId: contract.sideEffectIntentId, sideEffectFingerprint: contract.sideEffectFingerprint } : {}),
				executionRef: { ...contract.executionRef, taskId: awarded.proposal.id, memberId: awarded.bid.providerId },
			};
			const requiresSideEffectIntent = capability.requiredApproval !== "never" || capability.allowedActions.some((action) => action.startsWith("external:"));
			if (requiresSideEffectIntent && !contract.sideEffectIntentId) return pending("network external action requires an approved side-effect intent");
			if (contract.sideEffectIntentId) {
				const intent = this.sideEffectIntents.get(contract.sideEffectIntentId);
				if (!intent || intent.taskId !== awarded.proposal.id || intent.fingerprint !== contract.sideEffectFingerprint || !["approved", "consumed"].includes(intent.status)) return pending("network side-effect intent is not approved or task-bound");
				if (intent.status === "approved") this.consumeSideEffectIntent(intent.intentId, intent.fingerprint);
			}
		if (this.relayCapabilitySecret) envelope.capabilityToken = issueRelayCapabilityToken({
			jti: `capability-${awarded.proposal.id}`,
			subject: this.identity.id,
			communityId: scope.communityId,
			organizationId: scope.organizationId,
			roomId: scope.roomId,
			taskId: awarded.proposal.id,
			capability: capability.id,
			dataScopes: awarded.bid.acceptedDataScopes,
			allowedActions: capability.allowedActions,
			issuedAt: this.now().toISOString(),
			expiresAt: contract.expiresAt,
		}, this.relayCapabilitySecret);
			try {
				if (!this.relayOutbox) return pending("relay outbox is unavailable");
				await this.relayOutbox.send(envelope, scope, grant);
				if (contract.sideEffectIntentId) this.completeSideEffectIntent(contract.sideEffectIntentId, `relay:${awarded.proposal.id}`);
				return record("delivered");
			} catch (error) {
				if (contract.sideEffectIntentId && error instanceof RelayOutboxExpiredError) {
					try { this.failSideEffectIntent(contract.sideEffectIntentId, error instanceof Error ? error.message : String(error)); } catch { /* preserve relay failure */ }
				}
			if (error instanceof RelayOutboxExpiredError) return record("failed", error.message);
			return pending(error instanceof Error ? error.message : "provider endpoint is unavailable");
		}
	}

	async retryPendingNetworkDeliveries(): Promise<RelayOutboxRetryResult[]> {
		if (!this.relayOutbox) return [];
		const results = await this.relayOutbox.retryPending();
		for (const result of results) {
			const delivery = this.network.snapshot().deliveries.find((candidate) => candidate.proposalId === result.messageId.replace(/^network-message-/u, ""));
			if (!delivery) continue;
			this.network.recordDelivery({
				bidId: delivery.bidId,
				proposalId: delivery.proposalId,
				providerId: delivery.providerId,
				status: result.status === "delivered" ? "delivered" : result.status === "expired" ? "failed" : "pending_delivery",
				...(result.lastError ? { reason: result.lastError } : {}),
			});
			const taskId = result.messageId.replace(/^network-message-/u, "");
			const contract = this.taskContracts.get(taskId);
			if (contract?.sideEffectIntentId) {
				const intent = this.sideEffectIntents.get(contract.sideEffectIntentId);
				if (result.status === "delivered") {
					if (intent?.status === "approved") this.consumeSideEffectIntent(intent.intentId, intent.fingerprint);
					if (intent?.status === "consumed") this.completeSideEffectIntent(intent.intentId, `relay:${taskId}`);
				} else if (result.status === "expired") {
					if (intent?.status === "consumed") this.failSideEffectIntent(intent.intentId, result.lastError ?? "network delivery failed");
				}
			}
		}
		return results;
	}

	setOrganizationProvider(provider: CapabilityProvider | null): void {
		this.provider = provider;
		const providerIdentity = (provider as (CapabilityProvider & { identitySnapshot?: () => BuddyIdentity }) | null)?.identitySnapshot?.();
		if (providerIdentity) for (const [key, scope] of this.projectRooms) if (key.startsWith("organization:") && scope.roomId !== this.scope.roomId) this.syncRoomMember(scope, providerIdentity, "agent");
		const configurable = provider as (CapabilityProvider & { setCapabilities?: (capabilities: BuddyCapability[]) => void }) | null;
		const organizationCards = this.capabilityCards.filter((card) => card.visibility === "organization");
		if (organizationCards.length > 0) configurable?.setCapabilities?.(organizationCards.map((card) => this.capabilityFromCard(card, provider)));
		this.network.setLocalCapabilities(organizationCards.map((card) => this.capabilityFromCard(card, provider, this.identity.id)));
	}

	setPersonalProvider(provider: CapabilityProvider | null): void {
		this.personalProvider = provider;
		const providerIdentity = (provider as (CapabilityProvider & { identitySnapshot?: () => BuddyIdentity }) | null)?.identitySnapshot?.();
		if (providerIdentity) for (const [key, scope] of this.projectRooms) if (key.startsWith("personal:")) this.syncRoomMember(scope, providerIdentity, "agent");
		const configurable = provider as (CapabilityProvider & { setCapabilities?: (capabilities: BuddyCapability[]) => void }) | null;
		const personalCards = this.capabilityCards.filter((card) => card.visibility === "local");
		if (personalCards.length > 0) configurable?.setCapabilities?.(personalCards.map((card) => this.capabilityFromCard(card, provider)));
	}

	getOrganizationProvider(): CapabilityProvider | null {
		return this.provider;
	}

	isOrganizationApprovalGranted(taskId: string, actions: readonly string[]): boolean {
		return this.organization.isApprovalGranted(taskId, actions);
	}

	isOrganizationDelegationAuthorized(input: { granteeId: string; capability: string; dataScopes: string[]; taskId?: string; roomId?: string; now?: string }): { allowed: boolean; reason?: string } {
		return this.organization.isDelegationAuthorized(input);
	}

	createSideEffectIntent(input: { capability: string; action: string; summary: string; fingerprint: string; resourceId?: string; roomId?: string; taskId?: string; expiresAt?: string; approvedByUser?: boolean }): SideEffectIntent {
		const capability = input.capability.trim();
		const action = input.action.trim();
		const summary = input.summary.trim().slice(0, 240);
		const fingerprint = input.fingerprint.trim();
		if (!capability || !action || !summary || !fingerprint) throw new Error("side-effect intent requires capability, action, summary and fingerprint");
		const existingTask = input.taskId ? this.taskContracts.get(input.taskId) : undefined;
		if (input.taskId && !existingTask) throw new Error("side-effect intent task is unavailable");
		const roomId = input.roomId ?? existingTask?.roomId ?? this.scope.roomId;
		if (!this.knownRoom(roomId)) throw new Error("side-effect intent room is outside the local collaboration scope");
		const expiresAt = input.expiresAt ?? new Date(this.now().getTime() + 10 * 60_000).toISOString();
		if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= this.now().getTime()) throw new Error("side-effect intent expiry is invalid");
		const taskId = input.taskId ?? this.proposeTask({ title: summary, objective: summary, capability, roomId, contextRefs: [`room:${roomId}`] }).taskId;
		const task = this.taskContracts.get(taskId);
		if (task && task.roomId !== roomId) throw new Error("side-effect intent room does not match task");
		const approval = this.requestApproval({ taskId, actions: [action], reason: summary });
		if (input.approvedByUser === true) this.decideApproval({ approvalId: approval.id, approved: true, reason: "用户确认副作用执行" });
		const intent: SideEffectIntent = {
			intentId: `intent-${randomUUID()}`, taskId, approvalId: approval.id, roomId, capability, action,
			...(input.resourceId?.trim() ? { resourceId: input.resourceId.trim() } : {}), fingerprint, summary,
			createdAt: this.now().toISOString(), expiresAt, status: input.approvedByUser === true ? "approved" : "pending",
		};
		if (task) {
			task.sideEffectIntentId = intent.intentId;
			task.sideEffectFingerprint = fingerprint;
			this.writeTaskContracts();
		}
		this.sideEffectIntents.set(intent.intentId, intent);
		this.appendScopedEvent(createEvent({ id: `side-effect-intent-${intent.intentId}-created`, communityId: this.scope.communityId, organizationId: this.scope.organizationId, roomId, taskId: intent.taskId, kind: "side_effect.intent_created", actor: this.identity, subject: summary, nonce: `side-effect:${intent.intentId}:created`, createdAt: intent.createdAt, payload: { intentId: intent.intentId, approvalId: intent.approvalId, capability, action, resourceId: intent.resourceId, fingerprint, summary, expiresAt } }));
		return structuredClone(intent);
	}

	approveSideEffectIntent(intentId: string): SideEffectIntent {
		const intent = this.requireSideEffectIntent(intentId);
		if (intent.status !== "pending") throw new Error(`side-effect intent cannot be approved from ${intent.status}`);
		const approval = this.organization.listApprovals().find((item) => item.id === intent.approvalId);
		if (!approval || approval.status !== "approved") throw new Error("side-effect intent approval is not granted");
		intent.status = "approved";
		return structuredClone(intent);
	}

	consumeSideEffectIntent(intentId: string, fingerprint: string): SideEffectIntent {
		const intent = this.requireSideEffectIntent(intentId);
		if (intent.fingerprint !== fingerprint) throw new Error("side-effect intent fingerprint mismatch");
		if (Date.parse(intent.expiresAt) <= this.now().getTime()) { intent.status = "expired"; throw new Error("side-effect intent expired"); }
		if (intent.status === "pending") this.approveSideEffectIntent(intentId);
		if (intent.status !== "approved" || !this.organization.isApprovalGranted(intent.taskId, [intent.action])) throw new Error("side-effect intent approval is not granted");
		const consumedAt = this.now().toISOString();
		this.appendScopedEvent(createEvent({ id: `side-effect-intent-${intent.intentId}-consumed`, communityId: this.scope.communityId, organizationId: this.scope.organizationId, roomId: intent.roomId, taskId: intent.taskId, kind: "side_effect.intent_consumed", actor: this.identity, subject: intent.summary, nonce: `side-effect:${intent.intentId}:consumed`, createdAt: consumedAt, payload: { intentId, fingerprint } }));
		intent.status = "consumed";
		intent.consumedAt = consumedAt;
		return structuredClone(intent);
	}

	completeSideEffectIntent(intentId: string, receipt?: string): SideEffectIntent {
		const intent = this.requireSideEffectIntent(intentId);
		if (intent.status !== "consumed") throw new Error(`side-effect intent cannot complete from ${intent.status}`);
		const completedAt = this.now().toISOString();
		this.appendScopedEvent(createEvent({ id: `side-effect-intent-${intent.intentId}-completed`, communityId: this.scope.communityId, organizationId: this.scope.organizationId, roomId: intent.roomId, taskId: intent.taskId, kind: "side_effect.intent_completed", actor: this.identity, subject: intent.summary, nonce: `side-effect:${intent.intentId}:completed`, createdAt: completedAt, payload: { intentId, receipt } }));
		intent.status = "completed";
		intent.completedAt = completedAt;
		return structuredClone(intent);
	}

	failSideEffectIntent(intentId: string, error: string): SideEffectIntent {
		const intent = this.requireSideEffectIntent(intentId);
		if (intent.status !== "consumed") throw new Error(`side-effect intent cannot fail from ${intent.status}`);
		const failedAt = this.now().toISOString();
		const safeError = error.slice(0, 240);
		this.appendScopedEvent(createEvent({ id: `side-effect-intent-${intent.intentId}-failed`, communityId: this.scope.communityId, organizationId: this.scope.organizationId, roomId: intent.roomId, taskId: intent.taskId, kind: "side_effect.intent_failed", actor: this.identity, subject: intent.summary, nonce: `side-effect:${intent.intentId}:failed`, createdAt: failedAt, payload: { intentId, error: safeError } }));
		intent.status = "failed";
		intent.error = safeError;
		return structuredClone(intent);
	}

	cancelSideEffectIntent(intentId: string, reason = "副作用已取消"): SideEffectIntent {
		const intent = this.requireSideEffectIntent(intentId);
		if (["consumed", "completed", "failed"].includes(intent.status)) throw new Error(`side-effect intent cannot cancel from ${intent.status}`);
		const cancelledAt = this.now().toISOString();
		this.appendScopedEvent(createEvent({ id: `side-effect-intent-${intent.intentId}-cancelled`, communityId: this.scope.communityId, organizationId: this.scope.organizationId, roomId: intent.roomId, taskId: intent.taskId, kind: "side_effect.intent_cancelled", actor: this.identity, subject: intent.summary, nonce: `side-effect:${intent.intentId}:cancelled`, createdAt: cancelledAt, payload: { intentId, reason: reason.slice(0, 240) } }));
		intent.status = "cancelled";
		intent.error = reason.slice(0, 240);
		return structuredClone(intent);
	}

	private requireSideEffectIntent(intentId: string): SideEffectIntent {
		const intent = this.sideEffectIntents.get(intentId);
		if (!intent) throw new Error("side-effect intent not found");
		return intent;
	}

	recordProviderEvent(event: BuddyEvent): void {
		if (event.communityId !== this.scope.communityId || event.organizationId !== this.scope.organizationId || !this.knownRoom(event.roomId)) {
			throw new Error("provider event is outside the local collaboration scope");
		}
		this.appendEvent(event);
	}

	proposeTask(input: ProposeTaskInput & { mode?: "personal" | "organization"; dataScopes?: string[]; artifactTypes?: string[] }): ProposeTaskResult {
		const title = input.title.trim();
		const objective = input.objective.trim();
		if (!title || title.length > 160) throw new Error("task title must contain 1-160 characters");
		if (!objective || objective.length > 20_000) throw new Error("task objective must contain 1-20000 characters");
		const mode = input.mode ?? "personal";
		const agentRef = normalizeAgentRef(input.agentRef);
		if (agentRef?.type === "external-buddy") throw new Error("external Buddy requires network mode");
		if (agentRef?.type === "organization-buddy" && mode !== "organization") throw new Error("organization Buddy requires organization mode");
		if (agentRef?.type === "personal-buddy" && mode !== "personal") throw new Error("personal Buddy requires personal mode");
		if (mode === "organization" && agentRef?.type === "organization-buddy" && !this.organization.listMembers().some((member) => member.identity.id === agentRef.id && member.active)) throw new Error("organization Buddy must be an active organization member");
		const taskScope = this.scopeForTask({ projectId: input.projectId, mode, roomId: input.roomId });
		const roomId = taskScope.roomId;
		const dataScopes = normalizeTaskDataScopes(input.dataScopes, roomId);
		const taskId = `task-${randomUUID()}`;
		const result = createTaskProposal(this.identity, taskScope, {
			title,
			objective,
			capability: input.capability?.trim() || "general",
			taskId,
			eventId: `event-${randomUUID()}`,
			nonce: `propose:${taskId}`,
			createdAt: this.now().toISOString(),
			mode,
			projectId: input.projectId?.trim() || undefined,
			agentRef,
			executionRef: {
				executionId: `execution:${taskId}`,
				taskId,
				workflowId: `workflow:${taskId}`,
				stepId: `step:${taskId}:root`,
				teamId: `team:${taskId}`,
				...(agentRef ? { memberId: agentRef.id } : {}),
			},
		});
		this.appendEvent(result.event);
		this.taskContracts.set(taskId, {
			taskId,
			title,
			objective,
			capability: input.capability?.trim() || "general",
			mode: input.mode ?? "personal",
			dataScopes,
			artifactTypes: input.artifactTypes?.filter(Boolean) ?? ["other"],
			createdAt: this.now().toISOString(),
				...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
				roomId,
				contextRefs: normalizeContextRefs(input.contextRefs),
				...(input.capabilityInput ? { capabilityInput: structuredClone(input.capabilityInput) } : {}),
				...(agentRef ? { agentRef } : {}),
				...(input.sideEffectIntentId ? { sideEffectIntentId: input.sideEffectIntentId } : {}),
				...(input.sideEffectFingerprint ? { sideEffectFingerprint: input.sideEffectFingerprint } : {}),
				executionRef: result.executionRef ?? {
				executionId: `execution:${taskId}`,
				taskId,
				workflowId: `workflow:${taskId}`,
				stepId: `step:${taskId}:root`,
				teamId: `team:${taskId}`,
				...(agentRef ? { memberId: agentRef.id } : {}),
			},
		});
		this.writeTaskContracts();
		return { taskId, eventId: result.eventId, status: result.status, roomId, executionRef: result.executionRef ?? this.taskContracts.get(taskId)!.executionRef };
	}

	proposeCollaboration(input: BuddyCollaborationCommand): CollaborationCommandResult {
		const title = input.title.trim();
		const objective = input.objective.trim();
		if (!title || !objective) throw new Error("collaboration command requires title and objective");
		const capability = input.capability?.trim() || "general";
		const agentRef = normalizeAgentRef(input.agentRef);
		if (agentRef?.type === "external-buddy" && input.mode !== "network") throw new Error("external Buddy requires network mode");
		if (agentRef?.type === "organization-buddy" && input.mode !== "organization") throw new Error("organization Buddy requires organization mode");
		if (agentRef?.type === "personal-buddy" && input.mode !== "personal") throw new Error("personal Buddy requires personal mode");
		if (input.mode === "network" && agentRef && agentRef.type !== "external-buddy") throw new Error("network mode requires an external Buddy");
		const projectMode = input.mode === "network" ? "organization" : input.mode;
		const taskScope = input.mode === "network"
			? input.projectId
				? this.scopeForTask({ projectId: input.projectId, mode: projectMode, roomId: input.roomId })
				: { ...this.scope }
			: this.scopeForTask({ projectId: input.projectId, mode: projectMode ?? "personal", roomId: input.roomId });
		const dataScopes = normalizeTaskDataScopes(input.dataScopes, taskScope.roomId);
		const artifactTypes = input.artifactTypes?.map((type) => type.trim()).filter(Boolean) ?? ["other"];
		if (input.mode === "network") {
			const result = this.networkProposeService({
				capabilityId: capability,
				objective,
				dataScopes,
				artifactTypes,
				 expiresAt: input.expiresAt ?? new Date(this.now().getTime() + 60 * 60_000).toISOString(),
			});
			this.taskContracts.set(result.value.id, {
				taskId: result.value.id,
				title,
				objective,
				capability,
				dataScopes,
				artifactTypes,
				createdAt: this.now().toISOString(),
				expiresAt: result.value.expiresAt,
				mode: "network",
				projectId: input.projectId?.trim(),
				roomId: taskScope.roomId,
				...(agentRef ? { agentRef } : {}),
				...(input.sideEffectIntentId ? { sideEffectIntentId: input.sideEffectIntentId } : {}),
				...(input.sideEffectFingerprint ? { sideEffectFingerprint: input.sideEffectFingerprint } : {}),
				executionRef: executionRefFor(result.value.id),
			});
			this.writeTaskContracts();
			return {
				taskId: result.value.id,
				eventId: result.event.id,
				status: "proposed",
				mode: input.mode,
				...(input.projectId ? { projectId: input.projectId.trim() } : {}),
				executionRef: executionRefFor(result.value.id),
				contract: { dataScopes, artifactTypes, approval: "before_external_commit", execution: "network-proposal" },
				roomId: taskScope.roomId,
			};
		}
		const contextRefs = normalizeContextRefs(input.contextRefs);
		const result = this.proposeTask({ title, objective, capability, roomId: input.roomId, projectId: input.projectId, mode: input.mode, dataScopes, artifactTypes, contextRefs, capabilityInput: input.capabilityInput, agentRef });
		return {
			...result,
			mode: input.mode,
			...(input.projectId ? { projectId: input.projectId } : {}),
			roomId: result.roomId,
			contract: { dataScopes, artifactTypes, approval: "before_external_commit", execution: input.mode === "organization" ? "organization-provider" : "local" },
		};
	}

	async executeCollaborationTask(taskId: string): Promise<CollaborationExecutionResult> {
		const contract = this.taskContracts.get(taskId);
		if (!contract || (contract.mode !== "organization" && contract.mode !== "personal")) throw new Error("local collaboration task contract is unavailable");
		const provider = contract.mode === "organization" ? this.provider : this.personalProvider;
		if (!provider) throw new Error(`${contract.mode} capability provider is unavailable`);
		const taskScope = this.scopeForTask({ projectId: contract.projectId, mode: contract.mode, roomId: contract.roomId });
		const scope = { ...taskScope, taskId };
		const capabilities = await provider.list(scope);
		const capability = capabilities.find((candidate) => candidate.id === contract.capability || candidate.id.endsWith(`:${contract.capability}`))
			?? (contract.capability === "general" ? capabilities[0] : undefined);
		if (!capability) throw new Error(`${contract.mode} capability is unavailable: ${contract.capability}`);
		const providerId = capability.providerId;
		if (providerId === this.identity.id) throw new Error("requester cannot execute as provider");
		const providerSnapshot = (provider as CapabilityProvider & { identitySnapshot?: () => BuddyIdentity; identityForProvider?: (providerId: string) => BuddyIdentity | undefined }).identityForProvider?.(providerId)
			?? (provider as CapabilityProvider & { identitySnapshot?: () => BuddyIdentity }).identitySnapshot?.();
		const providerIdentity: BuddyIdentity = providerSnapshot ? { ...providerSnapshot, status: "working" } : {
			id: providerId,
			handle: providerId,
			displayName: providerId,
			ownerUserId: this.identity.ownerUserId,
			organizationId: this.scope.organizationId,
			trustLevel: contract.mode === "personal" ? "local" : "org",
			status: "working",
		};
		const verifierIdentity: BuddyIdentity = {
			id: `${this.identity.id}-verifier`,
			handle: `${this.identity.handle}-verifier`,
			displayName: "独立验证 Buddy",
			ownerUserId: this.identity.ownerUserId,
			organizationId: this.scope.organizationId,
			trustLevel: contract.mode === "personal" ? "local" : "org",
			status: "idle",
		};
			const executionRef: BuddyExecutionRef = {
				...contract.executionRef,
				executionId: contract.executionRef.executionId || `execution:${taskId}`,
				taskId,
				teamId: contract.executionRef.teamId ?? `team:${taskId}`,
			memberId: contract.agentRef?.id ?? providerId,
		};
		const envelope: BuddyTaskEnvelope = {
			protocol: "buddy/1.0",
			messageType: "task.propose",
			messageId: `task-message-${taskId}`,
			traceId: `task-trace-${taskId}`,
			taskId,
			nonce: `task:${taskId}:execute`,
			sender: this.identity,
			roomRef: taskScope.roomId,
			createdAt: contract.createdAt,
			expiresAt: new Date(this.now().getTime() + 60 * 60_000).toISOString(),
			objective: contract.objective,
			capability: capability.id,
			input: { contextRefs: contract.contextRefs, ...(contract.capabilityInput ? { constraints: { capabilityInput: contract.capabilityInput } } : {}) },
			output: { schema: {}, acceptanceTests: [], artifactTypes: contract.artifactTypes },
			policy: { dataScopes: contract.dataScopes, allowedActions: capability.id.startsWith("calendar:") ? ["read:room", "write:artifact", "write:calendar"] : ["read:room", "write:artifact"], forbiddenActions: ["external:send"], approval: capability.id.startsWith("calendar:") ? "before_external_commit" : "never", allowDelegation: true, maxDelegationDepth: 1, retention: "task", expiresAt: new Date(this.now().getTime() + 60 * 60_000).toISOString() },
			delivery: { acceptedArtifactTypes: contract.artifactTypes, retention: "task", redactionRequired: true },
			...(contract.sideEffectIntentId ? { sideEffectIntentId: contract.sideEffectIntentId, sideEffectFingerprint: contract.sideEffectFingerprint } : {}),
			executionRef,
		};
		const verifier: TaskVerifier = { id: verifierIdentity.id, identity: verifierIdentity, verify: async (bundle: BuddyEvidenceBundle) => ({ accepted: bundle.artifacts.length > 0 && bundle.evidence.length > 0 }) };
		const result = await new OrganizationTaskExecutor({ scope: taskScope, now: () => this.now().toISOString(), emit: (event) => this.appendScopedEvent(event) }).execute({ envelope, providerId, providerIdentity, provider, verifier, requester: this.identity, approvalGranted: (id, actions) => this.organization.isApprovalGranted(id, actions), ...(contract.sideEffectIntentId ? { sideEffectIntentRequired: true, consumeSideEffectIntent: (id, fingerprint) => { this.consumeSideEffectIntent(id, fingerprint); }, completeSideEffectIntent: (id, receipt) => { this.completeSideEffectIntent(id, receipt); }, failSideEffectIntent: (id, error) => { this.failSideEffectIntent(id, error); } } : {}) });
		const resolvedExecutionRef = result.executionRef ?? executionRef;
		if (result.bundle) this.appendEvidenceEvent(result.bundle, providerIdentity, verifierIdentity, resolvedExecutionRef);
		return { taskId, status: result.status, providerId, verifierId: verifierIdentity.id, executionRef: resolvedExecutionRef, bundleDigest: result.bundle?.bundleDigest, artifactIds: result.bundle?.artifacts.map((artifact) => artifact.id) ?? [], evidenceCount: result.bundle?.evidence.length ?? 0 };
	}

	async executeOrganizationTask(taskId: string): Promise<CollaborationExecutionResult> {
		const contract = this.taskContracts.get(taskId);
		if (!contract || contract.mode !== "organization") throw new Error("organization task contract is unavailable");
		return this.executeCollaborationTask(taskId);
	}

	proposeWorkflow(input: WorkflowProposalInput): WorkflowSnapshot {
		const title = input.title.trim();
		if (!title || title.length > 160) throw new Error("workflow title must contain 1-160 characters");
		if (input.nodes.length === 0 || input.nodes.length > 32) throw new Error("workflow must contain 1-32 nodes");
		const ids = new Set<string>();
		for (const node of input.nodes) {
			if (!/^[A-Za-z0-9._-]{1,80}$/u.test(node.id) || ids.has(node.id)) throw new Error("workflow node ids must be unique and valid");
			ids.add(node.id);
		}
		for (const node of input.nodes) for (const dependency of node.dependsOn ?? []) if (!ids.has(dependency) || dependency === node.id) throw new Error(`workflow dependency is invalid: ${node.id} -> ${dependency}`);
		const workflowId = `workflow-${randomUUID()}`;
		const nodeSnapshots: WorkflowNodeSnapshot[] = input.nodes.map((node) => {
			if (node.crossNetwork) {
				if (!node.capability?.trim()) throw new Error("cross-network node requires capability");
				if (input.mode === "organization") throw new Error("cross-network nodes require personal mode in the current phase");
				const proposal = this.networkProposeService({
					capabilityId: node.capability.trim(),
					objective: node.objective?.trim() || title,
					dataScopes: node.dataScopes?.length ? node.dataScopes : [`room:${this.scope.roomId}`],
					artifactTypes: node.artifactTypes?.length ? node.artifactTypes : ["other"],
					expiresAt: new Date(this.now().getTime() + 60 * 60_000).toISOString(),
				});
				this.taskContracts.set(proposal.value.id, {
					taskId: proposal.value.id,
					title: node.title?.trim() || `${title} · ${node.id}`,
					objective: node.objective?.trim() || title,
					capability: node.capability.trim(),
					dataScopes: node.dataScopes?.length ? [...node.dataScopes] : [`room:${this.scope.roomId}`],
					artifactTypes: node.artifactTypes?.length ? node.artifactTypes : ["other"],
					createdAt: this.now().toISOString(),
					expiresAt: new Date(this.now().getTime() + 60 * 60_000).toISOString(),
					mode: "network",
					...(node.projectId ?? input.projectId ? { projectId: node.projectId ?? input.projectId } : {}),
					roomId: node.roomId ?? this.scope.roomId,
					...(node.agentRef ? { agentRef: normalizeAgentRef(node.agentRef) } : {}),
					...(node.sideEffectIntentId ? { sideEffectIntentId: node.sideEffectIntentId, sideEffectFingerprint: node.sideEffectFingerprint } : {}),
					executionRef: executionRefFor(proposal.value.id, proposal.value.awardedBidId),
				});
				this.writeTaskContracts();
				return { id: node.id, taskId: proposal.value.id, dependsOn: [...(node.dependsOn ?? [])], title: node.title?.trim() || `${title} · ${node.id}`, status: "pending", ...(node.agentRef ? { agentRef: normalizeAgentRef(node.agentRef) } : {}), capability: node.capability.trim(), projectId: node.projectId ?? input.projectId, roomId: node.roomId ?? this.scope.roomId, dataScopes: node.dataScopes ? [...node.dataScopes] : undefined, ...(node.sideEffectIntentId ? { sideEffectIntentId: node.sideEffectIntentId, sideEffectFingerprint: node.sideEffectFingerprint } : {}) };
			}
			const task = this.proposeCollaboration({
				mode: input.mode,
				title: node.title?.trim() || `${title} · ${node.id}`,
				objective: node.objective?.trim() || title,
				capability: node.capability,
				projectId: node.projectId ?? input.projectId,
				roomId: node.roomId,
				contextRefs: node.contextRefs,
				dataScopes: node.dataScopes,
				artifactTypes: node.artifactTypes,
				capabilityInput: node.capabilityInput,
				agentRef: node.agentRef,
				sideEffectIntentId: node.sideEffectIntentId,
				sideEffectFingerprint: node.sideEffectFingerprint,
			});
			const contract = this.taskContracts.get(task.taskId);
			return {
				id: node.id,
				taskId: task.taskId,
				dependsOn: [...(node.dependsOn ?? [])],
				title: node.title?.trim() || `${title} · ${node.id}`,
				status: "pending",
					...(contract && contract.mode !== "network" && contract.agentRef ? { agentRef: structuredClone(contract.agentRef) } : {}),
				capability: contract?.capability,
				projectId: contract?.projectId,
				roomId: contract?.roomId,
				dataScopes: contract?.dataScopes ? [...contract.dataScopes] : undefined,
				...(contract?.sideEffectIntentId ? { sideEffectIntentId: contract.sideEffectIntentId, sideEffectFingerprint: contract.sideEffectFingerprint } : {}),
			};
		});
		const now = this.now().toISOString();
		const snapshot: WorkflowSnapshot = { workflowId, title, mode: input.mode, ...(input.projectId ? { projectId: input.projectId } : {}), status: "proposed", nodes: nodeSnapshots, createdAt: now, updatedAt: now };
		this.workflows.set(workflowId, snapshot);
		this.writeWorkflows();
		return structuredClone(snapshot);
	}

	workflowStatus(workflowId: string): WorkflowSnapshot {
		const workflow = this.workflows.get(workflowId);
		if (!workflow) throw new Error("workflow not found");
		return structuredClone(workflow);
	}

	controlWorkflow(input: { workflowId: string; action: WorkflowControlAction; reason?: string }): WorkflowSnapshot {
		const workflow = this.workflows.get(input.workflowId);
		if (!workflow) throw new Error("workflow not found");
		const reason = input.reason?.trim() || undefined;
		if (input.action === "pause" && workflow.status !== "running") throw new Error("only a running workflow can be paused");
		if (input.action === "resume" && workflow.status !== "paused") throw new Error("only a paused workflow can be resumed");
		if (input.action === "cancel" && ["accepted", "rejected", "failed", "cancelled"].includes(workflow.status)) throw new Error("workflow is already terminal");
		if (input.action === "takeover" && workflow.status === "accepted") throw new Error("accepted workflow cannot be taken over");
		if (input.action === "revision" && workflow.status === "running") throw new Error("running workflow must be paused before revision");
		if (input.action === "pause" || input.action === "cancel") this.workflowRuns.get(input.workflowId)?.abort();
		workflow.control = { state: input.action, actorId: this.identity.id, updatedAt: this.now().toISOString(), ...(reason ? { reason } : {}) };
		if (input.action === "pause") workflow.status = "paused";
		if (input.action === "cancel") workflow.status = "cancelled";
		if (input.action === "resume") workflow.status = "proposed";
		if (input.action === "takeover" || input.action === "revision") workflow.status = "proposed";
		workflow.updatedAt = this.now().toISOString();
		this.writeWorkflows();
		this.appendWorkflowEvent(workflow, `workflow.${input.action}`, reason);
		return structuredClone(workflow);
	}

	async executeWorkflow(workflowId: string): Promise<WorkflowExecutionResult> {
		const workflow = this.workflows.get(workflowId);
		if (!workflow) throw new Error("workflow not found");
		if (workflow.status === "running") throw new Error("workflow is already running");
		if (workflow.status === "cancelled" || workflow.status === "accepted") throw new Error("workflow is terminal");
		workflow.status = "running";
		workflow.updatedAt = this.now().toISOString();
		this.writeWorkflows();
		this.appendWorkflowEvent(workflow, "workflow.started");
		const controller = new AbortController();
		this.workflowRuns.set(workflowId, controller);
		const executionNodes = await Promise.all(workflow.nodes.map(async (node): Promise<OrganizationWorkflowNode> => ({ id: node.id, dependsOn: node.dependsOn, execution: await this.workflowExecutionInput(node.taskId) })));
		const seeds = workflow.nodes.filter((node) => node.status === "accepted").map((node) => ({ id: node.id, status: "accepted" as const }));
		const result = await new OrganizationWorkflowExecutor({ scope: this.scope, now: () => this.now().toISOString(), emit: (event) => this.appendScopedEvent(event) }).execute(workflowId, executionNodes, controller.signal, seeds);
		const executionByNode = new Map(executionNodes.map((node) => [node.id, node.execution]));
		const resultNodes = result.nodes.map((node) => {
			const snapshot = workflow.nodes.find((candidate) => candidate.id === node.id)!;
			const execution = node.result;
			const executionInput = executionByNode.get(node.id);
				if (execution?.bundle && executionInput) this.appendEvidenceEvent(execution.bundle, executionInput.providerIdentity, executionInput.verifier.identity, execution.executionRef ?? executionInput.envelope.executionRef);
				const executionProjection = execution?.bundle ? { taskId: snapshot.taskId, status: execution.status, executionRef: execution.executionRef ?? this.taskContracts.get(snapshot.taskId)?.executionRef, providerId: execution.bundle.providerId, verifierId: execution.bundle.verification?.verifierId, bundleDigest: execution.bundle.bundleDigest, artifactIds: execution.bundle.artifacts.map((artifact) => artifact.id), evidenceCount: execution.bundle.evidence.length } : undefined;
				return { ...snapshot, status: node.status, ...(executionProjection ? { execution: executionProjection, providerId: executionProjection.providerId } : {}), ...(node.reason ? { reason: node.reason } : {}) };
		});
		const resultStatus: WorkflowExecutionResult["status"] = workflow.control?.state === "cancel" ? "blocked" : result.status;
		workflow.nodes = resultNodes;
		workflow.status = workflow.control?.state === "cancel" ? "cancelled" : workflow.control?.state === "pause" ? "paused" : resultStatus;
		workflow.updatedAt = this.now().toISOString();
		this.writeWorkflows();
		this.workflowRuns.delete(workflowId);
		this.appendWorkflowEvent(workflow, `workflow.${workflow.status}`);
		return { workflowId, status: resultStatus, nodes: resultNodes };
	}

	private async workflowExecutionInput(taskId: string): Promise<OrganizationTaskExecutionInput> {
		const contract = this.taskContracts.get(taskId);
		if (!contract || (contract.mode !== "organization" && contract.mode !== "personal")) throw new Error("workflow node task contract is unavailable");
		const provider = contract.mode === "organization" ? this.provider : this.personalProvider;
		if (!provider) throw new Error(`${contract.mode} capability provider is unavailable`);
		const taskScope = this.scopeForTask({ projectId: contract.projectId, mode: contract.mode, roomId: contract.roomId });
		const capabilities = await provider.list({ ...taskScope, taskId });
		const capability = capabilities.find((candidate) => candidate.id === contract.capability || candidate.id.endsWith(`:${contract.capability}`)) ?? (contract.capability === "general" ? capabilities[0] : undefined);
		if (!capability) throw new Error(`${contract.mode} capability is unavailable: ${contract.capability}`);
		const providerId = capability.providerId;
		if (providerId === this.identity.id) throw new Error("requester cannot execute as provider");
		const providerSnapshot = (provider as CapabilityProvider & { identitySnapshot?: () => BuddyIdentity; identityForProvider?: (providerId: string) => BuddyIdentity | undefined }).identityForProvider?.(providerId) ?? (provider as CapabilityProvider & { identitySnapshot?: () => BuddyIdentity }).identitySnapshot?.();
		const providerIdentity: BuddyIdentity = providerSnapshot ? { ...providerSnapshot, status: "working" } : { id: providerId, handle: providerId, displayName: providerId, ownerUserId: this.identity.ownerUserId, organizationId: this.scope.organizationId, trustLevel: contract.mode === "personal" ? "local" : "org", status: "working" };
		const verifierIdentity: BuddyIdentity = { id: `${this.identity.id}-verifier`, handle: `${this.identity.handle}-verifier`, displayName: "独立验证 Buddy", ownerUserId: this.identity.ownerUserId, organizationId: this.scope.organizationId, trustLevel: contract.mode === "personal" ? "local" : "org", status: "idle" };
		const executionRef = { ...contract.executionRef, taskId, memberId: contract.agentRef?.id ?? providerId };
		const envelope: BuddyTaskEnvelope = { protocol: "buddy/1.0", messageType: "task.propose", messageId: `task-message-${taskId}`, traceId: `task-trace-${taskId}`, taskId, nonce: `task:${taskId}:workflow`, sender: this.identity, roomRef: taskScope.roomId, createdAt: contract.createdAt, expiresAt: new Date(this.now().getTime() + 60 * 60_000).toISOString(), objective: contract.objective, capability: capability.id, input: { contextRefs: contract.contextRefs, ...(contract.capabilityInput ? { constraints: { capabilityInput: contract.capabilityInput } } : {}) }, output: { schema: {}, acceptanceTests: [], artifactTypes: contract.artifactTypes }, policy: { dataScopes: contract.dataScopes, allowedActions: capability.id.startsWith("calendar:") ? ["read:room", "write:artifact", "write:calendar"] : ["read:room", "write:artifact"], forbiddenActions: ["external:send"], approval: capability.id.startsWith("calendar:") ? "before_external_commit" : "never", allowDelegation: true, maxDelegationDepth: 1, retention: "task", expiresAt: new Date(this.now().getTime() + 60 * 60_000).toISOString() }, delivery: { acceptedArtifactTypes: contract.artifactTypes, retention: "task", redactionRequired: true }, executionRef };
		const verifier: TaskVerifier = { id: verifierIdentity.id, identity: verifierIdentity, verify: async (bundle) => ({ accepted: bundle.artifacts.length > 0 && bundle.evidence.length > 0 }) };
		return { scope: taskScope, envelope, providerId, providerIdentity, provider, verifier, requester: this.identity, approvalGranted: (id, actions) => this.organization.isApprovalGranted(id, actions) };
	}

	addOrganizationMember(input: AddOrganizationMemberInput): OrganizationMember {
		const identity: BuddyIdentity = {
			id: input.id.trim(),
			handle: input.handle.trim(),
			displayName: input.displayName.trim(),
			ownerUserId: input.ownerUserId.trim(),
			organizationId: this.scope.organizationId,
			trustLevel: "org",
			status: "idle",
		};
		const member = this.organization.addMember(this.identity, identity, input.role ?? "member").value;
		return member;
	}

	removeOrganizationMember(input: { memberId: string }): OrganizationMember {
		const trimmedId = input.memberId.trim();
		if (!trimmedId) throw new Error("memberId is required");
		const removed = this.organization.removeMember(this.identity, trimmedId).value;
		return removed;
	}

	addOrganizationRoomMember(input: OrganizationRoomMemberInput): BuddyRoomMember {
		const scope = this.organizationRoomScope(input.roomId);
		const member = this.organization.listMembers().find((candidate) => candidate.identity.id === input.principalId && candidate.active);
		if (!member) throw new Error("room member must be an active organization member");
		const added = this.rooms.addMember(scope, { principalId: member.identity.id, role: input.role ?? "member", joinedAt: this.now().toISOString(), active: true }, this.identity);
		this.persistIfMissing(added.event);
		return added.value;
	}

	removeOrganizationRoomMember(input: { roomId: string; principalId: string }): BuddyRoomMember {
		const scope = this.organizationRoomScope(input.roomId);
		if (input.principalId === this.identity.id) throw new Error("organization room owner cannot be removed");
		const removed = this.rooms.removeMember(scope, input.principalId, this.identity);
		this.persistIfMissing(removed.event);
		return removed.value;
	}

	grantOrganizationDelegation(input: GrantDelegationInput): DelegationGrant {
		return this.organization.grantDelegation(this.identity, input).value;
	}

	issueFederatedRoomGrant(input: IssueFederatedRoomGrantInput): FederatedRoomGrantProjection {
		if (!this.grantSigningSecret && !this.grantSigningPrivateKey) throw new Error("federated room grant signing is unavailable");
		const projectId = input.projectId.trim();
		const roomId = input.roomId.trim();
		const principalId = input.principalId.trim();
		if (!projectId || !roomId || !principalId) throw new Error("federated room grant requires projectId, roomId, and principalId");
		const projectScope = [...this.projectRooms.values()].find((scope) => scope.roomId === roomId);
		if (!projectScope || roomId === this.scope.roomId) throw new Error("federated room grant room must be a known project room");
		const expectedRoomIds = [collaborationRoomId(projectId, "personal"), collaborationRoomId(projectId, "organization")];
		if (!expectedRoomIds.includes(roomId)) throw new Error("federated room grant room does not match project");
		const task = input.taskId ? this.taskContracts.get(input.taskId) : undefined;
		if (input.taskId && (!task || task.projectId !== projectId || task.roomId !== roomId || (task.mode !== "network" && task.mode !== "organization"))) throw new Error("federated room grant task does not match project room");
		const expiresAt = input.expiresAt.trim();
		if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= this.now().getTime()) throw new Error("federated room grant expiry must be in the future");
		const allowedOperations = [...new Set(input.allowedOperations)];
		if (allowedOperations.length === 0) throw new Error("federated room grant requires an operation");
		if (allowedOperations.includes("task.send") && !input.taskId) throw new Error("task.send grants must be task-bound");
		const unsignedGrant = {
			grantId: `grant-${randomUUID()}`,
			projectId,
			communityId: this.scope.communityId,
			organizationId: projectScope.organizationId,
			roomId,
			...(input.taskId ? { taskId: input.taskId } : {}),
			requesterOrganizationId: this.scope.organizationId,
			...(input.providerOrganizationId?.trim() ? { providerOrganizationId: input.providerOrganizationId.trim() } : {}),
			allowedPrincipals: [...new Set([this.identity.id, principalId])],
			allowedCapabilities: [...new Set(input.allowedCapabilities.map((value) => value.trim()).filter(Boolean))],
			allowedDataScopes: [...new Set(input.allowedDataScopes.map((value) => value.trim()).filter(Boolean))],
			allowedActions: [...new Set(input.allowedActions.map((value) => value.trim()).filter(Boolean))],
			allowedOperations,
			issuedAt: this.now().toISOString(),
			expiresAt,
			issuerId: this.identity.id,
		};
		const grant = this.grantSigningPrivateKey
			? issueEd25519FederatedRoomGrant(unsignedGrant, this.grantSigningPrivateKey, this.grantSigningKeyRef)
			: issueFederatedRoomGrant(unsignedGrant, this.grantSigningSecret!);
		this.federatedRoomGrants.set(grant.grantId, grant);
		this.appendEvent(createEvent({
			id: `federated-grant-issued-${grant.grantId}`,
			communityId: this.scope.communityId,
			organizationId: this.scope.organizationId,
			roomId,
			kind: "federated.room_grant_issued",
			actor: this.identity,
			subject: grant.grantId,
			nonce: `federated-grant:issued:${grant.grantId}`,
			createdAt: grant.issuedAt,
			payload: { grant },
		}));
		return this.projectFederatedRoomGrant(grant);
	}

	revokeFederatedRoomGrant(grantId: string): FederatedRoomGrantProjection | Promise<FederatedRoomGrantProjection> {
		const grant = this.federatedRoomGrants.get(grantId.trim());
		if (!grant) throw new Error("federated room grant not found");
		if (!grant.revokedAt) {
			grant.revokedAt = this.now().toISOString();
			this.appendEvent(createEvent({
				id: `federated-grant-revoked-${grant.grantId}`,
				communityId: this.scope.communityId,
				organizationId: this.scope.organizationId,
				roomId: grant.roomId,
				kind: "federated.room_grant_revoked",
				actor: this.identity,
				subject: grant.grantId,
				nonce: `federated-grant:revoked:${grant.grantId}`,
				createdAt: grant.revokedAt,
				payload: { grantId: grant.grantId, revokedAt: grant.revokedAt },
			}));
			const remoteRevocation = this.localRelay?.revokeRoomGrant?.(grant.grantId);
			if (remoteRevocation instanceof Promise) return remoteRevocation.then(() => this.projectFederatedRoomGrant(grant));
		}
		return this.projectFederatedRoomGrant(grant);
	}

	federatedRoomGrantSnapshot(): FederatedRoomGrantProjection[] {
		return [...this.federatedRoomGrants.values()].map((grant) => this.projectFederatedRoomGrant(grant));
	}

	getFederatedRoomGrantForRelay(grantId: string): FederatedRoomGrant {
		const grant = this.federatedRoomGrants.get(grantId.trim());
		if (!grant) throw new Error("federated room grant not found");
		if (grant.revokedAt || Date.parse(grant.expiresAt) <= this.now().getTime()) throw new Error("federated room grant is inactive");
		return structuredClone(grant);
	}

	revokeOrganizationDelegation(delegationId: string): DelegationGrant {
		return this.organization.revokeDelegation(this.identity, delegationId).value;
	}

	requestApproval(input: { taskId: string; actions: string[]; reason: string }): ApprovalRequest {
		return this.organization.requestApproval(this.identity, input).value;
	}

	decideApproval(input: { approvalId: string; approved: boolean; reason?: string }): ApprovalRequest {
		const approval = this.organization.decideApproval(this.identity, input.approvalId, input.approved, input.reason).value;
		for (const intent of this.sideEffectIntents.values()) {
			if (intent.approvalId !== approval.id || intent.status !== "pending") continue;
			intent.status = input.approved ? "approved" : "rejected";
		}
		return approval;
	}

	controlTask(input: { taskId: string; action: "pause" | "resume" | "revoke" | "takeover" | "revision"; reason?: string }): TaskControlProjection {
		return this.organization.controlTask(this.identity, input.taskId, input.action, input.reason).value;
	}

	shareEmailThread(input: SharedEmailThreadInput): SharedEmailThreadResult {
		const channel = input.channelId.trim();
		const accountId = input.accountId.trim();
		const threadId = input.threadId.trim();
		if (!channel || !accountId || !threadId) throw new Error("email share requires accountId, channelId and threadId");
		const event = createEvent({
			id: `event-${randomUUID()}`,
			communityId: this.scope.communityId,
			organizationId: this.scope.organizationId,
			roomId: this.scope.roomId,
			kind: "room.message",
			actor: this.identity,
			subject: input.subject?.trim() || `邮件线程 ${threadId}`,
			nonce: `email-share:${threadId}:${randomUUID()}`,
			createdAt: this.now().toISOString(),
			payload: { channelId: channel, emailAccountId: accountId, emailThreadId: threadId, summary: input.message?.trim() || "已分享邮件线程" },
		});
		this.appendEvent(event);
		return { eventId: event.id, channelId: channel, threadId };
	}

	ackInbox(eventId: string): InboxCursor {
		const event = this.events.find((candidate) => candidate.id === eventId
			&& candidate.communityId === this.scope.communityId
			&& candidate.organizationId === this.scope.organizationId
			&& this.knownRoom(candidate.roomId));
		if (!event) throw new Error("inbox event is outside the local collaboration scope");
		const cursor = this.inbox.ack(this.identity.id, eventId);
		this.writeCursor(cursor);
		return cursor;
	}

	snapshot(opts?: SnapshotOptions): SnapshotResponse {
		this.network.refreshAgentCardStatuses();
		const events = this.allCollaborationEvents();
		this.inbox.rebuild(events, this.identity.id, {
			communityId: this.scope.communityId,
			organizationId: this.scope.organizationId,
		});
		const rooms = [this.scope, ...this.projectRooms.values()].map((scope) => {
			const room = this.rooms.get(scope);
			if (!room) throw new Error(`local collaboration room is unavailable: ${scope.roomId}`);
			return { room, memberCount: this.rooms.listMembers(scope).length, channelCount: this.rooms.listChannels(scope).length, members: this.rooms.listMembers(scope) };
		});
		const inboxList = this.inbox.list(this.identity.id, { communityId: this.scope.communityId, organizationId: this.scope.organizationId });
		const workflowList = [...this.workflows.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((workflow) => structuredClone(workflow));
		const since = opts?.since;
		const slicedEvents = typeof since === "number" ? events.slice(since) : events;
		const hasMoreEvents = typeof since === "number" ? events.length > since + slicedEvents.length : false;
		const baseData: CollaborationSnapshot = {
			protocol: "buddy/1.0",
			mode: "local-first",
			collaborationManifest: this.collaborationManifest(),
				identity: structuredClone({ ...this.identity, status: this.rooms.getPresence(this.scope, this.identity.id, new Date().toISOString())?.status ?? "offline" }),
				rooms,
				inbox: inboxList,
			tasks: projectTasks(events),
			workflows: workflowList,
			activity: slicedEvents.slice(-20).reverse().map((event) => {
				const payload = event.payload && typeof event.payload === "object" ? event.payload as { executionRef?: unknown } : undefined;
				const executionRef = payload?.executionRef && typeof payload.executionRef === "object" ? payload.executionRef as BuddyExecutionRef : undefined;
				return { id: event.id, kind: event.kind, subject: event.subject, createdAt: event.createdAt, ...(event.taskId ? { taskId: event.taskId } : {}), roomId: event.roomId, ...(executionRef ? { executionRef: structuredClone(executionRef) } : {}) };
			}),
			capabilities: { local: 0, room: 0, organization: 0, directory: 0 },
			capabilityCards: structuredClone(this.capabilityCards),
			mcpCapabilities: [],
			policy: {
					dataScopes: [...new Set(rooms.map(({ room }) => `room:${room.id}`))],
				allowedActions: ["read:room", "write:artifact", "propose:task"],
				forbiddenActions: ["purchase", "delete:production", "external:send"],
				approval: "before_external_commit",
				expiresAt: new Date(this.now().getTime() + 60 * 60_000).toISOString(),
			},
			organization: {
					id: this.scope.organizationId!,
				members: this.organization.listMembers(),
				delegations: this.organization.listDelegations(),
				approvals: this.organization.listApprovals(),
				taskControls: this.organization.listTaskControls(),
			},
			federatedRoomGrants: this.federatedRoomGrantSnapshot(),
			sideEffectIntents: [...this.sideEffectIntents.values()].map((intent) => structuredClone(intent)),
			network: this.network.snapshot(),
			relay: { status: this.localRelay?.status ?? "local", ...(this.relaySyncScheduler ? { sync: this.relaySyncScheduler.getStatus() } : {}), pending: this.relayOutbox?.pending() ?? [] },
				updatedAt: this.now().toISOString(),
		};
		const version = this.computeSnapshotVersion(events, inboxList, workflowList);
		this.lastSnapshotVersion = version;
		return {
			version,
			data: baseData,
			hasMore: { events: hasMoreEvents, inbox: false },
		};
	}

	private lastSnapshotVersion: number = 0;

	private computeSnapshotVersion(
		events: ReadonlyArray<unknown>,
		inbox: ReadonlyArray<unknown>,
		workflows: ReadonlyArray<{ updatedAt?: string }>,
	): number {
		let hash = 0xcbf29ce484222325n;
		const prime = 0x100000001b3n;
		const mask = (1n << 64n) - 1n;
		const mix = (value: bigint) => {
			hash = ((hash ^ (value & mask)) * prime) & mask;
		};
		mix(BigInt(events.length));
		mix(BigInt(inbox.length));
		mix(BigInt(workflows.length));
		if (workflows.length > 0) {
			const latest = workflows.reduce((acc, w) => (w.updatedAt && (!acc || w.updatedAt > acc) ? w.updatedAt : acc), "");
			if (latest) {
				let i = 0;
				for (const ch of latest) {
					mix(BigInt(ch.charCodeAt(0)) << BigInt((i % 8) * 8));
					i += 1;
				}
			}
		}
		return Number(hash);
	}

	getSnapshotVersion(): number {
		return this.lastSnapshotVersion;
	}

	private readEvents(): BuddyEvent[] {
		try {
			return readFileSync(this.storagePath, "utf8").split(/\r?\n/u).filter(Boolean).flatMap((line) => {
				try {
					const value = JSON.parse(line) as BuddyEvent;
			return value && typeof value.id === "string" && typeof value.kind === "string" && typeof value.communityId === "string" ? [value] : [];
				} catch {
					return [];
				}
			});
		} catch {
			return [];
		}
	}

	private restoreFederatedRoomGrants(): void {
		for (const event of this.events) {
			if (event.kind === "federated.room_grant_issued") {
				const grant = (event.payload as { grant?: unknown }).grant;
				if (grant && typeof grant === "object" && typeof (grant as FederatedRoomGrant).grantId === "string") this.federatedRoomGrants.set((grant as FederatedRoomGrant).grantId, structuredClone(grant as FederatedRoomGrant));
			}
			if (event.kind === "federated.room_grant_revoked") {
				const payload = event.payload as { grantId?: unknown; revokedAt?: unknown };
				const grant = typeof payload.grantId === "string" ? this.federatedRoomGrants.get(payload.grantId) : undefined;
				if (grant) grant.revokedAt = typeof payload.revokedAt === "string" ? payload.revokedAt : event.createdAt;
			}
			if (event.kind === "network.authority_revocation_applied") {
				const record = (event.payload as { record?: unknown }).record;
				if (record && typeof record === "object" && (record as { kind?: unknown }).kind === "room-grant" && typeof (record as { identifier?: unknown }).identifier === "string") {
					const grant = this.federatedRoomGrants.get((record as { identifier: string }).identifier);
					if (grant) {
						grant.revokedAt = typeof (record as { revokedAt?: unknown }).revokedAt === "string" ? (record as { revokedAt: string }).revokedAt : event.createdAt;
						this.localRelay?.revokeRoomGrant?.(grant.grantId);
					}
				}
			}
		}
	}

	private restoreSideEffectIntents(): void {
		for (const event of this.events) {
			if (!event.kind.startsWith("side_effect.intent_")) continue;
			const payload = event.payload as Record<string, unknown>;
			const intentId = typeof payload.intentId === "string" ? payload.intentId : undefined;
			if (!intentId) continue;
			if (event.kind === "side_effect.intent_created") {
				const taskId = typeof event.taskId === "string" ? event.taskId : undefined;
				const approvalId = typeof payload.approvalId === "string" ? payload.approvalId : undefined;
				const capability = typeof payload.capability === "string" ? payload.capability : undefined;
				const action = typeof payload.action === "string" ? payload.action : undefined;
				const fingerprint = typeof payload.fingerprint === "string" ? payload.fingerprint : undefined;
				const summary = typeof payload.summary === "string" ? payload.summary : undefined;
				const expiresAt = typeof payload.expiresAt === "string" ? payload.expiresAt : undefined;
				const roomId = typeof event.roomId === "string" ? event.roomId : undefined;
				if (!taskId || !approvalId || !roomId || !capability || !action || !fingerprint || !summary || !expiresAt) continue;
				this.sideEffectIntents.set(intentId, { intentId, taskId, approvalId, roomId, capability, action, ...(typeof payload.resourceId === "string" ? { resourceId: payload.resourceId } : {}), fingerprint, summary, createdAt: event.createdAt, expiresAt, status: "pending" });
				continue;
			}
			const intent = this.sideEffectIntents.get(intentId);
			if (!intent) continue;
			if (event.kind === "side_effect.intent_consumed") { intent.status = "consumed"; intent.consumedAt = event.createdAt; }
			if (event.kind === "side_effect.intent_completed") { intent.status = "completed"; intent.completedAt = event.createdAt; }
			if (event.kind === "side_effect.intent_failed") { intent.status = "failed"; intent.error = typeof payload.error === "string" ? payload.error : undefined; }
			if (event.kind === "side_effect.intent_cancelled") { intent.status = "cancelled"; intent.error = typeof payload.reason === "string" ? payload.reason : undefined; }
		}
		for (const intent of this.sideEffectIntents.values()) {
			if (intent.status === "pending") {
				const approval = this.organization.listApprovals().find((item) => item.id === intent.approvalId);
				if (approval?.status === "approved") intent.status = "approved";
				if (approval?.status === "rejected") intent.status = "rejected";
			}
			if (intent.status === "pending" && Date.parse(intent.expiresAt) <= this.now().getTime()) intent.status = "expired";
		}
	}

	private projectFederatedRoomGrant(grant: FederatedRoomGrant): FederatedRoomGrantProjection {
		const status: FederatedRoomGrantProjection["status"] = grant.revokedAt ? "revoked" : Date.parse(grant.expiresAt) <= this.now().getTime() ? "expired" : "active";
		return {
			grantId: grant.grantId,
			projectId: grant.projectId,
			communityId: grant.communityId,
			...(grant.organizationId ? { organizationId: grant.organizationId } : {}),
			roomId: grant.roomId,
			...(grant.taskId ? { taskId: grant.taskId } : {}),
			...(grant.requesterOrganizationId ? { requesterOrganizationId: grant.requesterOrganizationId } : {}),
			...(grant.providerOrganizationId ? { providerOrganizationId: grant.providerOrganizationId } : {}),
			allowedPrincipals: [...grant.allowedPrincipals],
			allowedCapabilities: [...grant.allowedCapabilities],
			allowedDataScopes: [...grant.allowedDataScopes],
			allowedActions: [...grant.allowedActions],
			allowedOperations: [...grant.allowedOperations],
			issuedAt: grant.issuedAt,
			expiresAt: grant.expiresAt,
			...(grant.revokedAt ? { revokedAt: grant.revokedAt } : {}),
			issuerId: grant.issuerId,
			status,
		};
	}

	private appendEvent(event: BuddyEvent): void {
		if (this.events.some((candidate) => candidate.id === event.id || (candidate.actor.id === event.actor.id && candidate.nonce === event.nonce))) return;
		// P1-12: enqueue for async batched appendFile. The synchronous
		// `mkdirSync + appendFileSync + structuredClone` was one full
		// fsync per BuddyEvent — at 50 events/sec that starved every
		// other IPC handler in the main process.
		// Each entry is newline-terminated so readEvents()'s split('\n') parser
		// can recover individual records from the JSONL file.
		this.enqueueAppend(`${JSON.stringify(event)}\n`);
		this.events.push(structuredClone(event));
		this.organization?.observe(event);
		const update: CollaborationUpdate = {
			eventId: event.id,
			kind: event.kind,
			...(event.taskId ? { taskId: event.taskId } : {}),
			...(event.roomId ? { roomId: event.roomId } : {}),
			updatedAt: event.createdAt,
		};
		for (const listener of this.updateListeners) listener(update);
	}

	private appendScopedEvent(event: BuddyEvent): void {
		if (!this.knownRoom(event.roomId) || (event.organizationId && event.organizationId !== this.scope.organizationId)) throw new Error("provider event is outside the local collaboration scope");
		const normalized = event.communityId === this.scope.communityId && event.organizationId === this.scope.organizationId
			? event
			: createEvent({ ...event, communityId: this.scope.communityId, organizationId: this.scope.organizationId, roomId: event.roomId ?? this.scope.roomId, payload: event.payload });
		this.appendEvent(normalized);
	}

	private appendEvidenceEvent(bundle: BuddyEvidenceBundle, provider: BuddyIdentity, verifier: BuddyIdentity, executionRef?: BuddyExecutionRef, roomId?: string): void {
		const contract = this.taskContracts.get(bundle.taskId);
		this.appendScopedEvent(createEvent({
			id: `evidence-${bundle.taskId}`,
				communityId: this.scope.communityId,
				organizationId: this.scope.organizationId,
			roomId: contract && contract.mode !== "network" ? taskRoomId(contract) : contract?.roomId ?? roomId ?? this.scope.roomId,
			taskId: bundle.taskId,
			kind: "task.evidence_verified",
			actor: verifier,
			subject: "Buddy 交付已验证",
			nonce: `evidence:${bundle.taskId}`,
			createdAt: this.now().toISOString(),
			payload: { providerId: provider.id, verifierId: verifier.id, bundleDigest: bundle.bundleDigest, artifactIds: bundle.artifacts.map((artifact) => artifact.id), evidenceCount: bundle.evidence.length, verification: bundle.verification?.status, ...(executionRef ? { executionRef } : {}) },
		}));
	}

	private appendWorkflowEvent(workflow: WorkflowSnapshot, kind: string, reason?: string): void {
		this.appendScopedEvent(createEvent({
			id: `workflow-event-${workflow.workflowId}-${workflow.updatedAt}-${kind}`,
			communityId: this.scope.communityId,
			organizationId: this.scope.organizationId,
			roomId: this.scope.roomId,
			kind,
			actor: this.identity,
			subject: workflow.title,
			nonce: `workflow:${workflow.workflowId}:${workflow.updatedAt}:${kind}`,
			createdAt: workflow.updatedAt,
			payload: { workflowId: workflow.workflowId, status: workflow.status, nodeIds: workflow.nodes.map((node) => node.id), ...(reason ? { reason } : {}) },
		}));
	}

	private capabilityFromCard(card: CollaborationCapabilityProjection, provider: CapabilityProvider | null, providerIdOverride?: string): BuddyCapability {
		const providerId = providerIdOverride ?? card.providerId ?? (provider as (CapabilityProvider & { identitySnapshot?: () => BuddyIdentity; identityForProvider?: (providerId: string) => BuddyIdentity | undefined }) | null)?.identityForProvider?.(card.providerId ?? "")?.id ?? (provider as (CapabilityProvider & { identitySnapshot?: () => BuddyIdentity }) | null)?.identitySnapshot?.().id ?? "buddy-org-runner";
		return {
			id: card.id,
			providerId,
			description: card.name,
			inputSchema: {},
			outputSchema: {},
			procedure: [],
			allowedDataScopes: [`room:${this.scope.roomId}`, "room:project-*", "public:brief"],
			forbiddenDataScopes: ["credential:vault", "secret:prompt"],
			allowedActions: ["read:room", "write:artifact"],
			forbiddenActions: ["external:send", "purchase"],
			acceptanceTests: [],
			requiredApproval: card.contract.approval === "before-external-commit" ? "before_external_commit" : "never",
			allowDelegation: true,
			maxDelegationDepth: 1,
			visibility: card.visibility === "organization" ? "org" : "private",
		};
	}

	/**
	 * Return all locally-registered capability cards converted to `BuddyCapability`.
	 * Used by external integrations (MCP server adapter, A2A facade) that need a
	 * transport-neutral capability list.
	 */
	listMcpCapabilities(): BuddyCapability[] {
		const provider: CapabilityProvider | null = this.personalProvider ?? this.provider;
		return this.capabilityCards.map((card) => this.capabilityFromCard(card, provider, this.identity.id));
	}

	/**
	 * Invoke a capability by id with structured args. Builds a synthetic
	 * `BuddyTaskEnvelope` from the runtime's identity/scope and dispatches to
	 * the personal or organization provider. Returns the JSON-serializable
	 * result; throws when the capability is unknown, the provider is missing,
	 * or the provider rejects the envelope.
	 */
	async invokeMcpCapability(input: { capabilityId: string; args: Record<string, unknown> }): Promise<unknown> {
		const card = this.capabilityCards.find((entry) => entry.id === input.capabilityId);
		if (!card) throw new Error(`unknown capability: ${input.capabilityId}`);
		const provider: CapabilityProvider | null = card.visibility === "local" ? this.personalProvider : this.provider;
		if (!provider) throw new Error(`no provider registered for capability visibility: ${card.visibility}`);
		const capability = this.capabilityFromCard(card, provider, this.identity.id);
		const envelope: BuddyTaskEnvelope = {
			protocol: "buddy/1.0",
			messageType: "task.propose",
			messageId: `mcp-${randomUUID()}`,
			traceId: `mcp-trace-${input.capabilityId}`,
			taskId: `mcp-${input.capabilityId}-${Date.now()}`,
			nonce: `mcp:${input.capabilityId}:${randomUUID()}`,
			sender: this.identity,
			roomRef: this.scope.roomId,
			createdAt: this.now().toISOString(),
			expiresAt: new Date(this.now().getTime() + 60 * 60_000).toISOString(),
			objective: `MCP tool call: ${input.capabilityId}`,
			capability: capability.id,
			input: { contextRefs: [], ...(input.args ? { constraints: { capabilityInput: input.args } } : {}) },
			output: { schema: {}, acceptanceTests: [], artifactTypes: ["other"] },
			policy: {
				dataScopes: [`room:${this.scope.roomId}`],
				allowedActions: ["read:room"],
				forbiddenActions: ["external:send", "purchase"],
				approval: capability.requiredApproval,
				allowDelegation: capability.allowDelegation,
				maxDelegationDepth: capability.maxDelegationDepth,
				retention: "task",
				expiresAt: new Date(this.now().getTime() + 60 * 60_000).toISOString(),
			},
			delivery: { acceptedArtifactTypes: ["other"], retention: "task", redactionRequired: true },
		};
		return provider.invoke({ capability, envelope });
	}

	private writeTaskContracts(): void {
		// P1-12: debounce full-file rewrites. Most task/contract mutations
		// happen in clusters — a single capability-grant batch triggers 5+
		// writeTaskContracts calls in 50ms. Debouncing collapses them into
		// 1 atomic write per FULL_REWRITE_DEBOUNCE_MS window.
		this.scheduleContractsWrite();
	}

	private writeWorkflows(): void {
		// P1-12: debounce full-file rewrites (same rationale as
		// writeTaskContracts — most workflow mutations arrive in bursts).
		this.scheduleWorkflowsWrite();
	}

	/**
	 * P1-12: queue a serialized event-log line for batched async appendFile.
	 *
	 * The synchronous path was `mkdirSync + appendFileSync + structuredClone`
	 * per BuddyEvent — at 50 events/sec that meant 50 fsyncs/sec blocking
	 * every other IPC handler in the main process. The new path:
	 *   - accumulate lines in `appendQueue`
	 *   - on first enqueue, schedule a 16ms (one macrotask) flush
	 *   - if the queue ever hits APPEND_FLUSH_MAX lines, flush immediately
	 *   - serialize concurrent flushes via `appendWriteInFlight` so two
	 *     flushes never interleave bytes into the log file
	 *
	 * Returns synchronously; the actual fsync happens on a future tick.
	 */
	private enqueueAppend(line: string): void {
		this.appendQueue.push(line);
		if (this.appendQueue.length >= APPEND_FLUSH_MAX) {
			void this.flushAppendQueue();
			return;
		}
		if (this.appendFlushTimer) return;
		this.appendFlushTimer = setTimeout(() => {
			this.appendFlushTimer = null;
			void this.flushAppendQueue();
		}, APPEND_FLUSH_MS);
		// Don't keep the process alive purely for the flush — Electron's
		// app lifecycle owns that. `.unref()` makes the timer non-blocking.
		this.appendFlushTimer.unref?.();
	}

	private async flushAppendQueue(): Promise<void> {
		// Drain under the in-flight lock so two flushes can't race.
		const run = async () => {
			if (this.appendQueue.length === 0) return;
			const drain = this.appendQueue;
			this.appendQueue = [];
			const payload = drain.join('');
			await mkdir(dirname(this.storagePath), { recursive: true });
			await appendFile(this.storagePath, payload, "utf8");
		};
		this.appendWriteInFlight = this.appendWriteInFlight.then(run, run);
		try {
			await this.appendWriteInFlight;
		} catch (error) {
			// Don't crash the runtime if a single flush fails; the next
			// flush will retry. Log so the operator sees it.
			console.error("[collaboration-runtime] append flush failed", error);
		}
	}

	private scheduleContractsWrite(): void {
		if (this.contractsDirtyTimer) {
			// Already scheduled; existing timer will pick up the latest state.
			return;
		}
		this.contractsDirtyTimer = setTimeout(() => {
			this.contractsDirtyTimer = null;
			void this.persistContractsNow();
		}, FULL_REWRITE_DEBOUNCE_MS);
		this.contractsDirtyTimer.unref?.();
	}

	private scheduleWorkflowsWrite(): void {
		if (this.workflowsDirtyTimer) return;
		this.workflowsDirtyTimer = setTimeout(() => {
			this.workflowsDirtyTimer = null;
			void this.persistWorkflowsNow();
		}, FULL_REWRITE_DEBOUNCE_MS);
		this.workflowsDirtyTimer.unref?.();
	}

	private async persistContractsNow(): Promise<void> {
		const snapshot = `${JSON.stringify(Object.fromEntries(this.taskContracts))}\n`;
		await mkdir(dirname(this.contractsPath), { recursive: true });
		const temporaryPath = `${this.contractsPath}.tmp`;
		await writeFile(temporaryPath, snapshot, "utf8");
		await rename(temporaryPath, this.contractsPath);
	}

	private async persistWorkflowsNow(): Promise<void> {
		const snapshot = `${JSON.stringify(Object.fromEntries(this.workflows))}\n`;
		await mkdir(dirname(this.workflowsPath), { recursive: true });
		const temporaryPath = `${this.workflowsPath}.tmp`;
		await writeFile(temporaryPath, snapshot, "utf8");
		await rename(temporaryPath, this.workflowsPath);
	}

	/** P1-12: force any pending batched I/O to flush. Called on shutdown. */
	public async flushPendingIO(): Promise<void> {
		// Cancel timers and force-flush whatever is queued.
		if (this.appendFlushTimer) {
			clearTimeout(this.appendFlushTimer);
			this.appendFlushTimer = null;
		}
		if (this.contractsDirtyTimer) {
			clearTimeout(this.contractsDirtyTimer);
			this.contractsDirtyTimer = null;
			await this.persistContractsNow();
		}
		if (this.workflowsDirtyTimer) {
			clearTimeout(this.workflowsDirtyTimer);
			this.workflowsDirtyTimer = null;
			await this.persistWorkflowsNow();
		}
		await this.flushAppendQueue();
	}

	private readCursor(): InboxCursor | undefined {
		try {
			const value = JSON.parse(readFileSync(this.cursorPath, "utf8")) as InboxCursor;
			if (value.principalId !== this.identity.id || !Array.isArray(value.acknowledgedEventIds)) return undefined;
			return { principalId: value.principalId, lastReadEventId: value.lastReadEventId, acknowledgedEventIds: value.acknowledgedEventIds.filter((id): id is string => typeof id === "string") };
		} catch {
			return undefined;
		}
	}

	private writeCursor(cursor: InboxCursor): void {
		mkdirSync(dirname(this.cursorPath), { recursive: true });
		const temporaryPath = `${this.cursorPath}.tmp`;
		writeFileSync(temporaryPath, `${JSON.stringify(cursor)}\n`, "utf8");
		renameSync(temporaryPath, this.cursorPath);
	}

	private persistIfMissing(event: BuddyEvent): void {
		if (!this.events.some((candidate) => candidate.id === event.id || (candidate.kind === event.kind && candidate.roomId === event.roomId && candidate.actor.id === event.actor.id && candidate.nonce === event.nonce))) this.appendEvent(event);
	}
}

const localRelay = new LocalRelay();
export const collaborationRuntime = new CollaborationRuntime({ localRelay });
