import { describe, expect, it } from "vitest"
import { CallbackCapabilityProvider, createTaskProposal, OrganizationCapabilityProvider, OrganizationCoordinator, OrganizationProviderRegistry, OrganizationTaskExecutor, OrganizationWorkflowExecutor, PersonalProviderRegistry, projectTasks } from "./index"
import type { BuddyIdentity } from "@openbuddy/collaboration-protocol"

const actor: BuddyIdentity = {
	id: "buddy-1",
	handle: "buddy",
	displayName: "Buddy",
	ownerUserId: "user-1",
	trustLevel: "local",
	status: "idle",
}

describe("task coordinator core", () => {
	it("routes Personal capabilities through independent callback providers", async () => {
		const identity: BuddyIdentity = { ...actor, id: "buddy-memory", handle: "memory", displayName: "Memory Buddy", organizationId: "org" }
		const capability = { id: "memory:list", providerId: identity.id, description: "读取本地记忆索引", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:room"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:room"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never" as const, allowDelegation: false, maxDelegationDepth: 0, visibility: "private" as const }
		const provider = new CallbackCapabilityProvider({ identity, scope: { communityId: "community", organizationId: "org", roomId: "room" }, registrations: [{ capability, invoke: async () => ({ artifacts: [], evidence: [] }) }] })
		const registry = new PersonalProviderRegistry()
		registry.register(identity.id, provider)
		expect(await registry.list({ communityId: "community", organizationId: "org", roomId: "room" })).toEqual([capability])
		expect(await registry.invoke({ capability, envelope: { protocol: "buddy/1.0", messageType: "task.propose", messageId: "message", traceId: "trace", taskId: "task", nonce: "nonce", sender: { ...actor, organizationId: "org" }, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: "读取索引", capability: capability.id, input: {}, output: { schema: {}, acceptanceTests: [], artifactTypes: [] }, policy: { dataScopes: ["room:room"], allowedActions: ["read:room"], forbiddenActions: [], approval: "never", allowDelegation: false, maxDelegationDepth: 0, retention: "task", expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: [], retention: "task", redactionRequired: true } } })).toEqual({ artifacts: [], evidence: [] })
	})
	it("creates a redacted proposal event and projects its status", () => {
		const result = createTaskProposal(actor, { communityId: "community", roomId: "room" }, {
			title: "整理会议",
			objective: "完整 prompt 不应写入事件",
			capability: "calendar",
			taskId: "task-1",
			eventId: "event-1",
			nonce: "nonce-1",
			createdAt: "2026-08-30T12:00:00.000Z",
		})
		expect(result.event.payload).toMatchObject({ summary: "整理会议", capability: "calendar" })
		expect(JSON.stringify(result.event)).not.toContain("完整 prompt")
		expect(projectTasks([result.event])).toEqual([expect.objectContaining({ taskId: "task-1", status: "proposed", title: "整理会议" })])
	})

	it("enforces organization membership, delegation scope, revocation, approvals, and takeover", () => {
		const events: ReturnType<typeof createTaskProposal>["event"][] = []
		const coordinator = new OrganizationCoordinator({
			scope: { communityId: "community", organizationId: "org", roomId: "room" },
			owner: { ...actor, organizationId: "org" },
			now: () => "2026-08-30T12:00:00.000Z",
			emit: (event) => events.push(event),
		})
		const worker = { ...actor, id: "buddy-2", handle: "worker", displayName: "Worker", organizationId: "org", trustLevel: "org" as const }
		coordinator.addMember(actor, worker)
		const grant = coordinator.grantDelegation(actor, {
			granteeId: worker.id,
			taskId: "task-1",
			roomId: "room",
			allowedCapabilities: ["research"],
			allowedDataScopes: ["room:room"],
			expiresAt: "2026-08-30T13:00:00.000Z",
		}).value
		expect(coordinator.isDelegationAuthorized({ granteeId: worker.id, capability: "research", dataScopes: ["room:room"], taskId: "task-1", roomId: "room" }).allowed).toBe(true)
		coordinator.revokeDelegation(actor, grant.id)
		expect(coordinator.isDelegationAuthorized({ granteeId: worker.id, capability: "research", dataScopes: ["room:room"], taskId: "task-1", roomId: "room" }).allowed).toBe(false)

		const approval = coordinator.requestApproval(actor, { taskId: "task-1", actions: ["external:send"], reason: "发送前需要人工确认" }).value
		expect(coordinator.listApprovals()[0]).toMatchObject({ id: approval.id, status: "pending" })
		const decided = coordinator.decideApproval(actor, approval.id, true, "已确认收件人").value
		expect(decided).toMatchObject({ status: "approved", decidedBy: actor.id })

		coordinator.observe(createTaskProposal(actor, { communityId: "community", organizationId: "org", roomId: "room" }, {
			title: "组织任务", objective: "组织任务的最小目标描述", capability: "research", taskId: "task-1", eventId: "event-task-1", nonce: "nonce-task-1", createdAt: "2026-08-30T12:00:00.000Z",
		}).event)
		expect(coordinator.controlTask(actor, "task-1", "takeover", "provider 超时").value).toMatchObject({ state: "taken_over", taskId: "task-1" })
		expect(events.map((event) => event.kind)).toEqual(["org.member_added", "delegation.granted", "delegation.revoked", "task.approval_requested", "task.approval_approved", "task.takeover"])
	})

	it("fails-closed on delegation authorization after the grantee member is removed", () => {
		const coordinator = new OrganizationCoordinator({
			scope: { communityId: "community", organizationId: "org", roomId: "room" },
			owner: { ...actor, organizationId: "org" },
			now: () => "2026-08-30T12:00:00.000Z",
		})
		const worker = { ...actor, id: "buddy-worker-failclosed", handle: "worker", displayName: "Worker", organizationId: "org", trustLevel: "org" as const }
		coordinator.addMember(actor, worker)
		coordinator.grantDelegation(actor, {
			granteeId: worker.id,
			taskId: "failclosed-task",
			roomId: "room",
			allowedCapabilities: ["research"],
			allowedDataScopes: ["room:room"],
			expiresAt: "2026-08-30T13:00:00.000Z",
		})
		expect(coordinator.isDelegationAuthorized({
			granteeId: worker.id,
			capability: "research",
			dataScopes: ["room:room"],
			taskId: "failclosed-task",
			roomId: "room",
		})).toMatchObject({ allowed: true })

		coordinator.removeMember(actor, worker.id)

		const removed = coordinator.isDelegationAuthorized({
			granteeId: worker.id,
			capability: "research",
			dataScopes: ["room:room"],
			taskId: "failclosed-task",
			roomId: "room",
		})
		expect(removed.allowed).toBe(false)
		expect(removed.reason).toMatch(/active organization member/u)
	})

	it("rebuilds organization projections from scoped events without leaking another organization", () => {
		const owner = { ...actor, organizationId: "org" }
		const other = createTaskProposal({ ...actor, id: "other", organizationId: "other-org" }, { communityId: "community", organizationId: "other-org", roomId: "other-room" }, {
			title: "不应可见", objective: "其他组织的任务内容不应进入当前 projection", capability: "general", taskId: "other-task", eventId: "other-event", nonce: "other-nonce", createdAt: "2026-08-30T12:00:00.000Z",
		}).event
		const current = createTaskProposal(owner, { communityId: "community", organizationId: "org", roomId: "room" }, {
			title: "可见任务", objective: "当前组织任务的最小目标描述", capability: "general", taskId: "current-task", eventId: "current-event", nonce: "current-nonce", createdAt: "2026-08-30T12:00:00.000Z",
		}).event
		const coordinator = new OrganizationCoordinator({ scope: { communityId: "community", organizationId: "org", roomId: "room" }, owner, initialEvents: [other, current] })
		expect(coordinator.listMembers()).toHaveLength(1)
		expect(coordinator.listTaskControls()).toEqual([])
		expect(projectTasks([other, current]).map((task) => task.taskId)).toEqual(["other-task", "current-task"])
		coordinator.observe(other)
		expect(coordinator.listMembers()).toHaveLength(1)
	})

	it("adapts an isolated runner to a capability provider without sending session history", async () => {
		const worker = { ...actor, id: "buddy-provider", organizationId: "org", trustLevel: "org" as const }
		const received: Record<string, unknown>[] = []
		const provider = new OrganizationCapabilityProvider({
			identity: worker,
			scope: { communityId: "community", organizationId: "org", roomId: "room" },
			capabilities: [{
				id: "research",
				providerId: worker.id,
				description: "research",
				inputSchema: {},
				outputSchema: {},
				procedure: [],
				allowedDataScopes: ["room:room"],
				forbiddenDataScopes: [],
				allowedActions: ["read:room"],
				forbiddenActions: [],
				acceptanceTests: [],
				requiredApproval: "never",
				allowDelegation: true,
				maxDelegationDepth: 1,
				visibility: "org",
			}],
			runner: { runMember: async (input) => { received.push(input as unknown as Record<string, unknown>); return { text: "artifact", sessionId: "pi-session-1" }; } },
		})
		const result = await provider.invoke({
			capability: (await provider.list({ communityId: "community", organizationId: "org", roomId: "room" }))[0],
			envelope: {
				protocol: "buddy/1.0", messageType: "task.authorize", messageId: "message-1", traceId: "trace-1", taskId: "task-1", nonce: "nonce-1", sender: { ...actor, organizationId: "org" }, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: "研究目标", capability: "research", input: { contextRefs: ["artifact:brief-1"] }, output: { schema: {}, acceptanceTests: [], artifactTypes: ["other"] }, policy: { dataScopes: ["room:room"], allowedActions: ["read:room"], forbiddenActions: [], approval: "never", allowDelegation: true, maxDelegationDepth: 1, retention: "task", expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: ["other"], retention: "task", redactionRequired: true },
			},
		})
		expect(result.artifacts).toHaveLength(1)
		expect(result.evidence[0].artifactRefs).toEqual([result.artifacts[0].id])
		expect(result.executionRef).toMatchObject({ taskId: "task-1", memberId: worker.id, sessionId: "pi-session-1" })
		expect(received[0]).toMatchObject({ teamId: "task-1", memberId: worker.id, buddyTaskId: "task-1", executionId: `execution:task-1:${worker.id}`, goal: "研究目标" })
		expect(JSON.stringify(received[0])).not.toContain("history")
		await expect(provider.invoke({
			capability: (await provider.list({ communityId: "community", organizationId: "org", roomId: "room" }))[0],
			envelope: {
				protocol: "buddy/1.0", messageType: "task.authorize", messageId: "message-2", traceId: "trace-2", taskId: "task-2", nonce: "nonce-2", sender: { ...actor, organizationId: "other-org" }, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: "其他组织", capability: "research", input: {}, output: { schema: {}, acceptanceTests: [], artifactTypes: ["other"] }, policy: { dataScopes: ["room:room"], allowedActions: ["read:room"], forbiddenActions: [], approval: "never", allowDelegation: true, maxDelegationDepth: 1, retention: "task", expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: ["other"], retention: "task", redactionRequired: true },
			},
		})).rejects.toThrow("outside organization scope")
	})

	it("requires approval before a provider may execute an external action", async () => {
		const worker = { ...actor, id: "buddy-external", organizationId: "org", trustLevel: "org" as const }
		let approved = false
		const capability = { id: "send", providerId: worker.id, description: "send", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:room"], forbiddenDataScopes: [], allowedActions: ["external:send"], forbiddenActions: [], acceptanceTests: [], requiredApproval: "before_external_commit" as const, allowDelegation: true, maxDelegationDepth: 1, visibility: "org" as const }
		const provider = new OrganizationCapabilityProvider({ identity: worker, scope: { communityId: "community", organizationId: "org", roomId: "room" }, capabilities: [capability], isApprovalGranted: () => approved, runner: { runMember: async () => "sent" } })
		const envelope = {
			protocol: "buddy/1.0" as const, messageType: "task.authorize" as const, messageId: "message-external", traceId: "trace-external", taskId: "task-external", nonce: "nonce-external", sender: { ...actor, organizationId: "org" }, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: "发送目标", capability: "send", input: {}, output: { schema: {}, acceptanceTests: [], artifactTypes: ["message"] }, policy: { dataScopes: ["room:room"], allowedActions: ["external:send"], forbiddenActions: [], approval: "before_external_commit" as const, allowDelegation: true, maxDelegationDepth: 1, retention: "task" as const, expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: ["message"], retention: "task" as const, redactionRequired: true },
		}
		await expect(provider.invoke({ capability, envelope })).rejects.toThrow("requires an approved task action")
		approved = true
		expect((await provider.invoke({ capability, envelope })).artifacts).toHaveLength(1)
	})

	it("rejects a task whose scope or action exceeds the advertised capability", async () => {
		const worker = { ...actor, id: "buddy-policy-boundary", organizationId: "org", trustLevel: "org" as const }
		const capability = { id: "research", providerId: worker.id, description: "research", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:room"], forbiddenDataScopes: ["secret:prompt"], allowedActions: ["read:room"], forbiddenActions: ["external:send"], acceptanceTests: [], requiredApproval: "never" as const, allowDelegation: true, maxDelegationDepth: 1, visibility: "org" as const }
		const provider = new OrganizationCapabilityProvider({ identity: worker, scope: { communityId: "community", organizationId: "org", roomId: "room" }, capabilities: [capability], runner: { runMember: async () => "should not run" } })
		const base = { protocol: "buddy/1.0" as const, messageType: "task.authorize" as const, messageId: "policy-message", traceId: "policy-trace", taskId: "policy-task", nonce: "policy-nonce", sender: { ...actor, organizationId: "org" }, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: "目标", capability: "research", input: {}, output: { schema: {}, acceptanceTests: [], artifactTypes: ["other"] }, policy: { dataScopes: ["secret:prompt"], allowedActions: ["external:send"], forbiddenActions: [], approval: "never" as const, allowDelegation: true, maxDelegationDepth: 1, retention: "task" as const, expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: ["other"], retention: "task" as const, redactionRequired: true } }
		await expect(provider.invoke({ capability, envelope: base })).rejects.toThrow(/scope|policy/u)
	})

	it("executes delivery through an independent verifier and exposes failure for takeover", async () => {
		const requester = { ...actor, organizationId: "org" }
		const providerIdentity = { ...actor, id: "provider", handle: "provider", displayName: "Provider", organizationId: "org", trustLevel: "org" as const }
		const verifierIdentity = { ...actor, id: "verifier", handle: "verifier", displayName: "Verifier", organizationId: "org", trustLevel: "org" as const }
		const capability = { id: "research", providerId: providerIdentity.id, description: "research", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:room"], forbiddenDataScopes: [], allowedActions: ["read:room"], forbiddenActions: [], acceptanceTests: [], requiredApproval: "never" as const, allowDelegation: true, maxDelegationDepth: 1, visibility: "org" as const }
		const envelope = { protocol: "buddy/1.0" as const, messageType: "task.propose" as const, messageId: "exec-message", traceId: "exec-trace", taskId: "exec-task", nonce: "exec-nonce", sender: requester, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: "执行研究", capability: "research", input: { contextRefs: ["artifact:brief"] }, output: { schema: {}, acceptanceTests: [], artifactTypes: ["other"] }, policy: { dataScopes: ["room:room"], allowedActions: ["read:room"], forbiddenActions: [], approval: "never" as const, allowDelegation: true, maxDelegationDepth: 1, retention: "task" as const, expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: ["other"], retention: "task" as const, redactionRequired: true } }
		const provider = new OrganizationCapabilityProvider({ identity: providerIdentity, scope: { communityId: "community", organizationId: "org", roomId: "room" }, capabilities: [capability], runner: { runMember: async () => "delivery" } })
		const executor = new OrganizationTaskExecutor({ scope: { communityId: "community", organizationId: "org", roomId: "room" }, now: () => "2026-08-30T12:00:00.000Z" })
		const accepted = await executor.execute({ envelope, providerId: providerIdentity.id, providerIdentity, provider, verifier: { id: verifierIdentity.id, identity: verifierIdentity, verify: async (bundle) => ({ accepted: bundle.artifacts.length === 1 }) } })
		expect(accepted.status).toBe("accepted")
		expect(accepted.state.status).toBe("accepted")
		expect(accepted.bundle?.verification).toMatchObject({ status: "verified", verifierId: verifierIdentity.id })

		const failed = await new OrganizationTaskExecutor({ scope: { communityId: "community", organizationId: "org", roomId: "room" }, now: () => "2026-08-30T12:00:00.000Z" }).execute({ envelope: { ...envelope, taskId: "failed-task", messageId: "failed-message" }, providerId: providerIdentity.id, providerIdentity, provider: { list: async () => [capability], invoke: async () => { throw new Error("provider offline") } }, verifier: { id: verifierIdentity.id, identity: verifierIdentity, verify: async () => ({ accepted: true }) } })
		expect(failed.status).toBe("failed")
		expect(failed.state.status).toBe("failed")
		expect(failed.events.at(-1)?.kind).toBe("task.fail")
	})

	it("runs independent workflow nodes concurrently and blocks dependents after failure", async () => {
		const requester = { ...actor, organizationId: "org" }
		const providerIdentity = { ...actor, id: "provider-dag", handle: "provider-dag", displayName: "Provider DAG", organizationId: "org", trustLevel: "org" as const }
		const verifierIdentity = { ...actor, id: "verifier-dag", handle: "verifier-dag", displayName: "Verifier DAG", organizationId: "org", trustLevel: "org" as const }
		const capability = { id: "research", providerId: providerIdentity.id, description: "research", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:room"], forbiddenDataScopes: [], allowedActions: ["read:room"], forbiddenActions: [], acceptanceTests: [], requiredApproval: "never" as const, allowDelegation: true, maxDelegationDepth: 1, visibility: "org" as const }
		const starts: string[] = []
		const makeEnvelope = (taskId: string) => ({ protocol: "buddy/1.0" as const, messageType: "task.propose" as const, messageId: `${taskId}-message`, traceId: `${taskId}-trace`, taskId, nonce: `${taskId}-nonce`, sender: requester, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: taskId, capability: "research", input: { contextRefs: [] }, output: { schema: {}, acceptanceTests: [], artifactTypes: ["other"] }, policy: { dataScopes: ["room:room"], allowedActions: ["read:room"], forbiddenActions: [], approval: "never" as const, allowDelegation: true, maxDelegationDepth: 1, retention: "task" as const, expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: ["other"], retention: "task" as const, redactionRequired: true } })
		const makeExecution = (taskId: string, fail = false) => ({ envelope: makeEnvelope(taskId), providerId: providerIdentity.id, providerIdentity, provider: { list: async () => [capability], invoke: async () => { starts.push(taskId); if (fail) throw new Error("node failed"); return { artifacts: [{ id: `${taskId}-artifact`, taskId, kind: "other" as const, title: taskId, digest: taskId, visibility: "requester" as const }], evidence: [] } } }, verifier: { id: verifierIdentity.id, identity: verifierIdentity, verify: async () => ({ accepted: true }) } })
		const result = await new OrganizationWorkflowExecutor({ scope: { communityId: "community", organizationId: "org", roomId: "room" }, now: () => "2026-08-30T12:00:00.000Z" }).execute("workflow-1", [
			{ id: "a", dependsOn: [], execution: makeExecution("node-a") },
			{ id: "b", dependsOn: [], execution: makeExecution("node-b", true) },
			{ id: "c", dependsOn: ["b"], execution: makeExecution("node-c") },
		])
		expect(starts.sort()).toEqual(["node-a", "node-b"])
		expect(result.status).toBe("failed")
		expect(result.nodes).toContainEqual(expect.objectContaining({ id: "c", status: "blocked" }))
	})

	it("routes a capability to the registered Buddy provider", async () => {
		const first = { ...actor, id: "provider-one", organizationId: "org", trustLevel: "org" as const }
		const second = { ...actor, id: "provider-two", organizationId: "org", trustLevel: "org" as const }
		const capability = (providerId: string) => ({ id: `research:${providerId}`, providerId, description: "research", inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["room:room"], forbiddenDataScopes: [], allowedActions: ["read:room"], forbiddenActions: [], acceptanceTests: [], requiredApproval: "never" as const, allowDelegation: true, maxDelegationDepth: 1, visibility: "org" as const })
		const calls: string[] = []
		const registry = new OrganizationProviderRegistry({ communityId: "community", organizationId: "org", roomId: "room" })
		registry.register({ identity: first, capabilities: [capability(first.id)], runner: { runMember: async (input) => { calls.push(input.memberId); return input.memberId } } })
		registry.register({ identity: second, capabilities: [capability(second.id)], runner: { runMember: async (input) => { calls.push(input.memberId); return input.memberId } } })
		const listed = await registry.list({ communityId: "community", organizationId: "org", roomId: "room" })
		expect(listed.map((entry) => entry.providerId)).toEqual([first.id, second.id])
		const baseEnvelope = { protocol: "buddy/1.0" as const, messageType: "task.authorize" as const, messageId: "registry-message", traceId: "registry-trace", taskId: "registry-task", nonce: "registry-nonce", sender: { ...actor, organizationId: "org" }, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: "目标", capability: capability(second.id).id, input: {}, output: { schema: {}, acceptanceTests: [], artifactTypes: ["other"] }, policy: { dataScopes: ["room:room"], allowedActions: ["read:room"], forbiddenActions: [], approval: "never" as const, allowDelegation: true, maxDelegationDepth: 1, retention: "task" as const, expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: ["other"], retention: "task" as const, redactionRequired: true } }
		await registry.invoke({ capability: listed[1], envelope: baseEnvelope })
		expect(calls).toEqual([second.id])
	})
})
