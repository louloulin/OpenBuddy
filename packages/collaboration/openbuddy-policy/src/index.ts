 import type { BuddyCapability, BuddyTaskPolicy, TrustLevel } from "@openbuddy/collaboration-protocol"
 
 export interface PolicyLayer {
 	dataScopes: string[]
 	allowedActions: string[]
 	forbiddenActions: string[]
 	budget?: { tokens?: number; money?: number; currency?: string }
 	approval: "never" | "before_external_commit" | "always"
 	allowDelegation: boolean
 	maxDelegationDepth: number
 	expiresAt: string
 }
 
 export interface PolicyEvaluationInput {
 	user: PolicyLayer
 	organization: PolicyLayer
 	task: BuddyTaskPolicy
 	capability: BuddyCapability
 	now: string
 	requestedDataScopes: string[]
 	requestedActions: string[]
 	requestedBudget?: { tokens?: number; money?: number; currency?: string }
 	delegationDepth: number
 	trustLevel: TrustLevel
 	approved: boolean
 	providerId: string
 	taskOwnerId: string
 }
 
 export interface EffectivePolicy {
 	dataScopes: string[]
 	allowedActions: string[]
 	forbiddenActions: string[]
 	approval: "never" | "before_external_commit" | "always"
 	allowDelegation: boolean
 	maxDelegationDepth: number
 	budget?: { tokens?: number; money?: number; currency?: string }
 	retention: BuddyTaskPolicy["retention"]
 	expiresAt: string
 }
 
 export interface PolicyDecision {
 	allowed: boolean
 	reasons: string[]
 	effectivePolicy?: EffectivePolicy
 }
 
 const approvalRank = { never: 0, before_external_commit: 1, always: 2 } as const
 
 function earliestExpiry(values: string[]): string {
 	return values.reduce((latest, value) => value < latest ? value : latest)
 }
 
 function intersect(values: string[][]): string[] {
 	const [first, ...rest] = values
 	return (first ?? []).filter((value) => rest.every((candidate) => candidate.includes(value)))
 }
 
 function minDefined(values: Array<number | undefined>): number | undefined {
 	const present = values.filter((value): value is number => value !== undefined)
 	return present.length === 0 ? undefined : Math.min(...present)
 }
 
 export function intersectPolicies(input: Pick<PolicyEvaluationInput, "user" | "organization" | "task" | "capability">): EffectivePolicy {
 	const { user, organization, task, capability } = input
 	const expiresAt = earliestExpiry([user.expiresAt, organization.expiresAt, task.expiresAt])
 	return {
 		dataScopes: intersect([user.dataScopes, organization.dataScopes, task.dataScopes, capability.allowedDataScopes]),
 		allowedActions: intersect([user.allowedActions, organization.allowedActions, task.allowedActions, capability.allowedActions]),
 		forbiddenActions: [...new Set([...user.forbiddenActions, ...organization.forbiddenActions, ...task.forbiddenActions, ...capability.forbiddenActions])],
 		approval: [user.approval, organization.approval, task.approval, capability.requiredApproval].reduce((highest, value) => approvalRank[value] > approvalRank[highest] ? value : highest, "never"),
 		allowDelegation: user.allowDelegation && organization.allowDelegation && task.allowDelegation && capability.allowDelegation,
 		maxDelegationDepth: Math.min(user.maxDelegationDepth, organization.maxDelegationDepth, task.maxDelegationDepth, capability.maxDelegationDepth),
 		budget: {
 			tokens: minDefined([user.budget?.tokens, organization.budget?.tokens, task.budget?.tokens]),
 			money: minDefined([user.budget?.money, organization.budget?.money, task.budget?.money]),
 			currency: task.budget?.currency ?? organization.budget?.currency ?? user.budget?.currency,
 		},
 		retention: task.retention,
 		expiresAt,
 	}
 }
 
 export function evaluatePolicy(input: PolicyEvaluationInput): PolicyDecision {
 	const effectivePolicy = intersectPolicies(input)
 	const reasons: string[] = []
 	if (input.now >= effectivePolicy.expiresAt) reasons.push("policy expired")
 	if (input.now >= input.task.expiresAt) reasons.push("task expired")
 	if (!input.requestedDataScopes.every((scope) => effectivePolicy.dataScopes.includes(scope))) reasons.push("requested data scope is outside the effective intersection")
 	if (input.requestedActions.some((action) => !effectivePolicy.allowedActions.includes(action))) reasons.push("requested action is not allowed by every policy layer")
 	if (input.requestedActions.some((action) => effectivePolicy.forbiddenActions.includes(action))) reasons.push("requested action is forbidden")
 	if (input.requestedBudget?.tokens !== undefined && effectivePolicy.budget?.tokens !== undefined && input.requestedBudget.tokens > effectivePolicy.budget.tokens) reasons.push("requested token budget exceeds policy limit")
 	if (input.requestedBudget?.money !== undefined && effectivePolicy.budget?.money !== undefined && input.requestedBudget.money > effectivePolicy.budget.money) reasons.push("requested money budget exceeds policy limit")
 	if (input.requestedBudget?.currency && effectivePolicy.budget?.currency && input.requestedBudget.currency !== effectivePolicy.budget.currency) reasons.push("requested budget currency does not match policy")
 	if (input.delegationDepth > effectivePolicy.maxDelegationDepth) reasons.push("delegation depth exceeds policy limit")
 	if (input.delegationDepth > 0 && !effectivePolicy.allowDelegation) reasons.push("delegation is disabled")
 	if (input.providerId !== input.taskOwnerId && input.trustLevel === "public") reasons.push("public provider requires an explicit known trust boundary")
 	if (effectivePolicy.approval === "always" && !input.approved) reasons.push("approval is required")
 	if (effectivePolicy.approval === "before_external_commit" && input.requestedActions.some((action) => action.startsWith("external:")) && !input.approved) reasons.push("external commit requires approval")
 	return { allowed: reasons.length === 0, reasons, effectivePolicy }
 }
