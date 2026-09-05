 import { describe, expect, it } from "vitest"
 import { createEvent, type BuddyEvent, type BuddyIdentity, type BuddyRoom } from "@openbuddy/collaboration-protocol"
 import { InboxProjection } from "@openbuddy/collaboration-inbox"
 import {
 	buildWakePayload,
 	consumeWake,
 	InMemoryRoomStore,
 	presenceAt,
 } from "@openbuddy/collaboration-room"
 
 const owner: BuddyIdentity = {
 	id: "buddy-owner",
 	handle: "owner",
 	displayName: "Owner",
 	ownerUserId: "user-owner",
 	organizationId: "org-1",
 	trustLevel: "local",
 	status: "working",
 }
 
 const member: BuddyIdentity = {
 	id: "buddy-member",
 	handle: "member",
 	displayName: "Member",
 	ownerUserId: "user-member",
 	organizationId: "org-1",
 	trustLevel: "org",
 	status: "idle",
 }
 
 const scope = { communityId: "community-1", organizationId: "org-1", roomId: "room-1" }
 
 const room: BuddyRoom = {
 	id: "room-1",
 	handle: "research",
 	kind: "team",
 	ownerUserId: owner.ownerUserId,
 	organizationId: "org-1",
 	visibility: "org",
 	channels: [{ id: "general", handle: "general", kind: "channel" }],
 	members: [{ principalId: owner.id, role: "owner", joinedAt: "2026-08-30T10:00:00.000Z", active: true }],
 	policy: {
 		visibility: "org",
 		allowedTrustLevels: ["local", "org"],
 		retention: "room",
 		allowExternalSideEffects: false,
 	},
 }
 
 function event<T extends Record<string, unknown>>(input: Partial<BuddyEvent<T>> & Pick<BuddyEvent<T>, "id" | "kind" | "payload">): BuddyEvent<T> {
 	return createEvent({
 		communityId: "community-1",
 		roomId: "room-1",
 		organizationId: "org-1",
 		actor: owner,
 		nonce: input.id,
 		createdAt: `2026-08-30T10:${input.id.slice(-1).padStart(2, "0")}:00.000Z`,
 		...input,
 	})
 }
 
 describe("distributed Buddy Room and Inbox runtime", () => {
 	it("keeps membership state scoped while retaining removal events", () => {
 		const store = new InMemoryRoomStore()
 		store.create(scope, room, owner)
 		store.addMember(scope, {
 			principalId: member.id,
 			role: "agent",
 			joinedAt: "2026-08-30T10:01:00.000Z",
 			active: true,
 		}, owner)
 		const removed = store.removeMember(scope, member.id, owner)
 
 		expect(store.listChannels(scope)).toEqual(room.channels)
 		expect(store.listMembers(scope)).toEqual([room.members[0]])
 		expect(removed.value.active).toBe(false)
 		expect(store.queryEvents(scope).map((item) => item.kind)).toEqual([
 			"room.created",
 			"room.member_added",
 			"room.member_removed",
 		])
 		expect(store.queryEventsFor({ organizationId: "org-1", roomId: scope.roomId })).toHaveLength(3)
 		expect(store.queryEventsFor({ organizationId: "org-other", roomId: scope.roomId })).toHaveLength(0)
 		expect(() => store.queryEventsFor({})).toThrow(/scope is required/)
 	})
 
 	it("expires presence leases and rejects a stale agent body", () => {
 		const store = new InMemoryRoomStore()
 		store.create(scope, room, owner)
 		store.addMember(scope, {
 			principalId: member.id,
 			role: "agent",
 			joinedAt: "2026-08-30T10:01:00.000Z",
 			active: true,
 		}, owner)
 		store.setPresence(scope, {
 			agentId: member.id,
 			bodyId: "body-a",
 			status: "working",
 			startedAt: "2026-08-30T10:00:00.000Z",
 			lastHeartbeatAt: "2026-08-30T10:00:00.000Z",
 			expiresAt: "2026-08-30T10:05:00.000Z",
 		}, member)
 
 		expect(store.getPresence(scope, member.id, "2026-08-30T10:04:00.000Z")?.status).toBe("working")
 		expect(store.getPresence(scope, member.id, "2026-08-30T10:05:00.000Z")?.status).toBe("offline")
 		store.heartbeat(scope, member.id, "body-a", "2026-08-30T10:10:00.000Z", "2026-08-30T10:06:00.000Z", member)
 		expect(() => store.heartbeat(scope, member.id, "body-old", "2026-08-30T10:11:00.000Z", "2026-08-30T10:07:00.000Z", member)).toThrow(/body lease/)
 	})
 
 	it("rebuilds a scoped inbox and acknowledges items idempotently", () => {
 		const projection = new InboxProjection()
 		const events = [
 			event({ id: "event-1", kind: "approval.pending", subject: "Approve export", payload: { summary: "External export needs approval" }, taskId: "task-1" }),
 			event({ id: "event-2", kind: "task.proposed", subject: "Incoming task", payload: { summary: "A Buddy proposed research" }, taskId: "task-1" }),
 			event({ id: "event-3", kind: "task.failed", subject: "Task failed", payload: { summary: "Provider timed out" }, taskId: "task-1" }),
 			event({ id: "event-4", kind: "verification.pending", subject: "Verify delivery", payload: { summary: "Independent verification required" }, taskId: "task-1" }),
 			event({ id: "event-5", kind: "room.message", subject: "Room message", payload: { summary: "New message" }, taskId: "task-1" }),
 			event({ id: "event-6", kind: "approval.pending", subject: "Other room", payload: { summary: "Should not appear" }, roomId: "room-2", taskId: "task-2" }),
 		]
 		projection.rebuild(events, owner.id, { communityId: "community-1", organizationId: "org-1", roomId: scope.roomId })
 
 		const items = projection.list(owner.id, { roomId: scope.roomId })
 		expect(items).toHaveLength(5)
 		expect(items.map((item) => item.kind).sort()).toEqual(["approval", "failed", "incoming", "message", "verification"])
 		expect(items.find((item) => item.eventId === "event-1")?.summary).toBe("External export needs approval")
 
 		const firstAck = projection.ack(owner.id, "event-1")
 		const secondAck = projection.ack(owner.id, "event-1")
 		expect(secondAck.acknowledgedEventIds).toEqual(["event-1"])
 		expect(firstAck.lastReadEventId).toBe("event-1")
 		expect(projection.list(owner.id, { roomId: scope.roomId }).find((item) => item.eventId === "event-1")?.read).toBe(true)
 		expect(projection.list(owner.id, { organizationId: "org-other" })).toHaveLength(0)
 	})
 
	it("accepts only fresh wake payloads after rebuilding authority", () => {
		const payload = buildWakePayload({ taskId: "task-1", roomRef: "room-1", principalId: member.id, reason: "new_task", nonce: "nonce-1" })
		const consumed = new Set<string>()
		const context = {
			now: "2026-08-30T10:00:00.000Z",
			principalId: member.id,
			isRoomMember: (roomRef: string, principalId: string) => roomRef === "room-1" && principalId === member.id,
			getTask: (taskId: string) => taskId === "task-1" ? ({ taskId, roomRef: "room-1", expiresAt: "2026-08-30T11:00:00.000Z", wakeNonce: "nonce-1" }) : undefined,
			consumeNonce: (principalId: string, nonce: string) => {
				const key = `${principalId}:${nonce}`
				if (consumed.has(key)) return false
				consumed.add(key)
				return true
			},
		}

		expect(consumeWake(payload, context)).toMatchObject({ accepted: true, task: { taskId: "task-1" } })
		expect(consumeWake(payload, context)).toEqual({ accepted: false, reason: "stale_nonce" })
		expect(consumeWake({ ...payload, nonce: "old" }, context)).toEqual({ accepted: false, reason: "stale_nonce" })
		expect(consumeWake({ ...payload, principalId: owner.id }, context)).toEqual({ accepted: false, reason: "wrong_principal" })
		expect(consumeWake(payload, { ...context, isRoomMember: () => false })).toEqual({ accepted: false, reason: "missing_membership" })
		expect(consumeWake(payload, { ...context, now: "2026-08-30T11:00:00.000Z" })).toEqual({ accepted: false, reason: "expired" })
		expect(consumeWake(payload, { ...context, now: "2026-08-30T10:30:00.000Z", getTask: () => ({ taskId: "task-1", roomRef: "room-1", expiresAt: "2026-08-30T11:00:00.000Z", revokedAt: "2026-08-30T10:30:00.000Z", wakeNonce: "nonce-1" }) })).toEqual({ accepted: false, reason: "revoked" })
		expect(presenceAt({ agentId: member.id, bodyId: "body-a", status: "working", startedAt: "2026-08-30T10:00:00.000Z", lastHeartbeatAt: "2026-08-30T10:00:00.000Z", expiresAt: "2026-08-30T10:05:00.000Z" }, "2026-08-30T10:05:00.000Z")).toBe("offline")
	})
 })
