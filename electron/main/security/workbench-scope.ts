
export interface WorkbenchScopeIdentity {
  configured: boolean;
  tenantId?: string;
  subject?: string;
}

function encodeScopePart(value: string): string {
  return Array.from(value)
    .map((character) => character.codePointAt(0)?.toString(16).padStart(6, "0") ?? "000000")
    .join("");
}

export function workbenchScopeKey(identity: WorkbenchScopeIdentity): string {
  if (!identity.configured) return "local";
  const tenantId = identity.tenantId?.trim();
  const subject = identity.subject?.trim();
  if (!tenantId || !subject) return "signed-out";
  return `tenant-${encodeScopePart(tenantId)}-subject-${encodeScopePart(subject)}`;
}

export function workbenchPiHome(
  identity: WorkbenchScopeIdentity,
  userDataRoot: string,
  legacyRoot: string,
): string {
  const scope = workbenchScopeKey(identity);
  return scope === "local"
    ? legacyRoot
    : `${userDataRoot}/workspaces/${scope}/pi-agent`;
}
