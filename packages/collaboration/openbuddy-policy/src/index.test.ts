import { describe, expect, it } from "vitest"
import { evaluatePolicy, intersectPolicies, type PolicyEvaluationInput, type PolicyLayer } from "./index"
import type { BuddyCapability, BuddyTaskPolicy } from "@openbuddy/collaboration-protocol"

const expires = "2099-01-01T00:00:00.000Z"
const pastExpires = "2000-01-01T00:00:00.000Z"

function layer(overrides: Partial<PolicyLayer> = {}): PolicyLayer {
  return {
    dataScopes: ["*"],
    allowedActions: ["*"],
    forbiddenActions: [],
    approval: "never",
    allowDelegation: true,
    maxDelegationDepth: 3,
    expiresAt: expires,
    ...overrides,
  }
}

function task(overrides: Partial<BuddyTaskPolicy> = {}): BuddyTaskPolicy {
  return {
    taskId: "task-1",
    ownerId: "owner-1",
    dataScopes: ["*"],
    allowedActions: ["*"],
    forbiddenActions: [],
    approval: "never",
    allowDelegation: true,
    maxDelegationDepth: 3,
    retention: "session",
    expiresAt: expires,
    ...overrides,
  } as BuddyTaskPolicy
}

function capability(overrides: Partial<BuddyCapability> = {}): BuddyCapability {
  return {
    id: "cap-1",
    name: "Capability",
    description: "test",
    allowedDataScopes: ["*"],
    allowedActions: ["*"],
    forbiddenActions: [],
    requiredApproval: "never",
    allowDelegation: true,
    maxDelegationDepth: 3,
    ...overrides,
  } as BuddyCapability
}

function input(overrides: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  return {
    user: layer(),
    organization: layer(),
    task: task(),
    capability: capability(),
    now: "2026-01-01T00:00:00.000Z",
    requestedDataScopes: ["*"],
    requestedActions: ["*"],
    delegationDepth: 0,
    trustLevel: "local",
    approved: false,
    providerId: "owner-1",
    taskOwnerId: "owner-1",
    ...overrides,
  }
}

describe("intersectPolicies (no mock)", () => {
  it("intersects data scopes across all layers", () => {
    const eff = intersectPolicies({
      user: layer({ dataScopes: ["a", "b"] }),
      organization: layer({ dataScopes: ["b", "c"] }),
      task: task({ dataScopes: ["b"] }),
      capability: capability({ allowedDataScopes: ["b"] }),
    })
    expect(eff.dataScopes).toEqual(["b"])
  })

  it("intersects allowed actions across all layers", () => {
    const eff = intersectPolicies({
      user: layer({ allowedActions: ["read", "write"] }),
      organization: layer({ allowedActions: ["read"] }),
      task: task({ allowedActions: ["read"] }),
      capability: capability({ allowedActions: ["read"] }),
    })
    expect(eff.allowedActions).toEqual(["read"])
  })

  it("unions forbidden actions across all layers", () => {
    const eff = intersectPolicies({
      user: layer({ forbiddenActions: ["delete"] }),
      organization: layer({ forbiddenActions: ["format"] }),
      task: task({ forbiddenActions: [] }),
      capability: capability({ forbiddenActions: ["delete"] }),
    })
    expect(eff.forbiddenActions.sort()).toEqual(["delete", "format"])
  })

  it("approval becomes the highest required level", () => {
    const eff = intersectPolicies({
      user: layer({ approval: "never" }),
      organization: layer({ approval: "before_external_commit" }),
      task: task({ approval: "always" }),
      capability: capability({ requiredApproval: "never" }),
    })
    expect(eff.approval).toBe("always")
  })

  it("delegation requires every layer to allow it", () => {
    const eff = intersectPolicies({
      user: layer({ allowDelegation: true }),
      organization: layer({ allowDelegation: true }),
      task: task({ allowDelegation: true }),
      capability: capability({ allowDelegation: false }),
    })
    expect(eff.allowDelegation).toBe(false)
  })

  it("maxDelegationDepth is the minimum across layers", () => {
    const eff = intersectPolicies({
      user: layer({ maxDelegationDepth: 5 }),
      organization: layer({ maxDelegationDepth: 3 }),
      task: task({ maxDelegationDepth: 4 }),
      capability: capability({ maxDelegationDepth: 2 }),
    })
    expect(eff.maxDelegationDepth).toBe(2)
  })

  it("earliest expiry wins", () => {
    const eff = intersectPolicies({
      user: layer({ expiresAt: "2099-01-01T00:00:00.000Z" }),
      organization: layer({ expiresAt: "2030-01-01T00:00:00.000Z" }),
      task: task({ expiresAt: expires }),
      capability: capability(),
    })
    expect(eff.expiresAt).toBe("2030-01-01T00:00:00.000Z")
  })

  it("budget tokens are the minimum across layers", () => {
    const eff = intersectPolicies({
      user: layer({ budget: { tokens: 1000 } }),
      organization: layer({ budget: { tokens: 500 } }),
      task: task({ budget: { tokens: 800 } }),
      capability: capability(),
    })
    expect(eff.budget?.tokens).toBe(500)
  })
})

describe("evaluatePolicy (no mock)", () => {
  it("allows when all checks pass", () => {
    const decision = evaluatePolicy(input())
    expect(decision.allowed).toBe(true)
    expect(decision.reasons).toEqual([])
  })

  it("denies when policy is expired", () => {
    const decision = evaluatePolicy(input({ user: layer({ expiresAt: pastExpires }) }))
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain("policy expired")
  })

  it("denies when task is expired", () => {
    const decision = evaluatePolicy(input({ task: task({ expiresAt: pastExpires }) }))
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain("task expired")
  })

  it("denies when requested data scope is not in effective intersection", () => {
    const decision = evaluatePolicy(input({
      organization: layer({ dataScopes: ["restricted"] }),
      requestedDataScopes: ["public"],
    }))
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain("requested data scope is outside the effective intersection")
  })

  it("denies when a requested action is forbidden", () => {
    const decision = evaluatePolicy(input({
      organization: layer({ forbiddenActions: ["delete"] }),
      requestedActions: ["delete"],
    }))
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain("requested action is forbidden")
  })

  it("denies when token budget is exceeded", () => {
    const decision = evaluatePolicy(input({
      organization: layer({ budget: { tokens: 100 } }),
      requestedBudget: { tokens: 500 },
    }))
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain("requested token budget exceeds policy limit")
  })

  it("denies when delegation depth exceeds the limit", () => {
    const decision = evaluatePolicy(input({
      delegationDepth: 5,
      organization: layer({ maxDelegationDepth: 2 }),
    }))
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain("delegation depth exceeds policy limit")
  })

  it("denies external commits when approval=before_external_commit and not approved", () => {
    const decision = evaluatePolicy(input({
      organization: layer({ approval: "before_external_commit" }),
      requestedActions: ["external:send"],
      approved: false,
    }))
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain("external commit requires approval")
  })

  it("requires explicit approval when approval=always", () => {
    const decision = evaluatePolicy(input({
      task: task({ approval: "always" }),
      approved: false,
    }))
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain("approval is required")
  })

  it("approves public provider against itself when trustLevel is private", () => {
    const decision = evaluatePolicy(input({
      providerId: "owner-1",
      taskOwnerId: "owner-1",
      trustLevel: "local",
    }))
    expect(decision.allowed).toBe(true)
  })
})
