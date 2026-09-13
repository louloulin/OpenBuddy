import type { ArtifactDescriptor, ArtifactKind } from "@openbuddy/collaboration-evidence"

export type ArtifactViewStatus = "ready" | "loading" | "failed" | "unavailable"

export interface ArtifactViewModel {
  artifactId: string
  taskId?: string
  sessionId?: string
  name?: string
  kind?: ArtifactKind
  mediaType?: string
  sizeBytes?: number
  revision?: number
  capabilities: ArtifactDescriptor["capabilities"]
  status: ArtifactViewStatus
  canPreview: boolean
  canDownload: boolean
  sensitive: boolean
  redacted: boolean
  summary?: string
}

const validKinds = new Set<ArtifactKind>(["document", "spreadsheet", "slides", "pdf", "image", "code", "html", "data", "evidence"])
const validStatuses = new Set<ArtifactViewStatus>(["ready", "loading", "failed", "unavailable"])

function isDescriptor(value: unknown): value is ArtifactDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Partial<ArtifactDescriptor>
  return typeof item.artifactId === "string" && item.artifactId.length > 0
    && typeof item.name === "string" && item.name.length > 0
    && typeof item.mediaType === "string" && item.mediaType.length > 0
    && typeof item.kind === "string" && validKinds.has(item.kind as ArtifactKind)
    && typeof item.revision === "number" && Number.isInteger(item.revision) && item.revision >= 1
    && Array.isArray(item.capabilities)
    && item.security !== undefined && typeof item.security === "object" && item.security !== null
}

export function projectArtifact(input: ArtifactDescriptor, status: ArtifactViewStatus = "ready"): ArtifactViewModel {
  if (!isDescriptor(input) || !validStatuses.has(status)) {
    const artifactId = input && typeof input === "object" && typeof (input as { artifactId?: unknown }).artifactId === "string"
      ? (input as { artifactId: string }).artifactId : "unknown"
    return { artifactId, capabilities: [], status: "unavailable", canPreview: false, canDownload: false, sensitive: false, redacted: false }
  }

  const sensitive = input.security.sensitive === true
  const redacted = input.security.redacted === true
  return {
    artifactId: input.artifactId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    name: input.name,
    kind: input.kind,
    mediaType: input.mediaType,
    sizeBytes: input.sizeBytes,
    revision: input.revision,
    capabilities: [...input.capabilities],
    status,
    canPreview: input.capabilities.includes("preview") && !sensitive,
    canDownload: input.capabilities.includes("download") && !sensitive,
    sensitive,
    redacted,
    ...(sensitive ? {} : { summary: `${input.name} · revision ${input.revision}` }),
  }
}
