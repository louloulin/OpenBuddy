import { describe, expect, it } from "vitest"
import { projectArtifact, type ArtifactViewModel } from "./artifact-view-model"
import { resolveArtifactPreview, type ArtifactPreviewRoute } from "./artifact-preview-route"

function model(overrides: Partial<ArtifactViewModel> = {}): ArtifactViewModel {
  const base = projectArtifact({
    artifactId: "a1", taskId: "t1", sessionId: "s1", kind: "pdf", name: "report.pdf",
    mediaType: "application/pdf", sizeBytes: 1, sha256: "a".repeat(64), source: "tool-output",
    revision: 1, capabilities: ["preview"], security: { trust: "local", redacted: false, sensitive: false },
  }, "ready")
  return { ...base, ...overrides }
}

describe("resolveArtifactPreview", () => {
  it.each([
    ["application/pdf", "pdfjs"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "univer-docs"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "univer-sheets"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "readonly"],
  ] as const)("routes %s to %s", (mediaType, route) => {
    const result = resolveArtifactPreview(model({ mediaType }))
    expect(result).toMatchObject({ route })
  })

  it("does not route unavailable or non-previewable artifacts", () => {
    expect(resolveArtifactPreview(model({ status: "unavailable" }))).toEqual({ route: "unavailable", reason: "artifact-unavailable" })
    expect(resolveArtifactPreview(model({ canPreview: false }))).toEqual({ route: "unavailable", reason: "preview-not-allowed" })
  })

  it("keeps PPTX explicitly read-only", () => {
    const result = resolveArtifactPreview(model({ kind: "slides", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }))
    expect(result).toEqual({ route: "readonly", editable: false })
  })
})
