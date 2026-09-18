/**
 * IPC surface — casdoor domain.
 *
 * Split out of `./index.ts`.
 */
import { shell, type BrowserWindow } from "electron";
import { wrapIpcHandler } from "./_wrap";
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
		wrapIpcHandler("casdoor:workbench-summary", async () => {
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
		wrapIpcHandler("casdoor:status", async () => casdoorAuth.status());
		wrapIpcHandler("casdoor:capabilities", async () => casdoorAuth.getLoginCapabilities());
		wrapIpcHandler("casdoor:config-get", async () => casdoorAuth.getConfig());
		wrapIpcHandler("casdoor:config-save", async (_e, patch: Record<string, unknown>) => casdoorAuth.saveConfig(patch));
		wrapIpcHandler("casdoor:login", async (_e, provider: "default" | "sms" | "wechat") => casdoorAuth.startLogin(provider));
		wrapIpcHandler("casdoor:refresh", async () => casdoorAuth.refresh());
		wrapIpcHandler("casdoor:logout", async () => casdoorAuth.logout());
		wrapIpcHandler("casdoor:open-management", async () => {
			if (!casdoorAuth.status().config.configured) throw new Error("Casdoor 配置无效，请先完成企业身份配置");
			casdoorAuth.assertAuthorized({ capability: "admin.portal" }, "当前账户没有 Casdoor 管理权限");
			const url = casdoorAuth.status().config.managementUrl;
			if (!/^https?:\/\//i.test(url)) throw new Error("Casdoor 管理地址无效");
			await shell.openExternal(url);
			return { ok: true };
		});
		wrapIpcHandler("casdoor:can", async (_e, capability: string) => casdoorAuth.can(capability as never));
		wrapIpcHandler("casdoor:authorize", async (_e, requirement: { capability?: string; permission?: string }) => {
			if (requirement.capability) return casdoorAuth.authorize({ capability: requirement.capability as never });
			if (requirement.permission) return casdoorAuth.authorize({ permission: requirement.permission as never });
			return false;
		});
		wrapIpcHandler("casdoor:authorize-resource", async (_e, request: { tenantId?: string; resource: string; resourceId?: string; action: string }) => casdoorAuth.authorizeResourceRemotely(request));
		wrapIpcHandler("casdoor:authorize-decision", async (_e, requirement: { capability?: string; permission?: string }) => {
			if (requirement.capability) return casdoorAuth.authorize({ capability: requirement.capability as never });
			if (requirement.permission) return casdoorAuth.authorize({ permission: requirement.permission as never });
			return false;
		});
		wrapIpcHandler("casdoor:weknora-token-exchange", async (_e, input: { tenantId: string; sessionId?: string }) => casdoorAuth.exchangeForWeKnora(input.tenantId, input.sessionId));
		wrapIpcHandler("weknora:status", async () => weknoraStatus());
		wrapIpcHandler("weknora:list-knowledge-bases", async (_e, input?: { query?: string }) => listWeKnoraKnowledgeBases(input?.query));
		wrapIpcHandler("weknora:ask", async (_e, input: { query: string; knowledgeBaseIds: string[]; sessionId?: string }) => askWeKnora(input.query, input.knowledgeBaseIds, input.sessionId));
		wrapIpcHandler("casdoor:tenant-select", async (_e, tenantId: string) => casdoorAuth.selectTenant(tenantId));
		wrapIpcHandler("casdoor:audit-list", async () => {
			casdoorAuth.assertAuthorized({ permission: "tenant.audit.read" }, "当前租户没有审计读取权限");
			const status = casdoorAuth.status();
			return casdoorAudit.list(hasCasdoorCapability(status.identity, "admin.portal") ? undefined : status.tenantContext.activeTenantId);
		});
		wrapIpcHandler("casdoor:list-users", async (_e, query?: CasdoorListQuery) => listCasdoorUsers(query ?? {}));
		wrapIpcHandler("casdoor:list-account-linking", async (_e, args: { owner: string; name: string }) => listCasdoorAccountLinking(args.owner, args.name));
		wrapIpcHandler("casdoor:unlink-account", async (_e, input: CasdoorAccountLinkingInput) => unlinkCasdoorAccount(input));
		wrapIpcHandler("casdoor:get-organization", async (_e, args: { owner: string; name: string }) => getCasdoorOrganization(args.owner, args.name));
		wrapIpcHandler("casdoor:list-sessions", async (_e, args: { owner: string; name: string }) => listCasdoorSessions(args.owner, args.name));
		wrapIpcHandler("casdoor:session-list", async (_e, args?: { limit?: number }) => casdoorResources.listSessions(args?.limit ?? 100));
		wrapIpcHandler("casdoor:delete-session", async (_e, input: CasdoorSessionRevokeInput) => deleteCasdoorSession(input));
		wrapIpcHandler("casdoor:delete-all-sessions", async (_e, args: { owner: string; name: string }) => deleteAllCasdoorSessions(args.owner, args.name));
		wrapIpcHandler("casdoor:webhook-subscription-list", async (_e, args: { tenantId: string }) => listCasdoorWebhookSubscriptions(args.tenantId));
		wrapIpcHandler("casdoor:webhook-subscription-update", async (_e, input: { tenantId: string; eventTypes: string[] }) => updateCasdoorWebhookSubscriptions(input));
		wrapIpcHandler("casdoor:list-organizations", async (_e, query?: CasdoorListQuery) => listCasdoorOrganizations(query ?? {}));
		wrapIpcHandler("casdoor:list-roles", async (_e, query?: CasdoorListQuery) => listCasdoorRoles(query ?? {}));
		wrapIpcHandler("casdoor:list-permissions", async (_e, query?: CasdoorListQuery) => listCasdoorPermissions(query ?? {}));
		wrapIpcHandler("casdoor:list-groups", async (_e, query?: CasdoorListQuery) => listCasdoorGroups(query ?? {}));
		wrapIpcHandler("casdoor:list-rules", async (_e, query?: CasdoorListQuery) => listCasdoorRules(query ?? {}));
		wrapIpcHandler("casdoor:user-update", async (_e, patch: CasdoorUserPatch) => updateCasdoorUser(patch));
		wrapIpcHandler("casdoor:user-invite", async (_e, invite: CasdoorUserInvite) => inviteCasdoorUser(invite));
		wrapIpcHandler("casdoor:user-add", async (_e, user: CasdoorUserInput) => saveCasdoorUser(user));
		wrapIpcHandler("casdoor:user-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorUser(args.owner, args.name));
		wrapIpcHandler("casdoor:role-add", async (_e, role: CasdoorRoleInput) => saveCasdoorRole(role));
		wrapIpcHandler("casdoor:role-update", async (_e, role: CasdoorRoleInput) => updateCasdoorRole(role));
		wrapIpcHandler("casdoor:role-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorRole(args.owner, args.name));
		wrapIpcHandler("casdoor:permission-add", async (_e, permission: CasdoorPermissionInput) => saveCasdoorPermission(permission));
		wrapIpcHandler("casdoor:permission-update", async (_e, permission: CasdoorPermissionInput) => updateCasdoorPermission(permission));
		wrapIpcHandler("casdoor:permission-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorPermission(args.owner, args.name));
		wrapIpcHandler("casdoor:organization-add", async (_e, organization: CasdoorOrganizationInput) => saveCasdoorOrganization(organization));
		wrapIpcHandler("casdoor:organization-update", async (_e, organization: CasdoorOrganizationInput) => updateCasdoorOrganization(organization));
		wrapIpcHandler("casdoor:organization-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorOrganization(args.owner, args.name));
		wrapIpcHandler("casdoor:group-add", async (_e, group: CasdoorGroupInput) => saveCasdoorGroup(group));
		wrapIpcHandler("casdoor:group-update", async (_e, group: CasdoorGroupInput) => updateCasdoorGroup(group));
		wrapIpcHandler("casdoor:group-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorGroup(args.owner, args.name));
		wrapIpcHandler("casdoor:rule-add", async (_e, rule: CasdoorRuleInput) => saveCasdoorRule(rule));
		wrapIpcHandler("casdoor:rule-update", async (_e, rule: CasdoorRuleInput) => updateCasdoorRule(rule));
	wrapIpcHandler("casdoor:open-membership-management", async () => {
			if (!casdoorAuth.status().config.configured) throw new Error("Casdoor 配置无效，请先完成企业身份配置");
			casdoorAuth.assertAuthorized({ permission: "tenant.users.read" }, "当前账户没有成员管理权限");
			const url = casdoorAuth.status().config.managementUrl;
			if (!/^https?:\/\//i.test(url)) throw new Error("Casdoor 管理地址无效");
			await shell.openExternal(url);
			return { ok: true };
		});
		wrapIpcHandler("casdoor:resource-list", async (_e, args?: { type?: string }) => casdoorResources.list(args?.type as never));
		wrapIpcHandler("casdoor:session-register", async (_e, input: { sessionId: string; kind?: string; scopes?: string[]; deviceFingerprint?: string; metadata?: Record<string, string | number | boolean | null> }) => casdoorResources.registerSession(input as never));
		wrapIpcHandler("casdoor:session-unregister", async (_e, args: { sessionId: string }) => casdoorResources.unregisterSession(args.sessionId));
		wrapIpcHandler("casdoor:webhook-deliver", async (_e, args: { event: { type: string; action: string; organization: string; user?: string; group?: string; role?: string; permission?: string; target?: string }; signatureSecret: string }) => casdoorResources.deliverCasdoorWebhook(args.event, args.signatureSecret));
		wrapIpcHandler("casdoor:resource-get", async (_e, args: { id: string }) => casdoorResources.get(args.id));
		wrapIpcHandler("casdoor:resource-create", async (_e, args: { input: unknown }) => casdoorResources.create(args.input as never));
		wrapIpcHandler("casdoor:resource-update", async (_e, args: { id: string; input: unknown }) => casdoorResources.update(args.id, args.input as never));
		wrapIpcHandler("casdoor:resource-delete", async (_e, args: { id: string; expectedVersion: number }) => casdoorResources.delete(args.id, args.expectedVersion));
		wrapIpcHandler("casdoor:tenant-policy-get", async () => casdoorResources.getTenantPolicy());
		wrapIpcHandler("casdoor:tenant-policy-update", async (_e, patch: unknown) => casdoorResources.updateTenantPolicy(patch as never));
		wrapIpcHandler("casdoor:tenant-audit-list", async (_e, query?: { limit?: number }) => casdoorResources.listTenantAudit(query?.limit ?? 100));
		wrapIpcHandler("casdoor:tenant-health", async () => casdoorResources.tenantHealth());
		wrapIpcHandler("casdoor:runtime-policy-get", async () => casdoorResources.getRuntimePolicy());
		wrapIpcHandler("casdoor:ai-capabilities", async () => casdoorResources.getAiCapabilities());
		wrapIpcHandler("casdoor:commercial-model-catalog", async () => casdoorResources.getCommercialModelCatalog());
		wrapIpcHandler("casdoor:credits-get", async (_e, args?: { subject?: string }) => casdoorResources.getCredits(args?.subject));
		wrapIpcHandler("casdoor:credits-ledger", async (_e, args?: { limit?: number; subject?: string }) => casdoorResources.listCreditLedger(args?.limit ?? 100, args?.subject));
		wrapIpcHandler("casdoor:credits-pricing", async () => casdoorResources.listCreditPricing());
		wrapIpcHandler("casdoor:credits-pricing-update", async (_e, input: unknown) => casdoorResources.updateCreditPricing(input as never));
		wrapIpcHandler("casdoor:credits-quote", async (_e, input: { model: string; promptTokens: number; completionTokens: number }) => casdoorResources.quoteCredits(input));
		wrapIpcHandler("casdoor:credits-reconciliation", async (_e, args?: { since?: string; until?: string; walletId?: string }) => casdoorResources.getCreditReconciliation(args?.since, args?.until, args?.walletId));
		wrapIpcHandler("casdoor:credits-reconciliation-export", async (_e, args?: { since?: string; until?: string; walletId?: string }) => casdoorResources.getCreditReconciliationExport(args?.since, args?.until, args?.walletId));
		wrapIpcHandler("casdoor:credits-grant", async (_e, input: { subject?: string; amount: number; type?: "grant"; reason?: string; validDays?: number; idempotencyKey: string }) => casdoorResources.grantCredits(input));
		wrapIpcHandler("casdoor:credits-reserve", async (_e, input: { amount?: number; model?: string; promptTokens?: number; completionTokens?: number; idempotencyKey: string; reason?: string }) => casdoorResources.reserveCredits(input));
		wrapIpcHandler("casdoor:credits-settle", async (_e, input: { reservationKey: string; amount: number; model?: string; promptTokens?: number; completionTokens?: number; newApiRequestId?: string; reason?: string }) => casdoorResources.settleCredits(input));
		wrapIpcHandler("casdoor:credits-release", async (_e, args: { reservationKey: string }) => casdoorResources.releaseCredits(args.reservationKey));
		wrapIpcHandler("casdoor:credits-expire", async (_e, args?: { subject?: string }) => casdoorResources.expireCredits(args?.subject));
		wrapIpcHandler("casdoor:credits-welcome", async (_e, input: { subject?: string; idempotencyKey: string }) => casdoorResources.issueWelcomeCredit(input));
		wrapIpcHandler("casdoor:wallets-list", async () => casdoorResources.listCreditWallets());
		wrapIpcHandler("casdoor:wallet-selected", async () => casdoorResources.getSelectedWalletId());
		wrapIpcHandler("casdoor:wallet-select", async (_e, args: { walletId?: string }) => casdoorResources.selectCreditWallet(args.walletId));
		wrapIpcHandler("casdoor:wallet-credits", async () => casdoorResources.getSelectedCreditWalletCredits());
		wrapIpcHandler("casdoor:wallet-ledger", async (_e, args?: { limit?: number }) => casdoorResources.listSelectedCreditWalletLedger(args?.limit ?? 100));
		wrapIpcHandler("casdoor:billing-plans", async () => casdoorResources.listBillingPlans());
		wrapIpcHandler("casdoor:billing-plan-upsert", async (_e, input: unknown) => casdoorResources.upsertBillingPlan(input as never));
		wrapIpcHandler("casdoor:billing-orders", async (_e, args?: { limit?: number; subject?: string }) => casdoorResources.listBillingOrders(args?.limit ?? 100, args?.subject));
		wrapIpcHandler("casdoor:billing-order-create", async (_e, input: unknown) => casdoorResources.createBillingOrder(input as never));
		wrapIpcHandler("casdoor:billing-order-refund", async (_e, args: { orderNo: string }) => casdoorResources.refundBillingOrder(args.orderNo));
		wrapIpcHandler("casdoor:billing-order-expire", async (_e, args: { orderNo: string }) => casdoorResources.expireBillingOrder(args.orderNo));
		wrapIpcHandler("casdoor:billing-subscription", async () => casdoorResources.getBillingSubscription());
		wrapIpcHandler("casdoor:introspect-token", async () => { casdoorAuth.authorize({ permission: "tenant.users.read" }); return introspectCasdoorToken({ token: "" }); });
		wrapIpcHandler("casdoor:gateway-health", async () => casdoorResources.gatewayHealth());
		wrapIpcHandler("casdoor:member-revocation", async (_e, args: { subject: string; revoked: boolean; reason?: string }) => casdoorResources.setMemberRevocation(args.subject, args.revoked, args.reason));
		wrapIpcHandler("casdoor:member-revocations", async () => casdoorResources.listMemberRevocations());
		wrapIpcHandler("casdoor:rule-delete", async (_e, args: { owner: string; name: string }) => deleteCasdoorRule(args.owner, args.name));
}
