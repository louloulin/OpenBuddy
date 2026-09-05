export interface SessionTenantBinding {
  tenantId: string;
  subject: string;
}

export type StoredSessionTenantIndex = Record<string, SessionTenantBinding | string>;

export function normalizeSessionTenantIndex(value: unknown): Record<string, SessionTenantBinding> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, SessionTenantBinding> = {};
  for (const [sessionId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && entry.trim()) {
      result[sessionId] = { tenantId: entry.trim(), subject: "" };
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const objectEntry = entry as Record<string, unknown>;
    const tenantId = typeof objectEntry.tenantId === "string"
      ? objectEntry.tenantId.trim()
      : "";
    const subject = typeof objectEntry.subject === "string"
      ? objectEntry.subject.trim()
      : "";
    if (tenantId) result[sessionId] = { tenantId, subject };
  }
  return result;
}

export function sessionBindingBelongsTo(binding: SessionTenantBinding | undefined, tenantId: string, subject: string): boolean {
  return Boolean(binding && binding.tenantId === tenantId && binding.subject && binding.subject === subject);
}
