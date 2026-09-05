import { app } from "electron";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { casdoorAuth } from "./casdoor-auth";
import { openStorageSync, SettingsDocumentStore } from "@openbuddy/storage";

import { casdoorAudit } from "./casdoor-audit";
import type { CasdoorTenantPermission } from "@openbuddy/auth-casdoor";

const MANAGEMENT_TIMEOUT_MS = 15_000;
const WEBHOOK_SUBSCRIPTION_FILE = "casdoor-webhook-subscriptions.json";
const WEBHOOK_SUBSCRIPTION_SCHEMA_VERSION = 1;

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
  createdTime?: string;
  users?: string[];
  groups?: string[];
  roles?: string[];
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

interface CasdoorAdminPayload {
  status?: string;
  msg?: string;
  data?: unknown;
  data2?: unknown[];
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function sanitizeUser(row: unknown): CasdoorUserSummary {
  const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return { owner: asText(value.owner) ?? "", name: asText(value.name) ?? "", displayName: asText(value.displayName), email: asText(value.email), phone: asText(value.phone), isAdmin: asBoolean(value.isAdmin), isForbidden: asBoolean(value.isForbidden), createdTime: asText(value.createdTime), groups: asStringList(value.groups) };
}

function sanitizeOrganization(row: unknown): CasdoorOrganizationSummary {
  const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return { owner: asText(value.owner) ?? "", name: asText(value.name) ?? "", displayName: asText(value.displayName), websiteUrl: asText(value.websiteUrl), createdTime: asText(value.createdTime), disableSignin: asBoolean(value.disableSignin) };
}

function sanitizeRole(row: unknown): CasdoorRoleSummary {
  const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return { owner: asText(value.owner) ?? "", name: asText(value.name) ?? "", displayName: asText(value.displayName), isEnabled: asBoolean(value.isEnabled), createdTime: asText(value.createdTime), subUsers: asStringList(value.subUsers), subRoles: asStringList(value.subRoles), users: asStringList(value.users), groups: asStringList(value.groups), roles: asStringList(value.roles) };
}

function sanitizePermission(row: unknown): CasdoorPermissionSummary {
  const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return { owner: asText(value.owner) ?? "", name: asText(value.name) ?? "", displayName: asText(value.displayName), resourceType: asText(value.resourceType), resources: asStringList(value.resources), actions: asStringList(value.actions), effect: asText(value.effect), isEnabled: asBoolean(value.isEnabled), model: asText(value.model), roles: asStringList(value.roles), users: asStringList(value.users), groups: asStringList(value.groups), createdTime: asText(value.createdTime) };
}

function sanitizeGroup(row: unknown): CasdoorGroupSummary {
  const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return { owner: asText(value.owner) ?? "", name: asText(value.name) ?? "", displayName: asText(value.displayName), createdTime: asText(value.createdTime), parent: asText(value.parent), users: asStringList(value.users), isEnabled: asBoolean(value.isEnabled) };
}

function sanitizeRule(row: unknown, fallbackOwner = ""): CasdoorRuleSummary {
  const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return { owner: asText(value.owner) ?? fallbackOwner, name: asText(value.name) ?? "", createdTime: asText(value.createdTime), updatedTime: asText(value.updatedTime), type: asText(value.type), expressions: asText(value.text) ?? asText(value.expressions), action: asText(value.action), statusCode: typeof value.statusCode === "number" ? value.statusCode : undefined, reason: asText(value.reason) };
}

type FetchKind = "users" | "organizations" | "roles" | "permissions" | "rules" | "groups";

async function callCasdoorApi<T>(endpoint: string, query: CasdoorListQuery): Promise<T[]> {
  const status = casdoorAuth.status();
  const operation = managementOperation(endpoint);
  const audit = (outcome: "success" | "failure", reason?: string) => {
    void casdoorAudit.record({
      event: "casdoor.management",
      outcome,
      subject: status.identity?.subject,
      tenantId: status.tenantContext.activeTenantId,
      resource: operation.resource,
      action: operation.action,
      reason,
    });
  };
  try {
    const token = casdoorAuth.getAccessToken();
    if (!token) throw new Error("Casdoor 会话不可用，请先登录或刷新企业会话");
    const params = new URLSearchParams({
      p: String(Math.max(1, query.page ?? 1)),
      pageSize: String(Math.max(1, Math.min(200, query.pageSize ?? 50))),
    });
    if (query.owner) params.set("owner", query.owner);
    if (query.query) {
      params.set("field", "name");
      params.set("value", query.query);
    }
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
    });
    const json = (await response.json().catch(() => null)) as CasdoorAdminPayload | null;
    if (!response.ok || !json || json.status === "error") {
      throw new Error(json?.msg || `Casdoor ${endpoint} 请求失败 (${response.status})`);
    }
    const list = Array.isArray(json.data2) ? json.data2 : Array.isArray(json.data) ? (json.data as T[]) : [];
    audit("success");
    return list as T[];
  } catch (error) {
    audit("failure", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function writeCasdoorApi(endpoint: string, payload: Record<string, unknown>): Promise<void> {
  const status = casdoorAuth.status();
  const operation = managementOperation(endpoint);
  const audit = (outcome: "success" | "failure", reason?: string) => {
    void casdoorAudit.record({
      event: "casdoor.management",
      outcome,
      subject: status.identity?.subject,
      tenantId: status.tenantContext.activeTenantId,
      resource: operation.resource,
      action: operation.action,
      reason,
    });
  };
  try {
    const token = casdoorAuth.getAccessToken();
    if (!token) throw new Error("Casdoor 会话不可用，请先登录或刷新企业会话");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
    });
    const json = (await response.json().catch(() => null)) as CasdoorAdminPayload | null;
    if (!response.ok || !json || json.status === "error") {
      throw new Error(json?.msg || `Casdoor ${endpoint} 请求失败 (${response.status})`);
    }
    const session = await casdoorAuth.revalidateCurrentSession();
    if (session.status !== "signed_in") throw new Error("CASDOOR_SESSION_INVALIDATED: Casdoor 会话在管理变更后已失效");
    audit("success");
  } catch (error) {
    audit("failure", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function managementOperation(endpoint: string): { resource: string; action: "create" | "update" | "delete" | "read" | "write" } {
  try {
    const operation = new URL(endpoint).pathname.match(/\/api\/(add|invite|update|delete|get)-([a-z-]+)$/i);
    if (!operation) return { resource: "casdoor", action: "write" };
    const action = operation[1].toLowerCase();
    const resource = operation[2].toLowerCase().replace(/s$/, "");
    return {
      resource,
      action: action === "add" || action === "invite" ? "create" : action === "get" ? "read" : action as "update" | "delete",
    };
  } catch {
    return { resource: "casdoor", action: "write" };
  }
}

export const __casdoorManagementTestables = {
  managementOperation,
  clearCasdoorWebhookSubscriptions,
  isWebhookSubscribed,
  listCasdoorWebhookSubscriptions,
  updateCasdoorWebhookSubscriptions,
  resetWebhookSubscriptionsForTests,
  openWebhookSubscriptionsStoreForTests: openWebhookSubscriptionStore,
  flushWebhookSubscriptionMigrationForTests,
};

function endpointFor(kind: FetchKind, issuer: string): string {
  return `${issuer.replace(/\/$/, "")}/api/get-${kind}`;
}

function requireTenantPermission(permission: CasdoorTenantPermission): void {
  if (!casdoorAuth.status().config.configured) throw new Error("Casdoor 配置无效，请先完成企业身份配置");
  casdoorAuth.assertAuthorized({ permission }, `当前租户缺少 ${permission} 权限`);
}

function ownerScopes(): Set<string> {
  const status = casdoorAuth.status();
  const identity = status.identity;
  const values = [status.tenantContext.activeTenantId, identity?.owner, identity?.organization];
  return new Set(values.flatMap((value) => {
    if (!value) return [];
    const normalized = value.trim();
    const slash = normalized.indexOf("/");
    return slash > 0 ? [normalized.slice(0, slash), normalized] : [normalized];
  }));
}

function assertOwnerScope(owner: string): void {
  const normalizedOwner = owner.trim();
  if (!normalizedOwner || normalizedOwner.includes("/")) throw new Error("Casdoor 组织标识无效");
  const identity = casdoorAuth.status().identity;
  if (identity?.isAdmin) return;
  if (normalizedOwner === "built-in") throw new Error("非超级管理员不能管理 Casdoor 内置组织");
  if (!ownerScopes().has(normalizedOwner)) throw new Error("当前账户不能管理当前租户之外的 Casdoor 组织");
}

function scopedListQuery(query: CasdoorListQuery): CasdoorListQuery {
  if (casdoorAuth.status().identity?.isAdmin) return query;
  const owner = query.owner?.trim() || casdoorAuth.status().tenantContext.activeTenantId;
  if (!owner) throw new Error("当前账户没有可管理的 Casdoor 组织");
  assertOwnerScope(owner);
  return { ...query, owner };
}

export async function listCasdoorUsers(query: CasdoorListQuery = {}): Promise<CasdoorUserSummary[]> {
  requireTenantPermission("tenant.users.read");
  const issuer = casdoorAuth.status().config.issuer;
  return (await callCasdoorApi<unknown>(endpointFor("users", issuer), scopedListQuery(query))).map(sanitizeUser);
}

export async function listCasdoorOrganizations(query: CasdoorListQuery = {}): Promise<CasdoorOrganizationSummary[]> {
  requireTenantPermission("tenant.organizations.read");
  const issuer = casdoorAuth.status().config.issuer;
  return (await callCasdoorApi<unknown>(endpointFor("organizations", issuer), scopedListQuery(query))).map(sanitizeOrganization);
}

export async function listCasdoorRoles(query: CasdoorListQuery = {}): Promise<CasdoorRoleSummary[]> {
  requireTenantPermission("tenant.roles.read");
  const issuer = casdoorAuth.status().config.issuer;
  return (await callCasdoorApi<unknown>(endpointFor("roles", issuer), scopedListQuery(query))).map(sanitizeRole);
}

export async function listCasdoorPermissions(query: CasdoorListQuery = {}): Promise<CasdoorPermissionSummary[]> {
  requireTenantPermission("tenant.permissions.read");
  const issuer = casdoorAuth.status().config.issuer;
  return (await callCasdoorApi<unknown>(endpointFor("permissions", issuer), scopedListQuery(query))).map(sanitizePermission);
}

export async function listCasdoorGroups(query: CasdoorListQuery = {}): Promise<CasdoorGroupSummary[]> {
  requireTenantPermission("tenant.groups.read");
  const issuer = casdoorAuth.status().config.issuer;
  return (await callCasdoorApi<unknown>(endpointFor("groups", issuer), scopedListQuery(query))).map(sanitizeGroup);
}

export async function listCasdoorRules(query: CasdoorListQuery = {}): Promise<CasdoorRuleSummary[]> {
  requireTenantPermission("tenant.rules.read");
  const issuer = casdoorAuth.status().config.issuer;
  const scopedQuery = scopedListQuery(query);
  const rules = await callCasdoorApi<Record<string, unknown>>(endpointFor("rules", issuer), scopedQuery);
  return rules.map((row) => sanitizeRule(row, scopedQuery.owner ?? ""));
}

function objectId(owner: string, name: string): string {
  const normalizedOwner = owner.trim();
  const normalizedName = name.trim();
  if (!normalizedOwner || !normalizedName || normalizedOwner.includes("/") || normalizedName.includes("/")) {
    throw new Error("Casdoor 对象标识无效");
  }
  return `${encodeURIComponent(normalizedOwner)}/${encodeURIComponent(normalizedName)}`;
}

function stringList(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  return values.map((value) => value.trim()).filter(Boolean);
}

function optionalText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim();
}

function assertMutableUser(owner: string, name: string, isForbidden: boolean | undefined): void {
  objectId(owner, name);
  if (isForbidden && owner.trim() === "built-in" && name.trim() === "admin") {
    throw new Error("不能禁用 Casdoor 内置管理员");
  }
}

function assertDeletableUser(owner: string, name: string): void {
  objectId(owner, name);
  if (owner.trim() === "built-in" && name.trim() === "admin") {
    throw new Error("不能删除 Casdoor 内置管理员");
  }
}

function assertDeletableObject(owner: string, name: string, kind: "role" | "permission"): void {
  objectId(owner, name);
  const normalizedOwner = owner.trim();
  const normalizedName = name.trim();
  const protectedNames = kind === "role"
    ? new Set(["admin", "administrator", "super_admin", "role-built-in"])
    : new Set(["permission-built-in"]);
  if (normalizedOwner === "built-in" && protectedNames.has(normalizedName)) {
    throw new Error(`不能删除 Casdoor 内置${kind === "role" ? "角色" : "权限"}`);
  }
}

function assertDeletableOrganization(owner: string, name: string): void {
  objectId(owner, name);
  if (name.trim() === "built-in") {
    throw new Error("不能删除 Casdoor 内置组织");
  }
}

function assertDeletableGroup(owner: string, name: string): void {
  objectId(owner, name);
  if (owner.trim() === "built-in") throw new Error("不能从 OpenBuddy 删除 Casdoor 内置群组");
}

function assertDeletableRule(owner: string, name: string): void {
  objectId(owner, name);
  if (owner.trim() === "admin" || owner.trim() === "built-in") {
    throw new Error("不能从 OpenBuddy 删除全局 Casdoor 规则");
  }
}

export async function updateCasdoorUser(patch: CasdoorUserPatch): Promise<void> {
  requireTenantPermission("tenant.users.write");
  assertMutableUser(patch.owner, patch.name, patch.isForbidden);
  assertOwnerScope(patch.owner);
  const id = objectId(patch.owner, patch.name);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/update-user?id=${id}`, {
    owner: patch.owner.trim(),
    name: patch.name.trim(),
    ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() } : {}),
    ...(patch.email !== undefined ? { email: patch.email.trim() } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone.trim() } : {}),
    ...(patch.isForbidden !== undefined ? { isForbidden: patch.isForbidden } : {}),
    ...(patch.groups !== undefined ? { groups: stringList(patch.groups) } : {}),
  });
}

export async function saveCasdoorUser(user: CasdoorUserInput): Promise<void> {
  requireTenantPermission("tenant.users.write");
  const payload = {
    owner: user.owner.trim(),
    name: user.name.trim(),
    ...(user.type !== undefined ? { type: user.type.trim() } : {}),
    ...(user.displayName !== undefined ? { displayName: user.displayName.trim() } : {}),
    ...(user.email !== undefined ? { email: user.email.trim() } : {}),
    ...(user.phone !== undefined ? { phone: user.phone.trim() } : {}),
    ...(user.groups !== undefined ? { groups: stringList(user.groups) } : {}),
  };
  objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  if (!payload.displayName && !payload.email && !payload.phone) throw new Error("新用户至少需要显示名、邮箱或手机号");
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/add-user`, payload);
}

export async function deleteCasdoorUser(owner: string, name: string): Promise<void> {
  requireTenantPermission("tenant.users.write");
  assertDeletableUser(owner, name);
  assertOwnerScope(owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/delete-user`, { owner: owner.trim(), name: name.trim() });
}

export async function saveCasdoorRole(role: CasdoorRoleInput): Promise<void> {
  requireTenantPermission("tenant.roles.write");
  const payload = {
    owner: role.owner.trim(),
    name: role.name.trim(),
    ...(role.displayName !== undefined ? { displayName: role.displayName.trim() } : {}),
    ...(role.description !== undefined ? { description: role.description.trim() } : {}),
    ...(role.users !== undefined ? { users: stringList(role.users) } : {}),
    ...(role.groups !== undefined ? { groups: stringList(role.groups) } : {}),
    ...(role.roles !== undefined ? { roles: stringList(role.roles) } : {}),
    ...(role.isEnabled !== undefined ? { isEnabled: role.isEnabled } : {}),
  };
  objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/add-role`, payload);
}

export async function updateCasdoorRole(role: CasdoorRoleInput): Promise<void> {
  requireTenantPermission("tenant.roles.write");
  const payload = {
    owner: role.owner.trim(),
    name: role.name.trim(),
    ...(role.displayName !== undefined ? { displayName: role.displayName.trim() } : {}),
    ...(role.description !== undefined ? { description: role.description.trim() } : {}),
    ...(role.users !== undefined ? { users: stringList(role.users) } : {}),
    ...(role.groups !== undefined ? { groups: stringList(role.groups) } : {}),
    ...(role.roles !== undefined ? { roles: stringList(role.roles) } : {}),
    ...(role.isEnabled !== undefined ? { isEnabled: role.isEnabled } : {}),
  };
  const id = objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/update-role?id=${id}`, payload);
}

export async function deleteCasdoorRole(owner: string, name: string): Promise<void> {
  requireTenantPermission("tenant.roles.write");
  assertDeletableObject(owner, name, "role");
  assertOwnerScope(owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/delete-role`, { owner: owner.trim(), name: name.trim() });
}

export async function saveCasdoorPermission(permission: CasdoorPermissionInput): Promise<void> {
  requireTenantPermission("tenant.permissions.write");
  const payload = {
    owner: permission.owner.trim(),
    name: permission.name.trim(),
    ...(permission.displayName !== undefined ? { displayName: permission.displayName.trim() } : {}),
    ...(permission.description !== undefined ? { description: permission.description.trim() } : {}),
    ...(permission.users !== undefined ? { users: stringList(permission.users) } : {}),
    ...(permission.groups !== undefined ? { groups: stringList(permission.groups) } : {}),
    ...(permission.roles !== undefined ? { roles: stringList(permission.roles) } : {}),
    ...(permission.model !== undefined ? { model: permission.model.trim() } : {}),
    ...(permission.resourceType !== undefined ? { resourceType: permission.resourceType.trim() } : {}),
    ...(permission.resources !== undefined ? { resources: stringList(permission.resources) } : {}),
    ...(permission.actions !== undefined ? { actions: stringList(permission.actions) } : {}),
    ...(permission.effect !== undefined ? { effect: permission.effect.trim() } : {}),
    ...(permission.isEnabled !== undefined ? { isEnabled: permission.isEnabled } : {}),
  };
  objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/add-permission`, payload);
}

export async function updateCasdoorPermission(permission: CasdoorPermissionInput): Promise<void> {
  requireTenantPermission("tenant.permissions.write");
  const payload = {
    owner: permission.owner.trim(),
    name: permission.name.trim(),
    ...(permission.displayName !== undefined ? { displayName: permission.displayName.trim() } : {}),
    ...(permission.description !== undefined ? { description: permission.description.trim() } : {}),
    ...(permission.users !== undefined ? { users: stringList(permission.users) } : {}),
    ...(permission.groups !== undefined ? { groups: stringList(permission.groups) } : {}),
    ...(permission.roles !== undefined ? { roles: stringList(permission.roles) } : {}),
    ...(permission.model !== undefined ? { model: permission.model.trim() } : {}),
    ...(permission.resourceType !== undefined ? { resourceType: permission.resourceType.trim() } : {}),
    ...(permission.resources !== undefined ? { resources: stringList(permission.resources) } : {}),
    ...(permission.actions !== undefined ? { actions: stringList(permission.actions) } : {}),
    ...(permission.effect !== undefined ? { effect: permission.effect.trim() } : {}),
    ...(permission.isEnabled !== undefined ? { isEnabled: permission.isEnabled } : {}),
  };
  const id = objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/update-permission?id=${id}`, payload);
}

export async function deleteCasdoorPermission(owner: string, name: string): Promise<void> {
  requireTenantPermission("tenant.permissions.write");
  assertDeletableObject(owner, name, "permission");
  assertOwnerScope(owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/delete-permission`, { owner: owner.trim(), name: name.trim() });
}

export async function saveCasdoorOrganization(organization: CasdoorOrganizationInput): Promise<void> {
  requireTenantPermission("tenant.organizations.write");
  const payload = {
    owner: organization.owner.trim(),
    name: organization.name.trim(),
    ...(organization.displayName !== undefined ? { displayName: organization.displayName.trim() } : {}),
    ...(organization.websiteUrl !== undefined ? { websiteUrl: organization.websiteUrl.trim() } : {}),
    ...(organization.logo !== undefined ? { logo: organization.logo.trim() } : {}),
    ...(organization.favicon !== undefined ? { favicon: organization.favicon.trim() } : {}),
    ...(organization.defaultApplication !== undefined ? { defaultApplication: organization.defaultApplication.trim() } : {}),
    ...(organization.disableSignin !== undefined ? { disableSignin: organization.disableSignin } : {}),
  };
  objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/add-organization`, payload);
}

export async function updateCasdoorOrganization(organization: CasdoorOrganizationInput): Promise<void> {
  requireTenantPermission("tenant.organizations.write");
  const payload = {
    owner: organization.owner.trim(),
    name: organization.name.trim(),
    ...(organization.displayName !== undefined ? { displayName: organization.displayName.trim() } : {}),
    ...(organization.websiteUrl !== undefined ? { websiteUrl: organization.websiteUrl.trim() } : {}),
    ...(organization.logo !== undefined ? { logo: organization.logo.trim() } : {}),
    ...(organization.favicon !== undefined ? { favicon: organization.favicon.trim() } : {}),
    ...(organization.defaultApplication !== undefined ? { defaultApplication: organization.defaultApplication.trim() } : {}),
    ...(organization.disableSignin !== undefined ? { disableSignin: organization.disableSignin } : {}),
  };
  const id = objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/update-organization?id=${id}`, payload);
}

export async function deleteCasdoorOrganization(owner: string, name: string): Promise<void> {
  requireTenantPermission("tenant.organizations.write");
  assertDeletableOrganization(owner, name);
  assertOwnerScope(owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/delete-organization`, { owner: owner.trim(), name: name.trim() });
}

export async function saveCasdoorGroup(group: CasdoorGroupInput): Promise<void> {
  requireTenantPermission("tenant.groups.write");
  const payload = {
    owner: group.owner.trim(),
    name: group.name.trim(),
    ...(group.displayName !== undefined ? { displayName: group.displayName.trim() } : {}),
    ...(group.manager !== undefined ? { manager: group.manager.trim() } : {}),
    ...(group.contactEmail !== undefined ? { contactEmail: group.contactEmail.trim() } : {}),
    ...(group.type !== undefined ? { type: group.type.trim() } : {}),
    ...(group.parentId !== undefined ? { parentId: group.parentId.trim() } : {}),
    ...(group.isEnabled !== undefined ? { isEnabled: group.isEnabled } : {}),
    ...(group.users !== undefined ? { users: stringList(group.users) } : {}),
  };
  objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/add-group`, payload);
}

export async function updateCasdoorGroup(group: CasdoorGroupInput): Promise<void> {
  requireTenantPermission("tenant.groups.write");
  const payload = {
    owner: group.owner.trim(),
    name: group.name.trim(),
    ...(group.displayName !== undefined ? { displayName: group.displayName.trim() } : {}),
    ...(group.manager !== undefined ? { manager: group.manager.trim() } : {}),
    ...(group.contactEmail !== undefined ? { contactEmail: group.contactEmail.trim() } : {}),
    ...(group.type !== undefined ? { type: group.type.trim() } : {}),
    ...(group.parentId !== undefined ? { parentId: group.parentId.trim() } : {}),
    ...(group.isEnabled !== undefined ? { isEnabled: group.isEnabled } : {}),
    ...(group.users !== undefined ? { users: stringList(group.users) } : {}),
  };
  const id = objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/update-group?id=${id}`, payload);
}

export async function deleteCasdoorGroup(owner: string, name: string): Promise<void> {
  requireTenantPermission("tenant.groups.write");
  assertDeletableGroup(owner, name);
  assertOwnerScope(owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/delete-group`, { owner: owner.trim(), name: name.trim() });
}

export async function saveCasdoorRule(rule: CasdoorRuleInput): Promise<void> {
  requireTenantPermission("tenant.rules.write");
  const payload = {
    owner: rule.owner.trim(),
    name: rule.name.trim(),
    type: rule.type.trim(),
    ...(rule.expressions !== undefined ? { expressions: rule.expressions.map((expression) => ({ name: optionalText(expression.name), operator: optionalText(expression.operator), value: expression.value.trim() })) } : {}),
    ...(rule.action !== undefined ? { action: rule.action.trim() } : {}),
    ...(rule.statusCode !== undefined ? { statusCode: rule.statusCode } : {}),
    ...(rule.reason !== undefined ? { reason: rule.reason.trim() } : {}),
    ...(rule.isVerbose !== undefined ? { isVerbose: rule.isVerbose } : {}),
  };
  objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  if (!payload.type) throw new Error("Casdoor 规则类型不能为空");
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/add-rule`, payload);
}

export async function updateCasdoorRule(rule: CasdoorRuleInput): Promise<void> {
  requireTenantPermission("tenant.rules.write");
  const payload = {
    owner: rule.owner.trim(),
    name: rule.name.trim(),
    type: rule.type.trim(),
    ...(rule.expressions !== undefined ? { expressions: rule.expressions.map((expression) => ({ name: optionalText(expression.name), operator: optionalText(expression.operator), value: expression.value.trim() })) } : {}),
    ...(rule.action !== undefined ? { action: rule.action.trim() } : {}),
    ...(rule.statusCode !== undefined ? { statusCode: rule.statusCode } : {}),
    ...(rule.reason !== undefined ? { reason: rule.reason.trim() } : {}),
    ...(rule.isVerbose !== undefined ? { isVerbose: rule.isVerbose } : {}),
  };
  const id = objectId(payload.owner, payload.name);
  assertOwnerScope(payload.owner);
  if (!payload.type) throw new Error("Casdoor 规则类型不能为空");
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/update-rule?id=${id}`, payload);
}

export async function deleteCasdoorRule(owner: string, name: string): Promise<void> {
  requireTenantPermission("tenant.rules.write");
  assertDeletableRule(owner, name);
  assertOwnerScope(owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer}/api/delete-rule`, { owner: owner.trim(), name: name.trim() });
}

// ---------------------------------------------------------------------------
// A4 Invitation link
//
// Casdoor `POST /api/invite-user` 生成临时邀请链接，开放给租户管理员在
// OpenBuddy Settings 面板里直接发起邀请。响应中通常包含 invite URL 或
// token；我们用统一的 `CasdoorUserInviteResult` 形状把字符串 / 嵌套对象
// 收口。
// ---------------------------------------------------------------------------

export interface CasdoorUserInvite {
  owner: string;
  email: string;
  role?: string;
  group?: string;
  /** 链接有效期（小时）。Casdoor 默认 24，留空使用服务端默认。 */
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeInviteResult(owner: string, email: string, payload: unknown): CasdoorUserInviteResult {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const link = asText(value.link) ?? asText(value.url) ?? asText(value.inviteUrl) ?? asText(value.invite_url);
  const token = asText(value.token) ?? asText(value.inviteToken) ?? asText(value.invite_token);
  const expiresAt = asText(value.expiresAt) ?? asText(value.expires_at);
  return {
    owner,
    email,
    link,
    token,
    expiresAt,
    raw: value,
  };
}

export async function inviteCasdoorUser(invite: CasdoorUserInvite): Promise<CasdoorUserInviteResult> {
  requireTenantPermission("tenant.users.write");
  const status = casdoorAuth.status();
  const owner = invite.owner.trim();
  const email = invite.email.trim();
  if (!owner) throw new Error("Casdoor 组织标识不能为空");
  if (!email) throw new Error("邀请邮箱不能为空");
  if (!EMAIL_PATTERN.test(email)) throw new Error("邀请邮箱格式不合法");
  assertOwnerScope(owner);
  const payload: Record<string, unknown> = { owner, email };
  if (invite.role && invite.role.trim()) payload.role = invite.role.trim();
  if (invite.group && invite.group.trim()) payload.group = invite.group.trim();
  if (typeof invite.hoursValid === "number" && Number.isFinite(invite.hoursValid) && invite.hoursValid > 0) {
    payload.hoursValid = Math.min(Math.floor(invite.hoursValid), 24 * 30);
  }
  const endpoint = `${status.config.issuer.replace(/\/$/, "")}/api/invite-user`;
  const operation = managementOperation(endpoint);
  const audit = (outcome: "success" | "failure", reason?: string) => {
    void casdoorAudit.record({
      event: "casdoor.management",
      outcome,
      subject: status.identity?.subject,
      tenantId: status.tenantContext.activeTenantId,
      resource: `${operation.resource}/${email}`,
      action: operation.action,
      reason,
    });
  };
  try {
    const token = casdoorAuth.getAccessToken();
    if (!token) throw new Error("Casdoor 会话不可用，请先登录或刷新企业会话");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
    });
    const json = (await response.json().catch(() => null)) as CasdoorAdminPayload | null;
    if (!response.ok || !json || json.status === "error") {
      throw new Error(json?.msg || `Casdoor ${endpoint} 请求失败 (${response.status})`);
    }
    const result = sanitizeInviteResult(owner, email, json.data);
    audit("success");
    return result;
  } catch (error) {
    audit("failure", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// A1 Account linking
//
// Casdoor `GET /api/get-account-linking-options` 列出当前用户已绑定的多
// Provider 凭据（手机号 / 微信 / GitHub / 邮箱 / 密码等），让 Settings 面
// 板能展示已绑定方式 + 提供解绑入口（`POST /api/delete-account-linking-option`）。
// 本节约 80 行，只读 + 解绑；新增 / 绑定走 Casdoor 控制台或 OIDC 重新登录。
// ---------------------------------------------------------------------------

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

function sanitizeAccountLinkingOption(row: unknown): CasdoorAccountLinkingOption {
  const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return {
    type: asText(value.type) ?? asText(value.providerType),
    provider: asText(value.provider) ?? asText(value.name) ?? asText(value.issuer),
    identifier: asText(value.identifier) ?? asText(value.email) ?? asText(value.phone) ?? asText(value.openId) ?? asText(value.unionId),
    displayName: asText(value.displayName) ?? asText(value.label),
    linkedAt: asText(value.linkedTime) ?? asText(value.createdTime) ?? asText(value.updatedTime),
    enabled: asBoolean(value.enabled) ?? asBoolean(value.isEnabled),
  };
}

export async function listCasdoorAccountLinking(owner: string, name: string): Promise<CasdoorAccountLinkingOption[]> {
  requireTenantPermission("tenant.users.read");
  const normalizedOwner = owner.trim();
  const normalizedName = name.trim();
  if (!normalizedOwner || !normalizedName) throw new Error("Casdoor 用户标识不能为空");
  assertOwnerScope(normalizedOwner);
  const status = casdoorAuth.status();
  const endpoint = `${status.config.issuer.replace(/\/$/, "")}/api/get-account-linking-options`;
  const query: CasdoorListQuery = { owner: normalizedOwner };
  const rows = await callCasdoorApi<unknown>(endpoint, query);
  const target = name ? normalizedName : "";
  const matches = (row: unknown) => {
    const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const candidates = [
      value.name,
      value.user,
      value.userName,
      value.identifier,
    ];
    return candidates.some((candidate) => typeof candidate === "string" && candidate.trim() === target);
  };
  const filtered = target ? rows.filter(matches) : rows;
  return filtered.map(sanitizeAccountLinkingOption);
}

export async function unlinkCasdoorAccount(input: CasdoorAccountLinkingInput): Promise<void> {
  requireTenantPermission("tenant.users.write");
  const owner = input.owner.trim();
  const name = input.name.trim();
  const type = input.type.trim();
  const identifier = input.identifier.trim();
  if (!owner || !name || !type || !identifier) throw new Error("解绑请求缺少 owner / name / type / identifier");
  assertOwnerScope(owner);
  const payload: Record<string, unknown> = {
    owner,
    name,
    type,
    identifier,
  };
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer.replace(/\/$/, "")}/api/delete-account-linking-option`, payload);
}

// ---------------------------------------------------------------------------
// Org Branding / Organization detail
//
// Casdoor `GET /api/get-organization?id={owner}/{name}` 返回 Organization 全
// 量字段，包括 displayName / logo / websiteUrl / favicon / theme 等。OpenBuddy
// 用它实现"白标登录"：把 Casdoor Organization 的品牌资源透出到 UI，让企业
// 用户登录后立即看到自己公司的视觉。
// ---------------------------------------------------------------------------

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

function sanitizeOrganizationBranding(row: unknown, fallbackOwner: string, fallbackName: string): CasdoorOrganizationBranding {
  const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return {
    owner: asText(value.owner) ?? fallbackOwner,
    name: asText(value.name) ?? fallbackName,
    displayName: asText(value.displayName),
    logo: asText(value.logo),
    websiteUrl: asText(value.websiteUrl),
    favicon: asText(value.favicon),
    defaultApplication: asText(value.defaultApplication),
    disableSignin: asBoolean(value.disableSignin),
  };
}

export async function getCasdoorOrganization(owner: string, name: string): Promise<CasdoorOrganizationBranding> {
  requireTenantPermission("tenant.organizations.read");
  const normalizedOwner = owner.trim();
  const normalizedName = name.trim();
  if (!normalizedOwner || !normalizedName) throw new Error("Casdoor 组织标识不能为空");
  assertOwnerScope(normalizedOwner);
  const id = objectId(normalizedOwner, normalizedName);
  const status = casdoorAuth.status();
  const endpoint = `${status.config.issuer.replace(/\/$/, "")}/api/get-organization?id=${encodeURIComponent(id)}`;
  const token = casdoorAuth.getAccessToken();
  if (!token) throw new Error("Casdoor 会话不可用，请先登录或刷新企业会话");
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => null)) as CasdoorAdminPayload | null;
  if (!response.ok || !json || json.status === "error") {
    throw new Error(json?.msg || `Casdoor ${endpoint} 请求失败 (${response.status})`);
  }
  void casdoorAudit.record({
    event: "casdoor.management",
    outcome: "success",
    subject: status.identity?.subject,
    tenantId: status.tenantContext.activeTenantId,
    resource: "organization",
    action: "read",
    reason: `target=${id}`,
  });
  return sanitizeOrganizationBranding(json.data, normalizedOwner, normalizedName);
}

// ---------------------------------------------------------------------------
// Active Sessions
//
// Casdoor `GET /api/get-sessions?owner=&name=` 列出当前用户（或指定用户）的
// 所有活跃 OIDC 会话（不同应用 / 设备 / refresh token 都会产生独立 session）。
// `POST /api/delete-session` 删除单个 session。OpenBuddy 把这套暴露成 IPC，
// 让用户在 Settings 面板里看到自己的所有活跃设备 / 应用，并自助强制下线。
// 与 A2 Backchannel logout 互补：A2 是管理员踢人，本项是用户自我撤销。
// ---------------------------------------------------------------------------

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

function sanitizeSession(row: unknown): CasdoorSessionSummary {
  const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return {
    sessionId: asText(value.sessionId) ?? asText(value.id),
    owner: asText(value.owner),
    name: asText(value.name) ?? asText(value.user),
    application: asText(value.application) ?? asText(value.app),
    deviceName: asText(value.deviceName) ?? asText(value.device),
    ip: asText(value.ip) ?? asText(value.remoteAddr),
    userAgent: asText(value.userAgent),
    createdAt: asText(value.createdTime) ?? asText(value.createdAt),
    expiresAt: asText(value.expireTime) ?? asText(value.expiresAt),
    refreshedAt: asText(value.refreshedTime) ?? asText(value.refreshedAt),
    isOnline: asBoolean(value.isOnline),
  };
}

export async function listCasdoorSessions(owner: string, name: string): Promise<CasdoorSessionSummary[]> {
  requireTenantPermission("tenant.users.read");
  const normalizedOwner = owner.trim();
  const normalizedName = name.trim();
  if (!normalizedOwner) throw new Error("Casdoor 组织标识不能为空");
  if (!normalizedName) throw new Error("Casdoor 用户名不能为空");
  assertOwnerScope(normalizedOwner);
  const status = casdoorAuth.status();
  const endpoint = `${status.config.issuer.replace(/\/$/, "")}/api/get-sessions`;
  const rows = await callCasdoorApi<unknown>(endpoint, { owner: normalizedOwner, query: normalizedName, pageSize: 200 });
  return rows.filter((row) => {
    const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const candidates = [value.name, value.user, value.username];
    return candidates.some((candidate) => typeof candidate === "string" && candidate.trim() === normalizedName);
  }).map(sanitizeSession);
}

export async function deleteCasdoorSession(input: CasdoorSessionRevokeInput): Promise<void> {
  requireTenantPermission("tenant.users.write");
  const owner = input.owner.trim();
  const name = input.name.trim();
  const sessionId = input.sessionId.trim();
  if (!owner || !name || !sessionId) throw new Error("撤销 session 请求缺少 owner / name / sessionId");
  assertOwnerScope(owner);
  await writeCasdoorApi(`${casdoorAuth.status().config.issuer.replace(/\/$/, "")}/api/delete-session`, { owner, name, sessionId });
}

export interface CasdoorSessionBulkRevokeResult {
  requested: number;
  revoked: number;
  failed: number;
  failures: string[];
}

export async function deleteAllCasdoorSessions(owner: string, name: string): Promise<CasdoorSessionBulkRevokeResult> {
  requireTenantPermission("tenant.users.write");
  const normalizedOwner = owner.trim();
  const normalizedName = name.trim();
  if (!normalizedOwner || !normalizedName) throw new Error("批量撤销 session 请求缺少 owner / name");
  assertOwnerScope(normalizedOwner);
  const sessions = await listCasdoorSessions(normalizedOwner, normalizedName);
  const result: CasdoorSessionBulkRevokeResult = { requested: sessions.length, revoked: 0, failed: 0, failures: [] };
  for (const session of sessions) {
    if (!session.sessionId) {
      result.failed += 1;
      result.failures.push("缺少 sessionId");
      continue;
    }
    try {
      await deleteCasdoorSession({ owner: normalizedOwner, name: normalizedName, sessionId: session.sessionId });
      result.revoked += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push(`${session.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  void casdoorAudit.record({
    event: "casdoor.management",
    outcome: result.failed === 0 ? "success" : "failure",
    subject: casdoorAuth.status().identity?.subject,
    tenantId: casdoorAuth.status().tenantContext.activeTenantId,
    resource: "session",
    action: "delete",
    reason: `bulk requested=${result.requested} revoked=${result.revoked} failed=${result.failed}; target=${normalizedOwner}/${normalizedName}`,
  });
  return result;
}


// ---------------------------------------------------------------------------
// Token Introspection (RFC 7662)
//
// Casdoor discovery 返回的 `introspection_endpoint` 校验 access_token / refresh_token 是否仍然有效，
// 并返回元数据（exp / iat / sub / aud / scope / active）。OpenBuddy 当前依赖
// 本地 safeStorage 缓存的 token + JWKS 验签，没有调用 introspection，因此
// 服务端主动撤销（如 admin 在 Casdoor 控制台踢人）后到本地缓存过期之间的窗口
// 期无法即时感知。增加 introspection 入口让 Settings / 审计面板可以按需
// 校验某个 token（特别是 device-flow 颁发的 refresh token 或第三方应用
// 持有的 access token）。
//
// 注意：introspection 本身需要调用方拥有 `clientId` 对应的 token，所以这里
// 走 Casdoor bearer auth（OIDC `client_credentials` 风格 token）；实际生产
// 中我们传的就是当前用户自己的 access_token，让 Casdoor 在 token 已被撤销
// 时返回 `{ active: false }`。
// ---------------------------------------------------------------------------

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

function sanitizeIntrospection(row: unknown): CasdoorTokenIntrospection {
  const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return {
    active: typeof value.active === "boolean" ? value.active : false,
    scope: asText(value.scope),
    clientId: asText(value.client_id) ?? asText(value.clientId),
    username: asText(value.username) ?? asText(value.user),
    sub: asText(value.sub),
    tokenType: asText(value.token_type) ?? asText(value.tokenType),
    exp: typeof value.exp === "number" ? value.exp : undefined,
    iat: typeof value.iat === "number" ? value.iat : undefined,
    nbf: typeof value.nbf === "number" ? value.nbf : undefined,
    aud: asText(value.aud),
    iss: asText(value.iss),
    jti: asText(value.jti),
  };
}

export async function introspectCasdoorToken(input: CasdoorIntrospectInput): Promise<CasdoorTokenIntrospection> {
  requireTenantPermission("tenant.users.read");
  const token = (input.token ?? "").trim();
  if (!token) throw new Error("introspection 需要非空 token");
  const status = casdoorAuth.status();
  const endpoint = await casdoorAuth.getIntrospectionEndpoint();
  const callerToken = casdoorAuth.getAccessToken();
  if (!callerToken) throw new Error("Casdoor 会话不可用，请先登录或刷新企业会话");
  const body = new URLSearchParams({ token });
  if (input.tokenTypeHint) body.set("token_type_hint", input.tokenTypeHint);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { accept: "application/json", authorization: `Bearer ${callerToken}`, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    throw new Error(`Casdoor introspection 请求失败 (${response.status})`);
  }
  await casdoorAudit.record({
    event: "casdoor.management",
    outcome: "success",
    subject: status.identity?.subject,
    tenantId: status.tenantContext.activeTenantId,
    resource: "introspection",
    action: "read",
    reason: input.tokenTypeHint ?? "access_token",
  });
  return sanitizeIntrospection(json);
}


// ---------------------------------------------------------------------------
// Webhook Subscription（按事件类型订阅）
//
// Casdoor 支持按事件类型订阅 webhook（user.created / user.deleted / org.updated
// / permission.changed / role.changed / group.changed 等）。OpenBuddy 默认
// 全量接收并转发给 renderer；引入订阅注册表后：
//   1. 用户在 Settings 面板按事件类型勾选订阅；
//   2. 主进程在 broadcastCasdoorWebhook 时按订阅过滤；
//   3. 订阅表持久化到 userData 下的 0600 JSON，重启后恢复；首次启动仍默认全量订阅。
// 价值：减少 renderer 噪音、降低无效事件触发的审计/缓存失效频率。
// ---------------------------------------------------------------------------

const WEBHOOK_EVENT_TYPES = [
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
] as const;

export type CasdoorWebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const CASDOOR_WEBHOOK_EVENT_TYPES: readonly CasdoorWebhookEventType[] = WEBHOOK_EVENT_TYPES;

const WEBHOOK_SUBSCRIPTION_NAMESPACE = "casdoor:webhook-subscriptions";

const webhookSubscriptions = new Map<string, Set<CasdoorWebhookEventType>>();
let webhookSubscriptionsLoaded = false;
let webhookSubscriptionStore: SettingsDocumentStore | null = null;

interface PersistedWebhookSubscriptions {
  schemaVersion: number;
  subscriptions: Record<string, string[]>;
}

function webhookSubscriptionFilePath(): string {
  return join(app.getPath("userData"), WEBHOOK_SUBSCRIPTION_FILE);
}

function casdoorWebhookStoragePath(): string {
  return join(app.getPath("userData"), "openbuddy.sqlite");
}

function openWebhookSubscriptionStore(): SettingsDocumentStore {
  if (webhookSubscriptionStore) return webhookSubscriptionStore;
  const opened = openStorageSync({ filePath: casdoorWebhookStoragePath(), appVersion: "openbuddy-casdoor-management" });
  webhookSubscriptionStore = new SettingsDocumentStore(opened.driver);
  return webhookSubscriptionStore;
}

function webhookSubscriptionStorageKey(tenantId: string): string {
  const issuer = String(casdoorAuth.status().config.issuer ?? "").trim().replace(/\/+$/, "");
  return `${issuer}::${tenantId.trim()}`;
}

async function loadLegacyWebhookSubscriptionsIntoCache(): Promise<void> {
  try {
    let raw: string;
    try {
      raw = await readFile(webhookSubscriptionFilePath(), "utf8");
    } catch {
      return; // file does not exist (first launch)
    }
    const parsed = JSON.parse(raw) as Partial<PersistedWebhookSubscriptions>;
    if (parsed.schemaVersion !== WEBHOOK_SUBSCRIPTION_SCHEMA_VERSION || !parsed.subscriptions || typeof parsed.subscriptions !== "object") {
      try { await rm(webhookSubscriptionFilePath(), { force: true }); } catch { /* best-effort */ }
      return;
    }
    for (const [key, values] of Object.entries(parsed.subscriptions)) {
      if (!Array.isArray(values)) continue;
      const normalized = values.map((value) => typeof value === "string" ? normalizeEventType(value) : null).filter((value): value is CasdoorWebhookEventType => Boolean(value));
      webhookSubscriptions.set(key, new Set(normalized));
    }
    // Persist migrated state and unlink the legacy file once.
    const snapshot: Record<string, string[]> = {};
    for (const [key, values] of webhookSubscriptions.entries()) snapshot[key] = Array.from(values);
    const store = openWebhookSubscriptionStore();
    store.set(WEBHOOK_SUBSCRIPTION_NAMESPACE, { casdoorSubscriptions: snapshot, schemaVersion: WEBHOOK_SUBSCRIPTION_SCHEMA_VERSION });
    try { await rm(webhookSubscriptionFilePath(), { force: true }); } catch { /* best-effort */ }
  } catch {
    // First launch and malformed files use the backward-compatible default-all behavior.
  }
}

let legacyMigrationPromise: Promise<void> | null = null;

function loadWebhookSubscriptions(): void {
  if (webhookSubscriptionsLoaded) return;
  webhookSubscriptionsLoaded = true;
  const store = openWebhookSubscriptionStore();
  const stored = store.get(WEBHOOK_SUBSCRIPTION_NAMESPACE);
  if (stored && typeof stored === "object" && stored.casdoorSubscriptions && typeof stored.casdoorSubscriptions === "object") {
    for (const [key, values] of Object.entries(stored.casdoorSubscriptions as Record<string, unknown>)) {
      if (!Array.isArray(values)) continue;
      const normalized = values.map((value) => typeof value === "string" ? normalizeEventType(value) : null).filter((value): value is CasdoorWebhookEventType => Boolean(value));
      webhookSubscriptions.set(key, new Set(normalized));
    }
    return;
  }
  legacyMigrationPromise = loadLegacyWebhookSubscriptionsIntoCache();
}

async function flushWebhookSubscriptionMigrationForTests(): Promise<void> {
  if (legacyMigrationPromise) await legacyMigrationPromise;
}

function persistWebhookSubscriptions(): void {
  const subscriptions: Record<string, string[]> = {};
  for (const [key, values] of webhookSubscriptions.entries()) subscriptions[key] = Array.from(values);
  const store = openWebhookSubscriptionStore();
  store.set(WEBHOOK_SUBSCRIPTION_NAMESPACE, { casdoorSubscriptions: subscriptions, schemaVersion: WEBHOOK_SUBSCRIPTION_SCHEMA_VERSION });
}

function normalizeEventType(input: string): CasdoorWebhookEventType | null {
  const trimmed = input.trim();
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(trimmed) ? (trimmed as CasdoorWebhookEventType) : null;
}

export function isWebhookSubscribed(tenantId: string, eventType: string): boolean {
  loadWebhookSubscriptions();
  const bucket = webhookSubscriptions.get(webhookSubscriptionStorageKey(tenantId));
  // 默认全量接收：未配置订阅 = 不过滤
  if (!bucket) return true;
  const normalized = normalizeEventType(eventType);
  if (!normalized) return false;
  return bucket.has(normalized);
}

export interface CasdoorWebhookSubscriptionSnapshot {
  tenantId: string;
  eventTypes: CasdoorWebhookEventType[];
  source: "default-all" | "explicit";
}

export function listCasdoorWebhookSubscriptions(tenantId: string): CasdoorWebhookSubscriptionSnapshot {
  requireTenantPermission("tenant.settings.read");
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) throw new Error("读取 webhook 订阅需要非空 tenantId");
  assertOwnerScope(normalizedTenantId);
  loadWebhookSubscriptions();
  const bucket = webhookSubscriptions.get(webhookSubscriptionStorageKey(normalizedTenantId));
  if (!bucket) return { tenantId: normalizedTenantId, eventTypes: [...WEBHOOK_EVENT_TYPES], source: "default-all" };
  return { tenantId: normalizedTenantId, eventTypes: Array.from(bucket), source: "explicit" };
}

export function updateCasdoorWebhookSubscriptions(input: { tenantId: string; eventTypes: string[] }): CasdoorWebhookSubscriptionSnapshot {
  requireTenantPermission("tenant.settings.write");
  const tenantId = (input.tenantId ?? "").trim();
  if (!tenantId) throw new Error("订阅 webhook 需要非空 tenantId");
  assertOwnerScope(tenantId);
  loadWebhookSubscriptions();
  const normalized = (Array.isArray(input.eventTypes) ? input.eventTypes : []).map(normalizeEventType).filter((type): type is CasdoorWebhookEventType => Boolean(type));
  // 显式订阅：传空数组 = 关闭所有事件订阅
  webhookSubscriptions.set(webhookSubscriptionStorageKey(tenantId), new Set(normalized));
  persistWebhookSubscriptions();
  return { tenantId, eventTypes: normalized, source: "explicit" };
}

export function clearCasdoorWebhookSubscriptions(tenantId: string): void {
  loadWebhookSubscriptions();
  webhookSubscriptions.delete(webhookSubscriptionStorageKey(tenantId));
  persistWebhookSubscriptions();
}

function resetWebhookSubscriptionsForTests(): void {
  webhookSubscriptions.clear();
  webhookSubscriptionsLoaded = false;
  legacyMigrationPromise = null;
}
