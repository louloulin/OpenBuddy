import { describe, expect, it } from "vitest"
import { createArtifactDescriptor, type ArtifactDescriptor } from "@openbuddy/collaboration-evidence"
import { projectArtifact, type ArtifactViewModel } from "./artifact-view-model"

function descriptor(overrides: Partial<ArtifactDescriptor> = {}): ArtifactDescriptor {
  return createArtifactDescriptor({
    artifactId: "artifact-1", taskId: "task-1", sessionId: "session-1", kind: "pdf",
    name: "report.pdf", mediaType: "application/pdf", sizeBytes: 128, sha256: "a".repeat(64),
    source: "tool-output", revision: 1, capabilities: ["preview", "download"],
    security: { trust: "local", redacted: false, sensitive: false }, ...overrides,
  })
}

describe("projectArtifact", () => {
  it.each([
    ["pdf", "application/pdf", "pdf"],
    ["document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
    ["spreadsheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "spreadsheet"],
    ["slides", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "slides"],
  ] as const)("projects %s into a previewable view model", (kind, mediaType, expectedKind) => {
    const result = projectArtifact(descriptor({ kind, mediaType }))
    expect(result).toMatchObject({ artifactId: "artifact-1", name: "report.pdf", kind: expectedKind, mediaType, status: "ready", canPreview: true, canDownload: true })
  })

  it("marks sensitive artifacts and removes preview capability", () => {
    const result = projectArtifact(descriptor({ capabilities: ["download"], security: { trust: "remote", redacted: true, sensitive: true } }))
    expect(result).toMatchObject({ status: "ready", canPreview: false, canDownload: false, sensitive: true, redacted: true })
    expect(result.summary).toBeUndefined()
  })

  it("returns unavailable instead of throwing for invalid descriptors", () => {
    const result: ArtifactViewModel = projectArtifact({ artifactId: "broken" } as unknown as ArtifactDescriptor)
    expect(result).toMatchObject({ artifactId: "broken", status: "unavailable", canPreview: false, canDownload: false })
  })

  it("keeps the newest revision in the projection", () => {
    expect(projectArtifact(descriptor({ revision: 7 })).revision).toBe(7)
  })
})
