import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { CollaborationRuntime } from "./collaboration-runtime";
import { OrganizationCapabilityProvider } from "@openbuddy/collaboration-coordinator";
import type { BuddyCapability, BuddyIdentity, BuddyScope } from "@openbuddy/collaboration-protocol";
import { RemoteRelayTransport, createResilientWebSocketRemoteRelayWire, type RemoteRelayCredential } from "@openbuddy/collaboration-network";
import type { RoomScope } from "@openbuddy/collaboration-room";

type WorkerConfig = {
  role: "requester" | "provider";
  relayUrl: string;
  credential: RemoteRelayCredential;
  scope: RoomScope;
  storagePath: string;
  identity: BuddyIdentity;
  providerIdentity?: BuddyIdentity;
  relayCapabilitySecret?: string;
};

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function transport(config: WorkerConfig): RemoteRelayTransport {
  const wire = createResilientWebSocketRemoteRelayWire({
    baseUrl: config.relayUrl,
    path: "/relay",
    credential: config.credential,
    webSocket: (url) => new WebSocket(url) as never,
    reconnect: { enabled: true, maxAttempts: 10, backoffMs: (attempt) => Math.min(1000, 100 * attempt) },
  });
  return new RemoteRelayTransport({ wire, credential: config.credential });
}

function capability(identity: BuddyIdentity): BuddyCapability {
  return {
    id: "research",
    providerId: identity.id,
    description: "独立进程研究能力",
    inputSchema: {},
    outputSchema: {},
    procedure: [],
    allowedDataScopes: ["public:brief"],
    forbiddenDataScopes: ["secret:prompt", "credential:vault"],
    allowedActions: ["read:public", "write:artifact"],
    forbiddenActions: ["external:send", "purchase"],
    acceptanceTests: [],
    requiredApproval: "never",
    allowDelegation: false,
    maxDelegationDepth: 0,
    visibility: "directory",
  };
}

async function runProvider(config: WorkerConfig): Promise<void> {
  const relay = transport(config);
  const runtime = new CollaborationRuntime({ relay, relayCapabilitySecret: config.relayCapabilitySecret, storagePath: config.storagePath, identity: config.identity, scope: config.scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
  await runtime.ready;
  const provider = new OrganizationCapabilityProvider({
    identity: config.identity,
    scope: config.scope,
    capabilities: [capability(config.identity)],
    runner: { runMember: async () => "independent provider result" },
  });
  const dispose = await runtime.registerRemoteProviderNetworkEndpoint(provider);
  emit({ type: "ready", role: config.role, identity: config.identity.id });
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const snapshot = runtime.snapshot().data;
      const evidence = snapshot.activity.find((event) => event.kind === "task.evidence_verified");
      if (evidence) {
        const evidenceTaskId = evidence.id.startsWith("evidence-") ? evidence.id.slice("evidence-".length) : undefined;
        const verifiedTask = snapshot.tasks.find((task) => task.taskId === evidenceTaskId);
        emit({ type: "verified", role: config.role, identity: config.identity.id, taskId: verifiedTask?.taskId ?? evidenceTaskId, executionRef: verifiedTask?.executionRef });
        return;
      }
      await delay(50);
    }
    emit({ type: "timeout", role: config.role, identity: config.identity.id });
    process.exitCode = 1;
  } finally {
    dispose();
    relay.close();
  }
}

async function runRequester(config: WorkerConfig): Promise<void> {
  const providerIdentity = config.providerIdentity;
  if (!providerIdentity) throw new Error("requester requires provider identity");
  const relay = transport(config);
  const runtime = new CollaborationRuntime({ relay, relayCapabilitySecret: config.relayCapabilitySecret, storagePath: config.storagePath, identity: config.identity, scope: config.scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
  await runtime.ready;
  emit({ type: "requester-started", role: config.role, identity: config.identity.id });
  runtime.registerNetworkPeer({ identity: providerIdentity, capabilities: [capability(providerIdentity)] });
  runtime.setNetworkPeerTrust(providerIdentity.id, "trusted");
  runtime.networkPublishOffer({ providerId: providerIdentity.id, capabilityId: "research", title: "独立进程研究", description: "跨进程公开资料研究", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
  const proposal = runtime.proposeCollaboration({ mode: "network", title: "跨进程公开研究", objective: "private requester objective that must never cross relay", capability: "research", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });
  emit({ type: "proposal-created", taskId: proposal.taskId });
  const offer = runtime.networkSnapshot().offers.find((entry) => entry.providerId === providerIdentity.id);
  if (!offer) throw new Error("network offer was not created");
  runtime.networkSubmitBid({ offerId: offer.id, proposalId: proposal.taskId, providerId: providerIdentity.id, message: "独立 provider 可以完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
  const bid = runtime.networkSnapshot().bids.find((entry) => entry.proposalId === proposal.taskId);
  if (!bid) throw new Error("network bid was not created");
  const delivery = await runtime.networkAwardBid(bid.id);
  const relayEvents = await relay.query({ ...config.scope, taskId: proposal.taskId });
  emit({ type: "awarded", role: config.role, identity: config.identity.id, taskId: proposal.taskId, executionRef: { ...proposal.executionRef, memberId: providerIdentity.id }, delivery, relayEvents });
  relay.close();
  if (delivery.status !== "delivered") process.exitCode = 1;
}

async function main(): Promise<void> {
  const raw = process.argv[2];
  if (!raw) throw new Error("worker config is required");
  const config = JSON.parse(raw) as WorkerConfig;
  if (config.role === "provider") await runProvider(config);
  else await runRequester(config);
}

void main().catch((error) => {
  emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
