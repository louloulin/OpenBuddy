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

  it("creates a session edit revision only from the current base revision", () => {
    const registry = new ArtifactRegistry([descriptor({ kind: "spreadsheet", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", capabilities: ["preview", "edit-session"] })])
    const result = registry.recordEditRevision({ artifactId: "artifact-1", baseRevision: 1, editor: "univer-sheets", state: "session-saved", snapshotHash: "b".repeat(64), createdAt: "2026-09-13T00:00:00.000Z" })
    expect(result).toEqual({ ok: true, revision: 2, state: "session-saved" })
    expect(registry.list()[0].revision).toBe(2)
    expect(registry.events().at(-1)?.payload).toMatchObject({ baseRevision: 1, revision: 2, editor: "univer-sheets", state: "session-saved", snapshotHash: "b".repeat(64) })
  })

  it("rejects stale edit revisions without changing the descriptor", () => {
    const registry = new ArtifactRegistry([descriptor({ kind: "document", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", capabilities: ["preview", "edit-session"] })])
    registry.upsert(descriptor({ sha256: "c".repeat(64), capabilities: ["preview", "edit-session"] }))
    const result = registry.recordEditRevision({ artifactId: "artifact-1", baseRevision: 1, editor: "univer-docs", state: "dirty", snapshotHash: "d".repeat(64), createdAt: "2026-09-13T00:00:00.000Z" })
    expect(result).toEqual({ ok: false, reason: "stale-base-revision", currentRevision: 2 })
    expect(registry.list()[0].revision).toBe(2)
  })
})
