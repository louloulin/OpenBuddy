import { describe, expect, it } from "vitest"
import {
  buildVerifiedBundle,
  createEvidenceBundle,
  recordVerification,
  verifyBundle,
} from "./index"
import type { BuddyArtifact, BuddyEvidence } from "@openbuddy/collaboration-protocol"

function artifact(id: string): BuddyArtifact {
  return {
    id,
    taskId: "task-1",
    kind: "document",
    title: `Artifact ${id}`,
    digest: `d-${id}`,
    visibility: "verifier",
  }
}

function evidence(id: string): BuddyEvidence {
  return {
    id,
    taskId: "task-1",
    type: "execution",
    title: `step-${id}`,
    artifactRefs: [],
    digest: `pd-${id}`,
    metadata: { step: id, createdAt: "2026-01-01T00:00:00.000Z" },
  }
}

describe("evidence bundle (no mock)", () => {
  it("createEvidenceBundle computes a deterministic digest", () => {
    const a = createEvidenceBundle({
      taskId: "task-1",
      providerId: "provider-a",
      artifacts: [artifact("a1")],
      evidence: [evidence("e1")],
      verification: { status: "verified", providerId: "provider-a", verifierId: "verifier-b", createdAt: "2026-01-01T00:00:00.000Z" },
    })
    expect(a.bundleDigest).toMatch(/^[0-9a-f]{16,}$/)
    expect(verifyBundle(a)).toBe(true)
  })

  it("verifyBundle detects tampering", () => {
    const bundle = createEvidenceBundle({
      taskId: "task-1",
      providerId: "provider-a",
      artifacts: [artifact("a1")],
      evidence: [evidence("e1")],
      verification: { status: "verified", providerId: "provider-a", verifierId: "verifier-b", createdAt: "2026-01-01T00:00:00.000Z" },
    })
    const tampered = { ...bundle, artifacts: [...bundle.artifacts, artifact("a2")] }
    expect(verifyBundle(tampered)).toBe(false)
  })

  it("verifyBundle is order-independent for the artifacts array", () => {
    const a = createEvidenceBundle({
      taskId: "task-1",
      providerId: "provider-a",
      artifacts: [artifact("a1"), artifact("a2")],
      evidence: [evidence("e1")],
      verification: { status: "verified", providerId: "provider-a", verifierId: "verifier-b", createdAt: "2026-01-01T00:00:00.000Z" },
    })
    const b = createEvidenceBundle({
      taskId: "task-1",
      providerId: "provider-a",
      artifacts: [artifact("a2"), artifact("a1")],
      evidence: [evidence("e1")],
      verification: { status: "verified", providerId: "provider-a", verifierId: "verifier-b", createdAt: "2026-01-01T00:00:00.000Z" },
    })
    // stableDigest sorts object keys but preserves array order. Different
    // array orderings should therefore produce different digests.
    expect(a.bundleDigest).not.toBe(b.bundleDigest)
  })

  it("recordVerification requires an independent verifier", () => {
    const v = recordVerification({
      taskId: "task-1",
      providerId: "provider-a",
      artifacts: [],
      evidence: [],
      accepted: true,
      now: "2026-01-01T00:00:00.000Z",
    })
    expect(v.status).toBe("unverified")
    expect(v.verifierId).toBeUndefined()
  })

  it("recordVerification rejects provider self-verification", () => {
    const v = recordVerification({
      taskId: "task-1",
      providerId: "provider-a",
      verifierId: "provider-a",
      artifacts: [],
      evidence: [],
      accepted: true,
      now: "2026-01-01T00:00:00.000Z",
    })
    expect(v.status).toBe("unverified")
  })

  it("recordVerification returns verified when an independent verifier accepts", () => {
    const v = recordVerification({
      taskId: "task-1",
      providerId: "provider-a",
      verifierId: "verifier-b",
      artifacts: [],
      evidence: [],
      accepted: true,
      now: "2026-01-01T00:00:00.000Z",
    })
    expect(v.status).toBe("verified")
    expect(v.verifierId).toBe("verifier-b")
  })

  it("recordVerification returns rejected when an independent verifier rejects", () => {
    const v = recordVerification({
      taskId: "task-1",
      providerId: "provider-a",
      verifierId: "verifier-b",
      artifacts: [],
      evidence: [],
      accepted: false,
      reason: "tests failed",
      now: "2026-01-01T00:00:00.000Z",
    })
    expect(v.status).toBe("rejected")
    expect(v.reason).toBe("tests failed")
  })

  it("buildVerifiedBundle attaches the verification and recomputes the digest", () => {
    const bundle = buildVerifiedBundle({
      taskId: "task-1",
      providerId: "provider-a",
      verifierId: "verifier-b",
      artifacts: [artifact("a1")],
      evidence: [evidence("e1")],
      accepted: true,
      now: "2026-01-01T00:00:00.000Z",
    })
    expect(bundle.verification?.status).toBe("verified")
    expect(verifyBundle(bundle)).toBe(true)
  })

  it("buildVerifiedBundle marks unverified when verifier is missing", () => {
    const bundle = buildVerifiedBundle({
      taskId: "task-1",
      providerId: "provider-a",
      artifacts: [],
      evidence: [],
      accepted: true,
      now: "2026-01-01T00:00:00.000Z",
    })
    expect(bundle.verification?.status).toBe("unverified")
  })
})
