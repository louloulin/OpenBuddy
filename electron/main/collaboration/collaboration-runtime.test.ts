import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CollaborationRuntime, type CollaborationUpdate } from "./collaboration-runtime";
import type { BuddyCapability, BuddyIdentity } from "@openbuddy/collaboration-protocol";
import { CallbackCapabilityProvider, OrganizationCapabilityProvider, OrganizationTaskExecutor, PersonalProviderRegistry, type TaskVerifier } from "@openbuddy/collaboration-coordinator";
import { agentCardKeyRef, attachRemoteRelayWebSocket, createWebSocketRemoteRelayWire, issueEd25519AgentCard, JsonAgentCardTrustStore, LocalRelay, MemoryAgentCardTrustStore, MemoryRemoteRelayPersistence, RemoteRelayServer, RemoteRelayTransport, verifyFederatedRoomGrant, type RelayWebSocketLike, type RemoteRelayCredential } from "@openbuddy/collaboration-network";
import type { BuddyTaskEnvelope } from "@openbuddy/collaboration-protocol";

class RuntimePairSocket implements RelayWebSocketLike {
	readonly readyState = 1;
	readonly OPEN = 1;
	readonly CONNECTING = 0;
	private readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
	private peer?: RuntimePairSocket;

	connect(peer: RuntimePairSocket): void { this.peer = peer; }
	send(data: string): void { queueMicrotask(() => { for (const listener of this.peer?.listeners.get("message") ?? []) listener({ data }); }); }
	close(): void { for (const listener of this.listeners.get("close") ?? []) listener({}); for (const listener of this.peer?.listeners.get("close") ?? []) listener({}); }
	addEventListener(type: string, listener: (event: { data?: unknown }) => void): void { const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners); }
	removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void { this.listeners.get(type)?.delete(listener); }
}

function runtimeSocketPair(): [RuntimePairSocket, RuntimePairSocket] {
	const client = new RuntimePairSocket();
	const server = new RuntimePairSocket();
	client.connect(server);
	server.connect(client);
	return [client, server];
}

function runtimeTransport(server: RemoteRelayServer, credential: RemoteRelayCredential): RemoteRelayTransport {
	const [client, relaySocket] = runtimeSocketPair();
	attachRemoteRelayWebSocket(relaySocket, server);
	return new RemoteRelayTransport({
		wire: createWebSocketRemoteRelayWire({ baseUrl: "http://runtime-relay.invalid", credential, webSocket: () => client }),
		credential,
	});
}

describe("local collaboration runtime", () => {
	it("routes external side effects through an approved, single-use intent", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-side-effect-"));
		const storagePath = join(root, "events.jsonl");
		const runtime = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const intent = runtime.createSideEffectIntent({ capability: "email:send", action: "external:send", summary: "发送测试邮件", fingerprint: "draft-fingerprint", approvedByUser: true });
		expect(intent.status).toBe("approved");
		expect(runtime.consumeSideEffectIntent(intent.intentId, "draft-fingerprint")).toMatchObject({ status: "consumed" });
		await expect(() => runtime.consumeSideEffectIntent(intent.intentId, "draft-fingerprint")).toThrow(/not granted|not executable/u);
		runtime.completeSideEffectIntent(intent.intentId, "receipt-1");
		await runtime.flushPendingIO();
		const restarted = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:01:00.000Z") });
		expect(restarted.snapshot().data.sideEffectIntents).toContainEqual(expect.objectContaining({ intentId: intent.intentId, status: "completed" }));
	});

	it("keeps side-effect intents pending until the linked approval is decided", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-side-effect-approval-"));
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl"), now: () => new Date("2026-08-30T12:00:00.000Z") });
		const intent = runtime.createSideEffectIntent({ capability: "automation:run", action: "task:execute", summary: "运行自动化", fingerprint: "automation-fingerprint" });
		expect(intent.status).toBe("pending");
		runtime.decideApproval({ approvalId: intent.approvalId, approved: false, reason: "需要人工复核" });
		expect(runtime.snapshot().data.sideEffectIntents).toContainEqual(expect.objectContaining({ intentId: intent.intentId, status: "rejected" }));
		await expect(() => runtime.consumeSideEffectIntent(intent.intentId, "automation-fingerprint")).toThrow(/not granted/u);
	});

	it("does not consume cancelled or expired side-effect intents", async () => {
		let now = new Date("2026-08-30T12:00:00.000Z");
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-side-effect-terminal-"));
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl"), now: () => now });
		const cancelled = runtime.createSideEffectIntent({ capability: "email:send", action: "external:send", summary: "已取消邮件", fingerprint: "cancelled", approvedByUser: true });
		runtime.cancelSideEffectIntent(cancelled.intentId, "用户撤回");
		expect(() => runtime.consumeSideEffectIntent(cancelled.intentId, "cancelled")).toThrow(/not granted|not executable/u);

		const expiring = runtime.createSideEffectIntent({ capability: "automation:run", action: "task:execute", summary: "即将过期自动化", fingerprint: "expired", expiresAt: "2026-08-30T12:01:00.000Z", approvedByUser: true });
		now = new Date("2026-08-30T12:02:00.000Z");
		expect(() => runtime.consumeSideEffectIntent(expiring.intentId, "expired")).toThrow(/expired/u);
		expect(runtime.snapshot().data.sideEffectIntents).toEqual(expect.arrayContaining([
			expect.objectContaining({ intentId: cancelled.intentId, status: "cancelled" }),
			expect.objectContaining({ intentId: expiring.intentId, status: "expired" }),
		]));
	});

	it("revalidates signed Agent Cards after runtime restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-agent-card-"));
		const storagePath = join(root, "events.jsonl");
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const keyRef = agentCardKeyRef(publicKey);
		const peer: BuddyIdentity = { id: "signed-peer", handle: "signed-peer", displayName: "Signed Peer", ownerUserId: "peer-user", organizationId: "local-organization", publicKeyRef: keyRef, trustLevel: "known_peer", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: peer.id, description: "公开研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["private:vault"], allowedActions: ["read:public"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		const card = issueEd25519AgentCard({ protocol: "agent-card/1", identity: peer, communityId: "local-community", capabilities: [{ id: capability.id, description: capability.description, acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never" }], endpoints: ["local://signed-peer"], issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }, privateKey, keyRef);
		const trustStore = new JsonAgentCardTrustStore(join(root, "agent-card-trust.json"));
		trustStore.add(publicKey, "2026-08-30T12:00:00.000Z");
		const first = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z"), agentCardTrustStore: trustStore });
		first.registerNetworkPeer({ identity: peer, capabilities: [capability], agentCard: card });
		first.setNetworkPeerTrust(peer.id, "known");
		expect(first.networkSnapshot().peers[0]).toMatchObject({ agentCardStatus: "verified" });
		await first.flushPendingIO();
		const directory = JSON.parse(await readFile(join(root, "agent-directory.json"), "utf8")) as { version: number; peers: Array<{ identity: BuddyIdentity; trust: string; agentCard?: unknown }> };
		expect(directory).toMatchObject({ version: 1, peers: [{ identity: { id: peer.id }, trust: "known", agentCard: expect.any(Object) }] });
		expect(JSON.stringify(directory)).not.toContain("PRIVATE KEY");
		const withoutTrustRoot = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z"), agentCardTrustStore: new MemoryAgentCardTrustStore() });
		expect(withoutTrustRoot.networkSnapshot().peers[0]).toMatchObject({ agentCardStatus: "unverified" });
		const restarted = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z") });
		expect(restarted.networkSnapshot().peers[0]).toMatchObject({ agentCardStatus: "verified" });
		const restartedDirectory = JSON.parse(await readFile(join(root, "agent-directory.json"), "utf8")) as { peers: Array<{ identity: BuddyIdentity; trust: string }> };
		expect(restartedDirectory.peers).toEqual(expect.arrayContaining([expect.objectContaining({ identity: expect.objectContaining({ id: peer.id }), trust: "known" })]));
	});

	it("projects trust-root add and revoke through the Main-owned runtime", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-trust-root-api-"));
		const trustStore = new JsonAgentCardTrustStore(join(root, "agent-card-trust.json"));
		const { publicKey } = generateKeyPairSync("ed25519");
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl"), agentCardTrustStore: trustStore });
		const added = runtime.addAgentCardTrustRoot(publicKey.export({ format: "pem", type: "spki" }).toString());
		expect(runtime.networkSnapshot().trustRoots).toEqual([added]);
		expect(runtime.agentCardTrustRoots()).toEqual([added]);
		expect(runtime.revokeAgentCardTrustRoot(added.keyRef)).toEqual([expect.objectContaining({ keyRef: added.keyRef, revokedAt: expect.any(String) })]);
		expect(runtime.networkSnapshot().trustRoots[0]).toMatchObject({ keyRef: added.keyRef, revokedAt: expect.any(String) });
	});

	it("exposes a scoped, redacted projection for the assistant workbench", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-projection-"));
		const snapshot = new CollaborationRuntime({ storagePath: join(root, "events.jsonl") }).snapshot().data;

		expect(snapshot.protocol).toBe("buddy/1.0");
		expect(snapshot.mode).toBe("local-first");
		expect(snapshot.identity).toMatchObject({ id: "buddy-local", displayName: "我的 Buddy", status: "idle" });
		expect(snapshot.collaborationManifest?.capabilities.map((capability) => capability.id)).toContain("side-effects");
		expect(snapshot.rooms).toHaveLength(1);
		expect(snapshot.rooms[0]).toMatchObject({ room: { id: "personal-room", visibility: "private" }, memberCount: 1 });
		expect(snapshot.rooms[0].room.members).toHaveLength(1);
		expect(snapshot.activity.map((event) => event.kind)).toEqual(["agent.presence", "room.created"]);
		expect(snapshot.inbox).toEqual([]);
		expect(snapshot.tasks).toEqual([]);
	});

	it("persists task proposals as idempotent, redacted events and rebuilds them", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-"));
		const storagePath = join(root, "events.jsonl");
		const first = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const proposed = first.proposeTask({ title: "整理会议", objective: "这是不应进入投影的完整私密 prompt", capability: "calendar" });
		const snapshot = first.snapshot().data;

		expect(snapshot.tasks).toEqual([expect.objectContaining({ taskId: proposed.taskId, status: "proposed", title: "整理会议" })]);
		expect(proposed.executionRef).toEqual({ executionId: `execution:${proposed.taskId}`, taskId: proposed.taskId, workflowId: `workflow:${proposed.taskId}`, stepId: `step:${proposed.taskId}:root`, teamId: `team:${proposed.taskId}` });
		expect(snapshot.tasks[0]?.executionRef).toEqual(proposed.executionRef);
		expect(snapshot.inbox).toEqual([expect.objectContaining({ kind: "incoming", taskId: proposed.taskId, summary: "整理会议" })]);
		await first.flushPendingIO();
		const persisted = await readFile(storagePath, "utf8");
		expect(persisted).not.toContain("完整私密 prompt");

		const rebuilt = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:01:00.000Z") }).snapshot().data;
		expect(rebuilt.tasks).toEqual(snapshot.tasks);
		expect(rebuilt.activity.filter((event) => event.kind === "task.proposed")).toHaveLength(1);
	});

	it("persists inbox acknowledgements across runtime rebuilds", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-cursor-"));
		const storagePath = join(root, "events.jsonl");
		const first = new CollaborationRuntime({ storagePath });
		const proposed = first.proposeTask({ title: "确认事项", objective: "读取当前状态并确认" });
		const eventId = first.snapshot().data.inbox.find((item) => item.taskId === proposed.taskId)?.eventId;
		expect(eventId).toBeDefined();
		first.ackInbox(eventId!);
		await first.flushPendingIO();
		expect(new CollaborationRuntime({ storagePath }).snapshot().data.inbox.find((item) => item.eventId === eventId)?.read).toBe(true);
	});

	it("emits redacted update metadata and supports unsubscribe", () => {
		const runtime = new CollaborationRuntime({ storagePath: "/tmp/openbuddy-collaboration-update-test.jsonl", now: () => new Date("2026-08-30T12:00:00.000Z") });
		const updates: CollaborationUpdate[] = [];
		const dispose = runtime.onUpdate((update) => updates.push(update));
		const proposed = runtime.proposeTask({ title: "更新通知", objective: "不可公开的完整任务目标" });
		expect(updates).toContainEqual(expect.objectContaining({ eventId: expect.any(String), kind: "task.proposed", taskId: proposed.taskId, roomId: "personal-room" }));
		expect(JSON.stringify(updates)).not.toContain("不可公开的完整任务目标");
		dispose();
		runtime.proposeTask({ title: "取消订阅", objective: "不会再推送" });
		expect(updates).toHaveLength(1);
	});

	it("keeps capability cards contract-shaped without provider paths or credentials", () => {
		const runtime = new CollaborationRuntime({ storagePath: "/tmp/openbuddy-collaboration-capability-test.jsonl" });
		runtime.setCapabilityCards([{
			id: "pi-skill:research",
			name: "research",
			source: "pi-skill",
			visibility: "local",
			status: "available",
			contract: { input: "context-refs", output: "artifact-or-message", approval: "before-external-commit" },
		}]);
		const snapshot = runtime.snapshot().data;
		expect(snapshot.capabilityCards).toEqual([expect.objectContaining({ id: "pi-skill:research", name: "research" })]);
		expect(JSON.stringify(snapshot.capabilityCards)).not.toMatch(/\/Users|token|secret|credential/i);
		expect(snapshot.policy.forbiddenActions).toContain("external:send");
	});

	it("projects shared email threads as local room messages", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-email-"));
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl") });
		const shared = runtime.shareEmailThread({ accountId: "gmail:a1", threadId: "thread-1", channelId: "work", subject: "报价", message: "请跟进" });
		const snapshot = runtime.snapshot().data;
		expect(shared.channelId).toBe("work");
		expect(snapshot.activity.some((event) => event.id === shared.eventId && event.kind === "room.message")).toBe(true);
		expect(snapshot.inbox.some((item) => item.eventId === shared.eventId && item.kind === "message")).toBe(true);
		expect(snapshot.inbox.find((item) => item.eventId === shared.eventId)).toMatchObject({ source: "email", emailAccountId: "gmail:a1", emailThreadId: "thread-1" });
	});

	it("persists organization approvals, delegation revocation, and task takeover", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-org-"));
		const storagePath = join(root, "events.jsonl");
		const first = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const member = first.addOrganizationMember({ id: "buddy-org-2", handle: "worker", displayName: "Worker", ownerUserId: "user-2" });
		const grant = first.grantOrganizationDelegation({ granteeId: member.identity.id, allowedCapabilities: ["research"], allowedDataScopes: ["room:personal-room"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const task = first.proposeTask({ title: "组织协作任务", objective: "一个足够长的组织协作目标描述", capability: "research" });
		const approval = first.requestApproval({ taskId: task.taskId, actions: ["external:send"], reason: "发送前人工确认" });
		first.decideApproval({ approvalId: approval.id, approved: true, reason: "已确认" });
		first.revokeOrganizationDelegation(grant.id);
		first.controlTask({ taskId: task.taskId, action: "takeover", reason: "执行体超时" });

		await first.flushPendingIO();
		const rebuilt = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:01:00.000Z") }).snapshot().data;
		expect(rebuilt.organization.members.some((entry) => entry.identity.id === member.identity.id)).toBe(true);
		expect(rebuilt.organization.delegations.find((entry) => entry.id === grant.id)?.revokedAt).toBeDefined();
		expect(rebuilt.organization.approvals.find((entry) => entry.id === approval.id)).toMatchObject({ status: "approved" });
		expect(rebuilt.organization.taskControls).toContainEqual(expect.objectContaining({ taskId: task.taskId, state: "taken_over" }));
	});

	it("uses one redacted command contract for personal, organization, and network work", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-command-"));
		const storagePath = join(root, "events.jsonl");
		const runtime = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z") });

		const personal = runtime.proposeCollaboration({ mode: "personal", title: "个人整理", objective: "整理本地工作事项", capability: "planning" });
		const organization = runtime.proposeCollaboration({ mode: "organization", title: "组织研究", objective: "组织成员共同研究一个主题", capability: "research", projectId: "project-research" });
		const network = runtime.proposeCollaboration({ mode: "network", title: "开放研究", objective: "这是不应写入事件的完整私密目标", capability: "research", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });

		expect(personal).toMatchObject({ mode: "personal", status: "proposed", contract: { execution: "local" } });
		expect(organization).toMatchObject({ mode: "organization", status: "proposed", contract: { execution: "organization-provider" } });
		expect(network).toMatchObject({ mode: "network", status: "proposed", contract: { execution: "network-proposal" } });
		expect(personal.executionRef).toMatchObject({ taskId: personal.taskId, workflowId: `workflow:${personal.taskId}`, stepId: `step:${personal.taskId}:root` });
		expect(organization.executionRef).toMatchObject({ taskId: organization.taskId, teamId: `team:${organization.taskId}` });
		expect(network.executionRef).toMatchObject({ taskId: network.taskId, executionId: `execution:${network.taskId}` });
		expect(runtime.snapshot().data.tasks.find((task) => task.taskId === organization.taskId)?.executionRef).toEqual(organization.executionRef);
		expect(organization.projectId).toBe("project-research");
		expect(network.projectId).toBeUndefined();
		expect(runtime.snapshot().data.tasks.find((task) => task.taskId === organization.taskId)?.projectId).toBe("project-research");
		await runtime.flushPendingIO();
		const persisted = await readFile(storagePath, "utf8");
		expect(persisted).not.toContain("完整私密目标");
		expect(runtime.snapshot().data.network.proposals).toContainEqual(expect.objectContaining({ id: network.taskId, objectiveDigest: expect.any(String), status: "open" }));
	});

	it("persists workflow DAG projections and rejects invalid dependencies", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-workflow-"));
		const storagePath = join(root, "events.jsonl");
		const runtime = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const workflow = runtime.proposeWorkflow({
			title: "研究交付流水线",
			mode: "personal",
			nodes: [
				{ id: "research", objective: "完成资料研究" },
				{ id: "brief", objective: "形成研究简报", dependsOn: ["research"] },
			],
		});
		expect(workflow).toMatchObject({ title: "研究交付流水线", status: "proposed", nodes: [{ id: "research", status: "pending" }, { id: "brief", dependsOn: ["research"], status: "pending" }] });
		expect(runtime.snapshot().data.workflows).toContainEqual(workflow);
		await runtime.flushPendingIO();
		const rebuilt = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:01:00.000Z") });
		expect(rebuilt.workflowStatus(workflow.workflowId)).toEqual(workflow);
		expect(() => runtime.proposeWorkflow({ title: "非法", mode: "personal", nodes: [{ id: "a", dependsOn: ["missing"] }] })).toThrow(/dependency/u);
	});

	it("binds workflow nodes to active organization Buddies and preserves the routing projection", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-agent-routing-"));
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl") });
		runtime.addOrganizationMember({ id: "org-writer", handle: "writer", displayName: "Writer Buddy", ownerUserId: "user-2" });
		const workflow = runtime.proposeWorkflow({
			title: "组织周报",
			mode: "organization",
			projectId: "project-report",
			nodes: [{ id: "prepare", objective: "汇总资料", agentRef: { type: "organization-buddy", id: "org-writer" } }],
		});
		expect(workflow.nodes[0]).toMatchObject({ agentRef: { type: "organization-buddy", id: "org-writer" }, projectId: "project-report" });
		await runtime.flushPendingIO();
		const rebuilt = new CollaborationRuntime({ storagePath: join(root, "events.jsonl") });
		expect(rebuilt.workflowStatus(workflow.workflowId).nodes[0]?.agentRef).toEqual({ type: "organization-buddy", id: "org-writer" });
		expect(() => runtime.proposeWorkflow({ title: "非法组织流程", mode: "organization", nodes: [{ id: "prepare", agentRef: { type: "organization-buddy", id: "inactive" } }] })).toThrow(/active organization member/u);
	});

	it("keeps project context as bounded references instead of copying project content", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-context-"));
		const storagePath = join(root, "events.jsonl");
		const runtime = new CollaborationRuntime({ storagePath });
		const result = runtime.proposeCollaboration({ mode: "personal", title: "项目交付", objective: "生成项目交付摘要", projectId: "project-1", contextRefs: ["project:project-1:instructions", "project:project-1:selected-resources", "完整项目内容不应写入合同"] });
		await runtime.flushPendingIO();
		const contracts = await readFile(`${storagePath}.contracts.json`, "utf8");
		expect(result.projectId).toBe("project-1");
		expect(contracts).toContain("project:project-1:instructions");
		expect(contracts).not.toContain("完整项目内容不应写入合同");
	});

	it("gives each project and mode an isolated room while the assistant aggregates them", () => {
		const runtime = new CollaborationRuntime({ storagePath: "/tmp/openbuddy-project-room-isolation.jsonl" });
		const first = runtime.proposeCollaboration({ mode: "personal", title: "项目一任务", objective: "只属于项目一", projectId: "project-one" });
		const second = runtime.proposeCollaboration({ mode: "personal", title: "项目二任务", objective: "只属于项目二", projectId: "project-two" });
		const organization = runtime.proposeCollaboration({ mode: "organization", title: "项目一组织任务", objective: "组织边界属于项目一", projectId: "project-one" });

		expect(first.roomId).not.toBe(second.roomId);
		expect(first.roomId).not.toBe(organization.roomId);
		expect(runtime.snapshot().data.rooms.map((entry) => entry.room.id)).toEqual(expect.arrayContaining([first.roomId, second.roomId, organization.roomId]));
		expect(runtime.snapshot().data.tasks.map((task) => task.roomId)).toEqual(expect.arrayContaining([first.roomId, second.roomId, organization.roomId]));
		expect(runtime.snapshot().data.policy.dataScopes).toEqual(expect.arrayContaining([`room:${first.roomId}`, `room:${second.roomId}`, `room:${organization.roomId}`]));
		expect(runtime.snapshot().data.rooms.find((entry) => entry.room.id === first.roomId)?.room.policy).toMatchObject({ visibility: "private", allowedTrustLevels: ["local"] });
		expect(runtime.snapshot().data.rooms.find((entry) => entry.room.id === organization.roomId)?.room.policy).toMatchObject({ visibility: "org", allowedTrustLevels: ["local", "org"] });
	});

	it("issues, restores, expires, and revokes exact federated project-room grants", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-federated-grant-runtime-test-"));
		const storagePath = join(root, "events.jsonl");
		const now = () => new Date("2026-08-30T12:00:00.000Z");
		const first = new CollaborationRuntime({ storagePath, now, grantSigningSecret: "test-grant-secret" });
		const task = first.proposeCollaboration({ mode: "organization", title: "跨组织报告", objective: "为指定项目生成一个跨 Buddy 报告", capability: "research", projectId: "project-federated" });
		const grant = first.issueFederatedRoomGrant({ projectId: "project-federated", roomId: task.roomId, taskId: task.taskId, principalId: "external-provider-buddy", allowedCapabilities: ["research"], allowedDataScopes: ["public:brief"], allowedActions: ["read:room", "write:artifact"], allowedOperations: ["task.send", "events.query"], expiresAt: "2026-08-30T13:00:00.000Z" });
		expect(grant).toMatchObject({ projectId: "project-federated", roomId: task.roomId, taskId: task.taskId, status: "active" });
		await first.flushPendingIO();
		const rebuilt = new CollaborationRuntime({ storagePath, now, grantSigningSecret: "test-grant-secret" });
		expect(rebuilt.snapshot().data.federatedRoomGrants).toContainEqual(grant);
		const revoked = rebuilt.revokeFederatedRoomGrant(grant.grantId);
		expect(revoked).toMatchObject({ grantId: grant.grantId, status: "revoked", revokedAt: expect.any(String) });
		await rebuilt.flushPendingIO();
		const afterRevoke = new CollaborationRuntime({ storagePath, now, grantSigningSecret: "test-grant-secret" }).snapshot().data;
		expect(afterRevoke.federatedRoomGrants.find((entry) => entry.grantId === grant.grantId)?.status).toBe("revoked");
		const expired = first.issueFederatedRoomGrant({ projectId: "project-federated", roomId: task.roomId, principalId: "external-provider-buddy", allowedCapabilities: ["research"], allowedDataScopes: ["public:brief"], allowedActions: ["read:room"], allowedOperations: ["events.query"], expiresAt: "2026-08-30T12:00:01.000Z" });
		await first.flushPendingIO();
		const expiredRuntime = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:01:00.000Z"), grantSigningSecret: "test-grant-secret" });
		expect(expiredRuntime.snapshot().data.federatedRoomGrants.find((entry) => entry.grantId === expired.grantId)?.status).toBe("expired");
	});

	it("uses a persistent Ed25519 grant key by default", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-ed25519-grant-runtime-"));
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl"), now: () => new Date("2026-08-30T12:00:00.000Z") });
		const task = runtime.proposeCollaboration({ mode: "organization", title: "签名项目授权", objective: "验证默认非对称授权", capability: "research", projectId: "project-signed" });
		const projection = runtime.issueFederatedRoomGrant({ projectId: "project-signed", roomId: task.roomId, taskId: task.taskId, principalId: "external-provider-buddy", allowedCapabilities: ["research"], allowedDataScopes: ["public:brief"], allowedActions: ["read:room"], allowedOperations: ["task.send"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const grant = runtime.getFederatedRoomGrantForRelay(projection.grantId);
		expect(grant.signature?.algorithm).toBe("Ed25519");
		await runtime.flushPendingIO();
		const restarted = new CollaborationRuntime({ storagePath: join(root, "events.jsonl"), now: () => new Date("2026-08-30T12:00:00.000Z") });
		expect(restarted.getFederatedRoomGrantForRelay(projection.grantId).signature?.keyRef).toBe(grant.signature?.keyRef);
	});

	it("allows organization members into team rooms but keeps the personal room private", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-room-members-"));
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl") });
		const member = runtime.addOrganizationMember({ id: "room-member", handle: "room-member", displayName: "Room Member", ownerUserId: "user-2" });
		const task = runtime.proposeCollaboration({ mode: "organization", title: "组织 Room 任务", objective: "共享组织上下文", projectId: "room-project" });

		expect(runtime.addOrganizationRoomMember({ roomId: task.roomId!, principalId: member.identity.id, role: "observer" })).toMatchObject({ principalId: member.identity.id, role: "observer" });
		expect(runtime.snapshot().data.rooms.find((entry) => entry.room.id === task.roomId)?.room.members).toContainEqual(expect.objectContaining({ principalId: member.identity.id, role: "observer", active: true }));
		expect(() => runtime.addOrganizationRoomMember({ roomId: "personal-room", principalId: member.identity.id })).toThrow(/organization project room/u);
		expect(runtime.removeOrganizationRoomMember({ roomId: task.roomId!, principalId: member.identity.id })).toMatchObject({ principalId: member.identity.id, active: false });
	});

	it("keeps project-scoped network tasks pending until a precise room grant exists", () => {
		const runtime = new CollaborationRuntime({ storagePath: "/tmp/openbuddy-network-project-room.jsonl", grantSigningSecret: "project-network-test-secret" });
		const result = runtime.proposeCollaboration({ mode: "network", title: "网络项目任务", objective: "等待跨组织项目 Room", projectId: "project-network", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2099-01-01T00:00:00.000Z" });
		expect(result.projectId).toBe("project-network");
		expect(result.roomId).toMatch(/^project-/u);
		expect(runtime.snapshot().data.rooms.some((entry) => entry.room.id === result.roomId && entry.room.kind === "team")).toBe(true);
	});

	it("delivers a project-scoped network task through a grant-bound provider endpoint", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-project-network-grant-e2e-"));
		const relay = new LocalRelay();
		const scope = { communityId: "shared-community", organizationId: "shared-organization", roomId: "personal-room" };
		const secret = "shared-project-network-grant-secret";
		const requesterIdentity: BuddyIdentity = { id: "project-requester", handle: "project-requester", displayName: "Project Requester", ownerUserId: "requester-user", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const providerIdentity: BuddyIdentity = { id: "project-provider", handle: "project-provider", displayName: "Project Provider", ownerUserId: "provider-user", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: providerIdentity.id, description: "项目网络研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		const provider = new OrganizationCapabilityProvider({ identity: providerIdentity, scope: { ...scope, roomId: "project-placeholder" }, capabilities: [capability], allowProjectRooms: true, runner: { runMember: async () => "project provider result" } });
		const requester = new CollaborationRuntime({ storagePath: join(root, "requester.events.jsonl"), localRelay: relay, identity: requesterIdentity, scope, grantSigningSecret: secret, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const providerRuntime = new CollaborationRuntime({ storagePath: join(root, "provider.events.jsonl"), localRelay: relay, identity: providerIdentity, scope, grantSigningSecret: secret, now: () => new Date("2026-08-30T12:00:00.000Z") });
		requester.registerNetworkPeer({ identity: providerIdentity, capabilities: [capability] });
		requester.setNetworkPeerTrust(providerIdentity.id, "trusted");
		requester.networkPublishOffer({ providerId: providerIdentity.id, capabilityId: capability.id, title: "项目研究", description: "项目范围内研究", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
		const proposal = requester.proposeCollaboration({ mode: "network", title: "项目网络研究", objective: "在项目 Room 内完成公开研究", capability: capability.id, projectId: "project-granted", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const offer = requester.networkSnapshot().offers[0];
		requester.networkSubmitBid({ offerId: offer.id, proposalId: proposal.taskId, providerId: providerIdentity.id, message: "项目 Provider 可以完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
		const bid = requester.networkSnapshot().bids[0];
		const grantProjection = requester.issueFederatedRoomGrant({ projectId: "project-granted", roomId: proposal.roomId, taskId: proposal.taskId, principalId: providerIdentity.id, providerOrganizationId: providerIdentity.organizationId, allowedCapabilities: [capability.id], allowedDataScopes: ["public:brief"], allowedActions: capability.allowedActions, allowedOperations: ["endpoint.register", "task.send", "events.query"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const grant = requester.getFederatedRoomGrantForRelay(grantProjection.grantId);
		const disposeProvider = providerRuntime.registerProviderNetworkEndpoint(provider, providerIdentity, grant);
		const delivery = await requester.networkAwardBid(bid.id);
		expect(delivery).toMatchObject({ providerId: providerIdentity.id });
		expect(delivery.status, delivery.reason).toBe("delivered");
		expect(providerRuntime.snapshot().data.activity.some((event) => event.kind === "task.evidence_verified" && event.roomId === proposal.roomId)).toBe(true);
		disposeProvider();
	});

	it("issues a cross-organization federated Room Grant with providerOrganizationId captured and preserves it across restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-cross-org-grant-issue-"));
		const storagePath = join(root, "events.jsonl");
		const requesterOrg = "org-requester";
		const providerOrg = "org-provider";
		const sharedCommunity = "shared-community";
		const scope = { communityId: sharedCommunity, organizationId: requesterOrg, roomId: "personal-room" };
		const secret = "cross-org-grant-secret";
		const requesterIdentity: BuddyIdentity = { id: "cross-org-requester", handle: "cross-org-requester", displayName: "Cross-Org Requester", ownerUserId: "requester-user", organizationId: requesterOrg, trustLevel: "org", status: "idle" };
		const providerIdentity: BuddyIdentity = { id: "cross-org-provider", handle: "cross-org-provider", displayName: "Cross-Org Provider", ownerUserId: "provider-user", organizationId: providerOrg, trustLevel: "org", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: providerIdentity.id, description: "跨组织研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		const now = () => new Date("2026-08-30T12:00:00.000Z");
		const requester = new CollaborationRuntime({ storagePath, identity: requesterIdentity, scope, grantSigningSecret: secret, now });
		requester.registerNetworkPeer({ identity: providerIdentity, capabilities: [capability] });
		requester.setNetworkPeerTrust(providerIdentity.id, "trusted");
		const task = requester.proposeCollaboration({ mode: "organization", title: "跨组织项目研究", objective: "为跨组织 Provider 创建一个项目 Room", capability: capability.id, projectId: "project-cross-org", dataScopes: ["public:brief"], artifactTypes: ["brief"] });
		const grantProjection = requester.issueFederatedRoomGrant({ projectId: "project-cross-org", roomId: task.roomId, taskId: task.taskId, principalId: providerIdentity.id, providerOrganizationId: providerOrg, allowedCapabilities: [capability.id], allowedDataScopes: ["public:brief"], allowedActions: capability.allowedActions, allowedOperations: ["endpoint.register", "task.send", "events.query"], expiresAt: "2026-08-30T13:00:00.000Z" });
		expect(grantProjection).toMatchObject({ projectId: "project-cross-org", roomId: task.roomId, taskId: task.taskId, status: "active" });
		expect(grantProjection.providerOrganizationId).toBe(providerOrg);
		expect(grantProjection.allowedPrincipals).toContain(providerIdentity.id);
		expect(grantProjection.allowedCapabilities).toContain(capability.id);
		expect(grantProjection.allowedOperations).toEqual(expect.arrayContaining(["endpoint.register", "task.send", "events.query"]));
		const grant = requester.getFederatedRoomGrantForRelay(grantProjection.grantId);
		expect(grant.providerOrganizationId).toBe(providerOrg);
		expect(grant.organizationId).toBe(requesterOrg);
		expect(grant.allowedPrincipals).toContain(providerIdentity.id);
		await requester.flushPendingIO();
		const rebuilt = new CollaborationRuntime({ storagePath, identity: requesterIdentity, scope, grantSigningSecret: secret, now });
		const restoredGrant = rebuilt.snapshot().data.federatedRoomGrants.find((entry) => entry.grantId === grantProjection.grantId);
		expect(restoredGrant).toMatchObject({ projectId: "project-cross-org", status: "active", providerOrganizationId: providerOrg });
		expect(restoredGrant?.allowedPrincipals).toContain(providerIdentity.id);
		const revoked = await rebuilt.revokeFederatedRoomGrant(grantProjection.grantId);
		expect(revoked.status).toBe("revoked");
		await rebuilt.flushPendingIO();
		const finalSnapshot = new CollaborationRuntime({ storagePath, identity: requesterIdentity, scope, grantSigningSecret: secret, now }).snapshot().data;
		expect(finalSnapshot.federatedRoomGrants.find((entry) => entry.grantId === grantProjection.grantId)?.status).toBe("revoked");
	});

	it("delivers a cross-organization network task end-to-end through a federated Room Grant", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-cross-org-e2e-delivery-"));
		const relay = new LocalRelay();
		const sharedCommunity = "shared-community";
		const requesterOrg = "org-requester";
		const providerOrg = "org-provider";
		const sharedSecret = "cross-org-e2e-delivery-secret";
		const now = () => new Date("2026-08-30T12:00:00.000Z");
		const requesterIdentity: BuddyIdentity = { id: "cross-org-e2e-requester", handle: "cross-org-e2e-requester", displayName: "Cross-Org E2E Requester", ownerUserId: "requester-user", organizationId: requesterOrg, trustLevel: "org", status: "idle" };
		const providerIdentity: BuddyIdentity = { id: "cross-org-e2e-provider", handle: "cross-org-e2e-provider", displayName: "Cross-Org E2E Provider", ownerUserId: "provider-user", organizationId: providerOrg, trustLevel: "org", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: providerIdentity.id, description: "跨组织端到端研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		const provider = new OrganizationCapabilityProvider({ identity: providerIdentity, scope: { communityId: sharedCommunity, organizationId: providerOrg, roomId: "project-placeholder" }, capabilities: [capability], allowProjectRooms: true, runner: { runMember: async () => "cross-org e2e provider result" } });
		const requester = new CollaborationRuntime({ storagePath: join(root, "requester.events.jsonl"), localRelay: relay, identity: requesterIdentity, scope: { communityId: sharedCommunity, organizationId: requesterOrg, roomId: "personal-room" }, grantSigningSecret: sharedSecret, now });
		const providerRuntime = new CollaborationRuntime({ storagePath: join(root, "provider.events.jsonl"), localRelay: relay, identity: providerIdentity, scope: { communityId: sharedCommunity, organizationId: providerOrg, roomId: "personal-room" }, grantSigningSecret: sharedSecret, now });
		requester.registerNetworkPeer({ identity: providerIdentity, capabilities: [capability] });
		requester.setNetworkPeerTrust(providerIdentity.id, "trusted");
		requester.networkPublishOffer({ providerId: providerIdentity.id, capabilityId: capability.id, title: "跨组织研究", description: "跨组织项目范围", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
		const proposal = requester.proposeCollaboration({ mode: "network", title: "跨组织端到端项目", objective: "在跨组织项目 Room 内完成端到端研究", capability: capability.id, projectId: "project-cross-org-e2e", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const offer = requester.networkSnapshot().offers[0];
		requester.networkSubmitBid({ offerId: offer.id, proposalId: proposal.taskId, providerId: providerIdentity.id, message: "跨组织 Provider 可完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
		const bid = requester.networkSnapshot().bids[0];
		const grantProjection = requester.issueFederatedRoomGrant({ projectId: "project-cross-org-e2e", roomId: proposal.roomId, taskId: proposal.taskId, principalId: providerIdentity.id, providerOrganizationId: providerOrg, allowedCapabilities: [capability.id], allowedDataScopes: ["public:brief"], allowedActions: capability.allowedActions, allowedOperations: ["endpoint.register", "task.send", "events.query"], expiresAt: "2026-08-30T13:00:00.000Z" });
		expect(grantProjection).toMatchObject({ projectId: "project-cross-org-e2e", status: "active", providerOrganizationId: providerOrg });
		const grant = requester.getFederatedRoomGrantForRelay(grantProjection.grantId);
		expect(grant.providerOrganizationId).toBe(providerOrg);
		const disposeProvider = providerRuntime.registerProviderNetworkEndpoint(provider, providerIdentity, grant);
		const delivery = await requester.networkAwardBid(bid.id);
		expect(delivery).toMatchObject({ providerId: providerIdentity.id });
		expect(delivery.status, delivery.reason).toBe("delivered");
		expect(providerRuntime.snapshot().data.activity.some((event) => event.kind === "task.evidence_verified" && event.roomId === proposal.roomId)).toBe(true);
		disposeProvider();
	});




	it("executes an organization Buddy through an independent verifier and persists evidence", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-execution-"));
		const storagePath = join(root, "events.jsonl");
		const providerIdentity: BuddyIdentity = { id: "buddy-org-runner", handle: "runner", displayName: "Runner", ownerUserId: "local-user", organizationId: "local-organization", trustLevel: "org", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: providerIdentity.id, description: "研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:personal-room"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:room", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: true, maxDelegationDepth: 1, visibility: "org" };
		const runtime = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z") });
		runtime.setOrganizationProvider(new OrganizationCapabilityProvider({
			identity: providerIdentity,
			scope: { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" },
			capabilities: [capability],
			runner: { runMember: async () => ({ text: "研究交付", sessionId: "pi-session-runtime" }) },
		}));
		runtime.setCapabilityCards([{
			id: "pi-skill:local-only",
			name: "local-only",
			source: "pi-skill",
			visibility: "local",
			status: "available",
			contract: { input: "context-refs", output: "artifact-or-message", approval: "before-external-commit" },
		}]);
		const proposed = runtime.proposeCollaboration({ mode: "organization", title: "组织研究", objective: "分析组织资料", capability: capability.id, artifactTypes: ["brief"] });
		const result = await runtime.executeOrganizationTask(proposed.taskId);
		expect(result).toMatchObject({ taskId: proposed.taskId, status: "accepted", providerId: providerIdentity.id, evidenceCount: 1 });
		expect(result.executionRef).toMatchObject({ taskId: proposed.taskId, sessionId: "pi-session-runtime" });
		expect(runtime.snapshot().data.tasks.find((task) => task.taskId === proposed.taskId)?.executionRef).toMatchObject({ taskId: proposed.taskId, sessionId: "pi-session-runtime" });
		expect(runtime.snapshot().data.tasks.find((task) => task.taskId === proposed.taskId)?.mode).toBe("organization");
		expect(runtime.snapshot().data.activity.map((entry) => entry.kind)).toContain("task.evidence_verified");
		await runtime.flushPendingIO();
		const persisted = await readFile(storagePath, "utf8");
		expect(persisted).toContain("pi-session-runtime");
		expect(persisted).not.toContain("分析组织资料");
	});

	it("executes project-scoped work inside its Project Room", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-project-room-execution-"));
		const storagePath = join(root, "events.jsonl");
		const providerIdentity: BuddyIdentity = { id: "buddy-project-runner", handle: "project-runner", displayName: "项目执行 Buddy", ownerUserId: "local-user", organizationId: "local-organization", trustLevel: "org", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: providerIdentity.id, description: "项目研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:project-*"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:room", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: true, maxDelegationDepth: 1, visibility: "org" };
		const runtime = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z") });
		runtime.setOrganizationProvider(new OrganizationCapabilityProvider({
			identity: providerIdentity,
			scope: { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" },
			allowProjectRooms: true,
			capabilities: [capability],
			runner: { runMember: async () => "项目交付" },
		}));
		const proposed = runtime.proposeCollaboration({ mode: "organization", title: "项目研究", objective: "只读取项目 Room", capability: capability.id, projectId: "project-scoped", artifactTypes: ["brief"] });
		const result = await runtime.executeCollaborationTask(proposed.taskId);

		expect(result.status).toBe("accepted");
		expect(proposed.roomId).toMatch(/^project-/u);
		expect(runtime.snapshot().data.activity.filter((event) => event.taskId === proposed.taskId).map((event) => ({ kind: event.kind, roomId: event.roomId }))).toEqual(expect.arrayContaining([{ kind: "task.proposed", roomId: proposed.roomId }]));
	});

	it("restores project Room members across runtime rebuilds", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-project-room-members-"));
		const storagePath = join(root, "events.jsonl");
		const first = new CollaborationRuntime({ storagePath });
		first.proposeCollaboration({ mode: "organization", title: "成员任务", objective: "验证成员 Room", projectId: "project-members" });
		const member = first.addOrganizationMember({ id: "buddy-member", handle: "member", displayName: "项目成员", ownerUserId: "member-user" });
		const roomId = first.snapshot().data.tasks.find((task) => task.projectId === "project-members")?.roomId;
		expect(roomId).toBeDefined();
		first.addOrganizationRoomMember({ roomId: roomId!, principalId: member.identity.id });
		expect(first.snapshot().data.rooms.find((entry) => entry.room.id === roomId)?.room.members).toEqual(expect.arrayContaining([expect.objectContaining({ principalId: member.identity.id })]));

		await first.flushPendingIO();
		const rebuilt = new CollaborationRuntime({ storagePath });
		expect(rebuilt.snapshot().data.rooms.find((entry) => entry.room.id === roomId)?.room.members).toEqual(expect.arrayContaining([expect.objectContaining({ principalId: member.identity.id })]));
		rebuilt.removeOrganizationRoomMember({ roomId: roomId!, principalId: member.identity.id });
		await rebuilt.flushPendingIO();
		const restoredAfterRemoval = new CollaborationRuntime({ storagePath });
		expect(restoredAfterRemoval.snapshot().data.rooms.find((entry) => entry.room.id === roomId)?.room.members).not.toEqual(expect.arrayContaining([expect.objectContaining({ principalId: member.identity.id, active: true })]));
	});

	it("executes a personal Buddy through the same evidence and verifier pipeline", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-personal-execution-"));
		const storagePath = join(root, "events.jsonl");
		const providerIdentity: BuddyIdentity = { id: "buddy-personal-runner", handle: "personal-runner", displayName: "个人执行 Buddy", ownerUserId: "local-user", organizationId: "local-organization", trustLevel: "local", status: "idle" };
		const capability: BuddyCapability = { id: "planning", providerId: providerIdentity.id, description: "规划", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:personal-room"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:room", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: true, maxDelegationDepth: 1, visibility: "private" };
		const runtime = new CollaborationRuntime({ storagePath, now: () => new Date("2026-08-30T12:00:00.000Z") });
		runtime.setPersonalProvider(new OrganizationCapabilityProvider({
			identity: providerIdentity,
			scope: { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" },
			capabilities: [capability],
			runner: { runMember: async () => "个人规划交付" },
		}));
		const proposed = runtime.proposeCollaboration({ mode: "personal", title: "个人规划", objective: "整理我的工作事项", capability: capability.id, artifactTypes: ["brief"] });
		const result = await runtime.executeCollaborationTask(proposed.taskId);
		expect(result).toMatchObject({ taskId: proposed.taskId, status: "accepted", providerId: providerIdentity.id, evidenceCount: 1 });
		expect(runtime.snapshot().data.activity.map((entry) => entry.kind)).toContain("task.evidence_verified");
	});

	it("executes a Cordis-style Personal callback through the shared evidence pipeline", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-personal-callback-"));
		const storagePath = join(root, "events.jsonl");
		const providerIdentity: BuddyIdentity = { id: "buddy-personal-resources", handle: "resources", displayName: "个人资源 Buddy", ownerUserId: "local-user", organizationId: "local-organization", trustLevel: "local", status: "idle" };
		const capability: BuddyCapability = { id: "memory:list", providerId: providerIdentity.id, description: "本地记忆索引", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:personal-room"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:room", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "private" };
		const callback = new CallbackCapabilityProvider({ identity: providerIdentity, scope: { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" }, registrations: [{ capability, invoke: async ({ envelope }) => ({ artifacts: [{ id: `memory-artifact-${envelope.taskId}`, taskId: envelope.taskId, kind: "other", title: "记忆索引", digest: "memory-digest", visibility: "requester" }], evidence: [{ id: `memory-evidence-${envelope.taskId}`, taskId: envelope.taskId, type: "execution", title: "记忆索引读取", artifactRefs: [`memory-artifact-${envelope.taskId}`], digest: "memory-evidence-digest", metadata: { count: 3 } }] }) }] });
		const registry = new PersonalProviderRegistry();
		registry.register(providerIdentity.id, callback);
		const runtime = new CollaborationRuntime({ storagePath });
		runtime.setPersonalProvider(registry);
		const proposed = runtime.proposeCollaboration({ mode: "personal", title: "读取记忆", objective: "读取本地记忆索引", capability: capability.id, artifactTypes: ["other"] });
		await expect(runtime.executeCollaborationTask(proposed.taskId)).resolves.toMatchObject({ status: "accepted", providerId: providerIdentity.id, evidenceCount: 1 });
		expect(runtime.snapshot().data.activity.map((entry) => entry.kind)).toContain("task.evidence_verified");
	});

	it("delivers a task across requester, relay, provider, and independent verifier", async () => {
		const relay = new LocalRelay();
		const scope = { communityId: "community-network", organizationId: "org-network", roomId: "room-network" };
		const requester: BuddyIdentity = { id: "buddy-requester", handle: "requester", displayName: "Requester Buddy", ownerUserId: "user-requester", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const providerIdentity: BuddyIdentity = { id: "buddy-provider", handle: "provider", displayName: "Provider Buddy", ownerUserId: "user-provider", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: providerIdentity.id, description: "研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: true, maxDelegationDepth: 1, visibility: "org" };
		const provider = new OrganizationCapabilityProvider({ identity: providerIdentity, scope, capabilities: [capability], runner: { runMember: async () => "跨 Buddy 研究交付" } });
		const verifierIdentity: BuddyIdentity = { id: "buddy-verifier", handle: "verifier", displayName: "Independent Verifier", ownerUserId: "user-verifier", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const verifier: TaskVerifier = { id: verifierIdentity.id, identity: verifierIdentity, verify: async (bundle) => ({ accepted: bundle.artifacts.length === 1 && bundle.evidence.length === 1 }) };
		let providerResult: "accepted" | "failed" | "rejected" | undefined;
		const envelope: BuddyTaskEnvelope = {
			protocol: "buddy/1.0",
			messageType: "task.propose",
			messageId: "network-message-1",
			traceId: "network-trace-1",
			taskId: "network-task-1",
			nonce: "network-nonce-1",
			sender: requester,
			recipient: providerIdentity,
			roomRef: scope.roomId,
			createdAt: "2026-08-30T12:00:00.000Z",
			expiresAt: "2026-08-30T13:00:00.000Z",
			objective: "跨域原始目标不得写入 relay 事件，但 provider 可按授权执行",
			capability: capability.id,
			input: { contextRefs: ["artifact:public-brief"] },
			output: { schema: {}, acceptanceTests: [], artifactTypes: ["brief"] },
			policy: { dataScopes: ["public:brief"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], approval: "never", allowDelegation: true, maxDelegationDepth: 1, retention: "task", expiresAt: "2026-08-30T13:00:00.000Z" },
			delivery: { acceptedArtifactTypes: ["brief"], retention: "task", redactionRequired: true },
		};
		const dispose = relay.registerEndpoint({ identity: providerIdentity, scope, accept: async (received) => {
			const result = await new OrganizationTaskExecutor({ scope, now: () => "2026-08-30T12:00:01.000Z" }).execute({ envelope: received, providerId: providerIdentity.id, providerIdentity, provider, verifier, requester });
			providerResult = result.status;
		} });
		await relay.send(envelope, { ...scope, taskId: envelope.taskId });
		expect(providerResult).toBe("accepted");
		expect(JSON.stringify(relay.query({ communityId: scope.communityId, taskId: envelope.taskId }))).not.toContain("跨域原始目标不得写入 relay 事件");
		dispose();
	});

	it("keeps an awarded network task pending when no provider endpoint is registered", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-network-pending-"));
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl"), now: () => new Date("2026-08-30T12:00:00.000Z") });
		const provider: BuddyIdentity = { id: "buddy-network-provider", handle: "provider", displayName: "Network Provider", ownerUserId: "provider-user", organizationId: "local-organization", trustLevel: "known_peer", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: provider.id, description: "研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		runtime.registerNetworkPeer({ identity: provider, capabilities: [capability] });
		runtime.setNetworkPeerTrust(provider.id, "trusted");
		runtime.networkPublishOffer({ providerId: provider.id, capabilityId: capability.id, title: "研究服务", description: "公开研究", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
		const proposed = runtime.proposeCollaboration({ mode: "network", title: "开放研究", objective: "分析公开资料", capability: capability.id, dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const offer = runtime.networkSnapshot().offers[0];
		runtime.networkSubmitBid({ offerId: offer.id, proposalId: proposed.taskId, providerId: provider.id, message: "可以完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
		const bid = runtime.networkSnapshot().bids[0];

		await expect(runtime.networkAwardBid(bid.id)).resolves.toMatchObject({ status: "pending_delivery", reason: "local network relay is unavailable" });
	});

	it("requires and completes a task-bound intent for a network external action", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-network-side-effect-"));
		const relay = new LocalRelay();
		const scope = { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" };
		const provider: BuddyIdentity = { id: "buddy-network-external-provider", handle: "external-provider", displayName: "External Provider", ownerUserId: "provider-user", organizationId: scope.organizationId, trustLevel: "known_peer", status: "idle" };
		const capability: BuddyCapability = { id: "external:send", providerId: provider.id, description: "发送外部消息", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["external:send"], forbiddenActions: [], acceptanceTests: [], requiredApproval: "before_external_commit", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		const providerCapability = new OrganizationCapabilityProvider({ identity: provider, scope, capabilities: [capability], runner: { runMember: async () => "external delivery accepted" } });
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl"), localRelay: relay, now: () => new Date("2026-08-30T12:00:00.000Z") });
		runtime.registerNetworkPeer({ identity: provider, capabilities: [capability] });
		runtime.setNetworkPeerTrust(provider.id, "trusted");
		runtime.networkPublishOffer({ providerId: provider.id, capabilityId: capability.id, title: "外部发送", description: "受控外部动作", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["message"], approval: "before_external_commit", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
		const proposed = runtime.proposeCollaboration({ mode: "network", title: "发送外部消息", objective: "只发送已经批准的公开消息", capability: capability.id, dataScopes: ["public:brief"], artifactTypes: ["message"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const offer = runtime.networkSnapshot().offers[0]!;
		runtime.networkSubmitBid({ offerId: offer.id, proposalId: proposed.taskId, providerId: provider.id, message: "可以发送", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
		const bid = runtime.networkSnapshot().bids[0]!;
		await expect(runtime.networkAwardBid(bid.id)).resolves.toMatchObject({ status: "pending_delivery", reason: "network external action requires an approved side-effect intent" });
		const intent = runtime.createSideEffectIntent({ taskId: proposed.taskId, capability: capability.id, action: "external:send", summary: "发送公开消息", fingerprint: "network-external-v1", approvedByUser: true });
		expect(intent.status).toBe("approved");
		const dispose = runtime.registerProviderNetworkEndpoint(providerCapability, provider);
		const delivery = await runtime.networkAwardBid(bid.id);
		expect(delivery.status, delivery.reason).toBe("delivered");
		expect(runtime.snapshot().data.sideEffectIntents).toContainEqual(expect.objectContaining({ intentId: intent.intentId, status: "completed", taskId: proposed.taskId }));
		dispose();
	});

	it("retries a persisted network delivery after the provider endpoint returns", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-network-retry-"));
		const relay = new LocalRelay();
		const storagePath = join(root, "events.jsonl");
		const scope = { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" };
		const provider: BuddyIdentity = { id: "buddy-retry-provider", handle: "retry-provider", displayName: "Retry Provider", ownerUserId: "provider-user", organizationId: scope.organizationId, trustLevel: "known_peer", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: provider.id, description: "研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		const first = new CollaborationRuntime({ storagePath, localRelay: relay, now: () => new Date("2026-08-30T12:00:00.000Z") });
		first.registerNetworkPeer({ identity: provider, capabilities: [capability] });
		first.setNetworkPeerTrust(provider.id, "trusted");
		first.networkPublishOffer({ providerId: provider.id, capabilityId: capability.id, title: "研究服务", description: "公开研究", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
		const proposed = first.proposeCollaboration({ mode: "network", title: "可恢复研究", objective: "分析公开资料", capability: capability.id, dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const offer = first.networkSnapshot().offers[0];
		first.networkSubmitBid({ offerId: offer.id, proposalId: proposed.taskId, providerId: provider.id, message: "恢复后完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
		const bid = first.networkSnapshot().bids[0];
		await expect(first.networkAwardBid(bid.id)).resolves.toMatchObject({ status: "pending_delivery" });
		await first.flushPendingIO();
		const restarted = new CollaborationRuntime({ storagePath, localRelay: relay, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const dispose = restarted.registerLocalNetworkEndpoint({ identity: provider, scope, accept: async () => undefined });
		await expect(restarted.retryPendingNetworkDeliveries()).resolves.toEqual([{ messageId: `network-message-${proposed.taskId}`, status: "delivered" }]);
		expect(restarted.snapshot().data.relay.pending).toEqual([]);
		expect(restarted.networkSnapshot().deliveries).toEqual([expect.objectContaining({ proposalId: proposed.taskId, status: "delivered" })]);
		dispose();
	});

	it("delivers an awarded network task through a Main-registered endpoint", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-network-delivery-"));
		const relay = new LocalRelay();
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl"), localRelay: relay, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const provider: BuddyIdentity = { id: "buddy-network-provider", handle: "provider", displayName: "Network Provider", ownerUserId: "provider-user", organizationId: "local-organization", trustLevel: "known_peer", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: provider.id, description: "研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		runtime.registerNetworkPeer({ identity: provider, capabilities: [capability] });
		runtime.setNetworkPeerTrust(provider.id, "trusted");
		runtime.networkPublishOffer({ providerId: provider.id, capabilityId: capability.id, title: "研究服务", description: "公开研究", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
		const proposed = runtime.proposeCollaboration({ mode: "network", title: "开放研究", objective: "分析公开资料", capability: capability.id, dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const offer = runtime.networkSnapshot().offers[0];
		runtime.networkSubmitBid({ offerId: offer.id, proposalId: proposed.taskId, providerId: provider.id, message: "可以完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
		const bid = runtime.networkSnapshot().bids[0];
		let received: BuddyTaskEnvelope | undefined;
		const dispose = runtime.registerLocalNetworkEndpoint({ identity: provider, scope: { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" }, accept: (envelope) => { received = envelope; } });

		await expect(runtime.networkAwardBid(bid.id)).resolves.toMatchObject({ status: "delivered", providerId: provider.id });
		expect(received).toMatchObject({ taskId: proposed.taskId, recipient: provider, capability: capability.id, objective: "分析公开资料" });
		expect(JSON.stringify(relay.query({ communityId: "local-community", taskId: proposed.taskId }))).not.toContain("分析公开资料");
		dispose();
	});

	it("routes a local network identity to its injected execution provider", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-network-alias-"));
		const relay = new LocalRelay();
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl"), localRelay: relay, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const providerIdentity: BuddyIdentity = { id: "buddy-org-runner", handle: "runner", displayName: "Runner", ownerUserId: "local-user", organizationId: "local-organization", trustLevel: "org", status: "idle" };
		const networkIdentity: BuddyIdentity = { id: "buddy-remote-provider", handle: "remote-provider", displayName: "Remote Provider", ownerUserId: "remote-user", organizationId: "local-organization", trustLevel: "known_peer", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: networkIdentity.id, description: "研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "org" };
		const provider = new OrganizationCapabilityProvider({ identity: providerIdentity, scope: { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" }, capabilities: [{ ...capability, providerId: providerIdentity.id }], runner: { runMember: async () => "alias delivery" } });
		runtime.registerNetworkPeer({ identity: networkIdentity, capabilities: [capability] });
		runtime.setNetworkPeerTrust(networkIdentity.id, "trusted");
		runtime.networkPublishOffer({ providerId: networkIdentity.id, capabilityId: capability.id, title: "本地研究", description: "本地能力", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
		const proposed = runtime.proposeCollaboration({ mode: "network", title: "本地研究", objective: "分析公开资料", capability: capability.id, dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const offer = runtime.networkSnapshot().offers[0];
		runtime.networkSubmitBid({ offerId: offer.id, proposalId: proposed.taskId, providerId: networkIdentity.id, message: "本地完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
		const bid = runtime.networkSnapshot().bids[0];
		const dispose = runtime.registerProviderNetworkEndpoint(provider, networkIdentity);
		await expect(runtime.networkAwardBid(bid.id)).resolves.toMatchObject({ status: "delivered", providerId: networkIdentity.id });
		dispose();
	});

	it("executes a network award across two independent CollaborationRuntime instances", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-two-runtimes-"));
		const relay = new LocalRelay();
		const scope = { communityId: "shared-community", organizationId: "shared-organization", roomId: "shared-room" };
		const requesterIdentity: BuddyIdentity = { id: "buddy-requester-runtime", handle: "requester", displayName: "Requester Runtime", ownerUserId: "requester-user", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const providerIdentity: BuddyIdentity = { id: "buddy-provider-runtime", handle: "provider", displayName: "Provider Runtime", ownerUserId: "provider-user", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: providerIdentity.id, description: "跨 Runtime 研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		const provider = new OrganizationCapabilityProvider({ identity: providerIdentity, scope, capabilities: [capability], runner: { runMember: async () => "provider runtime result" } });
		const providerRuntime = new CollaborationRuntime({ storagePath: join(root, "provider.events.jsonl"), localRelay: relay, identity: providerIdentity, scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const disposeProvider = providerRuntime.registerProviderNetworkEndpoint(provider);
		const requesterRuntime = new CollaborationRuntime({ storagePath: join(root, "requester.events.jsonl"), localRelay: relay, identity: requesterIdentity, scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
		requesterRuntime.registerNetworkPeer({ identity: providerIdentity, capabilities: [capability] });
		requesterRuntime.setNetworkPeerTrust(providerIdentity.id, "trusted");
		const offer = requesterRuntime.networkPublishOffer({ providerId: providerIdentity.id, capabilityId: capability.id, title: "跨 Runtime 研究", description: "独立 Provider Runtime", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
		const proposed = requesterRuntime.proposeCollaboration({ mode: "network", title: "跨 Runtime 研究", objective: "分析公开资料", capability: capability.id, dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const offerId = requesterRuntime.networkSnapshot().offers[0]?.id;
		expect(offerId).toBeDefined();
		requesterRuntime.networkSubmitBid({ offerId: offerId!, proposalId: proposed.taskId, providerId: providerIdentity.id, message: "Provider Runtime 可以完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
		const bid = requesterRuntime.networkSnapshot().bids[0];

		await expect(requesterRuntime.networkAwardBid(bid.id)).resolves.toMatchObject({ status: "delivered", providerId: providerIdentity.id });
		expect(providerRuntime.snapshot().data.identity.id).toBe(providerIdentity.id);
		expect(providerRuntime.snapshot().data.activity.some((event) => event.kind === "task.evidence_verified")).toBe(true);
		expect(JSON.stringify(relay.query({ communityId: scope.communityId, taskId: proposed.taskId }))).not.toContain("分析公开资料");
		disposeProvider();
	});

	it("restores two independent Runtime states and replays delivery after WebSocket relay recovery", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-remote-runtime-recovery-"));
		const scope = { communityId: "remote-community", organizationId: "remote-organization", roomId: "remote-room" };
		const requesterIdentity: BuddyIdentity = { id: "remote-requester", handle: "remote-requester", displayName: "Remote Requester", ownerUserId: "requester-user", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const providerIdentity: BuddyIdentity = { id: "remote-provider", handle: "remote-provider", displayName: "Remote Provider", ownerUserId: "provider-user", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const capability: BuddyCapability = { id: "research", providerId: providerIdentity.id, description: "远程公开研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence: new (await import("@openbuddy/collaboration-network")).MemoryRemoteRelayPersistence() });
		const requesterCredential: RemoteRelayCredential = { subject: requesterIdentity.id, token: "remote-requester-token", expiresAt: "2026-08-30T13:00:00.000Z" };
		const providerCredential: RemoteRelayCredential = { subject: providerIdentity.id, token: "remote-provider-token", expiresAt: "2026-08-30T13:00:00.000Z" };
		const provider = new OrganizationCapabilityProvider({ identity: providerIdentity, scope, capabilities: [capability], runner: { runMember: async () => "remote provider result" } });
		const providerTransport1 = runtimeTransport(server, providerCredential);
		const providerRuntime1 = new CollaborationRuntime({ storagePath: join(root, "provider.events.jsonl"), relay: providerTransport1, identity: providerIdentity, scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const disposeProvider1 = await providerRuntime1.registerRemoteProviderNetworkEndpoint(provider);
		disposeProvider1();
		providerTransport1.close();

		const requesterTransport1 = runtimeTransport(server, requesterCredential);
		const requester1 = new CollaborationRuntime({ storagePath: join(root, "requester.events.jsonl"), relay: requesterTransport1, identity: requesterIdentity, scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
		requester1.registerNetworkPeer({ identity: providerIdentity, capabilities: [capability] });
		requester1.setNetworkPeerTrust(providerIdentity.id, "trusted");
		requester1.networkPublishOffer({ providerId: providerIdentity.id, capabilityId: capability.id, title: "远程研究", description: "跨 Runtime 研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
		const proposal = requester1.proposeCollaboration({ mode: "network", title: "跨 Runtime 研究", objective: "私密目标不得进入 Relay", capability: capability.id, dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const offer = requester1.networkSnapshot().offers[0]!;
		requester1.networkSubmitBid({ offerId: offer.id, proposalId: proposal.taskId, providerId: providerIdentity.id, message: "Provider 可完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
		const bid = requester1.networkSnapshot().bids[0]!;
		await expect(requester1.networkAwardBid(bid.id)).resolves.toMatchObject({ status: "pending_delivery" });
		expect(requester1.snapshot().data.relay.pending).toHaveLength(1);
		expect(JSON.stringify(await requesterTransport1.query(scope))).not.toContain("私密目标不得进入 Relay");
		await requester1.flushPendingIO();
		requesterTransport1.close();

		const providerTransport2 = runtimeTransport(server, providerCredential);
		const providerRuntime2 = new CollaborationRuntime({ storagePath: join(root, "provider.events.jsonl"), relay: providerTransport2, identity: providerIdentity, scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const disposeProvider2 = await providerRuntime2.registerRemoteProviderNetworkEndpoint(provider);
		const requesterTransport2 = runtimeTransport(server, requesterCredential);
		const requester2 = new CollaborationRuntime({ storagePath: join(root, "requester.events.jsonl"), relay: requesterTransport2, identity: requesterIdentity, scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
		expect(requester2.networkSnapshot().peers).toEqual([expect.objectContaining({ identity: expect.objectContaining({ id: providerIdentity.id }), trust: "trusted" })]);
		expect(requester2.networkSnapshot().capabilityAgreements).toEqual([expect.objectContaining({ proposalId: proposal.taskId, status: "accepted" })]);
		expect(requester2.networkSnapshot().bids).toEqual([expect.objectContaining({ id: bid.id, agreementId: expect.any(String) })]);
		await expect(requester2.retryPendingNetworkDeliveries()).resolves.toEqual([{ messageId: `network-message-${proposal.taskId}`, status: "delivered" }]);
		expect(requester2.snapshot().data.relay.pending).toEqual([]);
		expect(providerRuntime2.snapshot().data.activity.some((event) => event.kind === "task.evidence_verified")).toBe(true);
		expect(JSON.stringify(await requesterTransport2.query(scope))).not.toContain("私密目标不得进入 Relay");
		disposeProvider2();
		providerTransport2.close();
		requesterTransport2.close();
	});

	it("propagates project Room Grant revocation across runtimes and relay restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-cross-runtime-grant-revocation-"));
		const scope = { communityId: "grant-community", organizationId: "grant-organization", roomId: "grant-room" };
		const requesterIdentity: BuddyIdentity = { id: "grant-requester", handle: "grant-requester", displayName: "Grant Requester", ownerUserId: "requester-user", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const providerIdentity: BuddyIdentity = { id: "grant-provider", handle: "grant-provider", displayName: "Grant Provider", ownerUserId: "provider-user", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
		const providerCredential: RemoteRelayCredential = { subject: providerIdentity.id, token: "grant-provider-token", expiresAt: "2026-08-30T13:00:00.000Z" };
		const requesterCredential: RemoteRelayCredential = { subject: requesterIdentity.id, token: "grant-requester-token", expiresAt: "2026-08-30T13:00:00.000Z" };
		const grantSigningSecret = "cross-runtime-grant-secret";
		const now = () => new Date("2026-08-30T12:00:00.000Z");
		const persistence = new MemoryRemoteRelayPersistence();
		const createServer = () => new RemoteRelayServer({
			now: () => now().toISOString(),
			allowInsecureLocal: true,
			persistence,
			verifyRoomGrant: (grant, expected) => verifyFederatedRoomGrant(grant, grantSigningSecret, expected, now().toISOString()),
		});
		const server = createServer();
		const requesterTransport = runtimeTransport(server, requesterCredential);
		const providerTransport = runtimeTransport(server, providerCredential);
		const requester = new CollaborationRuntime({ storagePath: join(root, "requester.events.jsonl"), relay: requesterTransport, identity: requesterIdentity, scope, grantSigningSecret, now });
		const provider = new CollaborationRuntime({ storagePath: join(root, "provider.events.jsonl"), relay: providerTransport, identity: providerIdentity, scope, grantSigningSecret, now });
		const capability: BuddyCapability = { id: "research", providerId: providerIdentity.id, description: "项目研究", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:public", "write:artifact"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" };
		const capabilityProvider = new OrganizationCapabilityProvider({ identity: providerIdentity, scope, capabilities: [capability], allowProjectRooms: true, runner: { runMember: async () => "grant-protected result" } });
		const proposal = requester.proposeCollaboration({ mode: "network", title: "项目跨 Buddy 研究", objective: "交付公开研究摘要", capability: capability.id, projectId: "project-grant", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const grantProjection = requester.issueFederatedRoomGrant({ projectId: "project-grant", roomId: proposal.roomId, taskId: proposal.taskId, principalId: providerIdentity.id, allowedCapabilities: [capability.id], allowedDataScopes: ["public:brief"], allowedActions: capability.allowedActions, allowedOperations: ["endpoint.register", "task.send", "events.query"], expiresAt: "2026-08-30T12:30:00.000Z" });
		const grant = requester.getFederatedRoomGrantForRelay(grantProjection.grantId);
		await provider.registerRemoteProviderNetworkEndpoint(capabilityProvider, undefined, grant);
		requester.registerNetworkPeer({ identity: providerIdentity, capabilities: [capability] });
		requester.setNetworkPeerTrust(providerIdentity.id, "trusted");
		requester.networkPublishOffer({ providerId: providerIdentity.id, capabilityId: capability.id, title: "项目研究", description: "受 Grant 保护的项目能力", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" });
		const offer = requester.networkSnapshot().offers[0]!;
		requester.networkSubmitBid({ offerId: offer.id, proposalId: proposal.taskId, providerId: providerIdentity.id, message: "可交付", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" });
		const bid = requester.networkSnapshot().bids[0]!;
		await expect(requester.networkAwardBid(bid.id)).resolves.toMatchObject({ status: "delivered" });
		await vi.waitFor(() => expect(provider.snapshot().data.activity.some((event) => event.kind === "task.evidence_verified")).toBe(true));

		await requester.revokeFederatedRoomGrant(grantProjection.grantId);
		await expect(provider.registerRemoteProviderNetworkEndpoint(capabilityProvider, undefined, grant)).rejects.toThrow(/revoked/u);
		await expect(requesterTransport.query({ ...scope, taskId: proposal.taskId }, grant)).rejects.toThrow(/revoked/u);
		expect(persistence.load()?.revokedRoomGrantIds).toContain(grantProjection.grantId);

		requesterTransport.close();
		providerTransport.close();
		const restartedServer = createServer();
		const restartedProviderTransport = runtimeTransport(restartedServer, providerCredential);
		const restartedProvider = new CollaborationRuntime({ storagePath: join(root, "provider.events.jsonl"), relay: restartedProviderTransport, identity: providerIdentity, scope, grantSigningSecret, now });
		await expect(restartedProvider.registerRemoteProviderNetworkEndpoint(capabilityProvider, undefined, grant)).rejects.toThrow(/revoked/u);
		restartedProviderTransport.close();
	});

	it("replays remote authority revocations into the Runtime audit projection", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-revocation-sync-"));
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, revocationAuthorityId: "authority-source" });
		const admin: RemoteRelayCredential = { subject: "relay-admin", token: "relay-admin-token", expiresAt: "2026-08-30T13:00:00.000Z" };
		const transport = runtimeTransport(server, admin);
		server.revoke("stale-capability-token");
		const runtime = new CollaborationRuntime({ storagePath: join(root, "events.jsonl"), relay: transport, relaySync: { enabled: true, intervalMs: 60_000 }, now: () => new Date("2026-08-30T12:00:00.000Z") });
		try {
			await vi.waitFor(() => expect(runtime.networkSnapshot().authorityRevocations).toEqual([expect.objectContaining({ authorityId: "authority-source", kind: "credential", identifier: expect.any(String) })]));
			expect(runtime.snapshot().data.network.authorityRevocations).toHaveLength(1);
		} finally {
			runtime.stopRelaySync();
			transport.close();
		}
	});

	it("replays organization membership, delegation, and approvals across two local runtimes sharing the same EventStore", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-dual-runtime-shared-"));
		const storagePath = join(root, "events.jsonl");
		const personalIdentity: BuddyIdentity = { id: "buddy-personal", handle: "personal", displayName: "Personal Buddy", ownerUserId: "owner-personal", organizationId: "team-org", trustLevel: "local", status: "idle" };
		const orgBuddyIdentity: BuddyIdentity = { id: "buddy-org-runner", handle: "runner", displayName: "Org Runner", ownerUserId: "owner-org", organizationId: "team-org", trustLevel: "org", status: "idle" };
		const scope = { communityId: "team-community", organizationId: "team-org", roomId: "team-room" };
		const personalRuntime = new CollaborationRuntime({ storagePath, identity: personalIdentity, scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const member = personalRuntime.addOrganizationMember({ id: orgBuddyIdentity.id, handle: orgBuddyIdentity.handle, displayName: orgBuddyIdentity.displayName, ownerUserId: orgBuddyIdentity.ownerUserId, role: "admin" });
		const grant = personalRuntime.grantOrganizationDelegation({ granteeId: member.identity.id, allowedCapabilities: ["research"], allowedDataScopes: ["room:team-room"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const task = personalRuntime.proposeTask({ title: "组织协作任务", objective: "两个本地 Runtime 协同的研究任务", capability: "research" });
		const approval = personalRuntime.requestApproval({ taskId: task.taskId, actions: ["external:send"], reason: "发送前需要人工确认" });
		expect(personalRuntime.snapshot().data.organization.members.some((entry) => entry.identity.id === member.identity.id)).toBe(true);

		// 重启 Personal Runtime，新创建 Organization Buddy Runtime 共享同一 EventStore。
		await personalRuntime.flushPendingIO();
		const restartedPersonal = new CollaborationRuntime({ storagePath, identity: personalIdentity, scope, now: () => new Date("2026-08-30T12:01:00.000Z") });
		const orgRuntime = new CollaborationRuntime({ storagePath, identity: orgBuddyIdentity, scope, now: () => new Date("2026-08-30T12:01:00.000Z") });

		// Organization Buddy Runtime 立刻看到成员、委托、待审批与活动记录。
		const orgSnapshot = orgRuntime.snapshot().data;
		expect(orgSnapshot.organization.members.some((entry) => entry.identity.id === member.identity.id)).toBe(true);
		const orgDelegation = orgSnapshot.organization.delegations.find((entry) => entry.id === grant.id);
		expect(orgDelegation).toBeDefined();
		expect(orgDelegation?.granteeId).toBe(member.identity.id);
		expect(orgDelegation?.revokedAt).toBeUndefined();
		expect(orgSnapshot.organization.approvals.find((entry) => entry.id === approval.id)).toMatchObject({ status: "pending" });
		expect(orgSnapshot.activity.some((event) => event.kind === "task.proposed" && event.taskId === task.taskId)).toBe(true);

		// Organization Buddy Runtime 决策审批；修复后的 mutationEvent id 含 actor.id，
		// 让跨 Runtime 写入的事件不会撞 id，因此 Org Runtime 的决策必须落到共享 EventStore 上。
		orgRuntime.decideApproval({ approvalId: approval.id, approved: true, reason: "Org Buddy 批准" });
		await orgRuntime.flushPendingIO();
		const persisted = await readFile(storagePath, "utf8");
		expect(persisted).toContain("task.approval_approved");
		expect(persisted).toContain("Org Buddy 批准");
		const finalPersonal = new CollaborationRuntime({ storagePath, identity: personalIdentity, scope, now: () => new Date("2026-08-30T12:02:00.000Z") }).snapshot().data;
		const finalApproval = finalPersonal.organization.approvals.find((entry) => entry.id === approval.id);
		expect(finalApproval?.status).toBe("approved");
		expect(finalApproval?.decisionReason).toBe("Org Buddy 批准");
	});

	it("documents the cross-runtime EventStore dedup collision (Phase 2 bug): the second runtime's mutations are silently dropped", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-dual-runtime-dedup-"));
		const storagePath = join(root, "events.jsonl");
		const personalIdentity: BuddyIdentity = { id: "buddy-personal-dedup", handle: "personal", displayName: "Personal", ownerUserId: "owner-personal", organizationId: "dedup-org", trustLevel: "local", status: "idle" };
		const orgBuddyIdentity: BuddyIdentity = { id: "buddy-org-dedup", handle: "runner", displayName: "Runner", ownerUserId: "owner-org", organizationId: "dedup-org", trustLevel: "org", status: "idle" };
		const scope = { communityId: "dedup-community", organizationId: "dedup-org", roomId: "dedup-room" };
		const personalRuntime = new CollaborationRuntime({ storagePath, identity: personalIdentity, scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
		personalRuntime.addOrganizationMember({ id: orgBuddyIdentity.id, handle: orgBuddyIdentity.handle, displayName: orgBuddyIdentity.displayName, ownerUserId: orgBuddyIdentity.ownerUserId, role: "admin" });
		const grant = personalRuntime.grantOrganizationDelegation({ granteeId: orgBuddyIdentity.id, allowedCapabilities: ["research"], allowedDataScopes: ["room:dedup-room"], expiresAt: "2026-08-30T13:00:00.000Z" });
		await personalRuntime.flushPendingIO();
		const orgRuntime = new CollaborationRuntime({ storagePath, identity: orgBuddyIdentity, scope, now: () => new Date("2026-08-30T12:00:01.000Z") });

		// 修复后的 OrganizationCoordinator.mutationEvent 把 actor.id 拼进事件 id 和 nonce，
		// 让两个 Runtime 共享 EventStore 时不再撞 id。Org Buddy Runtime 撤销 Personal Buddy
		// 签发的委托必须成功落盘，重启 Personal Runtime 后也能看到 revokedAt。
		const revokedGrant = orgRuntime.revokeOrganizationDelegation(grant.id);
		expect(revokedGrant.revokedAt).toBeDefined();
		await orgRuntime.flushPendingIO();
		const persisted = await readFile(storagePath, "utf8");
		expect(persisted).toContain("delegation.revoked");
		const finalPersonal = new CollaborationRuntime({ storagePath, identity: personalIdentity, scope, now: () => new Date("2026-08-30T12:00:02.000Z") });
		const finalSnapshot = finalPersonal.snapshot().data;
		const restored = finalSnapshot.organization.delegations.find((entry) => entry.id === grant.id);
		expect(restored?.revokedAt).toBeDefined();
	});

	it("audit-trail every org operation across restart when delegations are revoked", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-dual-runtime-audit-"));
		const storagePath = join(root, "events.jsonl");
		const ownerIdentity: BuddyIdentity = { id: "buddy-owner", handle: "owner", displayName: "Owner", ownerUserId: "owner-user", organizationId: "audit-org", trustLevel: "local", status: "idle" };
		const workerIdentity: BuddyIdentity = { id: "buddy-worker", handle: "worker", displayName: "Worker", ownerUserId: "worker-user", organizationId: "audit-org", trustLevel: "org", status: "idle" };
		const scope = { communityId: "audit-community", organizationId: "audit-org", roomId: "audit-room" };
		const ownerRuntime = new CollaborationRuntime({ storagePath, identity: ownerIdentity, scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const member = ownerRuntime.addOrganizationMember({ id: workerIdentity.id, handle: workerIdentity.handle, displayName: workerIdentity.displayName, ownerUserId: workerIdentity.ownerUserId });
		const grant = ownerRuntime.grantOrganizationDelegation({ granteeId: member.identity.id, allowedCapabilities: ["research"], allowedDataScopes: ["room:audit-room"], expiresAt: "2026-08-30T13:00:00.000Z" });
		const task = ownerRuntime.proposeTask({ title: "审计任务", objective: "验证撤销与接管全留痕", capability: "research" });
		ownerRuntime.revokeOrganizationDelegation(grant.id);
		ownerRuntime.controlTask({ taskId: task.taskId, action: "takeover", reason: "Worker 已离线" });

		await ownerRuntime.flushPendingIO();
		// 用全新的 Worker Runtime 实例（同 storagePath）读取投影：撤销和接管都必须在 activity 中可见。
		const workerRuntime = new CollaborationRuntime({ storagePath, identity: workerIdentity, scope, now: () => new Date("2026-08-30T12:01:00.000Z") });
		const snapshot = workerRuntime.snapshot().data;
		expect(snapshot.organization.delegations.find((entry) => entry.id === grant.id)?.revokedAt).toBeDefined();
		expect(snapshot.organization.taskControls).toContainEqual(expect.objectContaining({ taskId: task.taskId, state: "taken_over", reason: "Worker 已离线" }));
		const activityKinds = snapshot.activity.map((event) => event.kind);
		expect(activityKinds).toContain("delegation.revoked");
		expect(activityKinds).toContain("task.takeover");
	});

	it("removes an organization member and fails-closed existing delegations across restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-collaboration-failclosed-"));
		const storagePath = join(root, "events.jsonl");
		const ownerIdentity: BuddyIdentity = { id: "buddy-owner-fc", handle: "owner", displayName: "Owner", ownerUserId: "owner-fc-user", organizationId: "failclosed-org", trustLevel: "local", status: "idle" };
		const workerIdentity: BuddyIdentity = { id: "buddy-worker-fc", handle: "worker", displayName: "Worker", ownerUserId: "worker-fc-user", organizationId: "failclosed-org", trustLevel: "org", status: "idle" };
		const scope = { communityId: "failclosed-community", organizationId: "failclosed-org", roomId: "failclosed-room" };

		const ownerRuntime = new CollaborationRuntime({ storagePath, identity: ownerIdentity, scope, now: () => new Date("2026-08-30T12:00:00.000Z") });
		const member = ownerRuntime.addOrganizationMember({ id: workerIdentity.id, handle: workerIdentity.handle, displayName: workerIdentity.displayName, ownerUserId: workerIdentity.ownerUserId });
		const grant = ownerRuntime.grantOrganizationDelegation({ granteeId: member.identity.id, allowedCapabilities: ["research"], allowedDataScopes: ["room:failclosed-room"], expiresAt: "2026-08-30T13:00:00.000Z" });
		expect(ownerRuntime.isOrganizationDelegationAuthorized({ granteeId: member.identity.id, capability: "research", dataScopes: ["room:failclosed-room"] }).allowed).toBe(true);

		const removed = ownerRuntime.removeOrganizationMember({ memberId: member.identity.id });
		expect(removed.active).toBe(false);

		await ownerRuntime.flushPendingIO();
		const restartedRuntime = new CollaborationRuntime({ storagePath, identity: ownerIdentity, scope, now: () => new Date("2026-08-30T12:01:00.000Z") });
		const result = restartedRuntime.isOrganizationDelegationAuthorized({ granteeId: member.identity.id, capability: "research", dataScopes: ["room:failclosed-room"] });
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/active organization member/u);

		const persisted = await readFile(storagePath, "utf8");
		expect(persisted).toContain("org.member_removed");

		const snapshot = restartedRuntime.snapshot().data;
		// listMembers() 只投影 active=true 的成员；移除后成员不再出现在活动列表中，
		// 同时 activity 事件流仍保留 org.member_removed 用于审计。
		const activeMember = snapshot.organization.members.find((entry) => entry.identity.id === member.identity.id);
		expect(activeMember).toBeUndefined();
		expect(snapshot.activity.some((event) => event.kind === "org.member_removed")).toBe(true);
	});

	it("updates the runtime identity in memory and notifies listeners", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-identity-update-"));
		const storagePath = join(root, "events.jsonl");
		const identity: BuddyIdentity = { id: "buddy-original", handle: "original", displayName: "原始 Buddy", ownerUserId: "user-original", organizationId: "local-organization", trustLevel: "local", status: "idle" };
		const runtime = new CollaborationRuntime({ storagePath, identity, now: () => new Date("2026-08-31T00:00:00.000Z") });
		const updates: string[] = [];
		runtime.onUpdate((update) => { if (update.kind === "identity.updated") updates.push(runtime.snapshot().data.identity.handle); });

		const next = runtime.updateBuddyIdentity({ handle: "researcher", displayName: "研究员 Buddy" });
		expect(next.handle).toBe("researcher");
		expect(next.displayName).toBe("研究员 Buddy");
		expect(next.id).toBe("buddy-original");
		expect(next.ownerUserId).toBe("user-original");
		expect(updates).toEqual(["researcher"]);
		expect(runtime.snapshot().data.identity.handle).toBe("researcher");
		expect(runtime.snapshot().data.identity.displayName).toBe("研究员 Buddy");
	});

	it("is a no-op when the patch matches the current identity", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-identity-noop-"));
		const storagePath = join(root, "events.jsonl");
		const identity: BuddyIdentity = { id: "buddy-stable", handle: "stable", displayName: "稳定 Buddy", ownerUserId: "user-stable", organizationId: "local-organization", trustLevel: "local", status: "idle" };
		const runtime = new CollaborationRuntime({ storagePath, identity, now: () => new Date("2026-08-31T00:00:00.000Z") });
		const updates: string[] = [];
		runtime.onUpdate((update) => { if (update.kind === "identity.updated") updates.push("changed"); });
		runtime.updateBuddyIdentity({ handle: "stable", displayName: "稳定 Buddy" });
		expect(updates).toEqual([]);
	});

	it("lists and invokes Buddy capabilities through the MCP bridge", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-mcp-bridge-"));
		const storagePath = join(root, "events.jsonl");
		const identity: BuddyIdentity = { id: "buddy-mcp", handle: "mcp", displayName: "MCP Buddy", ownerUserId: "user-mcp", organizationId: "local-organization", trustLevel: "local", status: "idle" };
		const capability: BuddyCapability = { id: "memory:list", providerId: identity.id, description: "memory list", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:personal-room"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:room"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never", allowDelegation: false, maxDelegationDepth: 0, visibility: "private" };
		const runtime = new CollaborationRuntime({ storagePath, identity, now: () => new Date("2026-08-31T00:00:00.000Z") });
		runtime.setPersonalProvider(new CallbackCapabilityProvider({ identity, scope: { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" }, registrations: [{ capability, invoke: async () => ({ artifacts: [], evidence: [] }) }] }));
		runtime.setCapabilityCards([{ id: "memory:list", providerId: identity.id, name: "本地记忆索引", source: "pi-extension", visibility: "local", status: "available", contract: { input: "context-refs", output: "artifact-or-message", approval: "before-external-commit" } }]);

		const cards = runtime.listMcpCapabilities();
		expect(cards).toHaveLength(1);
		expect(cards[0].id).toBe("memory:list");

		const result = await runtime.invokeMcpCapability({ capabilityId: "memory:list", args: { limit: 5 } });
		expect(result).toMatchObject({ artifacts: expect.any(Array), evidence: expect.any(Array) });

		await expect(runtime.invokeMcpCapability({ capabilityId: "no-such", args: {} })).rejects.toThrow(/unknown capability/u);
	});

});
