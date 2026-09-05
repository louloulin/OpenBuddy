export const CASDOOR_CAPABILITIES = [
  "team.workspace",
  "cloud.sync",
  "protected.resources",
  "admin.portal",
  "billing.read",
  "audit.read",
] as const;

export type CasdoorCapability = (typeof CASDOOR_CAPABILITIES)[number];

export const CASDOOR_TENANT_PERMISSIONS = [
  "tenant.users.read",
  "tenant.users.write",
  "tenant.groups.read",
  "tenant.groups.write",
  "tenant.roles.read",
  "tenant.roles.write",
  "tenant.permissions.read",
  "tenant.permissions.write",
  "tenant.organizations.read",
  "tenant.organizations.write",
  "tenant.rules.read",
  "tenant.rules.write",
  "tenant.settings.read",
  "tenant.settings.write",
  "tenant.audit.read",
  "tenant.policy.read",
  "tenant.policy.write",
  "tenant.lifecycle.write",
  "tenant.usage.write",
  "tenant.billing.read",
  "tenant.billing.write",
] as const;

export type CasdoorTenantPermission = (typeof CASDOOR_TENANT_PERMISSIONS)[number];

export interface CasdoorTenantMembership {
  tenantId: string;
  roles: string[];
  permissions: string[];
  groups: string[];
  capabilities: CasdoorCapability[];
  tenantPermissions: CasdoorTenantPermission[];
  isTenantAdmin: boolean;
  plan?: string;
}

export type CasdoorTenantPlan = "free" | "team" | "enterprise" | "custom" | string;

export interface CasdoorIdentity {
  subject: string;
  owner?: string;
  organization?: string;
  organizations: string[];
  displayName?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  provider?: string;
  isForbidden: boolean;
  isDeleted: boolean;
  isAdmin: boolean;
  roles: string[];
  permissions: string[];
  groups: string[];
  capabilities: CasdoorCapability[];
  tenantMemberships: CasdoorTenantMembership[];
  customFields?: Record<string, string | number | boolean>;
}

const AUTHORIZATION_CLAIM_KEYS = new Set([
  "sub",
  "id",
  "name",
  "owner",
  "organization",
  "organizations",
  "org",
  "roles",
  "role",
  "permissions",
  "permission",
  "scopes",
  "capabilities",
  "capability",
  "groups",
  "group",
  "isAdmin",
  "isForbidden",
  "isDeleted",
]);

interface ClaimEntry {
  value: string;
  owner?: string;
  enabled: boolean;
  denied: boolean;
}

function claimEntries(value: unknown): ClaimEntry[] {
  if (Array.isArray(value)) return value.flatMap(claimEntries);
  if (typeof value === "string") {
    return value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean).map((item) => ({ value: item, enabled: true, denied: false }));
  }
  if (!value || typeof value !== "object") return [];
  const objectValue = value as Record<string, unknown>;
  const name = typeof objectValue.name === "string" ? objectValue.name.trim() : "";
  if (!name) return [];
  const owner = typeof objectValue.owner === "string" ? objectValue.owner.trim() : "";
  const effect = typeof objectValue.effect === "string" ? objectValue.effect.trim().toLowerCase() : "";
  return [{
    value: owner && !name.includes("/") ? `${owner}/${name}` : name,
    ...(owner ? { owner } : {}),
    enabled: objectValue.isEnabled !== false && objectValue.enabled !== false,
    denied: effect === "deny" || effect === "denied",
  }];
}

function claimValues(entries: ClaimEntry[]): string[] {
  return [...new Set(entries.filter((entry) => entry.enabled).map((entry) => entry.value))];
}

function stringList(value: unknown): string[] {
  return claimValues(claimEntries(value));
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizePermission(value: string): string {
  return value.trim().replace(/^.*[/:#]/, "").replace(/[()]/g, ".").toLowerCase();
}

function capabilityFrom(value: string): CasdoorCapability | undefined {
  const normalized = normalizePermission(value);
  return CASDOOR_CAPABILITIES.find((capability) => normalized === capability);
}

function permissionFrom(value: string): CasdoorTenantPermission | undefined {
  const normalized = normalizePermission(value);
  return CASDOOR_TENANT_PERMISSIONS.find((permission) => normalized === permission);
}

function claimOwner(entry: ClaimEntry): string | undefined {
  if (entry.owner) return entry.owner;
  const separator = entry.value.indexOf("/");
  return separator > 0 ? entry.value.slice(0, separator) : undefined;
}

function claimName(entry: ClaimEntry): string {
  const separator = entry.value.indexOf("/");
  return separator > 0 ? entry.value.slice(separator + 1) : entry.value;
}

function tenantIdValues(
  claims: Record<string, unknown>,
  entries: ClaimEntry[],
): string[] {
  const declared = [
    ...stringList(claims.organizations ?? claims.organization ?? claims.org ?? claims.owner),
    ...entries.map(claimOwner),
  ];
  return [...new Set(declared.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}

function extractCasdoorPlans(claims: Record<string, unknown>, primaryTenantId: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const properties = claims.properties && typeof claims.properties === "object" && !Array.isArray(claims.properties)
    ? claims.properties as Record<string, unknown>
    : null;
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (!value || typeof value !== "object") continue;
      const planField = (value as Record<string, unknown>).plan;
      if (typeof planField === "string" && planField.trim()) out[key] = planField.trim();
    }
    if (primaryTenantId && !out[primaryTenantId]) {
      const propsForTenant = properties[primaryTenantId];
      if (propsForTenant && typeof propsForTenant === "object") {
        const planField = (propsForTenant as Record<string, unknown>).plan;
        if (typeof planField === "string" && planField.trim()) out[primaryTenantId] = planField.trim();
      }
    }
  }
  const single = firstString(claims.plan);
  if (single && primaryTenantId && !out[primaryTenantId]) out[primaryTenantId] = single;
  return out;
}

function tenantMemberships(
  tenantIds: string[],
  primaryTenantId: string | undefined,
  roleEntries: ClaimEntry[],
  permissionEntries: ClaimEntry[],
  groupEntries: ClaimEntry[],
  isAdmin: boolean,
  plansByTenantId: Record<string, string> = {},
): CasdoorTenantMembership[] {
  return tenantIds.map((tenantId) => {
    const entriesForTenant = (entries: ClaimEntry[]) => entries.filter((entry) => {
      const owner = claimOwner(entry);
      return owner ? owner === tenantId : tenantId === primaryTenantId;
    });
    const roles = claimValues(entriesForTenant(roleEntries));
    const permissions = claimValues(entriesForTenant(permissionEntries));
    const groups = claimValues(entriesForTenant(groupEntries));
    const scopedEntries = [...entriesForTenant(roleEntries), ...entriesForTenant(permissionEntries), ...entriesForTenant(groupEntries)];
    const deniedCapabilities = new Set(
      scopedEntries.filter((entry) => entry.enabled && entry.denied)
        .map((entry) => capabilityFrom(claimName(entry)))
        .filter((value): value is CasdoorCapability => Boolean(value)),
    );
    const capabilities = [...new Set(scopedEntries
      .filter((entry) => entry.enabled && !entry.denied)
      .map((entry) => capabilityFrom(claimName(entry)))
      .filter((value): value is CasdoorCapability => value !== undefined)
      .filter((value) => !deniedCapabilities.has(value)))];
    const tenantPermissions = [...new Set(scopedEntries
      .filter((entry) => entry.enabled && !entry.denied)
      .map((entry) => permissionFrom(claimName(entry)))
      .filter((value): value is CasdoorTenantPermission => Boolean(value)))];
    const tenantAdminRole = roles.some((role) => ["tenant-admin", "tenant_admin", "openbuddy-tenant-admin"].includes(normalizePermission(role)));
    if (isAdmin || tenantAdminRole) {
      for (const capability of CASDOOR_CAPABILITIES) {
        if (!deniedCapabilities.has(capability) && !capabilities.includes(capability)) capabilities.push(capability);
      }
    }
    if (isAdmin || tenantAdminRole) {
      for (const permission of CASDOOR_TENANT_PERMISSIONS) {
        if (!tenantPermissions.includes(permission)) tenantPermissions.push(permission);
      }
    }
    const plan = plansByTenantId[tenantId];
    return { tenantId, roles, permissions, groups, capabilities, tenantPermissions, isTenantAdmin: isAdmin || tenantAdminRole, ...(plan ? { plan } : {}) };
  });
}

export function normalizeCasdoorClaims(
  claims: Record<string, unknown>,
  provider?: string,
): CasdoorIdentity {
  const roleEntries = claimEntries(claims.roles ?? claims.role);
  const permissionEntries = claimEntries(claims.permissions ?? claims.permission ?? claims.scopes ?? claims.capabilities ?? claims.capability);
  const groupEntries = claimEntries(claims.groups ?? claims.group);
  const roles = claimValues(roleEntries);
  const permissions = claimValues(permissionEntries);
  const groups = claimValues(groupEntries);
  const isForbidden = claims.isForbidden === true || claims.isForbidden === "true";
  const isDeleted = claims.isDeleted === true || claims.isDeleted === "true";
  const denied = new Set(
    [...permissionEntries, ...groupEntries, ...roleEntries]
      .filter((entry) => entry.enabled && entry.denied)
      .map((entry) => capabilityFrom(entry.value))
      .filter((value): value is CasdoorCapability => Boolean(value)),
  );
  const explicit = [...permissions, ...groups, ...roles]
    .map(capabilityFrom)
    .filter((value): value is CasdoorCapability => value !== undefined && !denied.has(value));
  const adminRole = !isForbidden && !isDeleted && [...roleEntries.filter((entry) => entry.enabled && !entry.denied).map((entry) => entry.value), ...(claims.isAdmin === true ? ["admin"] : [])].some((role) =>
    ["admin", "owner", "super_admin", "administrator"].includes(normalizePermission(role)),
  );
  const capabilities = new Set<CasdoorCapability>(isForbidden || isDeleted ? [] : explicit);
  if (adminRole) for (const capability of CASDOOR_CAPABILITIES) if (!denied.has(capability)) capabilities.add(capability);
  const organizations = [...new Set(stringList(claims.organizations ?? claims.organization ?? claims.org ?? claims.owner))];
  const owner = firstString(claims.owner, claims.organization, claims.org);
  const admin = adminRole;
  const tenantIds = tenantIdValues(claims, [...roleEntries, ...permissionEntries, ...groupEntries]);
  if (tenantIds.length === 0 && admin) tenantIds.push(owner ?? organizations[0] ?? "built-in");
  const plansByTenantId = extractCasdoorPlans(claims, owner ?? organizations[0]);
  const memberships = tenantMemberships(tenantIds, owner ?? organizations[0], roleEntries, permissionEntries, groupEntries, admin, plansByTenantId);
  const tenantCapabilities = new Set(memberships.flatMap((membership) => membership.capabilities));
  const allCapabilities = [...new Set([...capabilities, ...tenantCapabilities])];
  const customFields = extractCasdoorCustomFields(claims);
  return {
    subject: firstString(claims.sub, claims.id, claims.name) ?? "",
    owner,
    organization: firstString(claims.organization, claims.org, claims.owner),
    organizations,
    displayName: firstString(claims.displayName, claims.name, claims.preferred_username),
    email: firstString(claims.email),
    phone: firstString(claims.phone),
    avatar: firstString(claims.avatar, claims.permanentAvatar, claims.picture),
    provider,
    isForbidden,
    isDeleted,
    isAdmin: admin,
    roles: [...new Set(roles)],
    permissions: [...new Set(permissions)],
    groups: [...new Set(groups)],
    capabilities: allCapabilities,
    tenantMemberships: memberships,
    ...(Object.keys(customFields).length ? { customFields } : {}),
  };
}

function extractCasdoorCustomFields(claims: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const value = claims.properties;
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      if (raw) out[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = raw;
    } else if (typeof raw === "boolean") {
      out[key] = raw;
    }
  }
  return out;
}

export function mergeCasdoorClaims(
  signedClaims: Record<string, unknown>,
  userinfo: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...userinfo, ...signedClaims };
  for (const key of AUTHORIZATION_CLAIM_KEYS) {
    const signedHasKey = Object.prototype.hasOwnProperty.call(signedClaims, key);
    const userinfoHasKey = Object.prototype.hasOwnProperty.call(userinfo, key);
    if (signedHasKey && userinfoHasKey && ["roles", "role", "permissions", "permission", "scopes", "capabilities", "capability", "groups", "group"].includes(key)) {
      merged[key] = restrictClaimSet(signedClaims[key], userinfo[key]);
    } else if (signedHasKey && userinfoHasKey && ["organizations", "organization", "org"].includes(key)) {
      const signedOrganizations = stringList(signedClaims.organizations ?? signedClaims.organization ?? signedClaims.org);
      const currentOrganizations = stringList(userinfo.organizations ?? userinfo.organization ?? userinfo.org);
      merged.organizations = signedOrganizations.filter((value) => currentOrganizations.includes(value));
    } else if (signedHasKey) {
      merged[key] = signedClaims[key];
    } else if (userinfoHasKey) {
      merged[key] = userinfo[key];
    }
  }
  if (signedClaims.isForbidden === true || signedClaims.isForbidden === "true" || userinfo.isForbidden === true || userinfo.isForbidden === "true") {
    merged.isForbidden = true;
  }
  if (signedClaims.isDeleted === true || signedClaims.isDeleted === "true" || userinfo.isDeleted === true || userinfo.isDeleted === "true") {
    merged.isDeleted = true;
  }
  return merged;
}

function restrictClaimSet(
  signedValue: unknown,
  userinfoValue: unknown,
): unknown {
  const signedEntries = claimEntries(signedValue);
  const userinfoEntries = claimEntries(userinfoValue).filter((entry) => entry.enabled && !entry.denied);
  if (!signedEntries.length || !userinfoEntries.length) return [];
  return signedEntries.filter((entry) => userinfoEntries.some((candidate) => {
    const signedOwner = claimOwner(entry)?.toLowerCase();
    const candidateOwner = claimOwner(candidate)?.toLowerCase();
    return claimName(entry).toLowerCase() === claimName(candidate).toLowerCase()
      && (!signedOwner || !candidateOwner || signedOwner === candidateOwner);
  })).map((entry) => entry.value);
}

export function restrictCasdoorClaimsFromUserinfo(
  signedClaims: Record<string, unknown>,
  userinfo: Record<string, unknown>,
): Record<string, unknown> {
  const restricted = { ...mergeCasdoorClaims(signedClaims, userinfo) };
  for (const key of ["roles", "role", "permissions", "permission", "scopes", "capabilities", "capability", "groups", "group"] as const) {
    if (Object.prototype.hasOwnProperty.call(userinfo, key)) restricted[key] = restrictClaimSet(signedClaims[key], userinfo[key]);
  }
  if (Object.prototype.hasOwnProperty.call(userinfo, "organizations") || Object.prototype.hasOwnProperty.call(userinfo, "organization") || Object.prototype.hasOwnProperty.call(userinfo, "org")) {
    const signedOrganizations = stringList(signedClaims.organizations ?? signedClaims.organization ?? signedClaims.org);
    const currentOrganizations = stringList(userinfo.organizations ?? userinfo.organization ?? userinfo.org);
    restricted.organizations = signedOrganizations.filter((value) => currentOrganizations.includes(value));
  }
  if (Object.prototype.hasOwnProperty.call(userinfo, "isAdmin")) restricted.isAdmin = signedClaims.isAdmin === true && userinfo.isAdmin === true;
  return restricted;
}

export function hasCasdoorCapability(
  identity: CasdoorIdentity | null | undefined,
  capability: CasdoorCapability,
): boolean {
  return Boolean(identity?.capabilities.includes(capability));
}
