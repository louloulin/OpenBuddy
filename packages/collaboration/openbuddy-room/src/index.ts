 import type {
 	BuddyChannel,
 	BuddyEvent,
 	BuddyIdentity,
 	BuddyRoom,
 	BuddyRoomMember,
 	EventQueryScope,
 } from "@openbuddy/collaboration-protocol"
 import { createEvent } from "@openbuddy/collaboration-protocol"
 
 export interface RoomScope {
 	communityId: string
 	roomId: string
 	organizationId?: string
 }
 
 export interface PresenceLease {
 	agentId: string
 	bodyId: string
 	status: "offline" | "idle" | "working" | "paused"
 	startedAt: string
 	lastHeartbeatAt: string
 	expiresAt: string
 	configDigest?: string
 }
 
 export interface RoomMutationResult<T, P extends Record<string, unknown> = Record<string, unknown>> {
 	value: T
 	event: BuddyEvent<P>
 }
 
 function requireRoomScope(scope: Partial<RoomScope>): asserts scope is RoomScope {
 	if (!scope.communityId || !scope.roomId) throw new Error("communityId and roomId are required")
 }
 
 function scopeMatches(event: BuddyEvent, scope: RoomScope): boolean {
 	return event.communityId === scope.communityId
 		&& event.roomId === scope.roomId
 		&& (scope.organizationId === undefined || event.organizationId === scope.organizationId)
 }
 
 export function presenceAt(lease: PresenceLease, now: string): PresenceLease["status"] {
 	return now >= lease.expiresAt ? "offline" : lease.status
 }
 
 export class InMemoryRoomStore {
 	private readonly rooms = new Map<string, BuddyRoom>()
 	private readonly events: BuddyEvent[] = []
 	private readonly leases = new Map<string, PresenceLease>()
 	private sequence = 0
 
	private key(scope: RoomScope): string {
		requireRoomScope(scope)
		return `${scope.communityId}:${scope.organizationId ?? "_"}:${scope.roomId}`
	}
 
 	private event<T extends Record<string, unknown>>(scope: RoomScope, actor: BuddyIdentity, kind: string, payload: T, subject?: string): BuddyEvent<T> {
 		const event = createEvent({
 			id: `room-event-${++this.sequence}`,
 			communityId: scope.communityId,
 			organizationId: this.rooms.get(this.key(scope))?.organizationId,
 			roomId: scope.roomId,
 			kind,
 			actor,
 			nonce: `room-${this.sequence}`,
 			createdAt: new Date().toISOString(),
 			subject,
 			payload,
 		})
 		this.events.push(event)
 		return event
 	}
 
 	create(scope: RoomScope, room: BuddyRoom, actor: BuddyIdentity): RoomMutationResult<BuddyRoom, { roomId: string }> {
 		if (room.id !== scope.roomId || (scope.organizationId !== undefined && room.organizationId !== scope.organizationId)) {
 			throw new Error("room identity does not match scope")
 		}
 		if (this.rooms.has(this.key(scope))) throw new Error("room already exists")
 		this.rooms.set(this.key(scope), structuredClone(room))
 		const event = this.event(scope, actor, "room.created", { roomId: room.id })
 		return { value: structuredClone(room), event }
 	}
 
 	get(scope: RoomScope): BuddyRoom | undefined {
 		const room = this.rooms.get(this.key(scope))
 		return room ? structuredClone(room) : undefined
 	}
 
 	listChannels(scope: RoomScope): BuddyChannel[] {
 		return this.get(scope)?.channels ?? []
 	}
 
 	addMember(scope: RoomScope, member: BuddyRoomMember, actor: BuddyIdentity): RoomMutationResult<BuddyRoomMember, { member: BuddyRoomMember }> {
 		const room = this.rooms.get(this.key(scope))
 		if (!room) throw new Error("room not found")
 		if (room.members.some((candidate) => candidate.principalId === member.principalId && candidate.active)) throw new Error("member already active")
 		room.members = [...room.members.filter((candidate) => candidate.principalId !== member.principalId), { ...member, active: true }]
 		const event = this.event(scope, actor, "room.member_added", { member }, member.principalId)
 		return { value: { ...member, active: true }, event }
 	}
 
 	removeMember(scope: RoomScope, principalId: string, actor: BuddyIdentity): RoomMutationResult<BuddyRoomMember, { member: BuddyRoomMember }> {
 		const room = this.rooms.get(this.key(scope))
 		if (!room) throw new Error("room not found")
 		const existing = room.members.find((member) => member.principalId === principalId && member.active)
 		if (!existing) throw new Error("active member not found")
 		const removed = { ...existing, active: false }
 		room.members = room.members.map((member) => member.principalId === principalId ? removed : member)
 		const event = this.event(scope, actor, "room.member_removed", { member: removed }, principalId)
 		return { value: removed, event }
 	}
 
 	listMembers(scope: RoomScope): BuddyRoomMember[] {
 		return this.get(scope)?.members.filter((member) => member.active) ?? []
 	}
 
 	setPresence(scope: RoomScope, lease: PresenceLease, actor: BuddyIdentity): RoomMutationResult<PresenceLease, { lease: PresenceLease }> {
 		const room = this.rooms.get(this.key(scope))
 		if (!room || !room.members.some((member) => member.principalId === lease.agentId && member.active)) throw new Error("agent is not an active room member")
 		this.leases.set(`${this.key(scope)}:${lease.agentId}`, { ...lease })
 		const event = this.event(scope, actor, "agent.presence", { lease }, lease.agentId)
 		return { value: { ...lease }, event }
 	}
 
 	heartbeat(scope: RoomScope, agentId: string, bodyId: string, expiresAt: string, now: string, actor: BuddyIdentity): RoomMutationResult<PresenceLease, { agentId: string; bodyId: string; expiresAt: string }> {
 		const key = `${this.key(scope)}:${agentId}`
 		const current = this.leases.get(key)
 		if (!current || current.bodyId !== bodyId) throw new Error("presence body lease not found")
 		const next = { ...current, lastHeartbeatAt: now, expiresAt }
 		this.leases.set(key, next)
 		const event = this.event(scope, actor, "agent.presence_heartbeat", { agentId, bodyId, expiresAt }, agentId)
 		return { value: { ...next }, event }
 	}
 
 	getPresence(scope: RoomScope, agentId: string, now: string): PresenceLease | undefined {
 		const lease = this.leases.get(`${this.key(scope)}:${agentId}`)
 		if (!lease) return undefined
 		return { ...lease, status: presenceAt(lease, now) }
 	}
 
 	queryEvents(scope: RoomScope): BuddyEvent[] {
 		requireRoomScope(scope)
 		return this.events.filter((event) => scopeMatches(event, scope)).map((event) => structuredClone(event))
 	}
 
 	queryEventsFor(scope: EventQueryScope): BuddyEvent[] {
 		if (!scope.communityId && !scope.organizationId && !scope.roomId && !scope.taskId) throw new Error("scope is required before querying events")
 		return this.events.filter((event) =>
 			(scope.communityId === undefined || event.communityId === scope.communityId)
 			&& (scope.organizationId === undefined || event.organizationId === scope.organizationId)
 			&& (scope.roomId === undefined || event.roomId === scope.roomId)
 			&& (scope.taskId === undefined || event.taskId === scope.taskId),
 		).map((event) => structuredClone(event))
 	}
 }
 
 export interface BuddyWakePayload {
 	taskId: string
 	roomRef: string
 	principalId: string
 	reason: "new_task" | "new_message" | "resume" | "retry"
 	nonce: string
 }
 
 export interface WakeTaskSnapshot {
 	taskId: string
 	roomRef: string
 	expiresAt: string
 	revokedAt?: string
 	wakeNonce: string
 }
 
 export interface WakeConsumerContext {
 	now: string
 	principalId: string
 	isRoomMember: (roomRef: string, principalId: string) => boolean
 	getTask: (taskId: string) => WakeTaskSnapshot | undefined
 	consumeNonce?: (principalId: string, nonce: string) => boolean
 }
 
 export type WakeRebuildResult =
 	| { accepted: true; task: WakeTaskSnapshot }
 	| { accepted: false; reason: "invalid_payload" | "wrong_principal" | "missing_membership" | "unknown_task" | "stale_nonce" | "expired" | "revoked" | "room_mismatch" }
 
 export function buildWakePayload(input: BuddyWakePayload): BuddyWakePayload {
 	if (!input.taskId || !input.roomRef || !input.principalId || !input.nonce) throw new Error("wake payload requires stable identifiers")
 	return { ...input }
 }
 
 export function consumeWake(payload: BuddyWakePayload, context: WakeConsumerContext): WakeRebuildResult {
 	if (!payload.taskId || !payload.roomRef || !payload.principalId || !payload.nonce) return { accepted: false, reason: "invalid_payload" }
 	if (payload.principalId !== context.principalId) return { accepted: false, reason: "wrong_principal" }
 	if (!context.isRoomMember(payload.roomRef, payload.principalId)) return { accepted: false, reason: "missing_membership" }
 	const task = context.getTask(payload.taskId)
 	if (!task) return { accepted: false, reason: "unknown_task" }
 	if (task.roomRef !== payload.roomRef) return { accepted: false, reason: "room_mismatch" }
 	if (context.now >= task.expiresAt) return { accepted: false, reason: "expired" }
 	if (task.revokedAt && context.now >= task.revokedAt) return { accepted: false, reason: "revoked" }
 	if (task.wakeNonce !== payload.nonce) return { accepted: false, reason: "stale_nonce" }
 	if (context.consumeNonce && !context.consumeNonce(payload.principalId, payload.nonce)) return { accepted: false, reason: "stale_nonce" }
 	return { accepted: true, task: { ...task } }
 }
