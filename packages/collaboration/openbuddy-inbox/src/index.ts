import type { BuddyEvent, EventQueryScope } from "@openbuddy/collaboration-protocol"
 
 export type InboxItemKind = "approval" | "incoming" | "failed" | "verification" | "message"
 
export interface BuddyInboxItem {
 	id: string
 	kind: InboxItemKind
 	principalId: string
 	communityId: string
 	organizationId?: string
 	taskId?: string
 	roomId?: string
 	eventId: string
 	title: string
 	summary: string
 	createdAt: string
	read: boolean
	source?: "collaboration" | "email"
	emailAccountId?: string
	emailThreadId?: string
}
 
 export interface InboxCursor {
 	principalId: string
 	lastReadEventId?: string
 	acknowledgedEventIds: string[]
 }
 
 function itemKind(event: BuddyEvent): InboxItemKind | undefined {
	if (event.kind === "approval.pending" || event.kind === "task.authorize" || event.kind === "task.approval_requested") return "approval"
 	if (event.kind === "task.proposed" || event.kind === "task.bid" || event.kind === "room.member_added") return "incoming"
 	if (event.kind === "task.failed" || event.kind === "task.fail") return "failed"
 	if (event.kind === "task.verify" || event.kind === "verification.pending") return "verification"
 	if (event.kind === "room.message") return "message"
 	return undefined
 }
 
function eventSummary(event: BuddyEvent): string {
	if (typeof event.payload === "object" && event.payload && typeof (event.payload as { summary?: unknown }).summary === "string") return (event.payload as { summary: string }).summary
	if (typeof event.payload === "object" && event.payload && typeof (event.payload as { reason?: unknown }).reason === "string") return (event.payload as { reason: string }).reason
	return event.kind
}

function emailReference(event: BuddyEvent): { accountId: string; threadId: string } | undefined {
	if (!event.payload || typeof event.payload !== "object") return undefined
	const payload = event.payload as { emailAccountId?: unknown; emailThreadId?: unknown }
	if (typeof payload.emailAccountId !== "string" || !payload.emailAccountId.trim() || typeof payload.emailThreadId !== "string" || !payload.emailThreadId.trim()) return undefined
	return { accountId: payload.emailAccountId, threadId: payload.emailThreadId }
}
 
export class InboxProjection {
 	private readonly items = new Map<string, BuddyInboxItem>()
 	private readonly cursors = new Map<string, InboxCursor>()
 
	rebuild(events: readonly BuddyEvent[], principalId: string, scope: EventQueryScope): void {
		this.items.clear()
		for (const event of events) this.ingest(event, principalId, scope)
	}

	restoreCursor(cursor: InboxCursor): void {
		this.cursors.set(cursor.principalId, {
			principalId: cursor.principalId,
			lastReadEventId: cursor.lastReadEventId,
			acknowledgedEventIds: [...new Set(cursor.acknowledgedEventIds)],
		})
	}
 
 	ingest(event: BuddyEvent, principalId: string, scope: EventQueryScope): BuddyInboxItem | undefined {
 		if (scope.communityId && event.communityId !== scope.communityId) return undefined
 		if (scope.organizationId && event.organizationId !== scope.organizationId) return undefined
 		if (scope.roomId && event.roomId !== scope.roomId) return undefined
 		if (scope.taskId && event.taskId !== scope.taskId) return undefined
		const kind = itemKind(event)
		if (!kind) return undefined
		const email = emailReference(event)
		const item: BuddyInboxItem = {
 			id: `inbox:${principalId}:${event.id}`,
 			kind,
 			principalId,
 			communityId: event.communityId,
 			organizationId: event.organizationId,
 			taskId: event.taskId,
 			roomId: event.roomId,
 			eventId: event.id,
 			title: event.subject ?? event.kind,
 			summary: eventSummary(event),
 			createdAt: event.createdAt,
			read: this.cursors.get(principalId)?.acknowledgedEventIds.includes(event.id) ?? false,
			...(email ? { source: "email" as const, emailAccountId: email.accountId, emailThreadId: email.threadId } : {}),
		}
 		this.items.set(item.id, item)
 		return { ...item }
 	}
 
 	list(principalId: string, scope: EventQueryScope): BuddyInboxItem[] {
 		return [...this.items.values()]
 			.filter((item) => item.principalId === principalId
 				&& (!scope.communityId || item.communityId === scope.communityId)
 				&& (!scope.organizationId || item.organizationId === scope.organizationId)
 				&& (!scope.roomId || item.roomId === scope.roomId)
 				&& (!scope.taskId || item.taskId === scope.taskId))
 			.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
 			.map((item) => ({ ...item }))
 	}
 
 	ack(principalId: string, eventId: string): InboxCursor {
 		const current = this.cursors.get(principalId) ?? { principalId, acknowledgedEventIds: [] }
 		if (!current.acknowledgedEventIds.includes(eventId)) current.acknowledgedEventIds.push(eventId)
 		current.lastReadEventId = eventId
 		this.cursors.set(principalId, current)
 		for (const item of this.items.values()) if (item.principalId === principalId && item.eventId === eventId) item.read = true
 		return { ...current, acknowledgedEventIds: [...current.acknowledgedEventIds] }
 	}
 
 	getCursor(principalId: string): InboxCursor {
 		const cursor = this.cursors.get(principalId) ?? { principalId, acknowledgedEventIds: [] }
 		return { ...cursor, acknowledgedEventIds: [...cursor.acknowledgedEventIds] }
 	}
 }
