import { createEvent, matchesDataScope, stableDigest, type BuddyAgentRef, type BuddyCollaborationMode, type BuddyEvent, type BuddyExecutionRef, type BuddyIdentity, type BuddyScope, type BuddyTaskEnvelope, type BuddyEvidenceBundle, type CapabilityProvider, type FederatedRoomGrant } from "@openbuddy/collaboration-protocol"
import { buildVerifiedBundle, createEvidenceBundle } from "@openbuddy/collaboration-evidence"
import { appendTransition, initialTaskState, transitionTask, type BuddyTaskState } from "@openbuddy/collaboration-task"

export interface TaskProposalInput {
	title: string
	objective: string
	capability: string
	taskId: string
	eventId: string
	nonce: string
	createdAt: string
	mode?: BuddyCollaborationMode
	projectId?: string
	agentRef?: BuddyAgentRef
	executionRef?: BuddyExecutionRef
	sideEffectIntentId?: string
	sideEffectFingerprint?: string
}

export interface TaskProposalResult {
	taskId: string
	eventId: string
	status: "proposed"
	executionRef?: BuddyExecutionRef
	event: BuddyEvent
}

export interface TaskProjection {
	taskId: string
	status: string
	title: string
	roomId?: string
	updatedAt: string
	mode?: BuddyCollaborationMode
	projectId?: string
	agentRef?: BuddyAgentRef
	executionRef?: BuddyExecutionRef
}

export type OrganizationRole = "owner" | "admin" | "member" | "auditor"

export interface OrganizationMember {
	identity: BuddyIdentity
	role: OrganizationRole
	joinedAt: string
	active: boolean
}

export interface DelegationGrant {
	id: string
	ownerUserId: string
	grantorId: string
	granteeId: string
	organizationId?: string
	taskId?: string
	roomId?: string
	allowedCapabilities: string[]
	allowedDataScopes: string[]
	expiresAt: string
	revokedAt?: string
}

export interface ApprovalRequest {
	id: string
	taskId: string
	requesterId: string
	actions: string[]
	reason: string
	createdAt: string
	status: "pending" | "approved" | "rejected"
	decidedBy?: string
	decidedAt?: string
	decisionReason?: string
}

export type TaskControlAction = "pause" | "resume" | "revoke" | "takeover" | "revision"

export interface TaskControlProjection {
	taskId: string
	state: "paused" | "running" | "revoked" | "taken_over" | "revision_requested"
	actorId: string
	updatedAt: string
	reason?: string
}

export interface OrganizationCoordinatorOptions {
	scope: BuddyScope
	owner: BuddyIdentity
	now?: () => string
	initialEvents?: readonly BuddyEvent[]
	emit?: (event: BuddyEvent) => void
}

export interface OrganizationMutation<T> {
	value: T
	event: BuddyEvent
}

export interface TaskVerifier {
	id: string
	identity: BuddyIdentity
	verify(bundle: BuddyEvidenceBundle, signal?: AbortSignal): Promise<{ accepted: boolean; reason?: string }>
}

export interface OrganizationTaskExecutionInput {
	scope?: BuddyScope
	envelope: BuddyTaskEnvelope
	providerId: string
	providerIdentity: BuddyIdentity
	provider: CapabilityProvider
	verifier: TaskVerifier
	requester?: BuddyIdentity
	/** Optional Federated Room Grant that authorizes a cross-org delivery into this executor's scope. */
	crossOrgGrant?: FederatedRoomGrant
	approvalGranted?: (taskId: string, actions: readonly string[]) => boolean
	consumeSideEffectIntent?: (intentId: string, fingerprint: string) => void
	completeSideEffectIntent?: (intentId: string, receipt?: string) => void
	failSideEffectIntent?: (intentId: string, error: string) => void
	sideEffectIntentRequired?: boolean
	sideEffectIntentAuthorized?: boolean
	signal?: AbortSignal
}

export interface OrganizationTaskExecutionResult {
	state: BuddyTaskState
	bundle?: BuddyEvidenceBundle
	events: BuddyEvent[]
	status: "accepted" | "failed" | "rejected"
	executionRef?: BuddyExecutionRef
}

export interface OrganizationTaskExecutionOptions {
	scope: BuddyScope
	now?: () => string
	emit?: (event: BuddyEvent) => void
}

export interface OrganizationWorkflowNode {
	id: string
	dependsOn: string[]
	execution: OrganizationTaskExecutionInput
}

export interface OrganizationWorkflowNodeResult {
	id: string
	status: "accepted" | "rejected" | "failed" | "blocked"
	result?: OrganizationTaskExecutionResult
	reason?: string
}

export interface OrganizationWorkflowResult {
	workflowId: string
	status: "accepted" | "rejected" | "failed" | "blocked"
	nodes: OrganizationWorkflowNodeResult[]
}

export interface OrganizationWorkflowSeed {
	id: string
	status: "accepted"
}

const managementRoles = new Set<OrganizationRole>(["owner", "admin"])

function requireNonEmpty(value: string, name: string): string {
	const normalized = value.trim()
	if (!normalized) throw new Error(`${name} is required`)
	return normalized
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

/**
 * Organization-scoped control plane. It owns no provider/session implementation;
 * it only validates authority and emits replayable, redacted events.
 */
export class OrganizationCoordinator {
	private readonly scope: BuddyScope
	private readonly owner: BuddyIdentity
	private readonly now: () => string
	private readonly emit?: (event: BuddyEvent) => void
	private readonly members = new Map<string, OrganizationMember>()
	private readonly delegations = new Map<string, DelegationGrant>()
	private readonly approvals = new Map<string, ApprovalRequest>()
	private readonly controls = new Map<string, TaskControlProjection>()
	private readonly taskOwners = new Map<string, string>()
	private readonly taskRooms = new Map<string, string>()
	private readonly appliedEventIds = new Set<string>()
	private sequence = 0

	constructor(options: OrganizationCoordinatorOptions) {
		this.scope = { ...options.scope }
		this.owner = structuredClone(options.owner)
		this.now = options.now ?? (() => new Date().toISOString())
		this.emit = options.emit
		this.members.set(this.owner.id, { identity: structuredClone(this.owner), role: "owner", joinedAt: this.now(), active: true })
		for (const event of options.initialEvents ?? []) this.apply(event)
	}

	listMembers(): OrganizationMember[] {
		return [...this.members.values()].filter((member) => member.active).map((member) => structuredClone(member))
	}

	listDelegations(): DelegationGrant[] {
		return [...this.delegations.values()].map((grant) => structuredClone(grant))
	}

	listApprovals(): ApprovalRequest[] {
		return [...this.approvals.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((approval) => structuredClone(approval))
	}

	listTaskControls(): TaskControlProjection[] {
		return [...this.controls.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((control) => structuredClone(control))
	}

	addMember(actor: BuddyIdentity, identity: BuddyIdentity, role: OrganizationRole = "member"): OrganizationMutation<OrganizationMember> {
		this.assertManagement(actor)
		if (identity.organizationId !== this.scope.organizationId) throw new Error("member belongs to a different organization")
		const member: OrganizationMember = { identity: structuredClone(identity), role, joinedAt: this.now(), active: true }
		const event = this.mutationEvent(actor, "org.member_added", identity.id, { identity: member.identity, role, joinedAt: member.joinedAt })
		this.apply(event)
		return this.record({ ...member, identity: structuredClone(member.identity) }, event)
	}

	removeMember(actor: BuddyIdentity, memberId: string): OrganizationMutation<OrganizationMember> {
		this.assertManagement(actor)
		if (memberId === this.owner.id) throw new Error("organization owner cannot be removed")
		const current = this.requireActiveMember(memberId)
		const event = this.mutationEvent(actor, "org.member_removed", memberId, { memberId })
		this.apply(event)
		return this.record({ ...current, active: false }, event)
	}

	grantDelegation(actor: BuddyIdentity, input: Omit<DelegationGrant, "id" | "grantorId" | "ownerUserId" | "organizationId">): OrganizationMutation<DelegationGrant> {
		this.assertManagement(actor)
		this.requireActiveMember(input.granteeId)
		if (input.expiresAt <= this.now()) throw new Error("delegation must expire in the future")
		const grant: DelegationGrant = {
			...structuredClone(input),
			id: `delegation-${++this.sequence}`,
			grantorId: actor.id,
			ownerUserId: this.owner.ownerUserId,
			organizationId: this.scope.organizationId,
			allowedCapabilities: uniqueStrings(input.allowedCapabilities),
			allowedDataScopes: uniqueStrings(input.allowedDataScopes),
		}
		const event = this.mutationEvent(actor, "delegation.granted", grant.id, Object.fromEntries(Object.entries(grant)))
		this.apply(event)
		return this.record(grant, event)
	}

	revokeDelegation(actor: BuddyIdentity, delegationId: string): OrganizationMutation<DelegationGrant> {
		this.assertManagement(actor)
		const current = this.delegations.get(delegationId)
		if (!current) throw new Error("delegation not found")
		if (current.revokedAt) return this.record(structuredClone(current), this.mutationEvent(actor, "delegation.revoke_duplicate", delegationId, { delegationId }))
		const revokedAt = this.now()
		const event = this.mutationEvent(actor, "delegation.revoked", delegationId, { delegationId, revokedAt })
		this.apply(event)
		return this.record(this.delegations.get(delegationId)!, event)
	}

	requestApproval(actor: BuddyIdentity, input: { taskId: string; actions: string[]; reason: string }): OrganizationMutation<ApprovalRequest> {
		this.assertActiveMember(actor.id)
		const taskId = requireNonEmpty(input.taskId, "taskId")
		const approval: ApprovalRequest = {
			id: `approval-${++this.sequence}`,
			taskId,
			requesterId: actor.id,
			actions: uniqueStrings(input.actions),
			reason: requireNonEmpty(input.reason, "reason"),
			createdAt: this.now(),
			status: "pending",
		}
		const event = this.mutationEvent(actor, "task.approval_requested", taskId, Object.fromEntries(Object.entries(approval)))
		this.apply(event)
		return this.record(approval, event)
	}

	decideApproval(actor: BuddyIdentity, approvalId: string, approved: boolean, reason?: string): OrganizationMutation<ApprovalRequest> {
		this.assertManagement(actor)
		const current = this.approvals.get(approvalId)
		if (!current) throw new Error("approval request not found")
		if (current.status !== "pending") throw new Error("approval request is already decided")
		const decidedAt = this.now()
		const event = this.mutationEvent(actor, approved ? "task.approval_approved" : "task.approval_rejected", current.taskId, {
			approvalId,
			decidedBy: actor.id,
			decidedAt,
			decisionReason: reason?.trim() || undefined,
		})
		this.apply(event)
		return this.record(this.approvals.get(approvalId)!, event)
	}

	controlTask(actor: BuddyIdentity, taskId: string, action: TaskControlAction, reason?: string): OrganizationMutation<TaskControlProjection> {
		this.assertActiveMember(actor.id)
		const ownerId = this.taskOwners.get(taskId)
		if (!ownerId) throw new Error("task is outside the organization scope")
		const role = this.members.get(actor.id)?.role
		const canManage = role !== undefined && managementRoles.has(role)
		if (!canManage && actor.id !== ownerId && action !== "takeover") throw new Error("actor is not authorized for task control")
		if (action === "takeover" && !canManage && actor.id !== ownerId) throw new Error("only the requester or organization manager can take over")
		const event = this.mutationEvent(actor, `task.${action === "revision" ? "revision_requested" : action}`, taskId, { taskId, reason: reason?.trim() || undefined })
		this.apply(event)
		return this.record(this.controls.get(taskId)!, event)
	}

	isDelegationAuthorized(input: { granteeId: string; capability: string; dataScopes: string[]; taskId?: string; roomId?: string; now?: string }): { allowed: boolean; reason?: string; grant?: DelegationGrant } {
		// fail-closed：成员被移除（org.member_removed）后 active=false，即便仍有未撤销、未过期的
		// 委托 grant，调用方也不应再被授权。
		const grantee = this.members.get(input.granteeId)
		if (!grantee?.active) return { allowed: false, reason: "grantee is no longer an active organization member" }
		const now = input.now ?? this.now()
		const grant = [...this.delegations.values()].find((candidate) =>
			candidate.granteeId === input.granteeId
			&& !candidate.revokedAt
			&& candidate.expiresAt > now
			&& (!candidate.taskId || candidate.taskId === input.taskId)
			&& (!candidate.roomId || candidate.roomId === input.roomId)
			&& candidate.allowedCapabilities.includes(input.capability)
			&& input.dataScopes.every((scope) => candidate.allowedDataScopes.includes(scope)),
		)
		return grant ? { allowed: true, grant: structuredClone(grant) } : { allowed: false, reason: "no active delegation matches capability, scope, task, and expiry" }
	}

	isApprovalGranted(taskId: string, actions: readonly string[]): boolean {
		const requested = uniqueStrings(actions)
		return [...this.approvals.values()].some((approval) => approval.taskId === taskId
			&& approval.status === "approved"
			&& requested.every((action) => approval.actions.includes(action)))
	}

	/** Feed an event from the durable EventStore back into the projections. */
	observe(event: BuddyEvent): void {
		this.apply(event)
	}

	private assertManagement(actor: BuddyIdentity): void {
		this.assertActiveMember(actor.id)
		const role = this.members.get(actor.id)?.role
		if (!role || !managementRoles.has(role)) throw new Error("organization management role is required")
	}

	private assertActiveMember(memberId: string): void {
		if (!this.members.get(memberId)?.active) throw new Error("actor is not an active organization member")
	}

	private requireActiveMember(memberId: string): OrganizationMember {
		const member = this.members.get(memberId)
		if (!member?.active) throw new Error("organization member is not active")
		return structuredClone(member)
	}

	private mutationEvent(actor: BuddyIdentity, kind: string, subject: string, payload: Record<string, unknown>): BuddyEvent {
		return createEvent({
			// 事件 id 必须包含 actor.id：两个共享 storagePath 的 Runtime
			// （例如 Personal Buddy + Organization Buddy）各自都有自己的
			// OrganizationCoordinator 实例，sequence 计数器从 0 开始会让第二个
			// Runtime 写入的事件 id 与第一个 Runtime 已写入的事件撞 id，被
			// CollaborationRuntime.appendEvent 的 (id / actor+nonce) 去重拦掉。
			id: `org-event:${actor.id}:${++this.sequence}`,
			communityId: this.scope.communityId,
			organizationId: this.scope.organizationId,
			roomId: typeof payload.taskId === "string"
				? this.taskRooms.get(payload.taskId) ?? this.scope.roomId
				: typeof payload.roomId === "string" ? payload.roomId : this.scope.roomId,
			taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
			kind,
			actor,
			subject,
			nonce: `org:${kind}:${actor.id}:${this.sequence}`,
			createdAt: this.now(),
			payload,
		})
	}

	private record<T>(value: T, event: BuddyEvent): OrganizationMutation<T> {
		this.emit?.(structuredClone(event))
		return { value: structuredClone(value), event: structuredClone(event) }
	}

	private apply(event: BuddyEvent): void {
		if (this.appliedEventIds.has(event.id)) return
		if (event.organizationId !== this.scope.organizationId || event.communityId !== this.scope.communityId) return
		this.appliedEventIds.add(event.id)
		const payload = event.payload as Record<string, unknown>
		if (event.kind === "task.proposed" && event.taskId) {
			this.taskOwners.set(event.taskId, event.actor.id)
			if (event.roomId) this.taskRooms.set(event.taskId, event.roomId)
		}
		if (event.kind === "org.member_added" && payload.identity && typeof payload.identity === "object") {
			this.members.set(String((payload.identity as Record<string, unknown>).id), {
				identity: structuredClone(payload.identity as BuddyIdentity),
				role: payload.role as OrganizationRole,
				joinedAt: String(payload.joinedAt),
				active: true,
			})
		}
		if (event.kind === "org.member_removed") {
			const member = this.members.get(String(payload.memberId))
			if (member) member.active = false
		}
		if (event.kind === "delegation.granted") this.delegations.set(String(payload.id), structuredClone(payload as unknown as DelegationGrant))
		if (event.kind === "delegation.revoked") {
			const grant = this.delegations.get(String(payload.delegationId))
			if (grant) grant.revokedAt = String(payload.revokedAt)
		}
		if (event.kind === "task.approval_requested") this.approvals.set(String(payload.id), structuredClone(payload as unknown as ApprovalRequest))
		if (event.kind === "task.approval_approved" || event.kind === "task.approval_rejected") {
			const approval = this.approvals.get(String(payload.approvalId))
			if (approval) {
				approval.status = event.kind.endsWith("approved") ? "approved" : "rejected"
				approval.decidedBy = String(payload.decidedBy)
				approval.decidedAt = String(payload.decidedAt)
				approval.decisionReason = typeof payload.decisionReason === "string" ? payload.decisionReason : undefined
			}
		}
		const controlKinds: Record<string, TaskControlProjection["state"]> = {
			"task.pause": "paused",
			"task.resume": "running",
			"task.revoke": "revoked",
			"task.takeover": "taken_over",
			"task.revision_requested": "revision_requested",
		}
		const state = controlKinds[event.kind]
		if (state && event.taskId) this.controls.set(event.taskId, { taskId: event.taskId, state, actorId: event.actor.id, updatedAt: event.createdAt, reason: typeof payload.reason === "string" ? payload.reason : undefined })
	}
}

/**
 * Runs one organization task through the protocol state machine. The executor
 * coordinates contracts and evidence only; actual model/tool work stays in the
 * injected CapabilityProvider and the verifier is a separate identity.
 */
export class OrganizationTaskExecutor {
	private readonly scope: BuddyScope
	private readonly now: () => string
	private readonly emit?: (event: BuddyEvent) => void

	constructor(options: OrganizationTaskExecutionOptions) {
		this.scope = { ...options.scope }
		this.now = options.now ?? (() => new Date().toISOString())
		this.emit = options.emit
	}

	async execute(input: OrganizationTaskExecutionInput): Promise<OrganizationTaskExecutionResult> {
		const executionScope = input.scope ?? this.scope
		this.assertEnvelopeScope(input.envelope, executionScope, input.crossOrgGrant)
		if (input.providerIdentity.id !== input.providerId) throw new Error("provider identity does not match providerId")
		if (input.verifier.id !== input.verifier.identity.id) throw new Error("verifier identity does not match verifier id")
		if (input.verifier.id === input.providerId || input.verifier.id === input.envelope.sender.id) throw new Error("verifier must be independent from provider and requester")
		if (input.envelope.expiresAt <= input.envelope.createdAt) throw new Error("task envelope expiry must follow creation time")
		const externalActions = input.envelope.policy.allowedActions.filter((action) => action.startsWith("external:"))
		const requiresAuthorization = externalActions.length > 0 || input.envelope.policy.approval !== "never"
		const authorizationActions = externalActions.length > 0 ? externalActions : ["task:execute"]
		if (requiresAuthorization && input.sideEffectIntentRequired && !input.envelope.sideEffectIntentId) throw new Error("task execution requires a side-effect intent")
		if (requiresAuthorization && input.envelope.sideEffectIntentId) {
			if (!input.envelope.sideEffectFingerprint) throw new Error("side-effect intent fingerprint is required")
			if (input.consumeSideEffectIntent) input.consumeSideEffectIntent(input.envelope.sideEffectIntentId, input.envelope.sideEffectFingerprint)
			else if (!input.sideEffectIntentAuthorized) throw new Error("side-effect intent authorization is unavailable")
		} else if (requiresAuthorization && !input.approvalGranted?.(input.envelope.taskId, authorizationActions)) {
			throw new Error("task execution requires an approved task action")
		}

		let state = initialTaskState(input.envelope)
		const events: BuddyEvent[] = []
		const append = (next: BuddyTaskState, event: BuddyEvent): void => {
			state = next
			events.push(event)
			this.emit?.(event)
		}
		const transition = (actor: BuddyIdentity, messageType: BuddyTaskEnvelope["messageType"], extras: { providerId?: string; verifierId?: string } = {}): void => {
			const result = transitionTask(state, {
				actor,
				now: this.now(),
				envelope: { ...input.envelope, messageType, messageId: `task-event-${input.envelope.taskId}-${events.length + 1}`, nonce: `task:${input.envelope.taskId}:${messageType}:${events.length + 1}` },
				...extras,
			})
			append(result.state, result.event)
		}

		const requester = input.requester ?? input.envelope.sender
		try {
			transition(input.providerIdentity, "task.bid", { providerId: input.providerId })
			transition(requester, "task.award", { providerId: input.providerId })
			transition(requester, "task.authorize", { providerId: input.providerId })
			transition(input.providerIdentity, "task.progress", { providerId: input.providerId })
			if (input.signal?.aborted) throw new Error("task execution cancelled")
			const capability = (await input.provider.list(executionScope)).find((candidate) => candidate.id === input.envelope.capability)
			if (!capability) throw new Error("requested capability is unavailable in the organization scope")
			if (capability.providerId !== input.providerId) throw new Error("requested capability belongs to a different provider")
			if (input.envelope.policy.dataScopes.some((scope) => !capability.allowedDataScopes.some((allowed) => matchesDataScope(allowed, scope)) || capability.forbiddenDataScopes.some((forbidden) => matchesDataScope(forbidden, scope)))) throw new Error("task data scope exceeds capability policy")
			if (input.envelope.policy.allowedActions.some((action) => !capability.allowedActions.includes(action) || capability.forbiddenActions.includes(action))) throw new Error("task action exceeds capability policy")
			const delivery = await input.provider.invoke({ capability, envelope: { ...input.envelope, messageType: "task.authorize" }, sideEffectIntentAuthorized: Boolean(input.envelope.sideEffectIntentId && (input.consumeSideEffectIntent || input.sideEffectIntentAuthorized)), ...(input.crossOrgGrant ? { crossOrgGrant: input.crossOrgGrant } : {}), signal: input.signal })
			const executionRef = delivery.executionRef ?? input.envelope.executionRef
			transition(input.providerIdentity, "task.deliver", { providerId: input.providerId })
			const bundle = createEvidenceBundle({ taskId: input.envelope.taskId, providerId: input.providerId, artifacts: delivery.artifacts, evidence: delivery.evidence })
			const verdict = await input.verifier.verify(bundle, input.signal)
			transition(input.verifier.identity, "task.verify", { providerId: input.providerId, verifierId: input.verifier.id })
			const verifiedBundle = buildVerifiedBundle({ taskId: input.envelope.taskId, providerId: input.providerId, verifierId: input.verifier.id, artifacts: delivery.artifacts, evidence: delivery.evidence, accepted: verdict.accepted, reason: verdict.reason, now: this.now() })
			if (!verdict.accepted) {
				transition(input.verifier.identity, "task.dispute", { providerId: input.providerId, verifierId: input.verifier.id })
				if (input.envelope.sideEffectIntentId) input.failSideEffectIntent?.(input.envelope.sideEffectIntentId, verdict.reason ?? "交付未通过独立验证")
					return { state, bundle: verifiedBundle, events, status: "rejected", ...(executionRef ? { executionRef: structuredClone(executionRef) } : {}) }
				}
				if (input.envelope.sideEffectIntentId) input.completeSideEffectIntent?.(input.envelope.sideEffectIntentId, executionRef?.sessionId)
				transition(requester, "task.accept", { providerId: input.providerId, verifierId: input.verifier.id })
				return { state, bundle: verifiedBundle, events, status: "accepted", ...(executionRef ? { executionRef: structuredClone(executionRef) } : {}) }
		} catch (error) {
			if (state.status === "running" && !input.signal?.aborted) {
				const failure = transitionTask(state, {
					actor: input.providerIdentity,
					now: this.now(),
					envelope: { ...input.envelope, messageType: "task.fail", messageId: `task-event-${input.envelope.taskId}-${events.length + 1}`, nonce: `task:${input.envelope.taskId}:task.fail:${events.length + 1}` },
					providerId: input.providerId,
				})
				append(failure.state, failure.event)
			}
				if (input.envelope.sideEffectIntentId) {
					try { input.failSideEffectIntent?.(input.envelope.sideEffectIntentId, error instanceof Error ? error.message : String(error)) } catch { /* preserve task failure */ }
				}
				return { state, events, status: "failed" }
		}
	}

	private assertEnvelopeScope(envelope: BuddyTaskEnvelope, scope: BuddyScope, crossOrgGrant?: FederatedRoomGrant): void {
		const crossOrgAllowed = crossOrgGrant && envelope.sender.organizationId === crossOrgGrant.organizationId && scope.organizationId === crossOrgGrant.providerOrganizationId && crossOrgGrant.allowedPrincipals.includes(envelope.recipient?.id ?? "")
		if (envelope.roomRef !== scope.roomId || (envelope.sender.organizationId !== scope.organizationId && !crossOrgAllowed)) throw new Error("task envelope is outside organization scope")
	}
}

/** Executes independent workflow nodes concurrently and gates dependent nodes. */
export class OrganizationWorkflowExecutor {
	private readonly taskExecutor: OrganizationTaskExecutor

	constructor(options: OrganizationTaskExecutionOptions) {
		this.taskExecutor = new OrganizationTaskExecutor(options)
	}

	async execute(workflowId: string, nodes: readonly OrganizationWorkflowNode[], signal?: AbortSignal, seeds: readonly OrganizationWorkflowSeed[] = []): Promise<OrganizationWorkflowResult> {
		const byId = new Map(nodes.map((node) => [node.id, node]))
		if (byId.size !== nodes.length) throw new Error("workflow node ids must be unique")
		for (const node of nodes) for (const dependency of node.dependsOn) if (!byId.has(dependency) || dependency === node.id) throw new Error(`workflow dependency is invalid: ${node.id} -> ${dependency}`)
		const results = new Map<string, OrganizationWorkflowNodeResult>()
		for (const seed of seeds) {
			if (!byId.has(seed.id) || results.has(seed.id)) throw new Error(`workflow seed is invalid: ${seed.id}`)
			results.set(seed.id, { id: seed.id, status: seed.status })
		}
		const remaining = new Set([...byId.keys()].filter((id) => !results.has(id)))
		while (remaining.size > 0) {
			if (signal?.aborted) {
				for (const id of remaining) results.set(id, { id, status: "blocked", reason: "workflow cancelled" })
				break
			}
			const ready = [...remaining].filter((id) => {
				const node = byId.get(id)!
				return node.dependsOn.every((dependency) => results.has(dependency))
			})
			if (ready.length === 0) throw new Error("workflow dependency graph contains a cycle")
			const completed = await Promise.all(ready.map(async (id): Promise<OrganizationWorkflowNodeResult> => {
				const node = byId.get(id)!
				const blockedBy = node.dependsOn.find((dependency) => results.get(dependency)?.status !== "accepted")
				if (blockedBy) return { id, status: "blocked", reason: `dependency ${blockedBy} did not complete` }
				try {
					const result = await this.taskExecutor.execute({ ...node.execution, signal: signal ?? node.execution.signal })
						const status = result.status === "accepted" ? "accepted" : result.status === "failed" ? "failed" : "blocked"
						return { id, status, result, ...(result.status !== "accepted" ? { reason: result.status === "failed" ? "node execution failed" : "node execution was rejected" } : {}) }
				} catch (error) {
					return { id, status: "failed", reason: String(error) }
				}
			}))
			for (const result of completed) {
				results.set(result.id, result)
				remaining.delete(result.id)
			}
		}
		const ordered = nodes.map((node) => results.get(node.id)!).filter(Boolean)
		return {
			workflowId,
			status: ordered.every((node) => node.status === "accepted") ? "accepted" : ordered.some((node) => node.status === "failed") ? "failed" : ordered.some((node) => node.status === "rejected") ? "rejected" : "blocked",
			nodes: ordered,
		}
	}
}

export function createTaskProposal(actor: BuddyIdentity, scope: BuddyScope, input: TaskProposalInput): TaskProposalResult {
	const title = input.title.trim()
	const objective = input.objective.trim()
	if (!title || title.length > 160) throw new Error("task title must contain 1-160 characters")
	if (!objective || objective.length > 20_000) throw new Error("task objective must contain 1-20000 characters")
	const event = createEvent({
		id: input.eventId,
		communityId: scope.communityId,
		organizationId: scope.organizationId,
		roomId: scope.roomId,
		taskId: input.taskId,
		kind: "task.proposed",
		actor,
		subject: title,
		nonce: input.nonce,
		createdAt: input.createdAt,
		payload: {
			summary: title,
			objectiveDigest: stableDigest(objective),
			capability: input.capability.trim() || "general",
			mode: input.mode ?? "personal",
			...(input.projectId ? { projectId: input.projectId } : {}),
			...(input.agentRef ? { agentRef: structuredClone(input.agentRef) } : {}),
			...(input.executionRef ? { executionRef: input.executionRef } : {}),
			...(input.sideEffectIntentId ? { sideEffectIntentId: input.sideEffectIntentId } : {}),
			...(input.sideEffectFingerprint ? { sideEffectFingerprint: input.sideEffectFingerprint } : {}),
		},
	})
	return { taskId: input.taskId, eventId: input.eventId, status: "proposed", ...(input.executionRef ? { executionRef: structuredClone(input.executionRef) } : {}), event }
}

export function projectTasks(events: readonly BuddyEvent[]): TaskProjection[] {
	const latest = new Map<string, TaskProjection>()
	for (const event of events) {
		if (!event.taskId || !event.kind.startsWith("task.")) continue
		const payload = event.payload as { title?: unknown; objective?: unknown; summary?: unknown; mode?: unknown; projectId?: unknown; agentRef?: unknown; executionRef?: unknown }
		const title = [payload.title, payload.objective, payload.summary].find((value): value is string => typeof value === "string") ?? event.kind
		const previous = latest.get(event.taskId)
		const executionRef = payload.executionRef && typeof payload.executionRef === "object" ? payload.executionRef as BuddyExecutionRef : previous?.executionRef
		const agentRef = payload.agentRef && typeof payload.agentRef === "object" ? payload.agentRef as BuddyAgentRef : previous?.agentRef
		latest.set(event.taskId, {
			taskId: event.taskId,
			status: event.kind.slice("task.".length),
			title,
			roomId: event.roomId,
			updatedAt: event.createdAt,
			mode: payload.mode === "personal" || payload.mode === "organization" || payload.mode === "network"
				? payload.mode
				: previous?.mode ?? "personal",
			...(typeof payload.projectId === "string" ? { projectId: payload.projectId } : previous?.projectId ? { projectId: previous.projectId } : {}),
			...(agentRef ? { agentRef: structuredClone(agentRef) } : {}),
			...(executionRef ? { executionRef: structuredClone(executionRef) } : {}),
		})
	}
	return [...latest.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export * from "./provider"
