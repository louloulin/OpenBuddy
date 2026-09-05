import { app, BrowserWindow } from "electron";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { casdoorAuth } from "./casdoor-auth";
import { casdoorAudit } from "./casdoor-audit";
import { CasdoorResourceBackend } from "@openbuddy/auth-casdoor";
import { isWebhookSubscribed } from "./casdoor-management";
import { closeStorage, openStorage, type OpenStorageResult, SettingsDocumentStore } from "@openbuddy/storage";

import {
  isCasdoorResourceType,
  normalizeCasdoorResourceMetadata,
  normalizeCasdoorResourceName,
  normalizeCasdoorResourceIdempotencyKey,
  type CasdoorResourceCreateInput,
  type CasdoorResourceRecord,
  type CasdoorResourceType,
  type CasdoorResourceUpdateInput,
  type CasdoorTenantPolicy,
  type CasdoorTenantPolicyPatch,
  type CasdoorAiCapabilities,
  type CasdoorCommercialModelCatalog,
  type CasdoorMemberRevocation,
  type CasdoorCreditAccount,
  type CasdoorCreditWallet,
  type CasdoorCreditLedgerEntry,
  type CasdoorCreditPricing,
  type CasdoorCreditQuote,
  type CasdoorReconciliationReport,
  type CasdoorReconciliationExport,
  type CasdoorGatewayHealth,
  type CasdoorTenantHealth,
  type CasdoorBillingPlan,
  type CasdoorBillingSubscription,
  type CasdoorBillingPlanInput,
  type CasdoorBillingOrder,
  type CasdoorBillingOrderInput,
} from "@openbuddy/auth-casdoor";

const RESOURCE_FILE = "casdoor-tenant-resources.json";
const WALLET_SELECTION_FILE = "casdoor-credit-wallet-selection.json";
const MAX_RESOURCES = 10_000;

type ResourceStore = {
  schemaVersion: 3;
  resources: CasdoorResourceRecord[];
  idempotency: Record<string, string>;
  tenantPolicies: Record<string, CasdoorTenantPolicy>;
  runtimeUsage: Record<string, { date: string; tokens: number; points?: number; reservedPoints?: number }>;
};

function resourcePath(): string {
  return join(app.getPath("userData"), RESOURCE_FILE);
}

function emptyStore(): ResourceStore {
  return { schemaVersion: 3, resources: [], idempotency: {}, tenantPolicies: {}, runtimeUsage: {} };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeStore(value: unknown): ResourceStore {
  if (!value || typeof value !== "object") return emptyStore();
  const objectValue = value as Record<string, unknown>;
  const resources = Array.isArray(objectValue.resources)
    ? objectValue.resources.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const id = typeof item.id === "string" ? item.id.trim() : "";
        const tenantId = typeof item.tenantId === "string" ? item.tenantId.trim() : "";
        const ownerSubject = typeof item.ownerSubject === "string" ? item.ownerSubject.trim() : "";
        const type = item.type;
        const name = normalizeCasdoorResourceName(item.name);
        const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
        const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : "";
        const version = typeof item.version === "number" && Number.isInteger(item.version) ? item.version : 0;
        if (!id || !tenantId || !ownerSubject || !isCasdoorResourceType(type) || !name || !createdAt || !updatedAt || version < 1) return [];
        return [{ id, tenantId, ownerSubject, type, name, metadata: normalizeCasdoorResourceMetadata(item.metadata), createdAt, updatedAt, version } satisfies CasdoorResourceRecord];
      })
    : [];
  const idempotency: Record<string, string> = {};
  if (objectValue.idempotency && typeof objectValue.idempotency === "object") {
    for (const [key, id] of Object.entries(objectValue.idempotency as Record<string, unknown>)) {
      if (/^[a-zA-Z0-9_.:-]{1,120}$/.test(key) && typeof id === "string" && resources.some((resource) => resource.id === id)) idempotency[key] = id;
    }
  }
  const tenantPolicies: Record<string, CasdoorTenantPolicy> = {};
  if (objectValue.tenantPolicies && typeof objectValue.tenantPolicies === "object") {
    for (const [tenantId, value] of Object.entries(objectValue.tenantPolicies as Record<string, unknown>)) {
      if (!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(tenantId) || !value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const status = item.status === "suspended" || item.status === "archived" ? item.status : item.status === "active" ? "active" : undefined;
      const maxResources = typeof item.maxResources === "number" && Number.isInteger(item.maxResources) ? item.maxResources : 0;
      const updatedAt = typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : "";
      if (!status || maxResources < 1 || !updatedAt) continue;
      const modelAllowlist = Array.isArray(item.modelAllowlist) ? [...new Set(item.modelAllowlist.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))].slice(0, 256) : undefined;
      const mcpAllowlist = Array.isArray(item.mcpAllowlist) ? [...new Set(item.mcpAllowlist.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))].slice(0, 256) : undefined;
      const maxTokensPerDay = typeof item.maxTokensPerDay === "number" && Number.isInteger(item.maxTokensPerDay) && item.maxTokensPerDay >= 0 ? item.maxTokensPerDay : undefined;
      const maxPointsPerDay = typeof item.maxPointsPerDay === "number" && Number.isSafeInteger(item.maxPointsPerDay) && item.maxPointsPerDay >= 0 ? item.maxPointsPerDay : undefined;
      const newApiGroup = typeof item.newApiGroup === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(item.newApiGroup.trim()) ? item.newApiGroup.trim() : undefined;
      const tokensUsedToday = typeof item.tokensUsedToday === "number" && Number.isInteger(item.tokensUsedToday) && item.tokensUsedToday >= 0 ? item.tokensUsedToday : undefined;
      const version = typeof item.version === "number" && Number.isInteger(item.version) && item.version >= 1 ? item.version : 1;
      tenantPolicies[tenantId] = { status, maxResources, version, updatedAt, ...(typeof item.updatedBy === "string" ? { updatedBy: item.updatedBy } : {}), ...(modelAllowlist ? { modelAllowlist } : {}), ...(mcpAllowlist ? { mcpAllowlist } : {}), ...(item.killSwitch === true ? { killSwitch: true } : {}), ...(maxTokensPerDay === undefined ? {} : { maxTokensPerDay }), ...(maxPointsPerDay === undefined ? {} : { maxPointsPerDay }), ...(tokensUsedToday === undefined ? {} : { tokensUsedToday }), ...(newApiGroup ? { newApiGroup } : {}) };
    }
  }
  const runtimeUsage: ResourceStore["runtimeUsage"] = {};
  if (objectValue.runtimeUsage && typeof objectValue.runtimeUsage === "object") {
    for (const [tenantId, value] of Object.entries(objectValue.runtimeUsage as Record<string, unknown>)) {
      if (!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(tenantId) || !value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      if (typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && typeof item.tokens === "number" && Number.isInteger(item.tokens) && item.tokens >= 0) runtimeUsage[tenantId] = { date: item.date, tokens: Math.min(item.tokens, 2_000_000_000), ...(typeof item.points === "number" && Number.isSafeInteger(item.points) && item.points >= 0 ? { points: item.points } : {}), ...(typeof item.reservedPoints === "number" && Number.isSafeInteger(item.reservedPoints) && item.reservedPoints >= 0 ? { reservedPoints: item.reservedPoints } : {}) };
    }
  }
  return { schemaVersion: 3, resources: resources.slice(-MAX_RESOURCES), idempotency, tenantPolicies, runtimeUsage };
}

const RESOURCE_NAMESPACE = "casdoor:tenant-resources";
let resourceStoreStore: SettingsDocumentStore | null = null;
let resourceStoreStoragePromise: Promise<SettingsDocumentStore> | null = null;
let resourceStoreLegacyImported = false;

async function openResourceStoreStorage(): Promise<SettingsDocumentStore> {
  if (resourceStoreStore) return resourceStoreStore;
  if (!resourceStoreStoragePromise) {
    const path = join(app.getPath("userData"), "openbuddy.sqlite");
    resourceStoreStoragePromise = (async () => {
      const promise = openStorage({ filePath: path, appVersion: "openbuddy-casdoor-resources" });
      const opened: OpenStorageResult = await promise;
      const store = new SettingsDocumentStore(opened.driver);
      if (!resourceStoreLegacyImported) {
        // Custom legacy import: our legacy file is a single document (not a
        // SettingsDocumentStore-shaped dictionary), so we read it directly
        // and surface it under our own namespace.
        try {
          const legacy = JSON.parse(await readFile(resourcePath(), "utf8"));
          if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
            store.set(RESOURCE_NAMESPACE, legacy as Record<string, unknown>);
          }
          await rm(resourcePath(), { force: true });
        } catch { /* best-effort, leave file alone if invalid */ }
        resourceStoreLegacyImported = true;
      }
      return store;
    })();
  }
  const store = await resourceStoreStoragePromise;
  resourceStoreStore = store;
  return store;
}

async function readStore(): Promise<ResourceStore> {
  try {
    const store = await openResourceStoreStorage();
    const value = store.get(RESOURCE_NAMESPACE);
    if (!value || Object.keys(value).length === 0) return emptyStore();
    return normalizeStore(value);
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: ResourceStore): Promise<void> {
  const storage = await openResourceStoreStorage();
  storage.set(RESOURCE_NAMESPACE, store as unknown as Record<string, unknown>);
}

function activeContext(): { tenantId: string; subject: string } {
  const status = casdoorAuth.status();
  const tenantId = status.tenantContext.activeTenantId;
  const subject = status.identity?.subject;
  if (!status.config.configured || status.status !== "signed_in" || !tenantId || !subject) {
    throw new Error("请先登录并选择企业租户");
  }
  return { tenantId, subject };
}

function assertType(type: unknown): CasdoorResourceType {
  if (!isCasdoorResourceType(type)) throw new Error("不支持的企业资源类型");
  return type;
}

function localPolicy(store: ResourceStore, tenantId: string): CasdoorTenantPolicy {
  return store.tenantPolicies[tenantId] ?? { status: "active", maxResources: MAX_RESOURCES, version: 1, updatedAt: new Date(0).toISOString() };
}

function assertLocalPolicyActive(policy: CasdoorTenantPolicy): void {
  if (policy.status === "suspended") throw new Error("当前租户已暂停使用");
  if (policy.status === "archived") throw new Error("当前租户已归档");
}

function assertLocalPolicyWritable(policy: CasdoorTenantPolicy): void {
  assertLocalPolicyActive(policy);
}

function assertLocalPolicyReadable(policy: CasdoorTenantPolicy): void {
  if (policy.status === "suspended") throw new Error("当前租户已暂停使用");
}

function defaultRuntimePolicy(): CasdoorTenantPolicy {
  return { status: "active", maxResources: MAX_RESOURCES, version: 1, updatedAt: new Date(0).toISOString() };
}

async function authorize(tenantId: string, type: CasdoorResourceType, action: "create" | "read" | "update" | "delete", resourceId?: string): Promise<void> {
  const capability = type === "project" ? "team.workspace" : "cloud.sync";
  if (!casdoorAuth.authorize({ capability })) throw new Error("当前账户没有该企业资源能力");
  const config = casdoorAuth.status().config;
  if (!config.enforcerId || !process.env.OPENBUDDY_CASDOOR_CLIENT_SECRET) return;
  const allowed = await casdoorAuth.authorizeResourceRemotely({ tenantId, resource: type, resourceId, action });
  if (!allowed) throw new Error("当前账户没有访问该租户资源的权限");
}

async function audit(outcome: "success" | "failure", type: CasdoorResourceType, action: string, tenantId: string, resourceId?: string, reason?: string): Promise<void> {
  await casdoorAudit.record({ event: "tenant.resource", outcome, tenantId, subject: casdoorAuth.status().identity?.subject, resource: resourceId ? `${type}/${resourceId}` : type, action, reason });
}

let writeQueue = Promise.resolve();
let walletSelectionWriteQueue = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

function walletSelectionPath(): string {
  return join(app.getPath("userData"), WALLET_SELECTION_FILE);
}

async function readWalletSelections(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(walletSelectionPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([key, value]) => /^[a-zA-Z0-9_.:/-]{1,320}$/.test(key) && typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value)) as Array<[string, string]>);
  } catch {
    return {};
  }
}

function persistWalletSelection(contextKey: string, walletId: string | undefined): Promise<void> {
  const operation = walletSelectionWriteQueue.then(async () => {
    const selections = await readWalletSelections();
    if (walletId) selections[contextKey] = walletId;
    else delete selections[contextKey];
    await mkdir(app.getPath("userData"), { recursive: true });
    const temporary = `${walletSelectionPath()}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(selections), { mode: 0o600 });
    await rename(temporary, walletSelectionPath());
  }, async () => undefined);
  walletSelectionWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export type CasdoorResourceBackendFactory = () => CasdoorResourceBackend | null;

export class CasdoorResourceService {
  private selectedWalletByContext = new Map<string, string>();
  private loadedWalletSelectionContexts = new Set<string>();
  private backendFactory: CasdoorResourceBackendFactory = () => {
    const endpoint = process.env.OPENBUDDY_CASDOOR_RESOURCE_API_URL?.trim();
    return endpoint ? new CasdoorResourceBackend(endpoint) : null;
  };

  setBackendFactory(factory: CasdoorResourceBackendFactory | null): void {
    this.backendFactory = factory ?? (() => null);
  }

  private remoteBackend(): CasdoorResourceBackend | null {
    return this.backendFactory();
  }

  private remoteContext(): { tenantId: string; token: string; backend: CasdoorResourceBackend } | null {
    const backend = this.remoteBackend();
    if (!backend) return null;
    const context = activeContext();
    const token = casdoorAuth.getAccessToken();
    if (!token) throw new Error("企业会话已过期，请刷新后重试");
    return { ...context, token, backend };
  }

  private assertPolicyPermission(action: "read" | "write"): void {
    if (!casdoorAuth.authorize({ permission: `tenant.policy.${action}` as never })) {
      throw new Error("当前账户没有租户策略权限");
    }
  }

  private assertLifecyclePermission(): void {
    if (!casdoorAuth.authorize({ permission: "tenant.lifecycle.write" })) {
      throw new Error("当前账户没有租户生命周期权限");
    }
  }

  private assertCreditPermission(action: "read" | "write"): void {
    const permission = action === "read" ? "tenant.billing.read" : "tenant.billing.write";
    if (!casdoorAuth.authorize({ permission: permission as never })) {
      throw new Error("当前账户没有积分权限");
    }
  }

  private creditContext(): { tenantId: string; token: string; backend: CasdoorResourceBackend } {
    const remote = this.remoteContext();
    if (!remote) throw new Error("未配置 Resource Gateway，企业积分账本尚未启用");
    return remote;
  }

  private walletContextKey(): string {
    const { tenantId, subject } = activeContext();
    return `${tenantId}::${subject}`;
  }

  getSelectedWalletId(): string | undefined {
    try {
      const contextKey = this.walletContextKey();
      if (!this.loadedWalletSelectionContexts.has(contextKey)) {
        // Defer async load; mark as loaded synchronously to avoid duplicate kicks.
        this.loadedWalletSelectionContexts.add(contextKey);
        void readWalletSelections().then((selections) => {
          const persisted = selections[contextKey];
          if (persisted) this.selectedWalletByContext.set(contextKey, persisted);
        });
      }
      return this.selectedWalletByContext.get(contextKey);
    } catch {
      return undefined;
    }
  }

  getSelectedCreditWalletId(): string | undefined {
    this.assertCreditPermission("read");
    this.creditContext();
    return this.getSelectedWalletId();
  }

  async listCreditWallets(): Promise<CasdoorCreditWallet[]> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    return remote.backend.listCreditWallets(remote.token, remote.tenantId);
  }

  async getSelectedCreditWalletCredits(): Promise<CasdoorCreditAccount> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    const walletId = this.getSelectedWalletId();
    if (!walletId) return remote.backend.getCredits(remote.token, remote.tenantId);
    const wallets = await remote.backend.listCreditWallets(remote.token, remote.tenantId);
    const wallet = wallets.find((entry) => entry.id === walletId && entry.status === "active" && this.canSpendCreditWallet(entry));
    if (!wallet) {
      this.selectedWalletByContext.delete(this.walletContextKey());
      return remote.backend.getCredits(remote.token, remote.tenantId);
    }
    return remote.backend.getCreditWalletCredits(remote.token, remote.tenantId, wallet.id);
  }

  async listSelectedCreditWalletLedger(limit = 100): Promise<CasdoorCreditLedgerEntry[]> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    const walletId = this.getSelectedWalletId();
    if (!walletId) return remote.backend.listCreditLedger(remote.token, remote.tenantId, limit);
    const wallets = await remote.backend.listCreditWallets(remote.token, remote.tenantId);
    const wallet = wallets.find((entry) => entry.id === walletId && entry.status === "active" && this.canSpendCreditWallet(entry));
    if (!wallet) return remote.backend.listCreditLedger(remote.token, remote.tenantId, limit);
    return remote.backend.listCreditWalletLedger(remote.token, remote.tenantId, wallet.id, limit);
  }

  private canSpendCreditWallet(wallet: CasdoorCreditWallet): boolean {
    const status = casdoorAuth.status();
    if (status.identity?.isAdmin || status.tenantContext.membership?.isTenantAdmin) return true;
    const subject = status.identity?.subject;
    return Boolean(subject && wallet.members?.some((member) => member.subject === subject && (member.role === "owner" || member.role === "spender")));
  }

  async selectCreditWallet(walletId?: string): Promise<{ selectedWalletId?: string; wallets: CasdoorCreditWallet[] }> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    const wallets = await remote.backend.listCreditWallets(remote.token, remote.tenantId);
    const normalized = walletId?.trim();
    const contextKey = this.walletContextKey();
    const previous = this.getSelectedWalletId();
    if (!normalized) {
      this.selectedWalletByContext.delete(contextKey);
      await persistWalletSelection(contextKey, undefined);
      return { wallets };
    }
    const wallet = wallets.find((entry) => entry.id === normalized && entry.status === "active" && this.canSpendCreditWallet(entry));
    if (!wallet) throw new Error("共享钱包不存在、不可用或当前账户无权访问");
    this.selectedWalletByContext.set(contextKey, wallet.id);
    try {
      await persistWalletSelection(contextKey, wallet.id);
    } catch (error) {
      if (previous) this.selectedWalletByContext.set(contextKey, previous);
      else this.selectedWalletByContext.delete(contextKey);
      throw new Error(`共享钱包选择保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return { selectedWalletId: wallet.id, wallets };
  }

  async getCredits(subject?: string): Promise<CasdoorCreditAccount> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    return remote.backend.getCredits(remote.token, remote.tenantId, subject);
  }

  async listCreditLedger(limit = 100, subject?: string): Promise<CasdoorCreditLedgerEntry[]> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    return remote.backend.listCreditLedger(remote.token, remote.tenantId, limit, subject);
  }

  async getCreditReconciliation(since?: string, until?: string, walletId?: string): Promise<CasdoorReconciliationReport> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    return remote.backend.getCreditReconciliation(remote.token, remote.tenantId, since, until, walletId);
  }

  async getCreditReconciliationExport(since?: string, until?: string, walletId?: string): Promise<CasdoorReconciliationExport> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    return remote.backend.getCreditReconciliationExport(remote.token, remote.tenantId, since, until, walletId);
  }

  async listCreditPricing(): Promise<CasdoorCreditPricing[]> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    return remote.backend.listCreditPricing(remote.token, remote.tenantId);
  }

  async quoteCredits(input: { model: string; promptTokens: number; completionTokens: number }): Promise<CasdoorCreditQuote> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    return remote.backend.quoteCredits(remote.token, remote.tenantId, input);
  }

  async updateCreditPricing(input: Omit<CasdoorCreditPricing, "updatedAt" | "updatedBy">): Promise<CasdoorCreditPricing> {
    const remote = this.creditContext();
    this.assertCreditPermission("write");
    return remote.backend.updateCreditPricing(remote.token, remote.tenantId, input);
  }

  async grantCredits(input: { subject?: string; amount: number; type?: "grant"; reason?: string; validDays?: number; idempotencyKey: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry }> {
    const remote = this.creditContext();
    this.assertCreditPermission("write");
    return remote.backend.grantCredits(remote.token, remote.tenantId, input);
  }

  async issueWelcomeCredit(input: { subject?: string; idempotencyKey: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry }> {
    const remote = this.creditContext();
    this.assertCreditPermission("write");
    return remote.backend.issueWelcomeCredit(remote.token, remote.tenantId, input);
  }

  async reserveCredits(input: { amount?: number; model?: string; promptTokens?: number; completionTokens?: number; idempotencyKey: string; reason?: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry }> {
    const remote = this.creditContext();
    return remote.backend.reserveCredits(remote.token, remote.tenantId, input);
  }

  async settleCredits(input: { reservationKey: string; amount: number; model?: string; promptTokens?: number; completionTokens?: number; newApiRequestId?: string; reason?: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry; refunded?: number }> {
    const remote = this.creditContext();
    return remote.backend.settleCredits(remote.token, remote.tenantId, input);
  }

  async releaseCredits(reservationKey: string): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry; refunded?: number }> {
    const remote = this.creditContext();
    return remote.backend.releaseCredits(remote.token, remote.tenantId, reservationKey);
  }

  async expireCredits(subject?: string): Promise<{ expired: number; account: CasdoorCreditAccount }> {
    const remote = this.creditContext();
    this.assertCreditPermission("write");
    return remote.backend.expireCredits(remote.token, remote.tenantId, subject);
  }

  private assertBillingCatalogPermission(): void {
    const authorized = casdoorAuth.authorize({ permission: "tenant.billing.catalog.write" as never })
      || casdoorAuth.authorize({ permission: "billing.catalog.write" as never })
      || casdoorAuth.authorize({ capability: "tenant.billing.manage" as never });
    if (!authorized) throw new Error("当前账户没有套餐目录写权限");
  }

  async listBillingPlans(): Promise<CasdoorBillingPlan[]> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    return remote.backend.listBillingPlans(remote.token, remote.tenantId);
  }

  async getBillingSubscription(): Promise<CasdoorBillingSubscription | null> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    return remote.backend.getBillingSubscription(remote.token, remote.tenantId);
  }

  async upsertBillingPlan(input: CasdoorBillingPlanInput): Promise<CasdoorBillingPlan> {
    const remote = this.creditContext();
    this.assertBillingCatalogPermission();
    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!id) throw new Error("套餐 ID 不能为空");
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) throw new Error("套餐名称不能为空");
    return remote.backend.upsertBillingPlan(remote.token, remote.tenantId, { ...input, id, name });
  }

  async listBillingOrders(limit = 100, subject?: string): Promise<CasdoorBillingOrder[]> {
    const remote = this.creditContext();
    this.assertCreditPermission("read");
    return remote.backend.listBillingOrders(remote.token, remote.tenantId, subject, limit);
  }

  async createBillingOrder(input: CasdoorBillingOrderInput): Promise<CasdoorBillingOrder> {
    const remote = this.creditContext();
    this.assertCreditPermission("write");
    const planId = typeof input.planId === "string" ? input.planId.trim() : "";
    if (!planId) throw new Error("套餐 ID 不能为空");
    return remote.backend.createBillingOrder(remote.token, remote.tenantId, { ...input, planId });
  }

  async refundBillingOrder(orderNo: string): Promise<CasdoorBillingOrder> {
    const remote = this.creditContext();
    this.assertCreditPermission("write");
    if (!orderNo || !orderNo.trim()) throw new Error("订单号不能为空");
    return remote.backend.refundBillingOrder(remote.token, remote.tenantId, orderNo.trim());
  }

  async expireBillingOrder(orderNo: string): Promise<CasdoorBillingOrder> {
    const remote = this.creditContext();
    this.assertCreditPermission("write");
    if (!orderNo || !orderNo.trim()) throw new Error("订单号不能为空");
    return remote.backend.expireBillingOrder(remote.token, remote.tenantId, orderNo.trim());
  }

  async getTenantPolicy(): Promise<CasdoorTenantPolicy> {
    const remote = this.remoteContext();
    if (remote) {
      this.assertPolicyPermission("read");
      return remote.backend.getTenantPolicy(remote.token, remote.tenantId);
    }
    const { tenantId } = activeContext();
    this.assertPolicyPermission("read");
    const store = await readStore();
    return store.tenantPolicies[tenantId] ?? { status: "active", maxResources: MAX_RESOURCES, version: 1, updatedAt: new Date(0).toISOString() };
  }

  async getRuntimePolicy(): Promise<CasdoorTenantPolicy> {
    const remote = this.remoteContext();
    if (remote) return remote.backend.getRuntimePolicy(remote.token, remote.tenantId);
    const { tenantId } = activeContext();
    const store = await readStore();
    const policy = store.tenantPolicies[tenantId] ?? defaultRuntimePolicy();
    const usage = store.runtimeUsage[tenantId];
    return { ...policy, tokensUsedToday: usage?.date === todayKey() ? usage.tokens : 0, pointsUsedToday: usage?.date === todayKey() ? usage.points ?? 0 : 0, pointsReservedToday: usage?.date === todayKey() ? usage.reservedPoints ?? 0 : 0 };
  }

  async getAiCapabilities(): Promise<CasdoorAiCapabilities | { configured: false }> {
    const remote = this.remoteContext();
    if (!remote) return { configured: false };
    return remote.backend.getAiCapabilities(remote.token, remote.tenantId);
  }

  async getCommercialModelCatalog(): Promise<CasdoorCommercialModelCatalog | { configured: false }> {
    const remote = this.remoteContext();
    if (!remote) return { configured: false };
    return remote.backend.getCommercialModelCatalog(remote.token, remote.tenantId);
  }

  async assertAiModelCapability(modelId: string): Promise<void> {
    const providerId = modelId.split("/", 1)[0] ?? "";
    if (!providerId.startsWith("new_api")) return;
    const capabilities = await this.getAiCapabilities();
    if ("configured" in capabilities) return;
    if (capabilities.capabilitySource !== "gateway-config") return;
    const separator = modelId.indexOf("/");
    const modelName = separator >= 0 ? modelId.slice(separator + 1) : modelId;
    const model = capabilities.models.find((entry) => entry.id === modelName || entry.id === modelId);
    if (!model) return;
    const chat = model.capabilities["chat.completions"];
    if (chat?.supported === false) throw new Error(`NEW_API_PROTOCOL_UNSUPPORTED: ${chat.reason ?? "当前模型不支持 Chat Completions"}`);
  }

  async assertRuntimePolicy(action: "prompt" | "model" | "mcp", value?: string): Promise<CasdoorTenantPolicy | null> {
    const status = casdoorAuth.status();
    if (!status.config.configured || status.status !== "signed_in" || !status.tenantContext.activeTenantId) return null;
    const policy = await this.getRuntimePolicy();
    if (policy.status !== "active" || policy.killSwitch) throw new Error("CASDOOR_RUNTIME_DISABLED: 当前租户已暂停智能体运行");
    if (action === "prompt" && policy.maxTokensPerDay !== undefined && (policy.tokensUsedToday ?? 0) >= policy.maxTokensPerDay) throw new Error("CASDOOR_TOKEN_QUOTA_EXCEEDED: 当前租户今日 token 配额已用尽");
    if (action === "model" && policy.modelAllowlist?.length && (!value || !policy.modelAllowlist.includes(value))) throw new Error(`CASDOOR_MODEL_NOT_ALLOWED: 模型 ${value ?? "unknown"} 不在租户白名单`);
    if (action === "mcp" && policy.mcpAllowlist?.length && (!value || !policy.mcpAllowlist.includes(value))) throw new Error(`CASDOOR_MCP_NOT_ALLOWED: MCP ${value ?? "unknown"} 不在租户白名单`);
    return policy;
  }

  async recordRuntimeUsage(tokens: number, points = 0): Promise<CasdoorTenantPolicy | null> {
    const remote = this.remoteContext();
    if (remote) return remote.backend.recordRuntimeUsage(remote.token, remote.tenantId, tokens, points);
    const status = casdoorAuth.status();
    if (!status.config.configured || status.status !== "signed_in" || !status.tenantContext.activeTenantId) return null;
    const { tenantId } = activeContext();
    return serialized(async () => {
      const store = await readStore();
      const current = store.tenantPolicies[tenantId] ?? defaultRuntimePolicy();
      assertLocalPolicyWritable(current);
      const used = Math.max(0, Math.floor(tokens));
      const pointsUsed = Math.max(0, Math.floor(points));
      const previous = store.runtimeUsage[tenantId];
      const usage: ResourceStore["runtimeUsage"][string] = previous?.date === todayKey()
        ? { date: todayKey(), tokens: previous.tokens + used, points: (previous.points ?? 0) + pointsUsed, ...(previous.reservedPoints ? { reservedPoints: previous.reservedPoints } : {}) }
        : { date: todayKey(), tokens: used, ...(pointsUsed ? { points: pointsUsed } : {}) };
      store.runtimeUsage[tenantId] = usage;
      await writeStore(store);
      return { ...current, tokensUsedToday: usage.tokens, pointsUsedToday: usage.points ?? 0, pointsReservedToday: usage.reservedPoints ?? 0 };
    });
  }

  async updateTenantPolicy(patch: CasdoorTenantPolicyPatch): Promise<CasdoorTenantPolicy> {
    const remote = this.remoteContext();
    if (remote) {
      this.assertPolicyPermission("write");
      if (patch.status === "archived") this.assertLifecyclePermission();
      if (patch.status === "active" && (await remote.backend.getTenantPolicy(remote.token, remote.tenantId)).status === "archived") this.assertLifecyclePermission();
      return remote.backend.updateTenantPolicy(remote.token, remote.tenantId, patch);
    }
    const { tenantId, subject } = activeContext();
    this.assertPolicyPermission("write");
    const status = patch.status === undefined ? undefined : patch.status === "active" || patch.status === "suspended" || patch.status === "archived" ? patch.status : undefined;
    const maxResources = patch.maxResources === undefined ? undefined : Number(patch.maxResources);
    if (patch.status !== undefined && !status) throw new Error("租户状态无效");
    if (maxResources !== undefined && (!Number.isInteger(maxResources) || maxResources < 1 || maxResources > MAX_RESOURCES)) throw new Error("租户资源配额无效");
    return serialized(async () => {
      const store = await readStore();
      const current = store.tenantPolicies[tenantId] ?? { status: "active" as const, maxResources: MAX_RESOURCES, version: 1, updatedAt: new Date(0).toISOString() };
      if (status === "archived" || current.status === "archived") this.assertLifecyclePermission();
      if (patch.expectedVersion !== undefined && (!Number.isInteger(patch.expectedVersion) || patch.expectedVersion < 1)) throw new Error("租户策略版本无效");
      if (patch.expectedVersion !== undefined && patch.expectedVersion !== current.version) throw new Error("TENANT_POLICY_VERSION_CONFLICT: 租户策略已被其他管理员更新，请刷新后重试");
      const modelAllowlist = patch.modelAllowlist === undefined ? undefined : [...new Set(patch.modelAllowlist.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))].slice(0, 256);
      const mcpAllowlist = patch.mcpAllowlist === undefined ? undefined : [...new Set(patch.mcpAllowlist.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))].slice(0, 256);
      const maxTokensPerDay = patch.maxTokensPerDay === undefined ? undefined : Number(patch.maxTokensPerDay);
      const maxPointsPerDay = patch.maxPointsPerDay === undefined ? undefined : Number(patch.maxPointsPerDay);
      const newApiGroup = patch.newApiGroup === undefined ? undefined : patch.newApiGroup.trim();
      if (patch.modelAllowlist !== undefined && !modelAllowlist) throw new Error("模型白名单无效");
      if (patch.mcpAllowlist !== undefined && !mcpAllowlist) throw new Error("MCP 白名单无效");
      if (patch.killSwitch !== undefined && typeof patch.killSwitch !== "boolean") throw new Error("kill switch 值无效");
      if (maxTokensPerDay !== undefined && (!Number.isInteger(maxTokensPerDay) || maxTokensPerDay < 0)) throw new Error("每日 token 配额无效");
      if (maxPointsPerDay !== undefined && (!Number.isSafeInteger(maxPointsPerDay) || maxPointsPerDay < 0)) throw new Error("每日积分预算无效");
      if (newApiGroup !== undefined && newApiGroup && !/^[a-zA-Z0-9_.:-]{1,120}$/.test(newApiGroup)) throw new Error("New API Group 无效");
      const policy: CasdoorTenantPolicy = { ...current, version: current.version + 1, ...(status ? { status } : {}), ...(maxResources === undefined ? {} : { maxResources }), ...(modelAllowlist === undefined ? {} : { modelAllowlist }), ...(mcpAllowlist === undefined ? {} : { mcpAllowlist }), ...(patch.killSwitch === undefined ? {} : { killSwitch: patch.killSwitch }), ...(maxTokensPerDay === undefined ? {} : { maxTokensPerDay }), ...(maxPointsPerDay === undefined ? {} : { maxPointsPerDay }), ...(newApiGroup === undefined ? {} : { newApiGroup: newApiGroup || undefined }), updatedAt: new Date().toISOString(), updatedBy: subject };
      store.tenantPolicies[tenantId] = policy;
      await writeStore(store);
      return policy;
    });
  }

  async listTenantAudit(limit = 100): Promise<unknown[]> {
    const remote = this.remoteContext();
    if (remote) {
      if (!casdoorAuth.authorize({ permission: "tenant.audit.read" })) throw new Error("当前账户没有审计读取权限");
      return remote.backend.listTenantAudit(remote.token, remote.tenantId, limit);
    }
    await this.assertAuditPermission();
    const events = await casdoorAudit.list(casdoorAuth.status().tenantContext.activeTenantId);
    return events.slice(-Math.max(1, Math.min(500, Math.floor(limit))));
  }

  async setMemberRevocation(subject: string, revoked: boolean, reason?: string): Promise<CasdoorMemberRevocation> {
    const remote = this.remoteContext();
    if (!remote) return { subject: subject.trim(), revoked, ...(reason?.trim() ? { reason: reason.trim() } : {}), configured: false };
    if (!casdoorAuth.authorize({ permission: "tenant.lifecycle.write" })) throw new Error("当前账户没有租户生命周期权限");
    const result = await remote.backend.setMemberRevocation(remote.token, remote.tenantId, subject, revoked, reason);
    await casdoorAudit.record({ event: "tenant.member-revocation", outcome: "success", tenantId: remote.tenantId, subject: casdoorAuth.status().identity?.subject, resource: `member/${subject.trim()}`, action: revoked ? "revoke" : "restore", reason });
    broadcastMemberRevocation(remote.tenantId, subject.trim(), revoked, reason);
    if (revoked) await casdoorAuth.handleExternalRevocation(remote.tenantId, subject.trim(), reason);
    return result;
  }

  async deliverCasdoorWebhook(event: { type: string; action: string; organization: string; user?: string; group?: string; role?: string; permission?: string; target?: string }, signatureSecret: string): Promise<{ received: string; action: string; impacted: string[] }> {
    const remote = this.remoteContext();
    if (!remote) return { received: event.type, action: event.action, impacted: [] };
    const result = await remote.backend.deliverWebhook(event, signatureSecret);
    broadcastCasdoorWebhook(event, result.impacted);
    if (result.impacted.length > 0) await casdoorAuth.refresh().catch(() => undefined);
    return result;
  }

  async listMemberRevocations(): Promise<CasdoorMemberRevocation[]> {
    const remote = this.remoteContext();
    if (!remote) return [];
    if (!casdoorAuth.authorize({ permission: "tenant.lifecycle.write" })) throw new Error("当前账户没有租户生命周期权限");
    return remote.backend.listMemberRevocations(remote.token, remote.tenantId);
  }

  async registerSession(input: { sessionId: string; kind?: CasdoorSessionKind; scopes?: string[]; deviceFingerprint?: string; metadata?: Record<string, string | number | boolean | null> }): Promise<CasdoorSessionBinding> {
    const remote = this.remoteContext();
    if (!remote) return { sessionId: input.sessionId, subject: casdoorAuth.status().identity?.subject ?? "anonymous", kind: input.kind ?? "desktop", scopes: input.scopes ?? [], startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), ...(input.deviceFingerprint ? { deviceFingerprint: input.deviceFingerprint } : {}), ...(input.metadata ? { metadata: input.metadata } : {}), configured: false } as CasdoorSessionBinding;
    const result = await remote.backend.registerSession(remote.token, remote.tenantId, { sessionId: input.sessionId, kind: input.kind, scopes: input.scopes, deviceFingerprint: input.deviceFingerprint, metadata: input.metadata });
    await casdoorAudit.record({ event: "tenant.session", outcome: "success", tenantId: remote.tenantId, subject: casdoorAuth.status().identity?.subject, resource: `session/${input.sessionId}`, action: "register", reason: input.kind ?? "desktop" });
    return result;
  }

  async listSessions(limit = 100): Promise<CasdoorSessionBinding[]> {
    const remote = this.remoteContext();
    if (!remote) return [];
    return remote.backend.listSessions(remote.token, remote.tenantId, limit);
  }

  async unregisterSession(sessionId: string): Promise<{ removed: boolean }> {
    const remote = this.remoteContext();
    if (!remote) return { removed: false };
    const result = await remote.backend.unregisterSession(remote.token, remote.tenantId, sessionId);
    await casdoorAudit.record({ event: "tenant.session", outcome: result.removed ? "success" : "deny", tenantId: remote.tenantId, subject: casdoorAuth.status().identity?.subject, resource: `session/${sessionId}`, action: result.removed ? "unregister" : "unregister_missing" });
    return result;
  }

  private async assertAuditPermission(): Promise<void> {
    if (!casdoorAuth.authorize({ permission: "tenant.audit.read" })) throw new Error("当前账户没有审计读取权限");
  }

  async list(type?: CasdoorResourceType): Promise<CasdoorResourceRecord[]> {
    const remote = this.remoteContext();
    if (remote) {
      if (type) {
        const resourceType = assertType(type);
        await authorize(remote.tenantId, resourceType, "read");
        return remote.backend.list(remote.token, remote.tenantId, resourceType);
      }
      const resources = await Promise.all(
        (["project", "knowledge_base", "storage_connection"] as const).map(async (resourceType) => {
          try {
            await authorize(remote.tenantId, resourceType, "read");
            return remote.backend.list(remote.token, remote.tenantId, resourceType);
          } catch {
            return [];
          }
        }),
      );
      return resources.flat();
    }
    const { tenantId } = activeContext();
    if (type) {
      await authorize(tenantId, assertType(type), "read");
    } else {
      const checks = await Promise.allSettled(
        (["project", "knowledge_base", "storage_connection"] as const).map((resourceType) => authorize(tenantId, resourceType, "read").then(() => resourceType)),
      );
      const allowedTypes = new Set(checks.flatMap((check) => check.status === "fulfilled" ? [check.value] : []));
      const store = await readStore();
      assertLocalPolicyReadable(localPolicy(store, tenantId));
      return store.resources.filter((resource) => resource.tenantId === tenantId && allowedTypes.has(resource.type));
    }
    const store = await readStore();
    assertLocalPolicyReadable(localPolicy(store, tenantId));
    return store.resources.filter((resource) => resource.tenantId === tenantId && (!type || resource.type === type));
  }

  async get(id: string): Promise<CasdoorResourceRecord> {
    const remote = this.remoteContext();
    if (remote) {
      const resource = await remote.backend.get(remote.token, remote.tenantId, id);
      await authorize(remote.tenantId, resource.type, "read", resource.id);
      return resource;
    }
    const { tenantId } = activeContext();
    const resourceId = id.trim();
    const store = await readStore();
    assertLocalPolicyReadable(localPolicy(store, tenantId));
    const resource = store.resources.find((entry) => entry.id === resourceId && entry.tenantId === tenantId);
    if (!resource) throw new Error("企业资源不存在");
    await authorize(tenantId, resource.type, "read", resource.id);
    return resource;
  }

  async create(input: CasdoorResourceCreateInput): Promise<CasdoorResourceRecord> {
    const remote = this.remoteContext();
    if (remote) {
      const type = assertType(input?.type);
      const name = normalizeCasdoorResourceName(input?.name);
      if (!name) throw new Error("企业资源名称不能为空");
      await authorize(remote.tenantId, type, "create");
      const resource = await remote.backend.create(remote.token, remote.tenantId, { ...input, type, name });
      await audit("success", type, "create", remote.tenantId, resource.id);
      return resource;
    }
    const { tenantId, subject } = activeContext();
    const type = assertType(input?.type);
    const name = normalizeCasdoorResourceName(input?.name);
    if (!name) throw new Error("企业资源名称不能为空");
    await authorize(tenantId, type, "create");
    return serialized(async () => {
      const store = await readStore();
      const policy = localPolicy(store, tenantId);
      assertLocalPolicyActive(policy);
      const idempotencyKey = normalizeCasdoorResourceIdempotencyKey(input?.idempotencyKey);
      const previousId = idempotencyKey ? store.idempotency[`${subject}:${idempotencyKey}`] : undefined;
      const previous = previousId && store.resources.find((resource) => resource.id === previousId);
      if (previous) return previous;
      if (store.resources.filter((resource) => resource.tenantId === tenantId).length >= policy.maxResources) throw new Error("当前租户资源配额已用尽");
      const now = new Date().toISOString();
      const resource: CasdoorResourceRecord = { id: randomUUID(), tenantId, ownerSubject: subject, type, name, metadata: normalizeCasdoorResourceMetadata(input.metadata), createdAt: now, updatedAt: now, version: 1 };
      store.resources.push(resource);
      if (idempotencyKey) store.idempotency[`${subject}:${idempotencyKey}`] = resource.id;
      const idempotencyEntries = Object.entries(store.idempotency);
      if (idempotencyEntries.length > MAX_RESOURCES) {
        store.idempotency = Object.fromEntries(idempotencyEntries.slice(-MAX_RESOURCES));
      }
      store.resources = store.resources.slice(-MAX_RESOURCES);
      await writeStore(store);
      await audit("success", type, "create", tenantId, resource.id);
      return resource;
    });
  }

  async update(id: string, input: CasdoorResourceUpdateInput): Promise<CasdoorResourceRecord> {
    const remote = this.remoteContext();
    if (remote) {
      const existing = await remote.backend.get(remote.token, remote.tenantId, id);
      await authorize(remote.tenantId, existing.type, "update", existing.id);
      const resource = await remote.backend.update(remote.token, remote.tenantId, id, input);
      await audit("success", existing.type, "update", remote.tenantId, resource.id);
      return resource;
    }
    const { tenantId } = activeContext();
    return serialized(async () => {
      const store = await readStore();
      assertLocalPolicyActive(localPolicy(store, tenantId));
      const index = store.resources.findIndex((resource) => resource.id === id.trim() && resource.tenantId === tenantId);
      const resource = index >= 0 ? store.resources[index] : undefined;
      if (!resource) throw new Error("企业资源不存在");
      if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion !== resource.version) throw new Error("企业资源版本已变更，请刷新后重试");
      await authorize(tenantId, resource.type, "update", resource.id);
      const name = input.name === undefined ? resource.name : normalizeCasdoorResourceName(input.name);
      if (!name) throw new Error("企业资源名称不能为空");
      const updated: CasdoorResourceRecord = { ...resource, name, metadata: input.metadata === undefined ? resource.metadata : normalizeCasdoorResourceMetadata(input.metadata), updatedAt: new Date().toISOString(), version: resource.version + 1 };
      store.resources[index] = updated;
      await writeStore(store);
      await audit("success", resource.type, "update", tenantId, resource.id);
      return updated;
    });
  }

  async delete(id: string, expectedVersion: number): Promise<{ ok: true }> {
    const remote = this.remoteContext();
    if (remote) {
      const existing = await remote.backend.get(remote.token, remote.tenantId, id);
      await authorize(remote.tenantId, existing.type, "delete", existing.id);
      const result = await remote.backend.delete(remote.token, remote.tenantId, id, expectedVersion);
      await audit("success", existing.type, "delete", remote.tenantId, existing.id);
      return result;
    }
    const { tenantId } = activeContext();
    return serialized(async () => {
      const store = await readStore();
      assertLocalPolicyActive(localPolicy(store, tenantId));
      const index = store.resources.findIndex((resource) => resource.id === id.trim() && resource.tenantId === tenantId);
      const resource = index >= 0 ? store.resources[index] : undefined;
      if (!resource) throw new Error("企业资源不存在");
      if (!Number.isInteger(expectedVersion) || expectedVersion !== resource.version) throw new Error("企业资源版本已变更，请刷新后重试");
      await authorize(tenantId, resource.type, "delete", resource.id);
      store.resources.splice(index, 1);
      for (const [key, value] of Object.entries(store.idempotency)) if (value === resource.id) delete store.idempotency[key];
      await writeStore(store);
      await audit("success", resource.type, "delete", tenantId, resource.id);
      return { ok: true };
    });
  }

  async gatewayHealth(): Promise<CasdoorGatewayHealth | { configured: false }> {
    const remote = this.remoteContext();
    if (!remote) return { configured: false, ok: false, store: "memory", latencyMs: 0, version: "local" };
    return remote.backend.health();
  }

  async tenantHealth(): Promise<CasdoorTenantHealth | { configured: false }> {
    const remote = this.remoteContext();
    if (!remote) return { configured: false, ok: false, store: "memory", latencyMs: 0, version: "local", tenantId: casdoorAuth.status().tenantContext.activeTenantId ?? "", policy: { status: "active", maxResources: 0, version: 0, killSwitch: false, modelAllowlist: 0, mcpAllowlist: 0, tokensUsedToday: 0, pointsUsedToday: 0 }, resources: {}, revokedMembers: 0, activeSessions: 0, siem: null, at: new Date().toISOString() };
    if (!casdoorAuth.status().tenantContext.activeTenantId) throw new Error("当前未选择租户");
    return remote.backend.tenantHealth(remote.token, remote.tenantId);
  }
}

export const casdoorResources = new CasdoorResourceService();

function broadcastCasdoorWebhook(event: { type: string; action: string; organization: string; user?: string; group?: string; role?: string; permission?: string; target?: string }, impacted: string[]): void {
  // Webhook subscription filter: 按 tenantId + event.type 校验订阅（5.4）
  const tenantId = event.organization ?? "*";
  const eventKey = `${event.type}.${event.action}`;
  if (!isWebhookSubscribed(tenantId, eventKey)) {
    return; // 未订阅该事件类型，丢弃
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send("casdoor://casdoor-webhook", { ...event, impacted, at: new Date().toISOString() });
  }
}

function broadcastMemberRevocation(tenantId: string, subject: string, revoked: boolean, reason?: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send("casdoor://member-revocation", { tenantId, subject, revoked, reason: reason ?? null, at: new Date().toISOString() });
  }
}

export const __casdoorResourceTestables = { normalizeStore, CasdoorResourceService };
import type { CasdoorSessionBinding, CasdoorSessionKind } from "@openbuddy/auth-casdoor";
