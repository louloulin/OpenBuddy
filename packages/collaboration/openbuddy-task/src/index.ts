 import type { BuddyEvent, BuddyIdentity, BuddyScope, BuddyTaskEnvelope, EventQueryScope, EventStore } from "@openbuddy/collaboration-protocol"
 import { createEvent } from "@openbuddy/collaboration-protocol"
 
 export type BuddyTaskStatus =
 	| "proposed"
 	| "negotiating"
 	| "awarded"
 	| "authorized"
 	| "running"
 	| "delivered"
 	| "verifying"
 	| "accepted"
 	| "rejected"
 	| "revoked"
 	| "failed"
 	| "revision_requested"
 	| "disputed"
 
 export interface BuddyTaskState {
 	taskId: string
 	status: BuddyTaskStatus
 	requesterId: string
 	providerId?: string
 	verifierId?: string
 	lastEventId?: string
 	version: number
 	updatedAt: string
 }
 
 export interface TaskTransitionContext {
 	actor: BuddyIdentity
 	now: string
 	envelope: BuddyTaskEnvelope
 	providerId?: string
 	verifierId?: string
 }
 
 export interface TaskTransitionResult {
 	state: BuddyTaskState
 	event: BuddyEvent
 }
 
 export class TaskTransitionError extends Error {
 	readonly code: "illegal_transition" | "unauthorized_actor" | "expired" | "terminal_state" | "missing_provider" | "missing_verifier"
 
 	constructor(code: TaskTransitionError["code"], message: string) {
 		super(message)
 		this.name = "TaskTransitionError"
 		this.code = code
 	}
 }
 
 const transitions: Record<BuddyTaskStatus, BuddyTaskStatus[]> = {
 	proposed: ["negotiating", "rejected", "revoked"],
 	negotiating: ["awarded", "rejected", "revoked"],
 	awarded: ["authorized", "revoked"],
 	authorized: ["running", "revoked"],
 	running: ["delivered", "failed", "revoked"],
 	delivered: ["verifying", "revision_requested", "disputed", "revoked"],
 	verifying: ["accepted", "revision_requested", "disputed", "failed", "revoked"],
 	accepted: ["revision_requested", "disputed"],
 	rejected: [],
 	revoked: [],
 	failed: ["revision_requested", "disputed"],
 	revision_requested: ["negotiating", "revoked"],
 	disputed: ["revision_requested", "revoked"],
 }
 
 const providersAllowed = new Set<BuddyTaskStatus>(["awarded", "authorized", "running", "delivered", "failed"])
 const verifiersAllowed = new Set<BuddyTaskStatus>(["verifying", "revision_requested", "disputed"])
 
 function actorAllowed(state: BuddyTaskState, context: TaskTransitionContext, next: BuddyTaskStatus): boolean {
 	if (next === "proposed" || next === "negotiating" || next === "awarded" || next === "authorized" || next === "revoked" || next === "revision_requested" || next === "accepted") {
 		if (context.actor.id === state.requesterId) return true
 	}
 	if (next === "negotiating" && !state.providerId && context.actor.id !== state.requesterId) return true
 	if (next === "verifying" && context.verifierId === context.actor.id && context.actor.id !== state.providerId) return true
 	if (context.actor.id === state.providerId && providersAllowed.has(next)) return true
 	if (context.actor.id === state.verifierId && verifiersAllowed.has(next)) return true
 	return false
 }
 
 function statusForMessage(messageType: BuddyTaskEnvelope["messageType"]): BuddyTaskStatus {
 	const status = {
 		"task.propose": "proposed",
 		"task.bid": "negotiating",
 		"task.award": "awarded",
 		"task.authorize": "authorized",
 		"task.progress": "running",
 		"task.deliver": "delivered",
 		"task.verify": "verifying",
 		"task.accept": "accepted",
 		"task.revoke": "revoked",
 		"task.fail": "failed",
 		"task.revision_requested": "revision_requested",
 		"task.dispute": "disputed",
 	} satisfies Record<BuddyTaskEnvelope["messageType"], BuddyTaskStatus>
 	return status[messageType]
 }
 
 export function initialTaskState(envelope: BuddyTaskEnvelope): BuddyTaskState {
 	return {
 		taskId: envelope.taskId,
 		status: "proposed",
 		requesterId: envelope.sender.id,
 		version: 0,
 		updatedAt: envelope.createdAt,
 	}
 }
 
 export function transitionTask(state: BuddyTaskState, context: TaskTransitionContext): TaskTransitionResult {
 	if (context.now >= context.envelope.expiresAt) throw new TaskTransitionError("expired", "task envelope has expired")
 	if (state.taskId !== context.envelope.taskId) throw new TaskTransitionError("illegal_transition", "task id does not match state")
 	const next = statusForMessage(context.envelope.messageType)
 	if (!transitions[state.status].includes(next)) {
 		if (state.status === "accepted" || state.status === "rejected" || state.status === "revoked") throw new TaskTransitionError("terminal_state", `terminal task cannot transition from ${state.status}`)
 		throw new TaskTransitionError("illegal_transition", `${state.status} cannot transition to ${next}`)
 	}
 	if (!actorAllowed(state, context, next)) throw new TaskTransitionError("unauthorized_actor", "actor is not authorized for this task transition")
 	if (next === "awarded" && !context.providerId && !state.providerId) throw new TaskTransitionError("missing_provider", "award must identify a provider")
 	if (next === "verifying" && !context.verifierId) throw new TaskTransitionError("missing_verifier", "verification must identify an independent verifier")
 	if (next === "accepted" && (!state.verifierId || state.providerId === context.actor.id)) throw new TaskTransitionError("missing_verifier", "provider cannot independently accept its own delivery")
 	const nextState: BuddyTaskState = {
 		...state,
 		status: next,
 		providerId: context.providerId ?? state.providerId ?? (next === "negotiating" && context.actor.id !== state.requesterId ? context.actor.id : undefined),
 		verifierId: context.verifierId ?? state.verifierId,
 		version: state.version + 1,
 		updatedAt: context.now,
 	}
 	const event = createEvent({
 		id: context.envelope.messageId,
 		communityId: context.envelope.roomRef ?? "local",
 		roomId: context.envelope.roomRef,
 		taskId: context.envelope.taskId,
 		kind: context.envelope.messageType,
 		actor: context.actor,
 		nonce: context.envelope.nonce,
 		createdAt: context.now,
 		payload: { previousStatus: state.status, nextStatus: next, version: nextState.version },
 		previousEventId: state.lastEventId,
 	})
 	return { state: { ...nextState, lastEventId: event.id }, event }
 }
 
 export class NonceLedger {
 	private readonly results = new Map<string, TaskTransitionResult>()
 
 	get(actorId: string, nonce: string): TaskTransitionResult | undefined {
 		return this.results.get(`${actorId}:${nonce}`)
 	}
 
 	put(actorId: string, nonce: string, result: TaskTransitionResult): void {
 		this.results.set(`${actorId}:${nonce}`, result)
 	}
 }
 
 export class InMemoryEventStore implements EventStore {
 	private readonly events: BuddyEvent[] = []
 	private readonly nonces = new Map<string, BuddyEvent>()
 
 	async append<T>(event: BuddyEvent<T>): Promise<{ event: BuddyEvent<T>; duplicate: boolean }> {
 		const nonceKey = `${event.actor.id}:${event.nonce}`
 		const existing = this.nonces.get(nonceKey) ?? this.events.find((candidate) => candidate.id === event.id)
 		if (existing) return { event: existing as BuddyEvent<T>, duplicate: true }
 		this.events.push(event as BuddyEvent)
 		this.nonces.set(nonceKey, event as BuddyEvent)
 		return { event, duplicate: false }
 	}
 
 	async query<T = Record<string, unknown>>(scope: EventQueryScope): Promise<BuddyEvent<T>[]> {
 		if (!scope.communityId && !scope.organizationId && !scope.roomId && !scope.taskId) throw new Error("scope is required before querying events")
 		return this.events.filter((event) =>
 			(scope.communityId === undefined || event.communityId === scope.communityId)
 			&& (scope.organizationId === undefined || event.organizationId === scope.organizationId)
 			&& (scope.roomId === undefined || event.roomId === scope.roomId)
 			&& (scope.taskId === undefined || event.taskId === scope.taskId),
 		) as BuddyEvent<T>[]
 	}
 }
 
 export async function appendTransition(
 	store: EventStore,
 	ledger: NonceLedger,
 	state: BuddyTaskState,
 	context: TaskTransitionContext,
 ): Promise<TaskTransitionResult> {
 	const duplicate = ledger.get(context.actor.id, context.envelope.nonce)
 	if (duplicate) return duplicate
 	const result = transitionTask(state, context)
 	const appended = await store.append(result.event)
 	const finalResult = appended.duplicate ? { ...result, event: appended.event } : result
 	ledger.put(context.actor.id, context.envelope.nonce, finalResult)
 	return finalResult
 }
 
 export function replayTask(events: readonly BuddyEvent[], envelope: BuddyTaskEnvelope, identities: ReadonlyMap<string, BuddyIdentity>): BuddyTaskState {
 	let state = initialTaskState(envelope)
 	for (const event of events.filter((candidate) => candidate.taskId === envelope.taskId).sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
 		const actor = identities.get(event.actor.id) ?? event.actor
 		const messageType = event.kind as BuddyTaskEnvelope["messageType"]
 		const result = transitionTask(state, {
 			actor,
 			now: event.createdAt,
 			envelope: { ...envelope, messageType, messageId: event.id, nonce: event.nonce, createdAt: event.createdAt },
 			providerId: state.providerId ?? (messageType === "task.bid" ? actor.id : undefined),
 			verifierId: state.verifierId ?? (messageType === "task.verify" ? actor.id : undefined),
 		})
 		state = result.state
 	}
 	return state
 }
 
 export type { BuddyScope }
