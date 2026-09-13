import type { ArtifactViewModel } from "./artifact-view-model"

export type ArtifactPreviewRoute = "pdfjs" | "univer-docs" | "univer-sheets" | "readonly" | "unavailable"
export type ArtifactPreviewResult =
  | { route: Exclude<ArtifactPreviewRoute, "unavailable">; editable?: boolean }
  | { route: "unavailable"; reason: "artifact-unavailable" | "preview-not-allowed" | "unsupported-media" }

const PDF = "application/pdf"
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

export function resolveArtifactPreview(artifact: ArtifactViewModel): ArtifactPreviewResult {
  if (artifact.status === "unavailable" || artifact.status === "failed") {
    return { route: "unavailable", reason: "artifact-unavailable" }
  }
  if (!artifact.canPreview) return { route: "unavailable", reason: "preview-not-allowed" }
  switch (artifact.mediaType) {
    case PDF: return { route: "pdfjs" }
    case DOCX: return { route: "univer-docs", editable: true }
    case XLSX: return { route: "univer-sheets", editable: true }
    case PPTX: return { route: "readonly", editable: false }
    default: return { route: "unavailable", reason: "unsupported-media" }
  }
}
