import { describe, expect, it } from "vitest"
import { toA2AAgentCard, toA2ATaskView, toBuddyTaskEnvelopeFromA2A } from "./a2a-adapter"

const identity = { id: "buddy-peer", handle: "peer", displayName: "Peer Buddy", ownerUserId: "user-peer", trustLevel: "known_peer" as const, status: "idle" as const }
const card = { protocol: "agent-card/1" as const, identity, communityId: "community", capabilities: [{ id: "research", description: "公开研究", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "before_external_commit" as const }], endpoints: ["https://peer.example/a2a"], issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }

describe("A2A adapter", () => {
	it("maps a Buddy Agent Card without treating discovery as authorization", () => {
		const result = toA2AAgentCard({ card, trust: "known", agentCardStatus: "unverified", now: "2026-08-30T12:00:00.000Z" })
		expect(result.skills).toEqual([expect.objectContaining({ id: "research" })])
		expect(result.metadata.openbuddy).toMatchObject({ identityId: identity.id, trust: "known", agentCardStatus: "unverified" })
	})

	it("maps a public A2A task to a redaction-safe Buddy envelope", () => {
		const envelope = toBuddyTaskEnvelopeFromA2A({
			id: "a2a-task-1", contextId: "ctx-1", skillId: "research", objective: "整理公开资料", sender: identity,
			dataScopes: ["public:brief"], allowedActions: ["read:public"], artifactTypes: ["brief"], contextRefs: ["artifact:public-brief"], expiresAt: "2026-08-30T13:00:00.000Z",
		}, { now: "2026-08-30T12:00:00.000Z" })
		expect(envelope).toMatchObject({ protocol: "buddy/1.0", messageType: "task.propose", taskId: "a2a-task-1", capability: "research", input: { contextRefs: ["artifact:public-brief"], constraints: { a2aContextId: "ctx-1" } } })
		expect(JSON.stringify(envelope)).not.toContain("private:")
	})

	it("rejects private scopes and raw context payloads at the adapter boundary", () => {
		const input = { id: "a2a-task-2", skillId: "research", objective: "不应跨域", sender: identity, dataScopes: ["private:vault"], allowedActions: [], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" }
		expect(() => toBuddyTaskEnvelopeFromA2A(input, { now: "2026-08-30T12:00:00.000Z" })).toThrow("private")
		expect(() => toBuddyTaskEnvelopeFromA2A({ ...input, dataScopes: ["public:brief"], contextRefs: ["raw prompt text"] }, { now: "2026-08-30T12:00:00.000Z" })).toThrow("stable authorized references")
	})

	it("preserves execution and verification metadata while mapping task state", () => {
		const result = toA2ATaskView({ taskId: "task-3", status: "delivered", updatedAt: "2026-08-30T12:02:00.000Z", executionRef: { executionId: "execution:task-3", sessionId: "pi-session-3" }, artifacts: [{ id: "artifact-3", title: "研究摘要", kind: "brief", digest: "digest-3", visibility: "requester" }] })
		expect(result.status.state).toBe("completed")
		expect(result.metadata.openbuddy).toMatchObject({ status: "delivered", verification: "unverified", executionRef: { sessionId: "pi-session-3" } })
		expect(result.artifacts[0]).toMatchObject({ id: "artifact-3", parts: [{ data: { digest: "digest-3" } }] })
	})
})
