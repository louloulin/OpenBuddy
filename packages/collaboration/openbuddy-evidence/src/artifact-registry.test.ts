import { describe, expect, it } from "vitest"
import { ArtifactRegistry, createArtifactDescriptor, type ArtifactDescriptor } from "./artifact-contract"

function descriptor(overrides: Partial<ArtifactDescriptor> = {}): ArtifactDescriptor {
  return createArtifactDescriptor({
    artifactId: "artifact-1", taskId: "task-1", sessionId: "session-1", kind: "code",
    name: "main.ts", mediaType: "text/typescript", sizeBytes: 20, sha256: "a".repeat(64),
    source: "tool-output", revision: 1, capabilities: ["preview", "download"],
    security: { trust: "local", redacted: false, sensitive: false }, ...overrides,
  })
}

describe("artifact registry", () => {
  it("upserts revisions and emits a replayable event", () => {
    const registry = new ArtifactRegistry()
    expect(registry.upsert(descriptor()).revision).toBe(1)
    const updated = registry.upsert(descriptor({ name: "main-renamed.ts", sha256: "b".repeat(64) }))
    expect(updated.revision).toBe(2)
    expect(registry.list({ taskId: "task-1", sessionId: "session-1" })).toHaveLength(1)
    expect(registry.events().map((event) => event.type)).toEqual(["artifact.created", "artifact.versioned"])
  })

  it("keeps task and session queries isolated", () => {
    const registry = new ArtifactRegistry([descriptor(), descriptor({ artifactId: "artifact-2", taskId: "task-2", sessionId: "session-2" })])
    expect(registry.list({ taskId: "task-1" }).map((item) => item.artifactId)).toEqual(["artifact-1"])
    expect(registry.list({ sessionId: "session-2" }).map((item) => item.artifactId)).toEqual(["artifact-2"])
  })
})
