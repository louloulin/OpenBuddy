export interface ComposerAttachment {
  id: string;
  name: string;
  mediaType?: string;
  uri?: string;
}

export interface ComposerReference {
  id: string;
  kind: "file" | "session" | "artifact" | "skill";
  value: string;
}

export interface ComposerEnvelopeInput {
  text: string;
  workspaceId?: string;
  assistantId?: string;
  modelId?: string;
  permissionMode?: "default" | "read-only" | "approve";
  attachments?: readonly ComposerAttachment[];
  references?: readonly ComposerReference[];
  command?: string;
  skill?: string;
  createdAt?: string;
}

export interface ComposerEnvelope {
  schemaVersion: 1;
  envelopeId: string;
  text: string;
  immutable: true;
  createdAt: string;
  workspaceId?: string;
  assistantId?: string;
  modelId?: string;
  permissionMode: "default" | "read-only" | "approve";
  attachments: readonly ComposerAttachment[];
  references: readonly ComposerReference[];
  command?: string;
  skill?: string;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`composer ${field} is required`);
  return value;
}

export function createComposerEnvelope(input: ComposerEnvelopeInput, ids: { envelopeId?: string; now?: () => string } = {}): ComposerEnvelope {
  const text = requiredText(input.text, "text");
  const createdAt = input.createdAt ?? ids.now?.() ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("composer createdAt must be an ISO timestamp");
  const attachments = (input.attachments ?? []).map((attachment) => ({ ...attachment }));
  const references = (input.references ?? []).map((reference) => ({ ...reference }));
  if (attachments.some((attachment) => !attachment.id.trim() || !attachment.name.trim())) throw new Error("composer attachment id and name are required");
  if (references.some((reference) => !reference.id.trim() || !reference.value.trim())) throw new Error("composer reference id and value are required");
  return Object.freeze({
    schemaVersion: 1,
    envelopeId: ids.envelopeId ?? crypto.randomUUID(),
    text,
    immutable: true,
    createdAt,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.assistantId ? { assistantId: input.assistantId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    permissionMode: input.permissionMode ?? "default",
    attachments: Object.freeze(attachments),
    references: Object.freeze(references),
    ...(input.command ? { command: input.command } : {}),
    ...(input.skill ? { skill: input.skill } : {}),
  });
}
