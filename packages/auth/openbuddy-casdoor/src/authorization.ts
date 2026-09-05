import {
  hasCasdoorCapability,
  type CasdoorCapability,
  type CasdoorIdentity,
  type CasdoorTenantPermission,
  type CasdoorTenantMembership,
} from "./permissions";

export type CasdoorAuthorizationRequirement =
  | { capability: CasdoorCapability; permission?: never }
  | { permission: CasdoorTenantPermission; capability?: never }
  | { resource: string; action: string; resourceId?: string; capability?: never; permission?: never };

export type CasdoorAuthorizationReason =
  | "allowed"
  | "signed_out"
  | "tenant_not_selected"
  | "tenant_not_member"
  | "permission_denied"
  | "user_forbidden";

export type CasdoorAuthorizationCode =
  | "CASDOOR_AUTHORIZED"
  | "CASDOOR_SIGNED_OUT"
  | "CASDOOR_TENANT_REQUIRED"
  | "CASDOOR_TENANT_MEMBERSHIP_REQUIRED"
  | "CASDOOR_USER_FORBIDDEN"
  | "CASDOOR_PERMISSION_DENIED";

export interface CasdoorAuthorizationDecision {
  allowed: boolean;
  reason: CasdoorAuthorizationReason;
  code: CasdoorAuthorizationCode;
  tenantId?: string;
  subject?: string;
  resource?: string;
  action?: string;
}

export function casdoorAuthorizationCode(reason: CasdoorAuthorizationReason): CasdoorAuthorizationCode {
  switch (reason) {
    case "allowed": return "CASDOOR_AUTHORIZED";
    case "signed_out": return "CASDOOR_SIGNED_OUT";
    case "tenant_not_selected": return "CASDOOR_TENANT_REQUIRED";
    case "tenant_not_member": return "CASDOOR_TENANT_MEMBERSHIP_REQUIRED";
    case "user_forbidden": return "CASDOOR_USER_FORBIDDEN";
    case "permission_denied": return "CASDOOR_PERMISSION_DENIED";
  }
}

export interface CasdoorTenantContext {
  activeTenantId?: string;
  availableTenantIds: string[];
  membership?: CasdoorTenantMembership;
  plan?: string;
  plansByTenantId?: Record<string, string>;
}

export type CasdoorResourceAuthorizationRequest = {
  tenantId?: string;
  resource: string;
  resourceId?: string;
  action: string;
};

export function defaultCasdoorTenantId(identity: CasdoorIdentity | null | undefined): string | undefined {
  if (!identity || identity.isForbidden || identity.isDeleted) return undefined;
  return identity.tenantMemberships[0]?.tenantId
    ?? identity.owner
    ?? identity.organization
    ?? identity.organizations[0];
}

export function casdoorTenantMembership(
  identity: CasdoorIdentity | null | undefined,
  tenantId: string | undefined,
): CasdoorTenantMembership | undefined {
  if (!identity || !tenantId) return undefined;
  return identity.tenantMemberships.find((membership) => membership.tenantId === tenantId);
}

export function buildCasdoorTenantContext(
  identity: CasdoorIdentity | null | undefined,
  activeTenantId?: string,
): CasdoorTenantContext {
  const availableTenantIds = identity?.tenantMemberships.map((membership) => membership.tenantId) ?? [];
  const active = activeTenantId && availableTenantIds.includes(activeTenantId)
    ? activeTenantId
    : availableTenantIds.length === 1
      ? defaultCasdoorTenantId(identity)
      : undefined;
  const plansByTenantId: Record<string, string> = {};
  for (const membership of identity?.tenantMemberships ?? []) {
    if (membership.plan) plansByTenantId[membership.tenantId] = membership.plan;
  }
  const plan = active ? plansByTenantId[active] : undefined;
  return {
    activeTenantId: active,
    availableTenantIds,
    membership: casdoorTenantMembership(identity, active),
    ...(plan ? { plan } : {}),
    plansByTenantId,
  };
}

export function authorizeCasdoorTenant(
  identity: CasdoorIdentity | null | undefined,
  tenantId: string | undefined,
  requirement: CasdoorAuthorizationRequirement,
): CasdoorAuthorizationDecision {
  if (!identity) return { allowed: false, reason: "signed_out", code: casdoorAuthorizationCode("signed_out") };
  if (identity.isForbidden || identity.isDeleted) return { allowed: false, reason: "user_forbidden", code: casdoorAuthorizationCode("user_forbidden"), subject: identity.subject };
  if (!tenantId) return { allowed: false, reason: "tenant_not_selected", code: casdoorAuthorizationCode("tenant_not_selected"), subject: identity.subject };
  const membership = casdoorTenantMembership(identity, tenantId);
  if (!membership) return { allowed: false, reason: "tenant_not_member", code: casdoorAuthorizationCode("tenant_not_member"), tenantId, subject: identity.subject };
  let allowed = false;
  const resource = "resource" in requirement ? requirement.resource.trim() : undefined;
  const action = "resource" in requirement ? requirement.action.trim() : undefined;
  if ("capability" in requirement) {
    allowed = membership.capabilities.includes(requirement.capability as CasdoorCapability) && hasCasdoorCapability(identity, requirement.capability as CasdoorCapability);
  } else if ("permission" in requirement) {
    allowed = membership.tenantPermissions.includes(requirement.permission as CasdoorTenantPermission);
  } else if (resource && action) {
    allowed = identity.isAdmin || membership.isTenantAdmin || resourcePermissionMatches(membership.permissions, resource, action);
  }
  const reason = allowed ? "allowed" : "permission_denied";
  return { allowed, reason, code: casdoorAuthorizationCode(reason), tenantId, subject: identity.subject, resource, action };
}

function resourcePermissionMatches(permissions: string[], resource: string, action: string): boolean {
  const candidates = new Set([
    `${resource}.${action}`,
    `${resource}:${action}`,
    `${resource}/${action}`,
    `resource.${resource}.${action}`,
    `resource:${resource}:${action}`,
  ].map((value) => value.toLowerCase()));
  return permissions.some((permission) => {
    const normalized = permission.trim().toLowerCase();
    return candidates.has(normalized)
      || normalized === `${resource.toLowerCase()}.*`
      || normalized === `${resource.toLowerCase()}:*`
      || normalized === `resource:${resource.toLowerCase()}:*`;
  });
}
