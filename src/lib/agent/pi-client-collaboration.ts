import { invoke, listen, type UnlistenFn } from "@/lib/platform/electron-api";
import type { BuddyAgentRef, BuddyExecutionRef, BuddySideEffectIntent } from "@openbuddy/collaboration-protocol";

/**
 * OpenBuddy pi-client collaboration surface — typed IPC wrappers for the
 * buddy/1.0 collaboration, workflow, network, and A2A APIs.
 *
 * Extracted from pi-client.ts (Stage 3 architecture split): this surface only
 * depends on the typed preload IPC (`invoke`/`listen`) and pure protocol types,
 * so it can be authored and tested independently. pi-client.ts re-exports it
 * via `export *`.
 */

export interface CollaborationSnapshot {
  protocol: "buddy/1.0";
  mode: "local-first";
  collaborationManifest?: {
    protocol: "collaboration/1";
    pluginId: "openbuddy-collaboration";
    capabilities: Array<{ id: string; version: "collaboration/1"; modes: Array<"personal" | "organization" | "network">; transport: "local" | "ipc" | "relay" | "a2a"; redactedProjection: boolean }>;
    invariants: readonly string[];
  };
  identity: { id: string; handle: string; displayName: string; status: "offline" | "idle" | "working" | "paused" };
  rooms: Array<{ room: { id: string; handle: string; kind: "personal" | "team" | "open"; visibility: string }; memberCount: number; channelCount: number; members: Array<{ principalId: string; role: "owner" | "member" | "observer" | "agent"; joinedAt: string; active: boolean }> }>;
  inbox: Array<{ id: string; kind: string; title: string; summary: string; createdAt: string; read: boolean; eventId: string; taskId?: string; roomId?: string; source?: "collaboration" | "email"; emailAccountId?: string; emailThreadId?: string }>;
  tasks: Array<{ taskId: string; status: string; title: string; roomId?: string; updatedAt: string; mode?: "personal" | "organization" | "network"; projectId?: string; agentRef?: BuddyAgentRef; executionRef?: BuddyExecutionRef }>;
  workflows: WorkflowSnapshot[];
  sideEffectIntents?: BuddySideEffectIntent[];
  activity: Array<{ id: string; kind: string; subject?: string; createdAt: string; roomId?: string; taskId?: string; executionRef?: BuddyExecutionRef }>;
  capabilities: { local: number; room: number; organization: number; directory: number };
  capabilityCards: Array<{ id: string; name: string; source: "pi-skill" | "pi-extension" | "prompt"; visibility: "local" | "organization"; status: "available" | "degraded"; contract: { input: "context-refs"; output: "artifact-or-message"; approval: "before-external-commit" } }>;
  mcpCapabilities: Array<{ serverName: string; toolName: string; providerId: string; roomId: string; dataScopes: string[]; allowedActions: string[]; approval: "before_external_commit"; status: string }>;
  policy: { dataScopes: string[]; allowedActions: string[]; forbiddenActions: string[]; approval: "before_external_commit"; expiresAt: string };
  organization: {
    id: string;
    members: Array<{ identity: { id: string; handle: string; displayName: string; ownerUserId: string; organizationId?: string; trustLevel: string; status: string }; role: "owner" | "admin" | "member" | "auditor"; joinedAt: string; active: boolean }>;
    delegations: Array<{ id: string; granteeId: string; taskId?: string; roomId?: string; allowedCapabilities: string[]; allowedDataScopes: string[]; expiresAt: string; revokedAt?: string }>;
    approvals: Array<{ id: string; taskId: string; requesterId: string; actions: string[]; reason: string; createdAt: string; status: "pending" | "approved" | "rejected"; decidedBy?: string; decidedAt?: string; decisionReason?: string }>;
    taskControls: Array<{ taskId: string; state: "paused" | "running" | "revoked" | "taken_over" | "revision_requested"; actorId: string; updatedAt: string; reason?: string }>;
  };
  federatedRoomGrants?: FederatedRoomGrantProjection[];
  network: {
    communityId: string;
    mode: "local-sandbox";
    trustRoots: Array<{ keyRef: string; addedAt: string; revokedAt?: string }>;
    deliveries: Array<{ bidId: string; proposalId: string; providerId: string; status: "pending_delivery" | "delivered" | "failed"; updatedAt: string; reason?: string }>;
    peers: Array<{ identity: { id: string; handle: string; displayName: string; organizationId?: string; trustLevel: string; status: string }; trust: "pending" | "known" | "trusted" | "blocked" | "revoked"; capabilities: Array<{ id: string; description: string }>; agentCardStatus: "missing" | "unverified" | "verified"; presence?: { expiresAt: string; leaseId: string; identityId: string; communityId: string; organizationId?: string; roomId?: string; issuedAt: string }; firstSeenAt: string; lastSeenAt: string; verifiedAt?: string; blockedAt?: string }>;
    capabilityDirectory: Array<{ peerId: string; identity: { id: string; displayName: string; handle: string }; trust: "pending" | "known" | "trusted" | "blocked" | "revoked"; agentCardStatus: "missing" | "unverified" | "verified"; capability: { id: string; description: string; allowedDataScopes: string[]; allowedActions: string[] } }>;
    offers: Array<{ id: string; providerId: string; capabilityId: string; title: string; description: string; acceptedDataScopes: string[]; acceptedArtifactTypes: string[]; approval: "never" | "before_external_commit" | "always"; validUntil: string; visibility: "known_peers" | "directory" }>;
    capabilityAgreements: Array<{ id: string; requesterId: string; providerId: string; proposalId: string; capabilityId: string; dataScopes: string[]; allowedActions: string[]; artifactTypes: string[]; approval: "never" | "before_external_commit" | "always"; expiresAt: string; status: "accepted" | "expired" | "revoked"; revokedAt?: string; revokedReason?: string; revokedBy?: string }>;
    authorityRevocations: Array<{ authorityId: string; sequence: number; kind: "credential" | "capability" | "room-grant"; identifier: string; revokedAt: string; signature?: { algorithm: "Ed25519"; keyRef: string; value: string } }>;
    proposals: Array<{ id: string; requesterId: string; capabilityId: string; objectiveDigest: string; dataScopes: string[]; allowedActions?: string[]; artifactTypes: string[]; expiresAt: string; status: "open" | "awarded" | "cancelled" | "expired"; awardedBidId?: string }>;
    bids: Array<{ id: string; offerId: string; proposalId: string; providerId: string; agreementId?: string; message: string; acceptedDataScopes: string[]; createdAt: string; validUntil: string; status: "submitted" | "withdrawn" | "awarded" | "rejected" }>;
  };
  relay: { status: "local" | "unknown" | "connecting" | "ready" | "degraded" | "closed"; sync?: { status: "idle" | "syncing" | "backoff" | "stopped"; consecutiveFailures: number; lastSyncAt?: string; lastChanged: number; nextAttemptAt?: string; lastError?: string; cursor?: { version: 1; revocationSequence: number; presenceSequence: number; updatedAt?: string; lastError?: string } }; pending: Array<{ messageId: string; taskId: string; attempts: number; createdAt: string; lastAttemptAt?: string; lastError?: string }> };
  updatedAt: string;
}

export const collaborationSnapshot = () => invoke<CollaborationSnapshot>("collaboration:snapshot");
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
  allowedOperations: Array<"endpoint.register" | "task.send" | "events.query">;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  issuerId: string;
  status: "active" | "expired" | "revoked";
}

export const collaborationFederatedRoomGrants = () => invoke<FederatedRoomGrantProjection[]>("collaboration:federated-grants");
export const collaborationIssueFederatedRoomGrant = (input: { projectId: string; roomId: string; principalId: string; providerOrganizationId?: string; taskId?: string; allowedCapabilities: string[]; allowedDataScopes: string[]; allowedActions: string[]; allowedOperations: Array<"endpoint.register" | "task.send" | "events.query">; expiresAt: string }) => invoke<FederatedRoomGrantProjection>("collaboration:federated-grant-issue", input);
export const collaborationRevokeFederatedRoomGrant = (grantId: string) => invoke<FederatedRoomGrantProjection>("collaboration:federated-grant-revoke", { grantId });
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean };
  skills: Array<{ id: string; name: string; description: string; inputModes: string[]; outputModes: string[] }>;
  metadata: { openbuddy: { identityId: string; communityId: string; organizationId?: string; trust: string; agentCardStatus: string } };
}
export interface A2ATaskRequest {
  id: string;
  contextId?: string;
  skillId: string;
  objective: string;
  sender: Record<string, unknown>;
  roomRef?: string;
  contextRefs?: string[];
  dataScopes: string[];
  allowedActions: string[];
  approval?: "never" | "before_external_commit" | "always";
  artifactTypes: string[];
  expiresAt: string;
  traceId?: string;
  nonce?: string;
  capabilityToken?: string;
}
export interface A2ATaskView {
  id: string;
  contextId: string;
  status: { state: string; timestamp: string };
  artifacts: Array<Record<string, unknown>>;
  metadata: { openbuddy: { taskId: string; status: string; executionRef?: Record<string, string>; verification: string } };
}
export const collaborationA2AAgentCard = () => invoke<A2AAgentCard>("collaboration:a2a-agent-card");
export const collaborationA2ATaskSubmit = (request: A2ATaskRequest) => invoke<{ requestId: string; runtimeTaskId: string; view: A2ATaskView }>("collaboration:a2a-task-submit", request);
export const collaborationA2ATaskGet = (taskId: string) => invoke<A2ATaskView>("collaboration:a2a-task-get", { taskId });
export type CollaborationUpdate = {
  eventId: string;
  kind: string;
  taskId?: string;
  roomId?: string;
  updatedAt: string;
};

export async function collaborationOnUpdate(handler: (update: CollaborationUpdate) => void): Promise<UnlistenFn> {
  return listen<CollaborationUpdate>("openbuddy://collaboration-update", (event) => handler(event.payload));
}

export interface CollaborationTaskHandle {
  taskId: string;
  eventId: string;
  status: "proposed";
  roomId: string;
  executionRef: BuddyExecutionRef;
}

export interface CollaborationExecutionHandle {
  taskId: string;
  status: "accepted" | "failed" | "rejected";
  executionRef?: BuddyExecutionRef;
  providerId?: string;
  verifierId?: string;
  bundleDigest?: string;
  artifactIds: string[];
  evidenceCount: number;
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
  execution?: CollaborationExecutionHandle;
  reason?: string;
}

export interface WorkflowSnapshot {
  workflowId: string;
  title: string;
  mode: "personal" | "organization";
  projectId?: string;
  status: "proposed" | "running" | "paused" | "cancelled" | "accepted" | "rejected" | "failed" | "blocked";
  nodes: WorkflowNodeSnapshot[];
  control?: { state: "pause" | "resume" | "cancel" | "takeover" | "revision"; actorId: string; updatedAt: string; reason?: string };
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  status: Exclude<WorkflowSnapshot["status"], "proposed" | "running" | "paused">;
  nodes: Array<WorkflowNodeSnapshot & { execution?: CollaborationExecutionHandle }>;
}

export const collaborationProposeTask = (input: { title: string; objective: string; capability?: string; roomId?: string; projectId?: string; agentRef?: BuddyAgentRef }) => invoke<CollaborationTaskHandle>("collaboration:propose-task", input);
export const collaborationPropose = (input: { mode: "personal" | "organization" | "network"; title: string; objective: string; capability?: string; roomId?: string; projectId?: string; contextRefs?: string[]; dataScopes?: string[]; artifactTypes?: string[]; expiresAt?: string; providerId?: string; capabilityInput?: Record<string, unknown>; agentRef?: BuddyAgentRef; sideEffectIntentId?: string; sideEffectFingerprint?: string }) => invoke<CollaborationTaskHandle & { mode: "personal" | "organization" | "network"; projectId?: string; contract: { dataScopes: string[]; artifactTypes: string[]; approval: "before_external_commit"; execution: "local" | "organization-provider" | "network-proposal" } }>("collaboration:propose", input);
export const collaborationExecute = (taskId: string) => invoke<CollaborationExecutionHandle>("collaboration:execute", { taskId });
export const collaborationWorkflowPropose = (input: { title: string; mode: "personal" | "organization"; projectId?: string; nodes: Array<{ id: string; dependsOn?: string[]; title?: string; objective?: string; capability?: string; projectId?: string; roomId?: string; contextRefs?: string[]; dataScopes?: string[]; artifactTypes?: string[]; capabilityInput?: Record<string, unknown>; agentRef?: BuddyAgentRef; crossNetwork?: boolean; sideEffectIntentId?: string; sideEffectFingerprint?: string }> }) => invoke<WorkflowSnapshot>("collaboration:workflow-propose", input);
export const collaborationWorkflowExecute = (workflowId: string) => invoke<WorkflowExecutionResult>("collaboration:workflow-execute", { workflowId });
export const collaborationWorkflowStatus = (workflowId: string) => invoke<WorkflowSnapshot>("collaboration:workflow-status", { workflowId });
export const collaborationWorkflowControl = (input: { workflowId: string; action: "pause" | "resume" | "cancel" | "takeover" | "revision"; reason?: string }) => invoke<WorkflowSnapshot>("collaboration:workflow-control", input);
export const collaborationAckInbox = (eventId: string) => invoke<{ principalId: string; lastReadEventId?: string; acknowledgedEventIds: string[] }>("collaboration:ack-inbox", { eventId });
export const collaborationAddOrganizationMember = (input: { id: string; handle: string; displayName: string; ownerUserId: string; role?: "owner" | "admin" | "member" | "auditor" }) => invoke("collaboration:organization-member", input);
export const collaborationRemoveOrganizationMember = (input: { memberId: string }) => invoke("collaboration:organization-member-remove", input);
export const collaborationGetIdentity = () => invoke<{ identity: import("@openbuddy/collaboration-protocol").BuddyIdentity; file: { id: string; handle: string; displayName: string; ownerUserId: string; organizationId: string; createdAt: string; updatedAt: string }; filePath: string }>("collaboration:identity-get", undefined);
export const collaborationUpdateIdentity = (input: { handle?: string; displayName?: string; organizationId?: string; status?: "idle" | "working" | "offline" }) => invoke<{ identity: import("@openbuddy/collaboration-protocol").BuddyIdentity; file: { id: string; handle: string; displayName: string; ownerUserId: string; organizationId: string; createdAt: string; updatedAt: string }; filePath: string }>("collaboration:identity-update", input);
export const collaborationAddRoomMember = (input: { roomId: string; principalId: string; role?: "member" | "observer" | "agent" }) => invoke("collaboration:room-member-add", input);
export const collaborationRemoveRoomMember = (input: { roomId: string; principalId: string }) => invoke("collaboration:room-member-remove", input);
export const collaborationGrantDelegation = (input: { granteeId: string; taskId?: string; roomId?: string; allowedCapabilities: string[]; allowedDataScopes: string[]; expiresAt: string }) => invoke("collaboration:delegation-grant", input);
export const collaborationRevokeDelegation = (delegationId: string) => invoke("collaboration:delegation-revoke", { delegationId });
export const collaborationRequestApproval = (input: { taskId: string; actions: string[]; reason: string }) => invoke("collaboration:approval-request", input);
export const collaborationDecideApproval = (input: { approvalId: string; approved: boolean; reason?: string }) => invoke("collaboration:approval-decide", input);
export const collaborationSideEffectCreate = (input: { capability: string; action: string; summary: string; fingerprint: string; resourceId?: string; taskId?: string; expiresAt?: string; approvedByUser?: boolean }) => invoke<BuddySideEffectIntent>("collaboration:side-effect-create", input);
export const collaborationSideEffectApprove = (intentId: string) => invoke("collaboration:side-effect-approve", { intentId });
export const collaborationSideEffectComplete = (intentId: string, receipt?: string) => invoke("collaboration:side-effect-complete", { intentId, ...(receipt ? { receipt } : {}) });
export const collaborationSideEffectCancel = (intentId: string, reason?: string) => invoke("collaboration:side-effect-cancel", { intentId, ...(reason ? { reason } : {}) });
export const collaborationControlTask = (input: { taskId: string; action: "pause" | "resume" | "revoke" | "takeover" | "revision"; reason?: string }) => invoke("collaboration:task-control", input);
export interface CollaborationNetworkPeerInput {
  identity: { id: string; handle: string; displayName: string; ownerUserId: string; organizationId?: string; publicKeyRef?: string; trustLevel: "local" | "org" | "known_peer" | "public"; status: "offline" | "idle" | "working" | "paused" };
  capabilities: unknown[];
  agentCard?: unknown;
}
export const collaborationRegisterNetworkPeer = (input: CollaborationNetworkPeerInput) => invoke("collaboration:network-peer", input);
export const collaborationSetNetworkPeerTrust = (peerId: string, trust: "pending" | "known" | "trusted" | "blocked" | "revoked") => invoke("collaboration:network-trust", { peerId, trust });
export const collaborationAddNetworkTrustRoot = (publicKeyPem: string) => invoke<{ keyRef: string; addedAt: string; revokedAt?: string }>("collaboration:network-trust-root-add", { publicKeyPem });
export const collaborationRevokeNetworkTrustRoot = (keyRef: string) => invoke<Array<{ keyRef: string; addedAt: string; revokedAt?: string }>>("collaboration:network-trust-root-revoke", { keyRef });
export const collaborationPublishNetworkOffer = (input: { providerId: string; capabilityId: string; title: string; description: string; acceptedDataScopes: string[]; acceptedArtifactTypes: string[]; approval: "never" | "before_external_commit" | "always"; validUntil: string; visibility: "known_peers" | "directory" }) => invoke("collaboration:network-offer", input);
export const collaborationProposeNetworkService = (input: { capabilityId: string; objective: string; dataScopes: string[]; allowedActions?: string[]; artifactTypes: string[]; expiresAt: string }) => invoke("collaboration:network-proposal", input);
export const collaborationNegotiateNetworkCapability = (input: { offerId: string; proposalId: string; providerId: string }) => invoke("collaboration:network-negotiate", input);
export const collaborationRevokeNetworkCapabilityAgreement = (agreementId: string, reason: string) => invoke("collaboration:network-agreement-revoke", { agreementId, reason });
export const collaborationSubmitNetworkBid = (input: { offerId: string; proposalId: string; providerId: string; message: string; acceptedDataScopes: string[]; validUntil: string }) => invoke("collaboration:network-bid", input);
export const collaborationAwardNetworkBid = (bidId: string) => invoke("collaboration:network-award", { bidId });
export const collaborationRetryNetworkDeliveries = () => invoke<Array<{ messageId: string; status: "delivered" | "pending" | "expired"; lastError?: string }>>("collaboration:network-retry");
