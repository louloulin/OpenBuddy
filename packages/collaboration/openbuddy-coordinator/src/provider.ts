import { createEvent, matchesDataScope, stableDigest, type BuddyArtifact, type BuddyCapability, type BuddyEvent, type BuddyEvidence, type BuddyExecutionRef, type BuddyIdentity, type BuddyScope, type CapabilityProvider, type FederatedRoomGrant } from "@openbuddy/collaboration-protocol"

export interface OrganizationProviderInput {
	teamId: string
	memberId: string
	buddyTaskId: string
	executionId: string
	workflowId?: string
	stepId?: string
	role: string
	goal: string
	provider?: string
	model?: string
	schema?: unknown
}

export interface OrganizationProviderRunner {
	runMember(input: OrganizationProviderInput, signal: AbortSignal): Promise<unknown>
}

export interface OrganizationProviderOptions {
	identity: BuddyIdentity
	scope: BuddyScope
	runner: OrganizationProviderRunner
	capabilities?: BuddyCapability[]
	isApprovalGranted?: (taskId: string, actions: readonly string[]) => boolean
	emit?: (event: BuddyEvent) => void
	allowProjectRooms?: boolean
}

export interface OrganizationProviderRegistration {
	identity: BuddyIdentity
	runner: OrganizationProviderRunner
	capabilities: BuddyCapability[]
}

export interface CallbackCapabilityRegistration {
	capability: BuddyCapability
	invoke(input: { capability: BuddyCapability; envelope: import("@openbuddy/collaboration-protocol").BuddyTaskEnvelope; signal?: AbortSignal }): Promise<{ artifacts: BuddyArtifact[]; evidence: BuddyEvidence[]; executionRef?: BuddyExecutionRef }>
}

export interface CallbackCapabilityProviderOptions {
	identity: BuddyIdentity
	scope: BuddyScope
	registrations: CallbackCapabilityRegistration[]
}

/** Small adapter for local capabilities owned by a Cordis service or plugin. */
export class CallbackCapabilityProvider implements CapabilityProvider {
	private readonly identity: BuddyIdentity
	private readonly scope: BuddyScope
	private readonly registrations = new Map<string, CallbackCapabilityRegistration>()

	constructor(options: CallbackCapabilityProviderOptions) {
		this.identity = structuredClone(options.identity)
		this.scope = { ...options.scope }
		for (const registration of options.registrations) {
			if (registration.capability.providerId !== this.identity.id) throw new Error("callback capability belongs to a different provider")
			this.registrations.set(registration.capability.id, registration)
		}
	}

	identitySnapshot(): BuddyIdentity {
		return structuredClone(this.identity)
	}

	async list(scope: BuddyScope): Promise<BuddyCapability[]> {
		if (scope.communityId !== this.scope.communityId || scope.organizationId !== this.scope.organizationId || (scope.roomId && scope.roomId !== this.scope.roomId && !scope.roomId.startsWith("project-"))) return []
		return [...this.registrations.values()].map((registration) => structuredClone(registration.capability))
	}

	async invoke(input: Parameters<CapabilityProvider["invoke"]>[0]): ReturnType<CapabilityProvider["invoke"]> {
		const roomRef = input.envelope.roomRef;
		if (input.envelope.sender.organizationId !== this.scope.organizationId || !roomRef || (roomRef !== this.scope.roomId && !roomRef.startsWith("project-"))) throw new Error("callback provider envelope is outside scope")
		const registration = this.registrations.get(input.capability.id)
		if (!registration || input.capability.providerId !== this.identity.id) throw new Error("callback capability is unavailable")
		if (input.envelope.policy.dataScopes.some((scope) => !registration.capability.allowedDataScopes.some((allowed) => matchesDataScope(allowed, scope)) || registration.capability.forbiddenDataScopes.some((forbidden) => matchesDataScope(forbidden, scope)))) throw new Error("callback provider data scope exceeds capability policy")
		if (input.envelope.policy.allowedActions.some((action) => !registration.capability.allowedActions.includes(action) || registration.capability.forbiddenActions.includes(action))) throw new Error("callback provider action exceeds capability policy")
		if (input.signal?.aborted) throw new Error("callback provider invocation cancelled")
		return registration.invoke(input)
	}
}

/** Aggregates independently packaged Personal capabilities without coupling them to the Coordinator. */
export class PersonalProviderRegistry implements CapabilityProvider {
	private readonly providers = new Map<string, CapabilityProvider>()

	register(providerId: string, provider: CapabilityProvider): void {
		if (!providerId.trim()) throw new Error("personal provider id is required")
		this.providers.set(providerId, provider)
	}

	identitySnapshot(): BuddyIdentity | undefined {
		for (const provider of this.providers.values()) {
			const identity = (provider as CapabilityProvider & { identitySnapshot?: () => BuddyIdentity }).identitySnapshot?.()
			if (identity) return identity
		}
		return undefined
	}

	identityForProvider(providerId: string): BuddyIdentity | undefined {
		for (const provider of this.providers.values()) {
			const identity = (provider as CapabilityProvider & { identitySnapshot?: () => BuddyIdentity }).identitySnapshot?.()
			if (identity?.id === providerId) return identity
		}
		return undefined
	}

	unregister(providerId: string): boolean {
		return this.providers.delete(providerId)
	}

	async list(scope: BuddyScope): Promise<BuddyCapability[]> {
		const lists = await Promise.all([...this.providers.values()].map((provider) => provider.list(scope)))
		return lists.flat()
	}

	async invoke(input: Parameters<CapabilityProvider["invoke"]>[0]): ReturnType<CapabilityProvider["invoke"]> {
		const provider = this.providers.get(input.capability.providerId)
		if (!provider) throw new Error(`personal provider is unavailable: ${input.capability.providerId}`)
		return provider.invoke(input)
	}

	setCapabilities(capabilities: BuddyCapability[]): void {
		for (const provider of this.providers.values()) {
			(provider as CapabilityProvider & { setCapabilities?: (next: BuddyCapability[]) => void }).setCapabilities?.(capabilities.filter((capability) => capability.providerId === ((provider as CapabilityProvider & { identitySnapshot?: () => BuddyIdentity }).identitySnapshot?.().id ?? "")))
		}
	}
}

function digest(value: unknown): string {
	return stableDigest(value)
}

function redactedText(value: unknown): string {
	if (typeof value === "string") return value.slice(0, 2_000)
	return JSON.stringify(value) ?? ""
}

function executionRefFromRunnerResult(value: unknown, fallback: BuddyExecutionRef): BuddyExecutionRef {
	if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(fallback)
	const sessionId = (value as { sessionId?: unknown }).sessionId
	return typeof sessionId === "string" && sessionId.trim()
		? { ...structuredClone(fallback), sessionId: sessionId.trim() }
		: structuredClone(fallback)
}

function outputFromRunnerResult(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && "text" in value) return (value as { text: unknown }).text
	return value
}

/**
 * Adapter from OpenBuddy's existing team runner to the protocol-level
 * CapabilityProvider. It never receives a member's full Pi history.
 */
export class OrganizationCapabilityProvider implements CapabilityProvider {
	private readonly identity: BuddyIdentity
	private readonly scope: BuddyScope
	private readonly runner: OrganizationProviderRunner
	private readonly capabilities: BuddyCapability[]
	private readonly isApprovalGranted?: (taskId: string, actions: readonly string[]) => boolean
	private readonly emit?: (event: BuddyEvent) => void
	private readonly allowProjectRooms: boolean

	constructor(options: OrganizationProviderOptions) {
		this.identity = structuredClone(options.identity)
		this.scope = { ...options.scope }
		this.runner = options.runner
		this.capabilities = structuredClone(options.capabilities ?? [])
		this.isApprovalGranted = options.isApprovalGranted
		this.emit = options.emit
		this.allowProjectRooms = options.allowProjectRooms ?? false
	}

	identitySnapshot(): BuddyIdentity {
		return structuredClone(this.identity)
	}

	setCapabilities(capabilities: BuddyCapability[]): void {
		this.capabilities.splice(0, this.capabilities.length, ...structuredClone(capabilities))
	}

	async list(scope: BuddyScope): Promise<BuddyCapability[]> {
		if (scope.communityId !== this.scope.communityId || scope.organizationId !== this.scope.organizationId || (scope.roomId && scope.roomId !== this.scope.roomId && !this.allowProjectRooms)) return []
		return structuredClone(this.capabilities)
	}

	async invoke(input: { capability: BuddyCapability; envelope: import("@openbuddy/collaboration-protocol").BuddyTaskEnvelope; sideEffectIntentAuthorized?: boolean; signal?: AbortSignal; crossOrgGrant?: FederatedRoomGrant }): Promise<{ artifacts: BuddyArtifact[]; evidence: BuddyEvidence[]; executionRef?: BuddyExecutionRef }> {
		const crossOrgByGrant = input.crossOrgGrant && input.envelope.sender.organizationId === input.crossOrgGrant.organizationId && this.scope.organizationId === input.crossOrgGrant.providerOrganizationId && input.crossOrgGrant.allowedPrincipals.includes(this.identity.id)
		if (input.envelope.sender.organizationId !== this.scope.organizationId && !crossOrgByGrant) throw new Error("provider envelope is outside organization scope")
		const roomRef = input.envelope.roomRef;
		if (!roomRef || (roomRef !== this.scope.roomId && !(this.allowProjectRooms && roomRef.startsWith("project-")))) throw new Error("provider envelope is outside room scope")
		if (input.capability.providerId !== this.identity.id) throw new Error("capability belongs to a different provider")
		if (!this.capabilities.some((candidate) => candidate.id === input.capability.id)) throw new Error("capability is not registered with this provider")
		if (input.envelope.policy.dataScopes.some((scope) => !input.capability.allowedDataScopes.some((allowed) => matchesDataScope(allowed, scope)) || input.capability.forbiddenDataScopes.some((forbidden) => matchesDataScope(forbidden, scope)))) throw new Error("provider data scope exceeds capability policy")
		if (input.envelope.policy.allowedActions.some((action) => !input.capability.allowedActions.includes(action) || input.capability.forbiddenActions.includes(action))) throw new Error("provider action exceeds capability policy")
		const externalActions = input.envelope.policy.allowedActions.filter((action) => action.startsWith("external:"))
		const needsApproval = input.capability.requiredApproval !== "never" || input.envelope.policy.approval !== "never" || externalActions.length > 0
		const sideEffectAuthorized = input.sideEffectIntentAuthorized === true
		if (needsApproval && !sideEffectAuthorized && !this.isApprovalGranted?.(input.envelope.taskId, externalActions.length > 0 ? externalActions : ["task:execute"])) throw new Error("provider execution requires an approved task action")
		if (input.signal?.aborted) throw new Error("provider invocation cancelled")
		const startedAt = new Date().toISOString()
		const execution = input.envelope.executionRef ?? {
			executionId: `execution:${input.envelope.taskId}:${this.identity.id}`,
			taskId: input.envelope.taskId,
			teamId: input.envelope.taskId,
			memberId: this.identity.id,
		}
		const result = await this.runner.runMember({
			teamId: execution.teamId ?? input.envelope.taskId,
			memberId: execution.memberId ?? this.identity.id,
			buddyTaskId: execution.taskId,
			executionId: execution.executionId,
			...(execution.workflowId ? { workflowId: execution.workflowId } : {}),
			...(execution.stepId ? { stepId: execution.stepId } : {}),
			role: input.capability.id,
			goal: input.envelope.objective,
			schema: input.envelope.output.schema,
		}, input.signal ?? new AbortController().signal)
		const executionRef = executionRefFromRunnerResult(result, execution)
		const output = redactedText(outputFromRunnerResult(result))
		const artifact: BuddyArtifact = {
			id: `artifact-${input.envelope.taskId}-${this.identity.id}`,
			taskId: input.envelope.taskId,
			kind: "other",
			title: `${input.capability.id} delivery`,
			digest: digest(output),
			visibility: "requester",
		}
		const evidence: BuddyEvidence = {
			id: `evidence-${input.envelope.taskId}-${this.identity.id}`,
			taskId: input.envelope.taskId,
			type: "execution",
			title: "organization provider execution",
			artifactRefs: [artifact.id],
			digest: digest({ output, startedAt, finishedAt: new Date().toISOString() }),
			metadata: { providerId: this.identity.id, outputDigest: artifact.digest },
		}
		this.emit?.(createEvent({
			id: `provider-event-${input.envelope.taskId}-${this.identity.id}`,
			communityId: this.scope.communityId,
			organizationId: this.scope.organizationId,
			roomId: input.envelope.roomRef,
			taskId: input.envelope.taskId,
			kind: "artifact.created",
			actor: this.identity,
			subject: artifact.title,
			nonce: `provider:${input.envelope.taskId}:${this.identity.id}`,
			createdAt: new Date().toISOString(),
			payload: { artifactId: artifact.id, evidenceId: evidence.id, outputDigest: artifact.digest },
		}))
		return { artifacts: [artifact], evidence: [evidence], executionRef }
	}
}

/** Registry that lets one organization expose several independently runnable Buddies. */
export class OrganizationProviderRegistry implements CapabilityProvider {
	private readonly providers = new Map<string, OrganizationCapabilityProvider>()

	constructor(private readonly scope: BuddyScope, private readonly emit?: (event: BuddyEvent) => void, private readonly isApprovalGranted?: (taskId: string, actions: readonly string[]) => boolean) {}

	register(input: OrganizationProviderRegistration): void {
		if (input.identity.organizationId !== this.scope.organizationId) throw new Error("provider identity is outside organization scope")
		this.providers.set(input.identity.id, new OrganizationCapabilityProvider({ identity: input.identity, scope: this.scope, runner: input.runner, capabilities: input.capabilities, emit: this.emit, isApprovalGranted: this.isApprovalGranted }))
	}

	unregister(identityId: string): boolean {
		return this.providers.delete(identityId)
	}

	listProviders(): BuddyIdentity[] {
		return [...this.providers.values()].map((provider) => provider.identitySnapshot())
	}

	async list(scope: BuddyScope): Promise<BuddyCapability[]> {
		const lists = await Promise.all([...this.providers.values()].map((provider) => provider.list(scope)))
		return lists.flat()
	}

	async invoke(input: Parameters<CapabilityProvider["invoke"]>[0]): ReturnType<CapabilityProvider["invoke"]> {
		const provider = this.providers.get(input.capability.providerId)
		if (!provider) throw new Error(`organization provider is unavailable: ${input.capability.providerId}`)
		return provider.invoke(input)
	}
}
