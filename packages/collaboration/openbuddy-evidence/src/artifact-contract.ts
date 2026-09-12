export const ARTIFACT_DESCRIPTOR_SCHEMA = {
  $id: "openbuddy.artifact-descriptor.v1",
  type: "object",
  additionalProperties: false,
  required: ["artifactId", "taskId", "sessionId", "kind", "name", "mediaType", "sizeBytes", "sha256", "source", "revision", "capabilities", "security"],
} as const

export class ArtifactRegistry {
  private readonly descriptors = new Map<string, ArtifactDescriptor>()
  private readonly eventLog = new ArtifactEventLog()

  constructor(initial: ArtifactDescriptor[] = []) {
    for (const item of initial) this.descriptors.set(item.artifactId, { ...item, capabilities: [...item.capabilities], security: { ...item.security } })
  }

  upsert(input: ArtifactDescriptor): ArtifactDescriptor {
    const previous = this.descriptors.get(input.artifactId)
    const revision = previous ? previous.revision + 1 : Math.max(1, input.revision)
    const item = { ...input, revision, capabilities: [...input.capabilities], updatedAt: input.updatedAt ?? input.createdAt, security: { ...input.security } }
    this.descriptors.set(item.artifactId, item)
    this.eventLog.append({
      eventId: `${item.artifactId}:${revision}`,
      type: previous ? "artifact.versioned" : "artifact.created",
      artifactId: item.artifactId,
      taskId: item.taskId,
      occurredAt: item.updatedAt ?? new Date(0).toISOString(),
      payload: { revision: item.revision, sha256: item.sha256 },
    })
    return item
  }

  list(filter: { taskId?: string; sessionId?: string } = {}): ArtifactDescriptor[] {
    return [...this.descriptors.values()].filter((item) =>
      (filter.taskId === undefined || item.taskId === filter.taskId) &&
      (filter.sessionId === undefined || item.sessionId === filter.sessionId),
    )
  }

  events(): ArtifactEvent[] { return this.eventLog.list() }
}

export type ArtifactKind = "document" | "spreadsheet" | "slides" | "pdf" | "image" | "code" | "html" | "data" | "evidence"
export type ArtifactSource = "user-upload" | "assistant-generated" | "tool-output" | "evidence"
export type ArtifactCapability = "preview" | "edit-session" | "download" | "export" | "cite"
export type ArtifactTrust = "local" | "workspace" | "remote" | "untrusted"

export interface ArtifactDescriptor {
  artifactId: string
  taskId: string
  sessionId: string
  kind: ArtifactKind
  name: string
  mediaType: string
  sizeBytes: number
  sha256: string
  source: ArtifactSource
  revision: number
  createdAt?: string
  updatedAt?: string
  capabilities: ArtifactCapability[]
  security: { trust: ArtifactTrust; redacted: boolean; sensitive: boolean }
}

export type ArtifactDescriptorInput = Omit<ArtifactDescriptor, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }

export function createArtifactDescriptor(input: ArtifactDescriptorInput): ArtifactDescriptor {
  const { data: _ignored, ...descriptor } = input as ArtifactDescriptorInput & { data?: unknown }
  return { ...descriptor }
}

export type ValidationResult = { ok: true; value: ArtifactDescriptor } | { ok: false; errors: string[] }
const kinds = new Set<ArtifactKind>(["document", "spreadsheet", "slides", "pdf", "image", "code", "html", "data", "evidence"])
const sources = new Set<ArtifactSource>(["user-upload", "assistant-generated", "tool-output", "evidence"])
const capabilities = new Set<ArtifactCapability>(["preview", "edit-session", "download", "export", "cite"])
const trusts = new Set<ArtifactTrust>(["local", "workspace", "remote", "untrusted"])

export function validateArtifactDescriptor(value: unknown): ValidationResult {
  const errors: string[] = []
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["descriptor must be an object"] }
  const item = value as Record<string, unknown>
  for (const key of ["artifactId", "taskId", "sessionId", "name", "mediaType", "source", "kind", "sha256"]) {
    if (typeof item[key] !== "string" || !item[key]) errors.push(`${key} must be a non-empty string`)
  }
  if (typeof item.kind === "string" && !kinds.has(item.kind as ArtifactKind)) errors.push("kind is invalid")
  if (typeof item.source === "string" && !sources.has(item.source as ArtifactSource)) errors.push("source is invalid")
  if (typeof item.sizeBytes !== "number" || !Number.isInteger(item.sizeBytes) || item.sizeBytes < 0) errors.push("sizeBytes must be a non-negative integer")
  if (typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(item.sha256)) errors.push("sha256 must be a 64-character hex digest")
  if (typeof item.revision !== "number" || !Number.isInteger(item.revision) || item.revision < 1) errors.push("revision must be a positive integer")
  if (!Array.isArray(item.capabilities) || item.capabilities.some((entry) => typeof entry !== "string" || !capabilities.has(entry as ArtifactCapability))) errors.push("capabilities is invalid")
  const security = item.security
  if (!security || typeof security !== "object" || Array.isArray(security)) errors.push("security is required")
  else {
    const s = security as Record<string, unknown>
    if (typeof s.trust !== "string" || !trusts.has(s.trust as ArtifactTrust)) errors.push("security.trust is invalid")
    if (typeof s.redacted !== "boolean") errors.push("security.redacted must be boolean")
    if (typeof s.sensitive !== "boolean") errors.push("security.sensitive must be boolean")
  }
  if ("data" in item || "content" in item || "prompt" in item || "apiKey" in item) errors.push("descriptor contains forbidden inline content")
  return errors.length ? { ok: false, errors } : { ok: true, value: value as ArtifactDescriptor }
}

const sensitiveKey = /(?:api.?key|access.?token|refresh.?token|authorization|bearer|password|secret|credential|prompt)/i
export function redactArtifactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactArtifactMetadata)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sensitiveKey.test(key) ? "[redacted]" : redactArtifactMetadata(entry)]))
}

export type ArtifactEventType = "artifact.created" | "artifact.updated" | "artifact.versioned" | "artifact.opened" | "artifact.failed"
export interface ArtifactEventInput { eventId: string; type: ArtifactEventType; artifactId: string; taskId: string; occurredAt: string; payload: Record<string, unknown>; sequence?: number }
export interface ArtifactEvent extends ArtifactEventInput { sequence: number }

export class ArtifactEventLog {
  private readonly events = new Map<string, ArtifactEvent>()
  private lastSequence = 0
  append(input: ArtifactEventInput): ArtifactEvent & { duplicate?: boolean } {
    const existing = this.events.get(input.eventId)
    if (existing) return { ...existing, duplicate: true }
    if (input.sequence !== undefined && input.sequence <= this.lastSequence) throw new Error("artifact event sequence must be monotonic")
    const event: ArtifactEvent = { ...input, sequence: this.lastSequence + 1 }
    this.events.set(event.eventId, event)
    this.lastSequence = event.sequence
    return event
  }
  list(): ArtifactEvent[] { return [...this.events.values()] }
}
