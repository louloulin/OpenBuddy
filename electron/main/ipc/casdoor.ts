/**
 * IPC surface — casdoor domain.
 *
 * Split out of `./index.ts`.
 */
import { ipcMain, shell, type BrowserWindow } from "electron";
import { casdoorAuth } from "../casdoor/casdoor-auth";
import { casdoorAudit } from "../casdoor/casdoor-audit";
import { casdoorResources } from "../casdoor/casdoor-resources";
import { askWeKnora, listWeKnoraKnowledgeBases, weknoraStatus } from "../casdoor/weknora-client";
import { hasCasdoorCapability } from "@openbuddy/auth-casdoor";
import {
	listCasdoorGroups,
	listCasdoorOrganizations,
	listCasdoorPermissions,
	listCasdoorRoles,
	listCasdoorRules,
	listCasdoorUsers,
	updateCasdoorUser,
	saveCasdoorUser,
	deleteCasdoorUser,
	saveCasdoorRole,
	updateCasdoorRole,
	deleteCasdoorRole,
	saveCasdoorPermission,
	updateCasdoorPermission,
	deleteCasdoorPermission,
	saveCasdoorOrganization,
	updateCasdoorOrganization,
	deleteCasdoorOrganization,
	saveCasdoorGroup,
	updateCasdoorGroup,
	deleteCasdoorGroup,
	saveCasdoorRule,
	updateCasdoorRule,
	deleteCasdoorRule,
	inviteCasdoorUser,
	listCasdoorAccountLinking,
	unlinkCasdoorAccount,
	getCasdoorOrganization,
	listCasdoorSessions,
	deleteCasdoorSession,
	deleteAllCasdoorSessions,
	introspectCasdoorToken,
	listCasdoorWebhookSubscriptions,
	updateCasdoorWebhookSubscriptions,
	type CasdoorAccountLinkingInput,
	type CasdoorListQuery,
	type CasdoorUserInvite,
	type CasdoorSessionRevokeInput,
	type CasdoorUserPatch,
	type CasdoorUserInput,
	type CasdoorRoleInput,
	type CasdoorPermissionInput,
	type CasdoorOrganizationInput,
	type CasdoorGroupInput,
	type CasdoorRuleInput,
} from "../casdoor/casdoor-management";

export function registerCasdoorIpc(getWindow: () => BrowserWindow | null): void {
		ipcMain.handle("casdoor:workbench-summary", async () => {
			const status = casdoorAuth.status();
			const identity = status.identity ? {
				subject: status.identity.subject,
				displayName: status.identity.displayName,
				email: status.identity.email,
				phone: status.identity.phone,
				organizations: status.identity.organizations,
				roles: status.identity.roles,
				groups: status.identity.groups,
				permissions: status.identity.permissions,
				capabilities: status.identity.capabilities,
				isAdmin: status.identity.isAdmin,
				customFields: status.identity.customFields,
			} : null;
			return {
				status: status.status,
				provider: status.provider,
				expiresAt: status.expiresAt,
				error: status.error,
				tenantContext: status.tenantContext,
				config: { configured: status.config.configured, reason: status.config.reason },
				identity,
			};
		});
		ipcMain.handle("casdoor:status", async () => casdoorAuth.status());
		ipcMain.handle("casdoor:capabilities", async () => casdoorAuth.getLoginCapabilities());
		ipcMain.handle("casdoor:config-get", async () => casdoorAuth.getConfig());
		ipcMain.handle("casdoor:config-save", async (_e, patch: Record<string, unknown>) => casdoorAuth.saveConfig(patch));
		ipcMain.handle("casdoor:login", async (_e, provider: "default" | "sms" | "wechat") => casdoorAuth.startLogin(provider));
		ipcMain.handle("casdoor:refresh", async () => casdoorAuth.refresh());
		ipcMain.handle("casdoor:logout", async () => casdoorAuth.logout());
		ipcMain.handle("casdoor:open-management", async () => {
			if (!casdoorAuth.status().config.configured) throw new Error("Casdoor 配置无效，请先完成企业身份配置");
			casdoorAuth.assertAuthorized({ capability: "admin.portal" }, "当前账户没有 Casdoor 管理权限");
			const url = casdoorAuth.status().config.managementUrl;
			if (!/^https?:\/\//i.test(url)) throw new Error("Casdoor 管理地址无效");
			await shell.openExternal(url);
			return { ok: true };
		});
		ipcMain.handle("casdoor:can", async (_e, capability: string) => casdoorAuth.can(capability as never));
		ipcMain.handle("casdoor:authorize", async (_e, requirement: { capability?: string; permission?: string }) => {
			if (requirement.capability) return casdoorAuth.authorize({ capability: requirement.capability as never });
			if (requirement.permission) return casdoorAuth.authorize({ permission: requirement.permission as never });
			return false;
		});
		ipcMain.handle("casdoor:authorize-resource", async (_e, request: { tenantId?: string; resource: string; resourceId?: string; action: string }) => casdoorAuth.authorizeResourceRemotely(request));
		ipcMain.handle("casdoor:authorize-decision", async (_e, requirement: { capability?: string; permission?: string }) => {
			if (requirement.capability) return casdoorAuth.authorize({ capability: requirement.capability as never });
			if (requirement.permission) return casdoorAuth.authorize({ permission: requirement.permission as never });
			return false;
		});
		ipcMain.handle("casdoor:weknora-token-exchange", async (_e, input: { tenantId: string; sessionId?: string }) => casdoorAuth.exchangeForWeKnora(input.tenantId, input.sessionId));
		ipcMain.handle("weknora:status", async () => weknoraStatus());
		ipcMain.handle("weknora:list-knowledge-bases", async (_e, input?: { query?: string }) => listWeKnoraKnowledgeBases(input?.query));
		ipcMain.handle("weknora:ask", async (_e, input: { query: string; knowledgeBaseIds: string[]; sessionId?: string }) => askWeKnora(input.query, input.knowledgeBaseIds, input.sessionId));
		ipcMain.handle("casdoor:tenant-select", async (_e, tenantId: string) => casdoorAuth.selectTenant(tenantId));
		ipcMain.handle("casdoor:audit-list", async () => {
			casdoorAuth.assertAuthorized({ permission: "tenant.audit.read" }, "当前租户没有审计读取权限");
			const status = casdoorAuth.status();
			return casdoorAudit.list(hasCasdoorCapability(status.identity, "admin.portal") ? undefined : status.tenantContext.activeTenantId);
		});
		ipcMain.handle("casdoor:list-users", async (_e, query?: CasdoorListQuery) => listCasdoorUsers(query ?? {}));
		ipcMain.handle("casdoor:list-account-linking", async (_e, args: { owner: string; name: string }) => listCasdoorAccountLinking(args.owner, args.name));
		ipcMain.handle("casdoor:unlink-account", async (_e, input: CasdoorAccountLinkingInput) => unlinkCasdoorAccount(input));
		ipcMain.handle("casdoor:get-organization", async (_e, args: { owner: string; name: string }) => getCasdoorOrganization(args.owner, args.name));
		ipcMain.handle("casdoor:list-sessions", async (_e, args: { owner: string; name: string }) => listCasdoorSessions(args.owner, args.name));
		ipcMain.handle("casdoor:session-list", async (_e, args?: { limit?: number }) => casdoorResources.listSessions(args?.limit ?? 100));
		ipcMain.handle("casdoor:delete-session", async (_e, input: CasdoorSessionRevokeInput) => deleteCasdoorSession(input));
		ipcMain.handle("casdoor:delete-all-sessions", async (_e, args: { owner: string; name: string }) => deleteAllCasdoorSessions(args.owner, args.name));
		ipcMain.handle("casdoor:webhook-subscription-list", async (_e, args: { tenantId: string }) => listCasdoorWebhookSubscriptions(args.tenantId));
		ipcMain.handle("casdoor:webhook-subscription-update", async (_e, input: { tenantId: string; eventTypes: string[] }) => updateCasdoorWebhookSubscriptions(input));
		ipcMain.handle("casdoor:list-organizations", async (_e, query?: CasdoorListQuery) => listCasdoorOrganizations(query ?? {}));
		ipcMain.handle("casdoor:list-roles", async (_e, query?: CasdoorListQuery) => listCasdoorRoles(query ?? {}));
		ipcMain.handle("casdoor:list-permissions", async (_e, query?: CasdoorListQuery) => listCasdoorPermissions(query ?? {}));
		ipcMain.handle("casdoor:list-groups", async (_e, query?: CasdoorListQuery) => listCasdoorGroups(query ?? {}));
		ipcMain.handle("casdoor:list-rules", async (_e, query?: CasdoorListQuery) => listCasdoorRules(query ?? {}));
		ipcMain.handle("casdoor:user-update", async (_e, patch: CasdoorUserPatch) => updateCasdoorUser(patch));
		ipcMain.handle("casdoor:user-invite", async (_e, invite: CasdoorUserInvite) => inviteCasdoorUser(invite));
		ipcMain.handle("casdoor:user-add", async (_e, user: CasdoorUserInput) => saveCasdoorUser(user));
		ipcMain.handle("casdoor:user-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorUser(args.owner, args.name));
		ipcMain.handle("casdoor:role-add", async (_e, role: CasdoorRoleInput) => saveCasdoorRole(role));
		ipcMain.handle("casdoor:role-update", async (_e, role: CasdoorRoleInput) => updateCasdoorRole(role));
		ipcMain.handle("casdoor:role-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorRole(args.owner, args.name));
		ipcMain.handle("casdoor:permission-add", async (_e, permission: CasdoorPermissionInput) => saveCasdoorPermission(permission));
		ipcMain.handle("casdoor:permission-update", async (_e, permission: CasdoorPermissionInput) => updateCasdoorPermission(permission));
		ipcMain.handle("casdoor:permission-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorPermission(args.owner, args.name));
		ipcMain.handle("casdoor:organization-add", async (_e, organization: CasdoorOrganizationInput) => saveCasdoorOrganization(organization));
		ipcMain.handle("casdoor:organization-update", async (_e, organization: CasdoorOrganizationInput) => updateCasdoorOrganization(organization));
		ipcMain.handle("casdoor:organization-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorOrganization(args.owner, args.name));
		ipcMain.handle("casdoor:group-add", async (_e, group: CasdoorGroupInput) => saveCasdoorGroup(group));
		ipcMain.handle("casdoor:group-update", async (_e, group: CasdoorGroupInput) => updateCasdoorGroup(group));
		ipcMain.handle("casdoor:group-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorGroup(args.owner, args.name));
		ipcMain.handle("casdoor:rule-add", async (_e, rule: CasdoorRuleInput) => saveCasdoorRule(rule));
		ipcMain.handle("casdoor:rule-update", async (_e, rule: CasdoorRuleInput) => updateCasdoorRule(rule));
	ipcMain.handle("casdoor:open-membership-management", async () => {
			if (!casdoorAuth.status().config.configured) throw new Error("Casdoor 配置无效，请先完成企业身份配置");
			casdoorAuth.assertAuthorized({ permission: "tenant.users.read" }, "当前账户没有成员管理权限");
			const url = casdoorAuth.status().config.managementUrl;
			if (!/^https?:\/\//i.test(url)) throw new Error("Casdoor 管理地址无效");
			await shell.openExternal(url);
			return { ok: true };
		});
		ipcMain.handle("casdoor:resource-list", async (_e, args?: { type?: string }) => casdoorResources.list(args?.type as never));
		ipcMain.handle("casdoor:session-register", async (_e, input: { sessionId: string; kind?: string; scopes?: string[]; deviceFingerprint?: string; metadata?: Record<string, string | number | boolean | null> }) => casdoorResources.registerSession(input as never));
		ipcMain.handle("casdoor:session-unregister", async (_e, args: { sessionId: string }) => casdoorResources.unregisterSession(args.sessionId));
		ipcMain.handle("casdoor:webhook-deliver", async (_e, args: { event: { type: string; action: string; organization: string; user?: string; group?: string; role?: string; permission?: string; target?: string }; signatureSecret: string }) => casdoorResources.deliverCasdoorWebhook(args.event, args.signatureSecret));
		ipcMain.handle("casdoor:resource-get", async (_e, args: { id: string }) => casdoorResources.get(args.id));
		ipcMain.handle("casdoor:resource-create", async (_e, args: { input: unknown }) => casdoorResources.create(args.input as never));
		ipcMain.handle("casdoor:resource-update", async (_e, args: { id: string; input: unknown }) => casdoorResources.update(args.id, args.input as never));
		ipcMain.handle("casdoor:resource-delete", async (_e, args: { id: string; expectedVersion: number }) => casdoorResources.delete(args.id, args.expectedVersion));
		ipcMain.handle("casdoor:tenant-policy-get", async () => casdoorResources.getTenantPolicy());
		ipcMain.handle("casdoor:tenant-policy-update", async (_e, patch: unknown) => casdoorResources.updateTenantPolicy(patch as never));
		ipcMain.handle("casdoor:tenant-audit-list", async (_e, query?: { limit?: number }) => casdoorResources.listTenantAudit(query?.limit ?? 100));
		ipcMain.handle("casdoor:tenant-health", async () => casdoorResources.tenantHealth());
		ipcMain.handle("casdoor:runtime-policy-get", async () => casdoorResources.getRuntimePolicy());
		ipcMain.handle("casdoor:ai-capabilities", async () => casdoorResources.getAiCapabilities());
		ipcMain.handle("casdoor:commercial-model-catalog", async () => casdoorResources.getCommercialModelCatalog());
		ipcMain.handle("casdoor:credits-get", async (_e, args?: { subject?: string }) => casdoorResources.getCredits(args?.subject));
		ipcMain.handle("casdoor:credits-ledger", async (_e, args?: { limit?: number; subject?: string }) => casdoorResources.listCreditLedger(args?.limit ?? 100, args?.subject));
		ipcMain.handle("casdoor:credits-pricing", async () => casdoorResources.listCreditPricing());
		ipcMain.handle("casdoor:credits-pricing-update", async (_e, input: unknown) => casdoorResources.updateCreditPricing(input as never));
		ipcMain.handle("casdoor:credits-quote", async (_e, input: { model: string; promptTokens: number; completionTokens: number }) => casdoorResources.quoteCredits(input));
		ipcMain.handle("casdoor:credits-reconciliation", async (_e, args?: { since?: string; until?: string; walletId?: string }) => casdoorResources.getCreditReconciliation(args?.since, args?.until, args?.walletId));
		ipcMain.handle("casdoor:credits-reconciliation-export", async (_e, args?: { since?: string; until?: string; walletId?: string }) => casdoorResources.getCreditReconciliationExport(args?.since, args?.until, args?.walletId));
		ipcMain.handle("casdoor:credits-grant", async (_e, input: { subject?: string; amount: number; type?: "grant"; reason?: string; validDays?: number; idempotencyKey: string }) => casdoorResources.grantCredits(input));
		ipcMain.handle("casdoor:credits-reserve", async (_e, input: { amount?: number; model?: string; promptTokens?: number; completionTokens?: number; idempotencyKey: string; reason?: string }) => casdoorResources.reserveCredits(input));
		ipcMain.handle("casdoor:credits-settle", async (_e, input: { reservationKey: string; amount: number; model?: string; promptTokens?: number; completionTokens?: number; newApiRequestId?: string; reason?: string }) => casdoorResources.settleCredits(input));
		ipcMain.handle("casdoor:credits-release", async (_e, args: { reservationKey: string }) => casdoorResources.releaseCredits(args.reservationKey));
		ipcMain.handle("casdoor:credits-expire", async (_e, args?: { subject?: string }) => casdoorResources.expireCredits(args?.subject));
		ipcMain.handle("casdoor:credits-welcome", async (_e, input: { subject?: string; idempotencyKey: string }) => casdoorResources.issueWelcomeCredit(input));
		ipcMain.handle("casdoor:wallets-list", async () => casdoorResources.listCreditWallets());
		ipcMain.handle("casdoor:wallet-selected", async () => casdoorResources.getSelectedWalletId());
		ipcMain.handle("casdoor:wallet-select", async (_e, args: { walletId?: string }) => casdoorResources.selectCreditWallet(args.walletId));
		ipcMain.handle("casdoor:wallet-credits", async () => casdoorResources.getSelectedCreditWalletCredits());
		ipcMain.handle("casdoor:wallet-ledger", async (_e, args?: { limit?: number }) => casdoorResources.listSelectedCreditWalletLedger(args?.limit ?? 100));
		ipcMain.handle("casdoor:billing-plans", async () => casdoorResources.listBillingPlans());
		ipcMain.handle("casdoor:billing-plan-upsert", async (_e, input: unknown) => casdoorResources.upsertBillingPlan(input as never));
		ipcMain.handle("casdoor:billing-orders", async (_e, args?: { limit?: number; subject?: string }) => casdoorResources.listBillingOrders(args?.limit ?? 100, args?.subject));
		ipcMain.handle("casdoor:billing-order-create", async (_e, input: unknown) => casdoorResources.createBillingOrder(input as never));
		ipcMain.handle("casdoor:billing-order-refund", async (_e, args: { orderNo: string }) => casdoorResources.refundBillingOrder(args.orderNo));
		ipcMain.handle("casdoor:billing-order-expire", async (_e, args: { orderNo: string }) => casdoorResources.expireBillingOrder(args.orderNo));
		ipcMain.handle("casdoor:billing-subscription", async () => casdoorResources.getBillingSubscription());
		ipcMain.handle("casdoor:introspect-token", async () => { casdoorAuth.authorize({ permission: "tenant.users.read" }); return introspectCasdoorToken({ token: "" }); });
		ipcMain.handle("casdoor:gateway-health", async () => casdoorResources.gatewayHealth());
		ipcMain.handle("casdoor:member-revocation", async (_e, args: { subject: string; revoked: boolean; reason?: string }) => casdoorResources.setMemberRevocation(args.subject, args.revoked, args.reason));
		ipcMain.handle("casdoor:member-revocations", async () => casdoorResources.listMemberRevocations());
		ipcMain.handle("casdoor:rule-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorRule(args.owner, args.name));
}
