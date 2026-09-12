import { describe, expect, it } from "vitest"
import {
  ARTIFACT_DESCRIPTOR_SCHEMA,
  ArtifactEventLog,
  createArtifactDescriptor,
  redactArtifactMetadata,
  validateArtifactDescriptor,
} from "./artifact-contract"

describe("artifact contract", () => {
  it("creates and validates a renderable descriptor without embedding content", () => {
    const descriptor = createArtifactDescriptor({
      artifactId: "artifact-1", taskId: "task-1", sessionId: "session-1", kind: "pdf",
      name: "report.pdf", mediaType: "application/pdf", sizeBytes: 1024,
      sha256: "a".repeat(64), source: "user-upload", revision: 1,
      capabilities: ["preview", "download"], security: { trust: "local", redacted: false, sensitive: false },
    })
    expect(validateArtifactDescriptor(descriptor)).toEqual({ ok: true, value: descriptor })
    expect(descriptor).not.toHaveProperty("data")
    expect(ARTIFACT_DESCRIPTOR_SCHEMA.$id).toBe("openbuddy.artifact-descriptor.v1")
  })

  it("rejects invalid media metadata and forbidden inline content", () => {
    const result = validateArtifactDescriptor({
      artifactId: "artifact-1", taskId: "task-1", sessionId: "session-1", kind: "pdf",
      name: "report.pdf", mediaType: "application/pdf", sizeBytes: -1, sha256: "bad",
      source: "user-upload", revision: 0, capabilities: ["preview"],
      security: { trust: "local", redacted: false, sensitive: false }, data: "base64-secret",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/sizeBytes|sha256|data/)
  })

  it("redacts secrets recursively while preserving safe metadata", () => {
    expect(redactArtifactMetadata({ provider: "minimax", apiKey: "secret",
      nested: { authorization: "Bearer token", prompt: "private prompt", count: 2 },
      headers: { "x-api-key": "secret" } })).toEqual({ provider: "minimax", apiKey: "[redacted]",
      nested: { authorization: "[redacted]", prompt: "[redacted]", count: 2 }, headers: { "x-api-key": "[redacted]" } })
  })

  it("enforces monotonic event sequence and idempotent event ids", () => {
    const log = new ArtifactEventLog()
    const event = log.append({ eventId: "event-1", type: "artifact.created", artifactId: "artifact-1",
      taskId: "task-1", occurredAt: "2026-01-01T00:00:00.000Z", payload: { revision: 1 } })
    expect(event.sequence).toBe(1)
    expect(log.append({ ...event, sequence: undefined })).toEqual({ ...event, duplicate: true })
    expect(() => log.append({ eventId: "event-2", type: "artifact.updated", artifactId: "artifact-1",
      taskId: "task-1", occurredAt: "2026-01-01T00:00:00.000Z", payload: { revision: 0 }, sequence: 0 })).toThrow(/sequence/)
  })
})
