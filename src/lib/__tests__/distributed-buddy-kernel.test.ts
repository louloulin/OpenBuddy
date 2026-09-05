 import { describe, expect, it } from "vitest"
 import {
 	createEvent,
 	stableDigest,
 	type BuddyCapability,
 	type BuddyIdentity,
 	type BuddyTaskEnvelope,
 } from "@openbuddy/collaboration-protocol"
 import { evaluatePolicy } from "@openbuddy/collaboration-policy"
 import {
 	appendTransition,
 	InMemoryEventStore,
 	initialTaskState,
 	NonceLedger,
 	replayTask,
 	TaskTransitionError,
 	transitionTask,
 } from "@openbuddy/collaboration-task"
 import {
 	buildVerifiedBundle,
 	createEvidenceBundle,
 	recordVerification,
 	verifyBundle,
 } from "@openbuddy/collaboration-evidence"
 
 const requester: BuddyIdentity = {
 	id: "buddy-requester",
 	handle: "requester",
 	displayName: "Requester",
 	ownerUserId: "user-1",
 	trustLevel: "local",
 	status: "idle",
 }
 
 const provider: BuddyIdentity = {
 	id: "buddy-provider",
 	handle: "provider",
 	displayName: "Provider",
 	ownerUserId: "user-2",
 	trustLevel: "org",
 	status: "idle",
 }
 
 const verifier: BuddyIdentity = {
 	id: "buddy-verifier",
 	handle: "verifier",
 	displayName: "Verifier",
 	ownerUserId: "user-3",
 	trustLevel: "org",
 	status: "idle",
 }
 
 const capability: BuddyCapability = {
 	id: "capability.research",
 	providerId: provider.id,
 	description: "Research and summarize sources",
 	inputSchema: { type: "object" },
 	outputSchema: { type: "object" },
 	procedure: [],
 	allowedDataScopes: ["room:research", "artifact:input"],
 	forbiddenDataScopes: ["vault:credentials"],
 	allowedActions: ["read:room", "write:artifact", "external:publish"],
 	forbiddenActions: ["purchase", "delete:production"],
 	acceptanceTests: [{ id: "test.citations", description: "Every claim has a source" }],
 	requiredApproval: "before_external_commit",
 	allowDelegation: true,
 	maxDelegationDepth: 1,
 	visibility: "org",
 }
 
 function envelope(messageType: BuddyTaskEnvelope["messageType"], actor: BuddyIdentity, nonce: string): BuddyTaskEnvelope {
 	return {
 		protocol: "buddy/1.0",
 		messageType,
 		messageId: `${messageType}:${nonce}`,
 		traceId: "trace-1",
 		taskId: "task-1",
 		nonce,
 		sender: actor,
 		recipient: provider,
 		roomRef: "room-research",
 		createdAt: "2026-08-30T10:00:00.000Z",
 		expiresAt: "2026-08-30T11:00:00.000Z",
 		objective: "Produce a cited research brief",
 		capability: capability.id,
 		input: { contextRefs: ["artifact:input-1"] },
 		output: { schema: { type: "object" }, acceptanceTests: capability.acceptanceTests, artifactTypes: ["brief"] },
 		policy: {
 			dataScopes: ["room:research", "artifact:input"],
 			allowedActions: ["read:room", "write:artifact", "external:publish"],
 			forbiddenActions: ["purchase"],
 			approval: "before_external_commit",
 			allowDelegation: true,
 			maxDelegationDepth: 1,
 			retention: "task",
 			expiresAt: "2026-08-30T11:00:00.000Z",
 		},
 		delivery: { acceptedArtifactTypes: ["brief"], retention: "task", redactionRequired: true },
 	}
 }
 
 function runLifecycle() {
 	let state = initialTaskState(envelope("task.propose", requester, "n0"))
 	const events = [] as ReturnType<typeof transitionTask>["event"][]
 	const steps: Array<[BuddyTaskEnvelope["messageType"], BuddyIdentity, string, string?, string?]> = [
 		["task.bid", provider, "n1", provider.id],
 		["task.award", requester, "n2"],
 		["task.authorize", requester, "n3"],
 		["task.progress", provider, "n4"],
 		["task.deliver", provider, "n5"],
 		["task.verify", verifier, "n6", undefined, verifier.id],
 		["task.accept", requester, "n7"],
 	]
 	for (const [messageType, actor, nonce, providerId, verifierId] of steps) {
 		const result = transitionTask(state, {
 			actor,
 			now: `2026-08-30T10:0${events.length + 1}:00.000Z`,
 			envelope: envelope(messageType, actor, nonce),
 			providerId,
 			verifierId,
 		})
 		state = result.state
 		events.push(result.event)
 	}
 	return { state, events }
 }
 
 describe("distributed Buddy protocol kernel", () => {
 	it("runs a requester/provider/verifier lifecycle and replays it", () => {
 		const result = runLifecycle()
 		expect(result.state.status).toBe("accepted")
 		expect(result.state.providerId).toBe(provider.id)
 		expect(result.state.verifierId).toBe(verifier.id)
 		const replayed = replayTask(result.events, envelope("task.propose", requester, "n0"), new Map([
 			[requester.id, requester],
 			[provider.id, provider],
 			[verifier.id, verifier],
 		]))
 		expect(replayed).toMatchObject({ status: "accepted", providerId: provider.id, verifierId: verifier.id, version: 7 })
 	})
 
 	it("rejects provider self-acceptance, illegal actors, and expired envelopes", () => {
 		const initial = initialTaskState(envelope("task.propose", requester, "n0"))
 		expect(() => transitionTask(initial, {
 			actor: provider,
 			now: "2026-08-30T10:00:00.000Z",
 			envelope: envelope("task.accept", provider, "bad"),
 		})).toThrow(TaskTransitionError)
 		expect(() => transitionTask(initial, {
 			actor: provider,
 			now: "2026-08-30T12:00:00.000Z",
 			envelope: envelope("task.bid", provider, "expired"),
 		})).toThrow(/expired/)
 	})
 
 	it("deduplicates nonce mutations and scopes event queries", async () => {
 		const store = new InMemoryEventStore()
 		const ledger = new NonceLedger()
 		const initial = initialTaskState(envelope("task.propose", requester, "n0"))
 		const context = { actor: provider, now: "2026-08-30T10:01:00.000Z", envelope: envelope("task.bid", provider, "same"), providerId: provider.id }
 		const first = await appendTransition(store, ledger, initial, context)
 		const duplicate = await appendTransition(store, ledger, initial, context)
 		expect(first).toEqual(duplicate)
 		expect(await store.query({ taskId: "task-1" })).toHaveLength(1)
 		await expect(store.query({})).rejects.toThrow(/scope is required/)
 	})
 
 	it("calculates policy intersection and blocks unapproved external side effects", () => {
 		const layer = {
 			dataScopes: ["room:research", "artifact:input"],
 			allowedActions: ["read:room", "write:artifact", "external:publish"],
 			forbiddenActions: [],
 			approval: "before_external_commit" as const,
 			allowDelegation: true,
 			maxDelegationDepth: 1,
 			expiresAt: "2026-08-30T11:00:00.000Z",
 		}
 		const decision = evaluatePolicy({ user: layer, organization: layer, task: envelope("task.propose", requester, "n0").policy, capability, now: "2026-08-30T10:00:00.000Z", requestedDataScopes: ["room:research"], requestedActions: ["external:publish"], delegationDepth: 0, trustLevel: "org", approved: false, providerId: provider.id, taskOwnerId: requester.id })
 		expect(decision.allowed).toBe(false)
 		expect(decision.reasons).toContain("external commit requires approval")
 		expect(decision.effectivePolicy?.dataScopes).toEqual(["room:research", "artifact:input"])
 		const overBudget = evaluatePolicy({
 			user: { ...layer, budget: { tokens: 100 } },
 			organization: layer,
 			task: envelope("task.propose", requester, "n0").policy,
 			capability,
 			now: "2026-08-30T10:00:00.000Z",
 			requestedDataScopes: ["room:research"],
 			requestedActions: ["read:room"],
 			requestedBudget: { tokens: 101 },
 			delegationDepth: 0,
 			trustLevel: "org",
 			approved: true,
 			providerId: provider.id,
 			taskOwnerId: requester.id,
 		})
 		expect(overBudget.allowed).toBe(false)
 		expect(overBudget.reasons).toContain("requested token budget exceeds policy limit")
 	})
 
 	it("marks missing independent verification as unverified and validates evidence digest", () => {
 		const verification = recordVerification({ taskId: "task-1", providerId: provider.id, verifierId: provider.id, artifacts: [], evidence: [], accepted: true, now: "2026-08-30T10:20:00.000Z" })
 		expect(verification.status).toBe("unverified")
 		const bundle = buildVerifiedBundle({ taskId: "task-1", providerId: provider.id, verifierId: verifier.id, artifacts: [{ id: "artifact-1", taskId: "task-1", kind: "brief", title: "Brief", digest: stableDigest("brief"), visibility: "room" }], evidence: [{ id: "evidence-1", taskId: "task-1", type: "source", title: "Source", artifactRefs: ["artifact-1"], digest: stableDigest("source") }], accepted: true, now: "2026-08-30T10:20:00.000Z" })
 		expect(bundle.verification?.status).toBe("verified")
 		expect(verifyBundle(bundle)).toBe(true)
 		const tampered = createEvidenceBundle({ ...bundle, evidence: [{ ...bundle.evidence[0], title: "Tampered" }] })
 		expect(verifyBundle({ ...tampered, bundleDigest: bundle.bundleDigest })).toBe(false)
 	})
 
 	it("creates stable payload digests independent of object key order", () => {
 		expect(stableDigest({ b: 2, a: 1 })).toBe(stableDigest({ a: 1, b: 2 }))
 		expect(stableDigest(undefined)).toBe(stableDigest(undefined))
 		const event = createEvent({ id: "e1", communityId: "local", kind: "test", actor: requester, nonce: "n", createdAt: "2026-08-30T10:00:00.000Z", payload: { z: 1, a: 2 } })
 		expect(event.payloadDigest).toBe(stableDigest({ a: 2, z: 1 }))
 	})
 })
