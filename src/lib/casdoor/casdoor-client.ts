import { invoke } from "@/lib/platform/electron-api";
import type { CasdoorIdentity } from "@openbuddy/auth-casdoor";
import type { CasdoorAuthorizationDecision, CasdoorAuthorizationRequirement, CasdoorResourceAuthorizationRequest } from "@openbuddy/auth-casdoor";
import type { CasdoorLoginCapabilities } from "@openbuddy/auth-casdoor";
import type { CasdoorMemberRevocation, CasdoorResourceCreateInput, CasdoorResourceRecord, CasdoorResourceType, CasdoorResourceUpdateInput, CasdoorTenantPolicy, CasdoorTenantPolicyPatch } from "@openbuddy/auth-casdoor";
import type { CasdoorAiCapabilities, CasdoorCommercialModelCatalog, CasdoorCreditAccount, CasdoorCreditLedgerEntry, CasdoorCreditPricing, CasdoorCreditQuote, CasdoorCreditWallet, CasdoorBillingPlan, CasdoorBillingPlanInput, CasdoorBillingOrder, CasdoorBillingOrderInput, CasdoorBillingSubscription, CasdoorReconciliationExport, CasdoorReconciliationReport } from "@openbuddy/auth-casdoor";

export interface CasdoorConfigView {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  smsProviderHint: string;
  wechatProviderHint: string;
  managementUrl: string;
  configured: boolean;
  reason?: string;
}

export interface CasdoorSessionView {
  status: "signed_out" | "signed_in" | "configuration_needed" | "error";
  config: CasdoorConfigView;
  identity: CasdoorIdentity | null;
  expiresAt?: number;
  provider?: string;
  pendingProvider?: string;
  error?: string;
  tenantContext: {
    activeTenantId?: string;
    availableTenantIds: string[];
    membership?: {
      tenantId: string;
      roles: string[];
      permissions: string[];
      groups: string[];
      capabilities: string[];
      tenantPermissions: string[];
      isTenantAdmin: boolean;
      plan?: string;
    };
    plan?: string;
    plansByTenantId?: Record<string, string>;
  };
}

export function casdoorStatus(): Promise<CasdoorSessionView> {
return invoke<CasdoorSessionView>("casdoor:status");
}

export type CasdoorWorkbenchSummary = Pick<CasdoorSessionView, "status" | "provider" | "expiresAt" | "error" | "tenantContext"> & {
  config: Pick<CasdoorConfigView, "configured" | "reason">;
  identity: Pick<CasdoorIdentity, "subject" | "displayName" | "email" | "phone" | "organizations" | "roles" | "groups" | "permissions" | "capabilities" | "isAdmin" | "customFields"> | null;
};

export function casdoorWorkbenchSummary(): Promise<CasdoorWorkbenchSummary> {
  return invoke<CasdoorWorkbenchSummary>("casdoor:workbench-summary");
}

export function casdoorLoginCapabilities(): Promise<CasdoorLoginCapabilities> {
  return invoke<CasdoorLoginCapabilities>("casdoor:capabilities");
}

export function casdoorSaveConfig(patch: Partial<CasdoorConfigView>): Promise<CasdoorConfigView> {
  return invoke<CasdoorConfigView>("casdoor:config-save", patch);
}

export function casdoorLogin(provider: "default" | "sms" | "wechat"): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  return invoke("casdoor:login", provider);
}

export function casdoorRefresh(): Promise<CasdoorSessionView> {
  return invoke<CasdoorSessionView>("casdoor:refresh");
}

export function casdoorLogout(): Promise<{ ok: true }> {
  return invoke<{ ok: true }>("casdoor:logout");
}

export function casdoorOpenManagement(): Promise<{ ok: true }> {
  return invoke<{ ok: true }>("casdoor:open-management");
}

export function casdoorOpenMembershipManagement(): Promise<{ ok: true }> {
  return invoke<{ ok: true }>("casdoor:open-membership-management");
}

export function casdoorCan(capability: string): Promise<boolean> {
  return invoke<boolean>("casdoor:can", capability);
}

export function casdoorSelectTenant(tenantId: string): Promise<CasdoorSessionView> {
  return invoke<CasdoorSessionView>("casdoor:tenant-select", tenantId);
}

export function casdoorAuthorize(requirement: { capability?: string; permission?: string }): Promise<boolean> {
  return invoke<boolean>("casdoor:authorize", requirement);
}

export function casdoorAuthorizeDecision(requirement: CasdoorAuthorizationRequirement): Promise<CasdoorAuthorizationDecision> {
  return invoke<CasdoorAuthorizationDecision>("casdoor:authorize-decision", requirement);
}

export function casdoorAuthorizeResource(request: CasdoorResourceAuthorizationRequest): Promise<boolean> {
  return invoke<boolean>("casdoor:authorize-resource", request);
}

export interface CasdoorAuditEvent {
  id: string;
  at: string;
  event: string;
  outcome: "allow" | "deny" | "success" | "failure";
  subject?: string;
  tenantId?: string;
  resource?: string;
  action?: string;
  reason?: string;
  code?: string;
  provider?: string;
}

export function casdoorListAudit(): Promise<CasdoorAuditEvent[]> {
  return invoke<CasdoorAuditEvent[]>("casdoor:audit-list");
}

export function casdoorGetTenantPolicy(): Promise<CasdoorTenantPolicy> {
  return invoke<CasdoorTenantPolicy>("casdoor:tenant-policy-get");
}

export function casdoorUpdateTenantPolicy(patch: CasdoorTenantPolicyPatch): Promise<CasdoorTenantPolicy> {
  return invoke<CasdoorTenantPolicy>("casdoor:tenant-policy-update", patch);
}

export function casdoorListTenantAudit(limit = 100): Promise<CasdoorAuditEvent[]> {
  return invoke<CasdoorAuditEvent[]>("casdoor:tenant-audit-list", limit);
}

export function casdoorSetMemberRevocation(subject: string, revoked: boolean, reason?: string): Promise<CasdoorMemberRevocation> {
  return invoke<CasdoorMemberRevocation>("casdoor:member-revocation", { subject, revoked, reason });
}

export function casdoorListMemberRevocations(): Promise<CasdoorMemberRevocation[]> {
  return invoke<CasdoorMemberRevocation[]>("casdoor:member-revocations");
}

export function casdoorGatewayHealth(): Promise<CasdoorGatewayHealth | { configured: false }> {
  return invoke<CasdoorGatewayHealth | { configured: false }>("casdoor:gateway-health");
}

export function casdoorTenantHealth(): Promise<CasdoorTenantHealth | { configured: false }> {
  return invoke<CasdoorTenantHealth | { configured: false }>("casdoor:tenant-health");
}

export function casdoorGetRuntimePolicy(): Promise<import("@openbuddy/auth-casdoor").CasdoorTenantPolicy> {
  return invoke("casdoor:runtime-policy-get");
}

export function casdoorGetAiCapabilities(): Promise<CasdoorAiCapabilities | { configured: false }> {
  return invoke<CasdoorAiCapabilities | { configured: false }>("casdoor:ai-capabilities");
}

export function casdoorGetCommercialModelCatalog(): Promise<CasdoorCommercialModelCatalog | { configured: false }> {
  return invoke<CasdoorCommercialModelCatalog | { configured: false }>("casdoor:commercial-model-catalog");
}

export function casdoorGetCredits(subject?: string): Promise<CasdoorCreditAccount> {
  return invoke<CasdoorCreditAccount>("casdoor:credits-get", subject);
}

export function casdoorListCreditWallets(): Promise<CasdoorCreditWallet[]> {
  return invoke<CasdoorCreditWallet[]>("casdoor:wallets-list");
}

export function casdoorGetSelectedCreditWalletId(): Promise<string | undefined> {
  return invoke<string | undefined>("casdoor:wallet-selected");
}

export function casdoorSelectCreditWallet(walletId?: string): Promise<{ selectedWalletId?: string; wallets: CasdoorCreditWallet[] }> {
  return invoke("casdoor:wallet-select", walletId);
}

export function casdoorGetSelectedCreditWalletCredits(): Promise<CasdoorCreditAccount> {
  return invoke<CasdoorCreditAccount>("casdoor:wallet-credits");
}

export function casdoorListSelectedCreditWalletLedger(limit = 100): Promise<CasdoorCreditLedgerEntry[]> {
  return invoke<CasdoorCreditLedgerEntry[]>("casdoor:wallet-ledger", limit);
}

export function casdoorListCreditLedger(limit = 100, subject?: string): Promise<CasdoorCreditLedgerEntry[]> {
  return invoke<CasdoorCreditLedgerEntry[]>("casdoor:credits-ledger", { limit, subject });
}

export function casdoorGetCreditReconciliation(since?: string, until?: string, walletId?: string): Promise<CasdoorReconciliationReport> {
  return invoke<CasdoorReconciliationReport>("casdoor:credits-reconciliation", { since, until, walletId });
}

export function casdoorExportCreditReconciliation(since?: string, until?: string, walletId?: string): Promise<CasdoorReconciliationExport> {
  return invoke<CasdoorReconciliationExport>("casdoor:credits-reconciliation-export", { since, until, walletId });
}

export function casdoorListCreditPricing(): Promise<CasdoorCreditPricing[]> {
  return invoke<CasdoorCreditPricing[]>("casdoor:credits-pricing");
}

export function casdoorQuoteCredits(input: { model: string; promptTokens: number; completionTokens: number }): Promise<CasdoorCreditQuote> {
  return invoke<CasdoorCreditQuote>("casdoor:credits-quote", input);
}

export function casdoorUpdateCreditPricing(input: Omit<CasdoorCreditPricing, "updatedAt" | "updatedBy">): Promise<CasdoorCreditPricing> {
  return invoke<CasdoorCreditPricing>("casdoor:credits-pricing-update", input);
}

export function casdoorGrantCredits(input: { subject?: string; amount: number; type?: "grant"; reason?: string; validDays?: number; idempotencyKey: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry }> {
  return invoke("casdoor:credits-grant", input);
}

export function casdoorIssueWelcomeCredit(input: { subject?: string; idempotencyKey: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry }> {
  return invoke("casdoor:credits-welcome", input);
}

export function casdoorReserveCredits(input: { amount?: number; model?: string; promptTokens?: number; completionTokens?: number; idempotencyKey: string; reason?: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry }> {
  return invoke("casdoor:credits-reserve", input);
}

export function casdoorSettleCredits(input: { reservationKey: string; amount: number; model?: string; promptTokens?: number; completionTokens?: number; newApiRequestId?: string; reason?: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry; refunded?: number }> {
  return invoke("casdoor:credits-settle", input);
}

export function casdoorReleaseCredits(reservationKey: string): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry; refunded?: number }> {
  return invoke("casdoor:credits-release", reservationKey);
}

export function casdoorExpireCredits(subject?: string): Promise<{ expired: number; account: CasdoorCreditAccount }> {
  return invoke("casdoor:credits-expire", subject);
}

export function casdoorListBillingPlans(): Promise<CasdoorBillingPlan[]> {
  return invoke<CasdoorBillingPlan[]>("casdoor:billing-plans");
}

export function casdoorGetBillingSubscription(): Promise<CasdoorBillingSubscription | null> {
  return invoke<CasdoorBillingSubscription | null>("casdoor:billing-subscription");
}

export function casdoorUpsertBillingPlan(input: CasdoorBillingPlanInput): Promise<CasdoorBillingPlan> {
  return invoke<CasdoorBillingPlan>("casdoor:billing-plan-upsert", input);
}

export function casdoorListBillingOrders(limit = 100, subject?: string): Promise<CasdoorBillingOrder[]> {
  return invoke<CasdoorBillingOrder[]>("casdoor:billing-orders", { limit, subject });
}

export function casdoorCreateBillingOrder(input: CasdoorBillingOrderInput): Promise<CasdoorBillingOrder> {
  return invoke<CasdoorBillingOrder>("casdoor:billing-order-create", input);
}

export function casdoorRefundBillingOrder(orderNo: string): Promise<CasdoorBillingOrder> {
  return invoke<CasdoorBillingOrder>("casdoor:billing-order-refund", orderNo);
}

export function casdoorExpireBillingOrder(orderNo: string): Promise<CasdoorBillingOrder> {
  return invoke<CasdoorBillingOrder>("casdoor:billing-order-expire", orderNo);
}

export function casdoorListResources(type?: CasdoorResourceType): Promise<CasdoorResourceRecord[]> {
  return invoke<CasdoorResourceRecord[]>("casdoor:resource-list", type);
}

export function casdoorGetResource(id: string): Promise<CasdoorResourceRecord> {
  return invoke<CasdoorResourceRecord>("casdoor:resource-get", id);
}

export function casdoorCreateResource(input: CasdoorResourceCreateInput): Promise<CasdoorResourceRecord> {
  return invoke<CasdoorResourceRecord>("casdoor:resource-create", input);
}

export function casdoorUpdateResource(id: string, input: CasdoorResourceUpdateInput): Promise<CasdoorResourceRecord> {
  return invoke<CasdoorResourceRecord>("casdoor:resource-update", { id, input });
}

export function casdoorDeleteResource(id: string, expectedVersion: number): Promise<{ ok: true }> {
  return invoke<{ ok: true }>("casdoor:resource-delete", { id, expectedVersion });
}

export interface CasdoorListQuery {
  owner?: string;
  page?: number;
  pageSize?: number;
  query?: string;
}

export interface CasdoorUserPatch {
  owner: string;
  name: string;
  displayName?: string;
  email?: string;
  phone?: string;
  isForbidden?: boolean;
  groups?: string[];
}

export interface CasdoorUserInput extends CasdoorUserPatch {
  type?: string;
}

export interface CasdoorUserInvite {
  owner: string;
  email: string;
  role?: string;
  group?: string;
  hoursValid?: number;
}

export interface CasdoorUserInviteResult {
  owner: string;
  email: string;
  link?: string;
  token?: string;
  expiresAt?: string;
  raw?: Record<string, unknown>;
}

export interface CasdoorAccountLinkingOption {
  type?: string;
  provider?: string;
  identifier?: string;
  displayName?: string;
  linkedAt?: string;
  enabled?: boolean;
}

export interface CasdoorAccountLinkingInput {
  owner: string;
  name: string;
  type: string;
  identifier: string;
}

export interface CasdoorOrganizationBranding {
  owner: string;
  name: string;
  displayName?: string;
  logo?: string;
  websiteUrl?: string;
  favicon?: string;
  defaultApplication?: string;
  disableSignin?: boolean;
}

export interface CasdoorSessionSummary {
  sessionId?: string;
  owner?: string;
  name?: string;
  application?: string;
  deviceName?: string;
  ip?: string;
  userAgent?: string;
  createdAt?: string;
  expiresAt?: string;
  refreshedAt?: string;
  isOnline?: boolean;
}

export interface CasdoorSessionRevokeInput {
  owner: string;
  name: string;
  sessionId: string;
}




export interface CasdoorRoleInput {
  owner: string;
  name: string;
  displayName?: string;
  description?: string;
  users?: string[];
  groups?: string[];
  roles?: string[];
  isEnabled?: boolean;
}

export interface CasdoorPermissionInput {
  owner: string;
  name: string;
  displayName?: string;
  description?: string;
  users?: string[];
  groups?: string[];
  roles?: string[];
  model?: string;
  resourceType?: string;
  resources?: string[];
  actions?: string[];
  effect?: string;
  isEnabled?: boolean;
}

export interface CasdoorOrganizationInput {
  owner: string;
  name: string;
  displayName?: string;
  websiteUrl?: string;
  logo?: string;
  favicon?: string;
  defaultApplication?: string;
  disableSignin?: boolean;
}

export interface CasdoorGroupInput {
  owner: string;
  name: string;
  displayName?: string;
  manager?: string;
  contactEmail?: string;
  type?: string;
  parentId?: string;
  isEnabled?: boolean;
  users?: string[];
}

export interface CasdoorRuleExpression {
  name?: string;
  operator?: string;
  value: string;
}

export interface CasdoorRuleInput {
  owner: string;
  name: string;
  type: string;
  expressions?: CasdoorRuleExpression[];
  action?: string;
  statusCode?: number;
  reason?: string;
  isVerbose?: boolean;
}

export interface CasdoorUserSummary {
  owner: string;
  name: string;
  displayName?: string;
  email?: string;
  phone?: string;
  isAdmin?: boolean;
  isForbidden?: boolean;
  createdTime?: string;
  groups?: string[];
}

export interface CasdoorOrganizationSummary {
  owner: string;
  name: string;
  displayName?: string;
  websiteUrl?: string;
  createdTime?: string;
  disableSignin?: boolean;
}

export interface CasdoorRoleSummary {
  owner: string;
  name: string;
  displayName?: string;
  isEnabled?: boolean;
  createdTime?: string;
  subUsers?: string[];
  subRoles?: string[];
  users?: string[];
  groups?: string[];
  roles?: string[];
}

export interface CasdoorPermissionSummary {
  owner: string;
  name: string;
  displayName?: string;
  resourceType?: string;
  resources?: string[];
  actions?: string[];
  effect?: string;
  isEnabled?: boolean;
  model?: string;
  roles?: string[];
  users?: string[];
  groups?: string[];
  createdTime?: string;
}

export interface CasdoorGroupSummary {
  owner: string;
  name: string;
  displayName?: string;
  createdTime?: string;
  parent?: string;
  users?: string[];
  isEnabled?: boolean;
}

export interface CasdoorRuleSummary {
  owner: string;
  name: string;
  createdTime?: string;
  updatedTime?: string;
  type?: string;
  expressions?: string;
  action?: string;
  statusCode?: number;
  reason?: string;
}

export function casdoorListUsers(query: CasdoorListQuery = {}): Promise<CasdoorUserSummary[]> {
  return invoke<CasdoorUserSummary[]>("casdoor:list-users", query);
}

export function casdoorListOrganizations(query: CasdoorListQuery = {}): Promise<CasdoorOrganizationSummary[]> {
  return invoke<CasdoorOrganizationSummary[]>("casdoor:list-organizations", query);
}

export function casdoorListRoles(query: CasdoorListQuery = {}): Promise<CasdoorRoleSummary[]> {
  return invoke<CasdoorRoleSummary[]>("casdoor:list-roles", query);
}

export function casdoorListPermissions(query: CasdoorListQuery = {}): Promise<CasdoorPermissionSummary[]> {
  return invoke<CasdoorPermissionSummary[]>("casdoor:list-permissions", query);
}

export function casdoorListGroups(query: CasdoorListQuery = {}): Promise<CasdoorGroupSummary[]> {
  return invoke<CasdoorGroupSummary[]>("casdoor:list-groups", query);
}

export function casdoorListRules(query: CasdoorListQuery = {}): Promise<CasdoorRuleSummary[]> {
  return invoke<CasdoorRuleSummary[]>("casdoor:list-rules", query);
}

export function casdoorUpdateUser(patch: CasdoorUserPatch): Promise<void> {
  return invoke<void>("casdoor:user-update", patch);
}

export function casdoorAddUser(user: CasdoorUserInput): Promise<void> {
  return invoke<void>("casdoor:user-add", user);
}

export function casdoorDeleteUser(owner: string, name: string): Promise<void> {
  return invoke<void>("casdoor:user-delete", { owner, name });
}

export function casdoorInviteUser(invite: CasdoorUserInvite): Promise<CasdoorUserInviteResult> {
  return invoke<CasdoorUserInviteResult>("casdoor:user-invite", invite);
}

export function casdoorListAccountLinking(owner: string, name: string): Promise<CasdoorAccountLinkingOption[]> {
  return invoke<CasdoorAccountLinkingOption[]>("casdoor:list-account-linking", { owner, name });
}

export function casdoorUnlinkAccount(input: CasdoorAccountLinkingInput): Promise<void> {
  return invoke<void>("casdoor:unlink-account", input);
}

export function casdoorGetOrganization(owner: string, name: string): Promise<CasdoorOrganizationBranding> {
  return invoke<CasdoorOrganizationBranding>("casdoor:get-organization", { owner, name });
}

export function casdoorListUserSessions(owner: string, name: string): Promise<CasdoorSessionSummary[]> {
  return invoke<CasdoorSessionSummary[]>("casdoor:list-sessions", { owner, name });
}

export function casdoorDeleteSession(input: CasdoorSessionRevokeInput): Promise<void> {
  return invoke<void>("casdoor:delete-session", input);
}

export interface CasdoorSessionBulkRevokeResult {
  requested: number;
  revoked: number;
  failed: number;
  failures: string[];
}

export function casdoorDeleteAllSessions(owner: string, name: string): Promise<CasdoorSessionBulkRevokeResult> {
  return invoke<CasdoorSessionBulkRevokeResult>("casdoor:delete-all-sessions", { owner, name });
}



export interface CasdoorTokenIntrospection {
  active: boolean;
  scope?: string;
  clientId?: string;
  username?: string;
  sub?: string;
  tokenType?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  aud?: string;
  iss?: string;
  jti?: string;
}

export interface CasdoorIntrospectInput {
  token: string;
  tokenTypeHint?: "access_token" | "refresh_token";
}

function normalizeCasdoorTokenIntrospection(value: CasdoorTokenIntrospection & Record<string, unknown>): CasdoorTokenIntrospection {
  return {
    active: value.active === true,
    scope: typeof value.scope === "string" ? value.scope : undefined,
    clientId: typeof value.clientId === "string" ? value.clientId : typeof value.client_id === "string" ? value.client_id : undefined,
    username: typeof value.username === "string" ? value.username : typeof value.user === "string" ? value.user : undefined,
    sub: typeof value.sub === "string" ? value.sub : undefined,
    tokenType: typeof value.tokenType === "string" ? value.tokenType : typeof value.token_type === "string" ? value.token_type : undefined,
    exp: typeof value.exp === "number" ? value.exp : undefined,
    iat: typeof value.iat === "number" ? value.iat : undefined,
    nbf: typeof value.nbf === "number" ? value.nbf : undefined,
    aud: typeof value.aud === "string" ? value.aud : undefined,
    iss: typeof value.iss === "string" ? value.iss : undefined,
    jti: typeof value.jti === "string" ? value.jti : undefined,
  };
}

export function casdoorIntrospectToken(input: CasdoorIntrospectInput): Promise<CasdoorTokenIntrospection> {
  return invoke<CasdoorTokenIntrospection>("casdoor:introspect-token", input).then((value) => normalizeCasdoorTokenIntrospection(value as CasdoorTokenIntrospection & Record<string, unknown>));
}

export function casdoorAddRole(role: CasdoorRoleInput): Promise<void> {
  return invoke<void>("casdoor:role-add", role);
}

export function casdoorUpdateRole(role: CasdoorRoleInput): Promise<void> {
  return invoke<void>("casdoor:role-update", role);
}

export function casdoorDeleteRole(owner: string, name: string): Promise<void> {
  return invoke<void>("casdoor:role-delete", { owner, name });
}

export function casdoorAddPermission(permission: CasdoorPermissionInput): Promise<void> {
  return invoke<void>("casdoor:permission-add", permission);
}

export function casdoorUpdatePermission(permission: CasdoorPermissionInput): Promise<void> {
  return invoke<void>("casdoor:permission-update", permission);
}

export function casdoorDeletePermission(owner: string, name: string): Promise<void> {
  return invoke<void>("casdoor:permission-delete", { owner, name });
}

export function casdoorAddOrganization(organization: CasdoorOrganizationInput): Promise<void> {
  return invoke<void>("casdoor:organization-add", organization);
}

export function casdoorUpdateOrganization(organization: CasdoorOrganizationInput): Promise<void> {
  return invoke<void>("casdoor:organization-update", organization);
}

export function casdoorDeleteOrganization(owner: string, name: string): Promise<void> {
  return invoke<void>("casdoor:organization-delete", { owner, name });
}

export function casdoorAddGroup(group: CasdoorGroupInput): Promise<void> {
  return invoke<void>("casdoor:group-add", group);
}

export function casdoorUpdateGroup(group: CasdoorGroupInput): Promise<void> {
  return invoke<void>("casdoor:group-update", group);
}

export function casdoorDeleteGroup(owner: string, name: string): Promise<void> {
  return invoke<void>("casdoor:group-delete", { owner, name });
}

export function casdoorAddRule(rule: CasdoorRuleInput): Promise<void> {
  return invoke<void>("casdoor:rule-add", rule);
}

export function casdoorUpdateRule(rule: CasdoorRuleInput): Promise<void> {
  return invoke<void>("casdoor:rule-update", rule);
}

export function casdoorDeleteRule(owner: string, name: string): Promise<void> {
  return invoke<void>("casdoor:rule-delete", { owner, name });
}
import type { CasdoorGatewayHealth, CasdoorTenantHealth } from "@openbuddy/auth-casdoor";
export interface CasdoorWebhookEvent {
  type: "user" | "organization" | "group" | "role" | "permission";
  action: "update" | "delete" | "add-user" | "remove-user" | "add-role" | "remove-role";
  organization: string;
  user?: string;
  group?: string;
  role?: string;
  permission?: string;
  target?: string;
}

export function casdoorDeliverWebhook(event: CasdoorWebhookEvent): Promise<{ received: string; action: string; impacted: string[] }> {
  return invoke("casdoor:webhook-deliver", event);
}

export type CasdoorSessionKind = "desktop" | "web" | "automation" | "team" | "session";

export interface CasdoorSessionBinding {
  sessionId: string;
  subject: string;
  deviceFingerprint?: string;
  kind: CasdoorSessionKind;
  scopes: string[];
  startedAt: string;
  lastSeenAt: string;
  endedAt?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CasdoorSessionBindingInput {
  sessionId: string;
  kind?: CasdoorSessionKind;
  scopes?: string[];
  deviceFingerprint?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export function casdoorRegisterSession(input: CasdoorSessionBindingInput): Promise<CasdoorSessionBinding> {
  return invoke<CasdoorSessionBinding>("casdoor:session-register", input);
}

export function casdoorListSessions(limit = 100): Promise<CasdoorSessionBinding[]> {
  return invoke<CasdoorSessionBinding[]>("casdoor:session-list", { limit });
}

export function casdoorUnregisterSession(sessionId: string): Promise<{ removed: boolean }> {
  return invoke<{ removed: boolean }>("casdoor:session-unregister", { sessionId });
}


export type CasdoorWebhookEventType =
  | "user.add"
  | "user.update"
  | "user.delete"
  | "user.add-user"
  | "user.remove-user"
  | "organization.update"
  | "organization.delete"
  | "group.update"
  | "group.delete"
  | "group.add-user"
  | "group.remove-user"
  | "role.update"
  | "role.delete"
  | "permission.update"
  | "permission.delete";

export const CASDOOR_WEBHOOK_EVENT_TYPES: readonly CasdoorWebhookEventType[] = [
  "user.add",
  "user.update",
  "user.delete",
  "user.add-user",
  "user.remove-user",
  "organization.update",
  "organization.delete",
  "group.update",
  "group.delete",
  "group.add-user",
  "group.remove-user",
  "role.update",
  "role.delete",
  "permission.update",
  "permission.delete",
];

export interface CasdoorWebhookSubscriptionSnapshot {
  tenantId: string;
  eventTypes: CasdoorWebhookEventType[];
  source: "default-all" | "explicit";
}

export function casdoorListWebhookSubscriptions(tenantId: string): Promise<CasdoorWebhookSubscriptionSnapshot> {
  return invoke<CasdoorWebhookSubscriptionSnapshot>("casdoor:webhook-subscription-list", { tenantId });
}

export function casdoorUpdateWebhookSubscriptions(input: { tenantId: string; eventTypes: string[] }): Promise<CasdoorWebhookSubscriptionSnapshot> {
  return invoke<CasdoorWebhookSubscriptionSnapshot>("casdoor:webhook-subscription-update", input);
}
