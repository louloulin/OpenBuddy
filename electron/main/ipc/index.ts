/**
 * IPC surface — renderer-facing `ipcMain.handle` registrations.
 *
 * Routes every renderer `invoke(...)` to either `agentHost.ts` (Pi SDK in-process)
 * or one of the 13 Cordis-mounted capability packages. Each package re-exports a
 * `<name>Handlers` façade that delegates to the live `Context` (the same one
 * agent-host.ts spun up), so the renderer can call any subsystem without going
 * through the agent loop.
 */
import { clipboard, dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
// P1-04 / P0-04: agent-host transitively pulls 138 top-level imports
// (pi-coding-agent, plugin-host, deepseek-runtime, pi-resources, ...).
// The Proxy lives in `./agent-host-proxy` so IPC sub-modules can import
// agentHost without creating a circular dependency through this index.ts.
// See ./agent-host-proxy.ts for the lazy-load mechanics.
import {
  agentHost,
  agentHostReady,
  bindAgentHost,
  bindRendererEventEmitter,
  bindRendererEventEmitterFn,
  ensureAgentHostLoaded,
} from "./agent-host-proxy";

// Re-export for backward compatibility (tests + boot orchestration call
// these through this index).
export { agentHostReady, bindAgentHost, bindRendererEventEmitterFn, ensureAgentHostLoaded };

import { getActiveHarnessServer, getHarnessServerAddress } from "../harness/harness-server";
import * as connectors from "../connectors";
import * as resources from "../agent/pi-resources";
import { dispatchMainNotifications } from "../notifications";
import { createRpcId, parseRpcMessage, rpcError, rpcValue, RpcId, serverResponse, validateRpcRequestPayload, type ClientRequest } from "@openbuddy/plugin-host";
import { remoteRequestFromHarnessRequest } from "../harness/harness-remote-request";
import type { DeepSeekConnectionDispatchContext } from "../deepseek/deepseek-runtime";
import { describeTypertCatalog } from "../agent/typert-catalog";
import { paginateHistoryEntries as paginateHistory } from "../agent/host-modules/pagination";
import * as workbuddyImport from "../workbuddy-import";
import { casdoorAuth } from "../casdoor/casdoor-auth";
import { casdoorAudit } from "../casdoor/casdoor-audit";
import { casdoorResources } from "../casdoor/casdoor-resources";
import { askWeKnora, listWeKnoraKnowledgeBases, weknoraStatus } from "../casdoor/weknora-client";
import { hasCasdoorCapability } from "@openbuddy/auth-casdoor";
import { sendSafe } from "../collaboration/send-safe";
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
import {
  rendererList,
  rendererRead,
  rendererRemove,
  rendererWriteVersioned,
} from "../storage/renderer-storage";
import { loadCollaborationBootstrap, loadTaskBootstrap, loadWorkspaceBootstrap, recentStorageMetrics } from "../storage/workspace-bootstrap";
import { closeStorage, openStorage } from "@openbuddy/storage";
import {
	absolutePath,
	assertPolicyModelAllowed,
	assertPolicySkillUploadAllowed,
	emailComposePayload,
	emailMutationPayload,
	emailRuleSchedule,
	emailSearchPayload,
	emailTagMutationPayload,
	enumValue,
	fromPiPermissionMode,
	httpUrl,
	memoryScope,
	modelId,
	normalizePromptContent,
	numberValue,
	openDialogOptions,
	optionalCwd,
	optionalFiniteInteger,
	optionalFiniteNumber,
	optionalNonNegativeIntegerArray,
	optionalString,
	optionalStringArray,
	permissionRules,
	providerId,
	publicPermissionMode,
	recordValue,
	requiredBoolean,
	requiredString,
	requiredStringArray,
	saveDialogOptions,
	stringValue,
	throwWorkspaceIpcError,
	toPiPermissionMode,
	writeAllowedRoot,
	type RecordValue,
} from "./validation";
import { registerCasdoorIpc } from "./casdoor";
import { registerStorageIpc } from "./storage";
import { registerEmailIpc } from "./email";
import { registerCollaborationIpc } from "./collaboration";
import { registerHarnessIpc } from "./harness";
import { registerAgentIpc } from "./agent";
import { registerConnectorsIpc } from "./connectors";
import { registerMiscIpc } from "./misc";


function rpcPayload(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RPC payload must be an object");
	return value as RecordValue;
}

async function harnessDirectoryListing(requestedPath?: string): Promise<{ path: string; home: string; crumbs: Array<{ name: string; path: string; hidden: false }>; entries: Array<{ name: string; path: string; hidden: boolean }>; truncated: boolean }> {
	const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
	const home = homedir();
	const path = requestedPath === undefined ? home : absolutePath(requestedPath, "path");
	const rows = await shellFsHandlers.listDir(path, home, 2001);
	const entries = rows.filter((entry) => entry.kind === "directory").slice(0, 2000).map((entry) => ({ name: entry.name, path: entry.path, hidden: entry.name.startsWith(".") }));
	const relativePath = relative(home, path);
	const crumbs: Array<{ name: string; path: string; hidden: false }> = [];
	let current = home;
	crumbs.push({ name: home.split(/[\\/]/).pop() || home, path: home, hidden: false });
	if (relativePath && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)) {
		for (const segment of relativePath.split(/[\\/]/).filter(Boolean)) {
			current = join(current, segment);
			crumbs.push({ name: segment, path: current, hidden: false });
		}
	}
	return { path, home, crumbs, entries, truncated: rows.length > 2000 };
}

function isInteractionResponse(value: unknown, method: string): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const response = value as Record<string, unknown>;
	if (response.cancelled !== undefined && typeof response.cancelled !== "boolean") return false;
	if (method === "session.permission") return response.optionId === undefined || typeof response.optionId === "string";
	if (response.answers !== undefined && (!response.answers || typeof response.answers !== "object" || Array.isArray(response.answers))) return false;
	if (response.annotations !== undefined && (!response.annotations || typeof response.annotations !== "object" || Array.isArray(response.annotations))) return false;
	return true;
}

function uiInteractionValue(value: unknown, method: string): string | boolean | { decision: "allow_always" } | { answers: Record<string, string | string[]>; annotations: Record<string, { preview?: string; notes?: string }> } | undefined {
	if (method === "session.permission") {
		if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
		const response = value as Record<string, unknown>;
		if (response.cancelled === true) return false;
		if (response.cancelled === true || response.optionId === "deny") return false;
		if (response.optionId === "allow_always") return { decision: "allow_always" };
		return response.optionId === "allow" ? true : false;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const response = value as Record<string, unknown>;
	const answers = response.answers && typeof response.answers === "object" && !Array.isArray(response.answers)
		? Object.fromEntries(Object.entries(response.answers).filter(([, item]) => typeof item === "string" || (Array.isArray(item) && item.every((entry) => typeof entry === "string")))) as Record<string, string | string[]>
		: {};
	const annotations = response.annotations && typeof response.annotations === "object" && !Array.isArray(response.annotations)
		? response.annotations as Record<string, { preview?: string; notes?: string }>
		: {};
	return { answers, annotations };
}

export async function dispatchTypedRpc(request: ClientRequest, source: "renderer" | "harness" = "renderer"): Promise<unknown> {
  validateRpcRequestPayload(request.method, request.payload);
	const payload = rpcPayload(request.payload);
	// Ensure agentHost module is loaded before any handler touches the Proxy.
	// The pre-warm at module top usually completes well before this is
	// called (the renderer's first IPC is several hundred ms after main
	// starts), but tests that call dispatchTypedRpc directly skip that
	// warm-up — so we await here.
	await ensureAgentHostLoaded();
		switch (request.method) {
		case "host.describe":
			return { product: "OpenBuddy", runtime: "pi", pluginHost: "openbuddy" };
		case "host.pickDirectory": {
			const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
			return { path: result.canceled ? null : result.filePaths[0] ?? null };
		}
		case "host.listDirectory":
			return harnessDirectoryListing(typeof payload.path === "string" ? payload.path : undefined);
		case "host.createDirectory": {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const name = requiredString(payload.name, "name");
			if (name === "." || name === ".." || /[\\/]/.test(name)) throw new Error("name must be a single path segment");
			return { path: await shellFsHandlers.makeDirectory(name, absolutePath(payload.path, "path")) };
		}
		case "host.openPath": {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			await shellFsHandlers.openPath(requiredString(payload.path, "path"), homedir());
			return { opened: true };
		}
		case "typert.catalog": {
			await agentHost.waitUntilReady();
			await agentHost.ensureTypertReady();
			const typert = agentHost.getContext()?.get("typert") as Parameters<typeof describeTypertCatalog>[0] | undefined;
			if (!typert?.listPackages || !typert.list || !typert.toJSONSchema) {
				throw Object.assign(new Error("Typert catalog is unavailable"), { code: "service-unavailable" });
			}
			return describeTypertCatalog(typert);
		}
		case "plugin.snapshot":
			return agentHost.pluginSnapshot();
		case "deepseek-cordis.snapshot":
			await agentHost.waitUntilReady();
			return agentHost.deepSeekCordisSnapshot();
		case "deepseek-pi.describe":
			return agentHost.deepSeekPiBridgeDescription();
		case "deepseek-cordis.invoke":
			return agentHost.invokeDeepSeekCordis({
				service: requiredString(payload.service, "service"),
				method: requiredString(payload.method, "method"),
				...(payload.args === undefined ? {} : { args: payload.args as readonly unknown[] | Record<string, unknown> }),
				...(payload.parameters === undefined ? {} : { parameters: payload.parameters as string[] }),
			});
		case "session.list":
			return { items: await agentHost.listSessions(typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : agentHost.getCwd()) };
		case "session.search": {
			const limit = typeof payload.limit === "number" ? Math.max(1, Math.min(payload.limit, 200)) : 50;
			const items = await resources.searchSessions(requiredString(payload.query, "query"), typeof payload.cwd === "string" ? payload.cwd : undefined, limit + 1);
			return { items: items.slice(0, limit), hasMore: items.length > limit };
		}
		case "session.fork": {
			const sessionId = requiredString(payload.sessionId, "sessionId");
			const sessionIdResult = await resources.forkSession(sessionId, typeof payload.cwd === "string" ? payload.cwd : undefined, typeof payload.atSeq === "number" ? payload.atSeq : undefined);
			return { sessionId: sessionIdResult };
		}
		case "session.rename": {
			const sessionId = requiredString(payload.sessionId, "sessionId");
			const title = requiredString(payload.title, "title");
			const cwd = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : agentHost.getCwd();
			await agentHost.renameSession(sessionId, title, cwd);
			return { title };
		}
		case "session.create":
			return agentHost.newSession(
				typeof payload.workspaceId === "string"
					? ((await agentHost.listWorkspaces() as any[]).find((workspace: any) => workspace?.workspaceId === payload.workspaceId)?.path ?? agentHost.getCwd())
					: typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : agentHost.getCwd(),
				typeof payload.modelId === "string" && payload.modelId.trim() ? payload.modelId : undefined,
			);
		case "subagent.list": {
			const parentSessionId = requiredString(payload.parentSessionId, "parentSessionId");
			return { entries: await agentHost.listSubagentChildren(parentSessionId), parentAvailable: agentHost.getSession()?.sessionId === parentSessionId };
		}
		case "subagent.history": {
			const parentSessionId = requiredString(payload.parentSessionId, "parentSessionId");
			const childSessionId = requiredString(payload.childSessionId, "childSessionId");
			const mode = enumValue(payload.mode, "mode", ["one-shot", "continuable"] as const);
			const beforeSeq = typeof payload.beforeSeq === "number" ? payload.beforeSeq : undefined;
			const maxMessages = typeof payload.maxMessages === "number" ? payload.maxMessages : undefined;
			const result = await agentHost.subagentHistory(parentSessionId, childSessionId, mode, beforeSeq, maxMessages);
			return { events: result.entries, hasMore: result.hasMore };
		}
		case "subagent.prompt": {
			const parentSessionId = requiredString(payload.parentSessionId, "parentSessionId");
			const childSessionId = requiredString(payload.childSessionId, "childSessionId");
			const content = normalizePromptContent(payload.content);
			return agentHost.promptSubagent(parentSessionId, childSessionId, content);
		}
		case "subagent.interrupt": {
			const parentSessionId = requiredString(payload.parentSessionId, "parentSessionId");
			const childSessionId = requiredString(payload.childSessionId, "childSessionId");
			return agentHost.interruptSubagent(parentSessionId, childSessionId);
		}
		case "agent.event-log": {
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			const sinceSequence = payload.sinceSequence === undefined ? undefined : optionalFiniteInteger(payload.sinceSequence, "sinceSequence", 0, 0, Number.MAX_SAFE_INTEGER);
			const limit = payload.limit === undefined ? 2000 : optionalFiniteInteger(payload.limit, "limit", 2000, 1, 2000);
			return agentHost.pluginEvents({
				...(sessionId === undefined ? {} : { sessionId }),
				...(sinceSequence === undefined ? {} : { sinceSequence }),
				limit,
			});
		}
		case "agent.extensions-reload":
			return agentHost.reloadPiExtensions();
		case "pi.extensions.reload":
			return { extensions: await agentHost.reloadPiExtensions() };
		case "session.history": {
			const sessionId = requiredString(payload.sessionId, "sessionId");
			const beforeSeq = typeof payload.beforeSeq === "number" ? payload.beforeSeq : undefined;
			const maxMessages = typeof payload.maxMessages === "number" ? payload.maxMessages : undefined;
			const projections = async () => beforeSeq === undefined ? { projections: await agentHost.sessionProjectionBaseline(sessionId) } : {};
			const query = agentHost.getContext()?.get("sessionQuery") as { listEvents?: (id: string) => Promise<unknown[]> } | undefined;
			if (query?.listEvents) {
				const page = paginateHistory(await query.listEvents(sessionId) as Array<Record<string, unknown>>, beforeSeq, maxMessages);
				return { ...page, ...(await projections()) };
			}
			const eventLog = agentHost.getContext()?.get("eventLog") as { list?: (query?: unknown) => unknown[] } | undefined;
			const page = paginateHistory((eventLog?.list?.({ sessionId }) ?? []) as Array<Record<string, unknown>>, beforeSeq, maxMessages);
			return { ...page, ...(await projections()) };
		}
		case "session.attachment":
			return (() => {
				const sessionId = requiredString(payload.sessionId, "sessionId");
				const attachmentId = requiredString(payload.attachmentId, "attachmentId");
				return agentHost.readSessionAttachment(sessionId, attachmentId).then(({ attachment, data }) => ({ attachment, data: Buffer.from(data).toString("base64") }));
			})();
		case "session.updateQueue": {
			const action = recordValue(payload.action, "action");
			const kind = enumValue(action.kind, "action.kind", ["edit", "remove", "steer"] as const);
			const normalized = kind === "remove" || kind === "steer"
				? { kind }
				: { kind, content: normalizePromptContent(action.content) };
			return agentHost.updateSessionQueue(requiredString(payload.sessionId, "sessionId"), requiredString(payload.itemId, "itemId"), normalized);
		}
		case "session.surface": {
			const service = agentHost.getContext()?.get("sessionQuery") as { readSurface?: (id: string) => Promise<unknown> } | undefined;
			if (!service?.readSurface) throw Object.assign(new Error("session surface is unavailable"), { code: "service-unavailable" });
			return service.readSurface(requiredString(payload.sessionId, "sessionId"));
		}
		case "session.traceEvent": {
			const service = agentHost.getContext()?.get("sessionQuery") as { traceEvent?: (request: { sessionId: string; seq: number }) => Promise<unknown> } | undefined;
			if (!service?.traceEvent) throw Object.assign(new Error("session event trace is unavailable"), { code: "service-unavailable" });
			const seq = payload.seq;
			if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) throw new Error("seq must be a non-negative integer");
			return service.traceEvent({ sessionId: requiredString(payload.sessionId, "sessionId"), seq });
		}
		case "session.readEvent": {
			const service = agentHost.getContext()?.get("sessionQuery") as { readEvent?: (request: { sessionId: string; seq: number; before?: number; after?: number }) => Promise<unknown> } | undefined;
			if (!service?.readEvent) throw Object.assign(new Error("session event read is unavailable"), { code: "service-unavailable" });
			const seq = payload.seq;
			if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) throw new Error("seq must be a non-negative integer");
			const before = payload.before;
			const after = payload.after;
			return service.readEvent({ sessionId: requiredString(payload.sessionId, "sessionId"), seq, before: typeof before === "number" ? before : undefined, after: typeof after === "number" ? after : undefined });
		}
		case "session.prompt": {
			const sessionId = requiredString(payload.sessionId, "sessionId");
			if (agentHost.getSession()?.sessionId !== sessionId) throw Object.assign(new Error(`session not found: ${sessionId}`), { code: "session-not-found" });
			const piSession = agentHost.getContext()?.get("piSession") as { promptContent: (parts: readonly unknown[], mode?: "queue" | "steer") => Promise<{ itemId?: string }> } | undefined;
			if (!piSession?.promptContent) throw Object.assign(new Error("Pi session prompt is unavailable"), { code: "service-unavailable" });
			const content = Array.isArray(payload.content)
				? payload.content as Array<{ type: "text" | "image"; text?: string; mediaType?: string; data?: string; name?: string }>
				: [{ type: "text" as const, text: requiredString(payload.text, "text") }];
			const result = await piSession.promptContent(content.map((part) => part.type === "text"
				? { type: "text", text: requiredString(part.text, "content.text") }
				: { type: "image", mediaType: requiredString(part.mediaType, "content.mediaType"), data: requiredString(part.data, "content.data"), ...(part.name === undefined ? {} : { name: requiredString(part.name, "content.name") }) }), payload.mode === "steer" ? "steer" : "queue");
			return { accepted: true, ...(result ?? {}) };
		}
		case "session.cancel": {
			const sessionId = requiredString(payload.sessionId, "sessionId");
			if (agentHost.getSession()?.sessionId !== sessionId) throw Object.assign(new Error(`session not found: ${sessionId}`), { code: "session-not-found" });
			await agentHost.abort();
			return { accepted: true };
		}
		case "session.selectModel": {
			const sessionId = requiredString(payload.sessionId, "sessionId");
			if (agentHost.getSession()?.sessionId !== sessionId) throw Object.assign(new Error(`session not found: ${sessionId}`), { code: "session-not-found" });
			await agentHost.setModel(requiredString(payload.modelId, "modelId"));
			return { accepted: true };
		}
		case "llm.providers": {
			const catalog = await agentHost.providerCatalog();
			return { providers: catalog.providers };
		}
		case "llm.models": {
			const catalog = await agentHost.providerCatalog();
			return { groups: catalog.providers.map((provider: { id: string; label?: string }) => ({ provider: provider.id, name: provider.label ?? provider.id, models: catalog.models.filter((model: { providerId: string }) => model.providerId === provider.id) })), failures: [] };
		}
		case "capability.providers": {
			const action = enumValue(payload.action, "action", ["catalog", "save-provider", "save-model", "delete-provider", "delete-model"] as const);
			if (action === "catalog") return agentHost.providerCatalog();
			if (action === "save-provider") {
				const provider = recordValue(payload.provider, "provider");
				await agentHost.saveProvider({
					...provider,
					id: providerId(provider.id),
					providerKind: requiredString(provider.providerKind, "providerKind"),
					...(provider.label === undefined ? {} : { label: requiredString(provider.label, "label") }),
					...(provider.apiKey === undefined ? {} : { apiKey: requiredString(provider.apiKey, "apiKey") }),
					...(provider.baseUrl === undefined ? {} : { baseUrl: httpUrl(provider.baseUrl, "baseUrl") }),
					...(provider.apiBackend === undefined ? {} : { apiBackend: enumValue(provider.apiBackend, "apiBackend", ["messages", "responses", "chat_completions"] as const) }),
					...(provider.authScheme === undefined ? {} : { authScheme: enumValue(provider.authScheme, "authScheme", ["bearer", "x_api_key"] as const) }),
				});
				return agentHost.providerCatalog();
			}
			if (action === "save-model") {
				const model = recordValue(payload.model, "model");
				await agentHost.saveModel({
					...model,
					providerId: providerId(model.providerId),
					modelId: modelId(model.modelId),
					...(model.name === undefined ? {} : { name: requiredString(model.name, "name") }),
				});
				return agentHost.providerCatalog();
			}
			if (action === "delete-provider") {
				await agentHost.deleteProvider(providerId(payload.id));
				return agentHost.providerCatalog();
			}
			await agentHost.deleteModel(providerId(payload.providerId), modelId(payload.modelId));
			return agentHost.providerCatalog();
		}
		case "capability.skills": {
			const action = enumValue(payload.action, "action", ["list", "toggle", "add", "remove"] as const);
			if (action === "list") return agentHost.listSkills(typeof payload.cwd === "string" ? payload.cwd : agentHost.getCwd());
			if (action === "toggle") return resources.toggleSkill(requiredString(payload.name, "name"), requiredBoolean(payload.enabled, "enabled"));
			if (action === "add") {
				await assertPolicySkillUploadAllowed();
				return resources.addSkill(requiredString(payload.path, "path"), typeof payload.cwd === "string" ? absolutePath(payload.cwd, "cwd") : agentHost.getCwd());
			}
			return resources.removeSkill(requiredString(payload.path, "path"), typeof payload.cwd === "string" ? absolutePath(payload.cwd, "cwd") : agentHost.getCwd());
		}
		case "capability.mcp": {
			const action = enumValue(payload.action, "action", ["list", "status", "upsert", "toggle", "delete", "config-read"] as const);
			if (action === "list") return resources.mcpList(agentHost.getCwd());
			if (action === "status") return agentHost.mcpStatus();
			if (action === "config-read") return resources.mcpConfigRead(agentHost.getCwd());
			const name = requiredString(payload.name ?? recordValue(payload.server, "server").name, "name");
			if (action === "upsert") {
				const server = recordValue(payload.server, "server");
				await resources.mcpUpsert(name, server, agentHost.getCwd());
			} else if (action === "toggle") {
				await resources.mcpToggle(name, requiredBoolean(payload.enabled, "enabled"), agentHost.getCwd());
			} else {
				await resources.mcpDelete(name, agentHost.getCwd());
			}
			await agentHost.reloadMcp();
			return resources.mcpList(agentHost.getCwd());
		}
		// Stage G-1c: openbuddy-automation removed; automation is owned
		// by pi-background-tasks + pi-goal (passthrough). The legacy
		// `capability.automation.*` IPC handler is gone; renderer
		// reaches the pi-native tool surface.
		case "capability.plugins": {
			const action = enumValue(payload.action, "action", ["list", "inventory", "readiness", "reload", "set-enabled"] as const);
			if (action === "list") return agentHost.listPlugins();
			if (action === "inventory") return agentHost.pluginInventory();
			if (action === "readiness") return agentHost.pluginReadiness();
			const id = requiredString(payload.id, "id");
			if (action === "reload") return agentHost.reloadPlugin(id);
			return agentHost.setPluginEnabled(id, requiredBoolean(payload.enabled, "enabled"));
		}
		case "capability.teams": {
			const action = enumValue(payload.action, "action", ["create", "status", "delete"] as const);
			const { teamToolsHandlers } = await import("@openbuddy/team-team");
			if (action === "create") return teamToolsHandlers.create(requiredString(payload.goal, "goal"), payload.size === undefined ? "small" : enumValue(payload.size, "size", ["small", "medium", "large"] as const));
			const id = requiredString(payload.id, "id");
			return action === "status" ? teamToolsHandlers.status(id) : teamToolsHandlers.delete(id);
		}
		case "capability.snapshot": {
			const sessionId = payload.sessionId === undefined ? agentHost.getSession()?.sessionId : requiredString(payload.sessionId, "sessionId");
			const context = agentHost.getContext();
			const permission = (await import("@openbuddy/auth-permission")).permissionHandlers;
			const [catalog, rules, mode, plugins, pluginInventory, resources, mcp, commands] = await Promise.all([
				agentHost.providerCatalog(),
				permission.readRules(),
				permission.readMode(),
				agentHost.listPlugins(),
				agentHost.pluginInventory(),
				agentHost.resourceInventory(),
				Promise.resolve(agentHost.mcpStatus()),
				Promise.resolve(agentHost.listCommands()),
			]);
			const readiness = agentHost.pluginReadiness();
			return {
				runtime: "pi",
				providerIds: catalog.providers.map((provider: { id: string }) => provider.id),
				modelIds: catalog.models.map((model: { providerId: string; modelId: string }) => `${model.providerId}/${model.modelId}`),
				permission: { mode, ruleCount: rules.length },
				plan: null,
				planOwner: "pi-plan-mode",
				tasks: { sessionId, source: "pi-native", note: "todo list is owned by pi's @juicesharp/rpiv-todo when installed; otherwise the bundled pi todo tool." },
				mcp: mcp.map((entry: { serverName: string; status: string; toolCount: number }) => ({ serverName: entry.serverName, status: entry.status, toolCount: entry.toolCount })),
				plugins: plugins.map((entry: { id?: string; enabled?: boolean; status?: string }) => ({ id: entry.id, enabled: entry.enabled, status: entry.status })),
				resources: { extensions: (pluginInventory as any)?.piExtensions?.length, skills: resources.skills?.length ?? 0, prompts: resources.prompts?.length ?? 0, themes: resources.themes?.length ?? 0, diagnostics: resources.diagnostics?.length ?? 0 },
				commands: Array.isArray(commands) ? commands.length : 0,
				contextReady: Boolean(context),
				pluginReadiness: readiness,
			};
		}
		case "capability.email": {
			const harness = source === "harness";
			const requireHarnessConfirmation = (confirmed: boolean | undefined, operation: string) => {
				if (harness && confirmed !== true) throw Object.assign(new Error(`${operation}必须经过确认`), { code: "confirmation_required" });
			};
			const action = enumValue(payload.action, "action", ["provider-diagnostics", "accounts", "rules", "save-rule", "delete-rule", "run-rule", "run-scheduled-rules", "sync", "sync-states", "triage", "prepare-processing-plan", "confirm-processing-plan", "execute-processing-plan", "cancel-processing-plan", "processing-plans", "threads", "threads-page", "reply-zero", "action-center-query", "contact-projection", "ack-inbox", "digest", "thread", "drafts", "scheduled-sends", "pending-sends", "prepare-schedule-send", "schedule-send", "cancel-scheduled-send", "cancel-pending-send", "labels", "workspace-tags", "update-workspace-tags", "update", "unsubscribe", "sender-policy", "share-thread", "create-reminder", "move-to-project", "attachments", "attachment-download", "create-draft", "prepare-send", "queue-send", "send-draft", "audit", "analyses", "save-analysis", "review-analysis", "link-analysis", "create-reminders-from-analysis", "registry-list", "registry-readiness", "registry-set-enabled", "registry-reauthorize", "registry-register", "registry-remove", "registry-diagnostics"] as const);
			const { emailHandlers } = await import("@openbuddy/capability-email");
			if (action === "provider-diagnostics") return emailHandlers.providerDiagnostics();
			if (action === "accounts") return emailHandlers.accounts();
			if (action === "rules") return emailHandlers.rules();
			if (action === "delete-rule") return emailHandlers.deleteRule(requiredString(payload.ruleId, "ruleId"));
				if (action === "run-rule") return emailHandlers.runRule(requiredString(payload.ruleId, "ruleId"));
				if (action === "run-scheduled-rules") return emailHandlers.runScheduledRules();
			if (action === "save-rule") {
				const name = requiredString(payload.name, "name");
				if (!Array.isArray(payload.actions) || payload.actions.length === 0 || payload.actions.length > 5) throw new Error("actions must contain 1 to 5 items");
				return emailHandlers.saveRule({ id: payload.ruleId === undefined ? undefined : requiredString(payload.ruleId, "ruleId"), name, enabled: payload.enabled === undefined ? true : requiredBoolean(payload.enabled, "enabled"), condition: payload.condition as never, actions: payload.actions as never, schedule: payload.schedule === null ? null : payload.schedule as never });
			}
			if (action === "sync") return emailHandlers.sync({ accountId: requiredString(payload.accountId, "accountId"), ...(payload.cursor === undefined ? {} : { cursor: requiredString(payload.cursor, "cursor") }), ...(payload.limit === undefined ? {} : { limit: optionalFiniteInteger(payload.limit, "limit", 100, 1, 500) }), ...(payload.full === undefined ? {} : { full: requiredBoolean(payload.full, "full") }) });
			if (action === "sync-states") return emailHandlers.syncStates(payload.accountId === undefined ? undefined : requiredString(payload.accountId, "accountId"));
			if (action === "triage") return emailHandlers.triage(emailSearchPayload(payload) as never);
			if (action === "action-center-query") return emailHandlers.actionCenterQuery(payload as never);
			if (action === "contact-projection") return emailHandlers.projectContacts(payload as never);
			if (action === "prepare-processing-plan") return emailHandlers.prepareProcessingPlan(payload as never);
			if (action === "confirm-processing-plan") return emailHandlers.confirmProcessingPlan(requiredString(payload.planId, "planId"), harness);
				if (action === "execute-processing-plan") { if (harness && payload.confirmationToken === undefined) requireHarnessConfirmation(undefined, "邮件处理计划"); return emailHandlers.executeProcessingPlan(requiredString(payload.planId, "planId"), requiredString(payload.confirmationToken, "confirmationToken")); }
				if (action === "cancel-processing-plan") return emailHandlers.cancelProcessingPlan(requiredString(payload.planId, "planId"));
			if (action === "processing-plans") return emailHandlers.processingPlans();
			if (action === "threads") return emailHandlers.threads(emailSearchPayload(payload) as never);
			if (action === "threads-page") return emailHandlers.threadsPage(emailSearchPayload(payload) as never);
			if (action === "reply-zero") return emailHandlers.replyZero(emailSearchPayload(payload) as never);
			if (action === "ack-inbox") return emailHandlers.acknowledgeInbox(requiredString(payload.accountId, "accountId"), requiredString(payload.threadId, "threadId"), payload.messageDate === undefined ? undefined : requiredString(payload.messageDate, "messageDate"));
			if (action === "digest") return emailHandlers.digest(emailSearchPayload(payload) as never);
			if (action === "thread") return emailHandlers.thread(requiredString(payload.accountId, "accountId"), requiredString(payload.threadId, "threadId"));
			if (action === "drafts") return emailHandlers.drafts(payload.accountId === undefined ? undefined : requiredString(payload.accountId, "accountId"));
			if (action === "scheduled-sends") return emailHandlers.scheduledSends();
			if (action === "pending-sends") return emailHandlers.pendingSends();
			if (action === "prepare-schedule-send") return emailHandlers.prepareScheduleSend(requiredString(payload.draftId, "draftId"), requiredString(payload.scheduledAt, "scheduledAt"), harness);
			if (action === "schedule-send") { if (harness && payload.confirmationToken === undefined) requireHarnessConfirmation(undefined, "计划发送"); return emailHandlers.scheduleSend(requiredString(payload.draftId, "draftId"), requiredString(payload.scheduledAt, "scheduledAt"), payload.confirmationToken === undefined ? undefined : requiredString(payload.confirmationToken, "confirmationToken")); }
			if (action === "cancel-scheduled-send") return emailHandlers.cancelScheduledSend(requiredString(payload.scheduleId, "scheduleId"));
			if (action === "cancel-pending-send") return emailHandlers.cancelPendingSend(requiredString(payload.pendingId, "pendingId"));
			if (action === "labels") return emailHandlers.labels(requiredString(payload.accountId, "accountId"));
			if (action === "workspace-tags") return emailHandlers.workspaceTags();
			if (action === "update-workspace-tags") return emailHandlers.updateWorkspaceTags(emailTagMutationPayload(payload) as never);
			if (action === "update") { const input = emailMutationPayload(payload); const confirmed = input.confirmed === undefined ? undefined : requiredBoolean(input.confirmed, "confirmed"); const destructive = input.kind === "trash" || input.kind === "spam"; if (destructive) requireHarnessConfirmation(confirmed, "邮件操作"); return emailHandlers.update(input as never, harness && destructive && confirmed === true); }
			if (action === "unsubscribe") { const confirmed = payload.confirmed === undefined ? undefined : requiredBoolean(payload.confirmed, "confirmed"); requireHarnessConfirmation(confirmed, "退订邮件列表"); return emailHandlers.unsubscribe({ accountId: requiredString(payload.accountId, "accountId"), messageId: requiredString(payload.messageId, "messageId"), ...(payload.threadId === undefined ? {} : { threadId: requiredString(payload.threadId, "threadId") }), ...(confirmed === undefined ? {} : { confirmed }) }, harness && confirmed === true); }
			if (action === "sender-policy") { const confirmed = payload.confirmed === undefined ? undefined : requiredBoolean(payload.confirmed, "confirmed"); const destructive = payload.policy === "block"; if (destructive) requireHarnessConfirmation(confirmed, "发件人策略"); return emailHandlers.setSenderPolicy({ senderEmail: requiredString(payload.senderEmail, "senderEmail"), policy: enumValue(payload.policy, "policy", ["signal", "noise", "block"] as const), ...(payload.accountId === undefined ? {} : { accountId: requiredString(payload.accountId, "accountId") }), ...(payload.threadId === undefined ? {} : { threadId: requiredString(payload.threadId, "threadId") }), ...(confirmed === undefined ? {} : { confirmed }) } as never, harness && destructive && confirmed === true); }
			if (action === "share-thread") return emailHandlers.shareThread({ accountId: requiredString(payload.accountId, "accountId"), threadId: requiredString(payload.threadId, "threadId"), channelId: requiredString(payload.channelId, "channelId"), ...(payload.message === undefined ? {} : { message: stringValue(payload.message, "message") }) });
			if (action === "create-reminder") return emailHandlers.createReminder({ accountId: requiredString(payload.accountId, "accountId"), threadId: requiredString(payload.threadId, "threadId"), description: requiredString(payload.description, "description"), remindAt: requiredString(payload.remindAt, "remindAt") });
			if (action === "move-to-project") return emailHandlers.moveToProject({ accountId: requiredString(payload.accountId, "accountId"), threadId: requiredString(payload.threadId, "threadId"), ...(payload.projectId === undefined ? {} : { projectId: requiredString(payload.projectId, "projectId") }) });
			if (action === "attachments") return emailHandlers.listAttachments(requiredString(payload.accountId, "accountId"), requiredString(payload.messageId, "messageId"));
			if (action === "attachment-download") return emailHandlers.downloadAttachment(requiredString(payload.accountId, "accountId"), requiredString(payload.attachmentId, "attachmentId"), requiredString(payload.messageId, "messageId"), absolutePath(payload.destinationDir, "destinationDir"));
			if (action === "create-draft") return emailHandlers.createDraft(emailComposePayload(payload) as never);
			if (action === "prepare-send") return emailHandlers.prepareSend(requiredString(payload.draftId, "draftId"), harness);
			if (action === "queue-send") return emailHandlers.queueSend(requiredString(payload.draftId, "draftId"), requiredString(payload.confirmationToken, "confirmationToken"), payload.undoWindowMs === undefined ? undefined : optionalFiniteInteger(payload.undoWindowMs, "undoWindowMs", 5000, 1000, 30000));
			if (action === "send-draft") return emailHandlers.sendDraft(requiredString(payload.draftId, "draftId"), payload.confirmationToken === undefined ? undefined : requiredString(payload.confirmationToken, "confirmationToken"));
			if (action === "analyses") return emailHandlers.listAnalyses({ ...(payload.accountId === undefined ? {} : { accountId: requiredString(payload.accountId, "accountId") }), ...(payload.threadId === undefined ? {} : { threadId: requiredString(payload.threadId, "threadId") }) });
			if (action === "save-analysis") return emailHandlers.saveAnalysis({ accountId: requiredString(payload.accountId, "accountId"), threadId: requiredString(payload.threadId, "threadId"), kind: enumValue(payload.kind, "kind", ["summary", "actions", "risk", "reply", "meeting"] as const), confidence: optionalFiniteNumber(payload.confidence, "confidence", 0, 0, 1), ...(payload.summary === undefined ? {} : { summary: requiredString(payload.summary, "summary") }), ...(payload.facts === undefined ? {} : { facts: payload.facts as never }), ...(payload.actions === undefined ? {} : { actions: payload.actions as never }), ...(payload.risks === undefined ? {} : { risks: payload.risks as never }), ...(payload.replyDraft === undefined ? {} : { replyDraft: payload.replyDraft as never }), ...(payload.meetingProposal === undefined ? {} : { meetingProposal: payload.meetingProposal as never }), ...(payload.linkedTaskIds === undefined ? {} : { linkedTaskIds: optionalStringArray(payload.linkedTaskIds, "linkedTaskIds") }), ...(payload.linkedProjectTaskIds === undefined ? {} : { linkedProjectTaskIds: optionalStringArray(payload.linkedProjectTaskIds, "linkedProjectTaskIds") }), ...(payload.linkedCalendarTaskId === undefined ? {} : { linkedCalendarTaskId: requiredString(payload.linkedCalendarTaskId, "linkedCalendarTaskId") }), ...(payload.linkedCalendarEventId === undefined ? {} : { linkedCalendarEventId: requiredString(payload.linkedCalendarEventId, "linkedCalendarEventId") }) } as never);
			if (action === "review-analysis") return emailHandlers.reviewAnalysis({ id: requiredString(payload.id, "id"), review: enumValue(payload.review, "review", ["accepted", "dismissed", "pending"] as const), ...(payload.reviewNote === undefined ? {} : { reviewNote: stringValue(payload.reviewNote, "reviewNote") }) });
			if (action === "link-analysis") return emailHandlers.linkAnalysis({ id: requiredString(payload.id, "id"), ...(payload.linkedDraftId === undefined ? {} : { linkedDraftId: requiredString(payload.linkedDraftId, "linkedDraftId") }), ...(payload.linkedReminderId === undefined ? {} : { linkedReminderId: requiredString(payload.linkedReminderId, "linkedReminderId") }), ...(payload.linkedTaskControlId === undefined ? {} : { linkedTaskControlId: requiredString(payload.linkedTaskControlId, "linkedTaskControlId") }), ...(payload.linkedTaskIds === undefined ? {} : { linkedTaskIds: optionalStringArray(payload.linkedTaskIds, "linkedTaskIds") }), ...(payload.linkedProjectTaskIds === undefined ? {} : { linkedProjectTaskIds: optionalStringArray(payload.linkedProjectTaskIds, "linkedProjectTaskIds") }), ...(payload.linkedCalendarTaskId === undefined ? {} : { linkedCalendarTaskId: requiredString(payload.linkedCalendarTaskId, "linkedCalendarTaskId") }), ...(payload.linkedCalendarEventId === undefined ? {} : { linkedCalendarEventId: requiredString(payload.linkedCalendarEventId, "linkedCalendarEventId") }) });
			if (action === "create-reminders-from-analysis") { requireHarnessConfirmation(payload.confirmed === undefined ? undefined : requiredBoolean(payload.confirmed, "confirmed"), "创建跟进提醒"); const actionIndexes = optionalNonNegativeIntegerArray(payload.actionIndexes, "actionIndexes"); return emailHandlers.createRemindersFromAnalysis({ analysisId: requiredString(payload.analysisId, "analysisId"), ...(actionIndexes === undefined ? {} : { actionIndexes }), confirmed: payload.confirmed === true }); }
			if (action === "registry-list") return emailHandlers.registryList();
			if (action === "registry-readiness") return emailHandlers.registryReadiness();
			if (action === "registry-set-enabled") return emailHandlers.registrySetEnabled(requiredString(payload.id, "id"), requiredBoolean(payload.enabled, "enabled"));
			if (action === "registry-reauthorize") return emailHandlers.registryReauthorize(requiredString(payload.id, "id"));
			if (action === "registry-register") return emailHandlers.registryRegister({ ...(payload.id === undefined ? {} : { id: requiredString(payload.id, "id") }), providerType: enumValue(payload.providerType, "providerType", ["mcp", "gmail-api", "graph-api", "jmap-api"] as const), displayName: requiredString(payload.displayName, "displayName"), ...(payload.credentialRef === undefined ? {} : { credentialRef: requiredString(payload.credentialRef, "credentialRef") }), ...(payload.mcpServerName === undefined ? {} : { mcpServerName: requiredString(payload.mcpServerName, "mcpServerName") }), ...(payload.scopes === undefined ? {} : { scopes: optionalStringArray(payload.scopes, "scopes") }), ...(payload.enabledCapabilities === undefined ? {} : { enabledCapabilities: optionalStringArray(payload.enabledCapabilities, "enabledCapabilities") }), ...(payload.enabled === undefined ? {} : { enabled: requiredBoolean(payload.enabled, "enabled") }) });
			if (action === "registry-remove") return emailHandlers.registryRemove(requiredString(payload.id, "id"));
			if (action === "registry-diagnostics") return emailHandlers.registryDiagnostics();
			return emailHandlers.audit();
		}
		case "capability.collaboration": {
			const action = enumValue(payload.action, "action", ["snapshot", "propose-task", "ack-inbox"] as const);
			const { collaborationRuntime } = await import("../collaboration/collaboration-runtime");
			if (action === "snapshot") return collaborationRuntime.snapshot();
			if (action === "propose-task") return collaborationRuntime.proposeTask({
				title: requiredString(payload.title, "title"),
				objective: requiredString(payload.objective, "objective"),
				...(payload.capability === undefined ? {} : { capability: requiredString(payload.capability, "capability") }),
				...(payload.roomId === undefined ? {} : { roomId: requiredString(payload.roomId, "roomId") }),
				...(payload.agentRef === undefined ? {} : { agentRef: (() => { const agentRef = recordValue(payload.agentRef, "agentRef"); return { type: enumValue(agentRef.type, "agentRef.type", ["expert", "personal-buddy", "organization-buddy", "external-buddy"] as const), id: requiredString(agentRef.id, "agentRef.id") }; })() }),
			});
			return collaborationRuntime.ackInbox(requiredString(payload.eventId, "eventId"));
		}
		case "capability.collaboration-admin": {
			const action = enumValue(payload.action, "action", [
				"snapshot", "propose", "org-member", "org-member-remove", "room-add", "room-remove", "delegation-grant", "delegation-revoke",
				"approval-request", "approval-decide", "task-control", "workflow-propose", "workflow-status", "workflow-execute", "workflow-control",
				"network-peer", "network-trust", "network-trust-root-add", "network-trust-root-revoke", "network-offer", "network-proposal", "network-negotiate", "network-agreement-revoke", "network-bid", "network-award",
				"a2a-card", "a2a-submit", "a2a-get",
				"federated-grants", "federated-grant-issue", "federated-grant-revoke",
			] as const);
			const { collaborationRuntime } = await import("../collaboration/collaboration-runtime");
			if (action === "snapshot") return collaborationRuntime.snapshot();
			if (action === "propose") return collaborationRuntime.proposeCollaboration({ mode: enumValue(payload.mode, "mode", ["personal", "organization", "network"] as const), title: requiredString(payload.title, "title"), objective: requiredString(payload.objective, "objective"), capability: payload.capability === undefined ? undefined : requiredString(payload.capability, "capability"), projectId: payload.projectId === undefined ? undefined : requiredString(payload.projectId, "projectId") });
			if (action === "org-member") return collaborationRuntime.addOrganizationMember({ id: requiredString(payload.id, "id"), handle: requiredString(payload.handle, "handle"), displayName: requiredString(payload.displayName, "displayName"), ownerUserId: requiredString(payload.ownerUserId, "ownerUserId"), role: payload.role === undefined ? undefined : enumValue(payload.role, "role", ["owner", "admin", "member", "auditor"] as const) });
			if (action === "org-member-remove") return collaborationRuntime.removeOrganizationMember({ memberId: requiredString(payload.memberId, "memberId") });
			if (action === "room-add") return collaborationRuntime.addOrganizationRoomMember({ roomId: requiredString(payload.roomId, "roomId"), principalId: requiredString(payload.principalId, "principalId"), role: payload.role === undefined ? undefined : enumValue(payload.role, "role", ["member", "observer", "agent"] as const) });
			if (action === "room-remove") return collaborationRuntime.removeOrganizationRoomMember({ roomId: requiredString(payload.roomId, "roomId"), principalId: requiredString(payload.principalId, "principalId") });
			if (action === "delegation-grant") return collaborationRuntime.grantOrganizationDelegation({ granteeId: requiredString(payload.granteeId, "granteeId"), taskId: payload.taskId === undefined ? undefined : requiredString(payload.taskId, "taskId"), roomId: payload.roomId === undefined ? undefined : requiredString(payload.roomId, "roomId"), allowedCapabilities: requiredStringArray(payload.allowedCapabilities, "allowedCapabilities"), allowedDataScopes: requiredStringArray(payload.allowedDataScopes, "allowedDataScopes"), expiresAt: requiredString(payload.expiresAt, "expiresAt") });
			if (action === "delegation-revoke") return collaborationRuntime.revokeOrganizationDelegation(requiredString(payload.delegationId, "delegationId"));
			if (action === "approval-request") return collaborationRuntime.requestApproval({ taskId: requiredString(payload.taskId, "taskId"), actions: requiredStringArray(payload.actions, "actions"), reason: requiredString(payload.reason, "reason") });
			if (action === "approval-decide") return collaborationRuntime.decideApproval({ approvalId: requiredString(payload.approvalId, "approvalId"), approved: requiredBoolean(payload.approved, "approved"), reason: payload.reason === undefined ? undefined : requiredString(payload.reason, "reason") });
			if (action === "task-control") return collaborationRuntime.controlTask({ taskId: requiredString(payload.taskId, "taskId"), action: enumValue(payload.control, "control", ["pause", "resume", "revoke", "takeover", "revision"] as const), reason: payload.reason === undefined ? undefined : requiredString(payload.reason, "reason") });
			if (action === "workflow-propose") return collaborationRuntime.proposeWorkflow({ title: requiredString(payload.title, "title"), mode: enumValue(payload.mode, "mode", ["personal", "organization"] as const), nodes: Array.isArray(payload.nodes) ? payload.nodes as never : (() => { throw new Error("nodes must be an array"); })() });
			if (action === "workflow-status") return collaborationRuntime.workflowStatus(requiredString(payload.workflowId, "workflowId"));
			if (action === "workflow-execute") return collaborationRuntime.executeWorkflow(requiredString(payload.workflowId, "workflowId"));
			if (action === "workflow-control") return collaborationRuntime.controlWorkflow({ workflowId: requiredString(payload.workflowId, "workflowId"), action: enumValue(payload.control, "control", ["pause", "resume", "cancel", "takeover", "revision"] as const), reason: payload.reason === undefined ? undefined : requiredString(payload.reason, "reason") });
			if (action === "network-peer") return collaborationRuntime.registerNetworkPeer({ identity: recordValue(payload.identity, "identity") as never, capabilities: Array.isArray(payload.capabilities) ? payload.capabilities as never : [], agentCard: payload.agentCard as never });
			if (action === "network-trust") return collaborationRuntime.setNetworkPeerTrust(requiredString(payload.peerId, "peerId"), enumValue(payload.trust, "trust", ["pending", "known", "trusted", "blocked", "revoked"] as const));
			if (action === "network-trust-root-add") return collaborationRuntime.addAgentCardTrustRoot(requiredString(payload.publicKeyPem, "publicKeyPem"));
			if (action === "network-trust-root-revoke") return collaborationRuntime.revokeAgentCardTrustRoot(requiredString(payload.keyRef, "keyRef"));
			if (action === "network-offer") return collaborationRuntime.networkPublishOffer(payload as never);
			if (action === "network-proposal") return collaborationRuntime.networkProposeService({ capabilityId: requiredString(payload.capabilityId, "capabilityId"), objective: requiredString(payload.objective, "objective"), dataScopes: requiredStringArray(payload.dataScopes, "dataScopes"), ...(payload.allowedActions === undefined ? {} : { allowedActions: requiredStringArray(payload.allowedActions, "allowedActions") }), artifactTypes: requiredStringArray(payload.artifactTypes, "artifactTypes"), expiresAt: requiredString(payload.expiresAt, "expiresAt") });
			if (action === "network-negotiate") return collaborationRuntime.networkNegotiateCapability({ offerId: requiredString(payload.offerId, "offerId"), proposalId: requiredString(payload.proposalId, "proposalId"), providerId: requiredString(payload.providerId, "providerId") });
			if (action === "network-agreement-revoke") return collaborationRuntime.networkRevokeCapabilityAgreement(requiredString(payload.agreementId, "agreementId"), requiredString(payload.reason, "reason"));
			if (action === "network-bid") return collaborationRuntime.networkSubmitBid(payload as never);
				if (action === "network-award") return collaborationRuntime.networkAwardBid(requiredString(payload.bidId, "bidId"));
				if (action === "federated-grants") return collaborationRuntime.federatedRoomGrantSnapshot();
				if (action === "federated-grant-issue") return collaborationRuntime.issueFederatedRoomGrant({
					projectId: requiredString(payload.projectId, "projectId"),
					roomId: requiredString(payload.roomId, "roomId"),
					principalId: requiredString(payload.principalId, "principalId"),
					providerOrganizationId: payload.providerOrganizationId === undefined ? undefined : requiredString(payload.providerOrganizationId, "providerOrganizationId"),
					taskId: payload.taskId === undefined ? undefined : requiredString(payload.taskId, "taskId"),
					allowedCapabilities: requiredStringArray(payload.allowedCapabilities, "allowedCapabilities"),
					allowedDataScopes: requiredStringArray(payload.allowedDataScopes, "allowedDataScopes"),
					allowedActions: requiredStringArray(payload.allowedActions, "allowedActions"),
					allowedOperations: requiredStringArray(payload.allowedOperations, "allowedOperations").map((operation) => enumValue(operation, "allowedOperations", ["endpoint.register", "task.send", "events.query"] as const)),
					expiresAt: requiredString(payload.expiresAt, "expiresAt"),
				});
				if (action === "federated-grant-revoke") return collaborationRuntime.revokeFederatedRoomGrant(requiredString(payload.grantId, "grantId"));
			if (action === "a2a-card") { const { createA2ARuntimeFacade } = await import("../collaboration/a2a-runtime-adapter"); return createA2ARuntimeFacade(collaborationRuntime).getAgentCard(); }
			if (action === "a2a-get") { const { createA2ARuntimeFacade } = await import("../collaboration/a2a-runtime-adapter"); return createA2ARuntimeFacade(collaborationRuntime).getTask(requiredString(payload.taskId, "taskId")); }
			const { createA2ARuntimeFacade } = await import("../collaboration/a2a-runtime-adapter");
			return createA2ARuntimeFacade(collaborationRuntime).submitTask(payload as never);
		}
		case "capability.clipboard": {
			const action = enumValue(payload.action, "action", ["read", "write"] as const);
			if (action === "read") return clipboard.readText();
			clipboard.writeText(stringValue(payload.text, "text"));
			return { written: true as const };
		}
		case "capability.permission": {
			const { permissionHandlers } = await import("@openbuddy/auth-permission");
			const action = enumValue(payload.action, "action", ["mode", "rules"] as const);
			if (action === "mode") return permissionHandlers.readMode();
			return permissionHandlers.readRules();
		}
		case "workspace.list":
			return { items: await agentHost.listWorkspaces() };
		case "workspace.create":
			return agentHost.createWorkspace(absolutePath(payload.path, "path"), payload.title === undefined ? undefined : requiredString(payload.title, "title"));
		case "workspace.rename":
			return { workspace: await agentHost.renameWorkspace(requiredString(payload.workspaceId, "workspaceId"), requiredString(payload.title, "title")) };
		case "workspace.delete":
			return { deleted: await agentHost.deleteWorkspace(requiredString(payload.workspaceId, "workspaceId")) };
		case "workspace.insertBefore":
			return { workspaceIds: await agentHost.insertWorkspaceBefore(requiredString(payload.workspaceId, "workspaceId"), payload.beforeWorkspaceId === undefined ? undefined : requiredString(payload.beforeWorkspaceId, "beforeWorkspaceId")) };
		case "workspace.insertSessionBefore":
			return { workspace: await agentHost.insertWorkspaceSessionBefore(requiredString(payload.workspaceId, "workspaceId"), requiredString(payload.sessionId, "sessionId"), payload.beforeSessionId === undefined ? undefined : requiredString(payload.beforeSessionId, "beforeSessionId")) };
		case "workspace.archiveSession":
			return { archivedSessionIds: await agentHost.archiveWorkspaceSession(requiredString(payload.sessionId, "sessionId"), payload.archived === undefined ? true : Boolean(payload.archived)) };
		case "remote.invoke":
			return agentHost.invokeRemote(payload);
		default:
			throw Object.assign(new Error(`RPC method is unavailable: ${request.method}`), { code: "method-unavailable" });
	}
}

export async function dispatchHarnessRpc(request: ClientRequest, context: DeepSeekConnectionDispatchContext = { authority: "loopback" }): Promise<unknown> {
	try {
		return await dispatchTypedRpc(request, "harness");
	} catch (error) {
		if (!(error instanceof Error) || !/RPC method is unavailable/.test(error.message)) throw error;
		const connection = await agentHost.invokeConnection(request.method, request.payload, context);
		if (connection.handled) return connection.value;
		return agentHost.invokeRemote(remoteRequestFromHarnessRequest(request));
	}
}


/**
 * Register all IPC handlers. Async because P1-04 makes the agentHost module
 * lazy — we await its load before any handler tries to touch it (the
 * streaming event subscription in particular). After this resolves, the
 * module is fully bound and sync access is O(1).
 */
export async function registerIpc(getWindow: () => BrowserWindow | null): Promise<void> {
  // P1-04: block until agent-host module is loaded so the Proxy access below
  // resolves to a real binding instead of throwing "load in flight".
  await ensureAgentHostLoaded();
	const pendingServerRequests = new Map<string, { method: string; timer: ReturnType<typeof setTimeout> }>();
	void import("../collaboration/collaboration-runtime").then(({ collaborationRuntime }) => {
		collaborationRuntime.onUpdate((update) => {
			const win = getWindow();
			if (!win || win.isDestroyed()) return;
			sendSafe(win, "openbuddy://collaboration-update", update);
		});
	});
	const emitServerRequest = (method: string, payload: unknown, prefix: string, requestedRpcId?: string): void => {
		const win = getWindow();
		if (!win || win.isDestroyed()) return;
		const rpcId = requestedRpcId ? RpcId(requestedRpcId) : createRpcId(prefix);
		const timer = setTimeout(() => {
			const pending = pendingServerRequests.get(rpcId);
			if (!pending) return;
			pendingServerRequests.delete(rpcId);
			if (pending.method === "session.permission" || pending.method === "session.question") {
				agentHost.resolveUiRequest(rpcId, undefined);
			}
		}, 30_000);
		timer.unref?.();
		pendingServerRequests.set(rpcId, { method, timer });
		sendSafe(win, "dsh://rpc", { type: "server-request", rpcId, method, payload });
	};
	for (const channel of [
		"agent:new-session", "agent:prompt", "agent:steer", "agent:follow-up", "agent:abort", "agent:set-model", "agent:current-model",
		"agent:plugin-list", "agent:plugin-inventory", "agent:plugin-snapshot", "agent:plugin-readiness", "agent:tools-list", "agent:deepseek-cordis-snapshot", "agent:deepseek-pi-describe", "agent:deepseek-cordis-invoke", "agent:plugin-events", "agent:event-log",
		"agent:plugin-enable", "agent:plugin-reload", "agent:extensions-reload", "agent:plugin-config", "agent:presets-list", "agent:preset-current", "agent:preset-default-save", "agent:preset-select",
		"agent:profile-packages", "agent:profile-install", "agent:profile-install-default-pi", "agent:profile-remove",
		"agent:renderer-plugin-entries",
		"agent:renderer-plugin-boot",
		"agent:renderer-plugin-module",
		"agent:remote-contributions",
	"agent:auth-status", "agent:providers-list",
	"harness:address",
	"harness:session-cursors", "harness:session-cursors-set", "harness:resume-token", "harness:resume-token-set",
		"dsh:remote", "dsh:rpc", "dsh:remote-register", "dsh:remote-unregister",
		"agents_list", "agents_get", "agents_save", "agents_delete", "agents_template", "agents_defaults_get", "agents_defaults_save", "tasks_list", "task_kill",
		"agent:load-session", "agent:session-info", "agent:session-usage", "agent:session-metadata-clear",
		"agent:commands-list", "agent:resolve-permission", "agent:resolve-question", "prompt_history", "session_search", "session_fork", "rewind_points", "rewind_execute",
		"agent:resource-inventory",
		"collaboration:snapshot", "collaboration:a2a-agent-card", "collaboration:a2a-task-submit", "collaboration:a2a-task-get", "collaboration:propose-task", "collaboration:propose", "collaboration:execute", "collaboration:ack-inbox",
		"collaboration:workflow-propose", "collaboration:workflow-execute", "collaboration:workflow-status", "collaboration:workflow-control",
		"collaboration:federated-grants", "collaboration:federated-grant-issue", "collaboration:federated-grant-revoke",
			"collaboration:network-retry",
		"agent:providers-save-provider", "agent:providers-save-model", "agent:providers-delete-provider", "agent:providers-delete-model", "agent:providers-fetch-models",
		"internal_reload",
		"email:create-reminders-from-analysis",
		"email:provider-diagnostics", "email:accounts", "email:rules", "email:save-rule", "email:delete-rule", "email:run-rule", "email:threads", "email:threads-page", "email:reply-zero", "email:ack-inbox", "email:digest", "email:thread", "email:action-center-query", "email:contact-projection", "email:action-center-create-reminders", "email:project-threads", "email:drafts", "email:scheduled-sends", "email:pending-sends", "email:prepare-schedule-send", "email:schedule-send", "email:cancel-scheduled-send", "email:cancel-pending-send", "email:labels", "email:update", "email:sender-policy", "email:attachments", "email:attachment-download", "email:create-draft", "email:prepare-send", "email:queue-send", "email:send-draft", "email:audit", "email:analyses", "email:save-analysis", "email:review-analysis", "email:link-analysis",
		"sessions:rename", "sessions:delete",
		"skills:list", "skills:add", "skills:remove", "skills:toggle", "mcp:list", "mcp:status", "mcp:upsert", "mcp:delete", "mcp:toggle", "mcp:config-path", "mcp:config-read", "mcp:config-save", "mcp_auth_trigger", "mcp_auth_cancel", "mcp_auth_status",
	"connectors_default_root", "connectors_list_roots", "connectors_load", "connectors_icon", "connectors_read_mcp_config", "connectors_cli_status", "connectors_cli_auth", "connectors_cli_auth_cancel", "connectors_cli_unauth", "connectors_cli_skills_dir", "skills_catalog_default_root", "skills_catalog_list_roots", "skills_catalog_load", "skills_catalog_read_skill",
		"experts_default_root", "experts_list_roots", "experts_load", "experts_thumbnail", "experts_image_bytes", "experts_read_agent_prompt", "experts_link_agents", "pi_set_session_expert", "pi_clear_session_expert", "workbuddy_import_preview", "workbuddy_import_confirm", "workbuddy_import_status", "workbuddy_import_rollback",
		"permission_list", "permission_save",
		"policy:get", "policy:save", "notify-channels:list", "notify-channels:save", "notify:dispatch", "knowledge-sources:list", "knowledge-sources:save", "storage-sources:list", "storage-sources:save",
		// Stage G-1c: openbuddy-automation removed; automation is owned by
		// pi-background-tasks + pi-goal (passthrough). Legacy
		// automations:* / automation_records_* channels no longer exist;
		// only plugin / marketplace channels remain to be removed here.
		"plugins_list", "plugins_action", "marketplace_list", "marketplace_action",
	]) ipcMain.removeHandler(channel);
	for (const channel of [
		"dialog:open", "dialog:save", "dialog:ask", "dialog:confirm", "dialog:message",
		"clipboard:read-text", "clipboard:write-text",
		"window:minimize", "window:toggle-maximize", "window:close", "window:is-maximized",
		"debug:toggle-devtools", "debug:reload", "debug:force-reload", "debug:info",
		"shellfs:read-file-base64",
	]) ipcMain.removeHandler(channel);
	ipcMain.handle("dsh:remote-register", async (_e, args: unknown) => {
		await agentHost.waitUntilReady();
		return agentHost.registerRemote(args);
	});
	ipcMain.handle("dsh:remote-unregister", async (_e, args: unknown) => {
		const input = recordValue(args, "DeepSeek remote unregister payload");
		return agentHost.unregisterRemote(input.package);
	});
	ipcMain.handle("dsh:remote", async (_e, args: unknown) => {
		try {
			return rpcValue(await agentHost.invokeRemote(args));
		} catch (error) {
			return rpcError(error);
		}
	});
	ipcMain.handle("dsh:rpc", async (_e, args: unknown) => {
		let message: ReturnType<typeof parseRpcMessage>;
		try {
			message = parseRpcMessage(args);
		} catch (error) {
			const rpcId = args && typeof args === "object" && typeof (args as { rpcId?: unknown }).rpcId === "string"
				? (args as { rpcId: string }).rpcId : createRpcId("invalid");
			return serverResponse(rpcId, rpcError(error, "bad-request"));
		}
		if (message.type === "client-response") {
			const pending = pendingServerRequests.get(message.rpcId);
			if (!pending) return { accepted: false, reason: "not-pending", rpcId: message.rpcId };
			if ((pending.method === "session.permission" || pending.method === "session.question")
				&& message.result.ok && !isInteractionResponse(message.result.value, pending.method)) {
				return { accepted: false, reason: "bad-response", rpcId: message.rpcId };
			}
			clearTimeout(pending.timer);
			pendingServerRequests.delete(message.rpcId);
			if (pending.method === "session.permission" || pending.method === "session.question") {
				const value = message.result.ok ? message.result.value : undefined;
				const uiValue = uiInteractionValue(value, pending.method);
				if (!agentHost.resolveUiRequest(message.rpcId, uiValue)) return { accepted: false, reason: "bad-response", rpcId: message.rpcId };
			}
			return { accepted: true, rpcId: message.rpcId };
		}
		if (message.type !== "client-request") {
			return serverResponse(message.rpcId, rpcError(new Error("dsh:rpc accepts client-request messages only"), "bad-request"));
		}
		try {
			return serverResponse(message.rpcId, rpcValue(await dispatchTypedRpc(message)));
		} catch (error) {
			return serverResponse(message.rpcId, rpcError(error));
		}
	});
	// Streaming text/thinking deltas are NOT emitted here.
	//
	// This block used to hold a 16ms `textDeltaCoalescer` (P0-03) that
	// accumulated `text_delta` payloads and emitted them as
	// `{ type: "agent_message_chunk", content: [{ type: "text", ... }] }`.
	// It was removed because Phase R3.0 made it a duplicate emitter with
	// three concrete defects:
	//
	//  1. **Double-append.** `handle-session-event.ts:302` (wired live at
	//     `agent-host.ts:2263`) already emits every delta as
	//     `{ type: "text_delta" }`. The coalescer emitted the same content a
	//     second time as `{ type: "text" }`, so the renderer received each
	//     delta twice in two shapes and rendered "DIDIAG-OKAG-OK".
	//     `acceptTextShape()` in `useAgentSession.ts` currently masks this by
	//     locking onto whichever shape arrives first — a downstream guard for
	//     a defect that belongs here, at the source.
	//
	//  2. **Reasoning leaked into the answer.** The coalescer enqueued
	//     `thinking_delta` into the *same* buffer and emitted it on
	//     `agent_message_chunk`, i.e. reasoning tokens were published as
	//     visible assistant text. `handle-session-event.ts:322` routes them
	//     correctly to `agent_thought_chunk`. For a reasoning model the
	//     thinking block precedes any text, so the shape-lock in (1) could
	//     latch onto `text` from a *thought* and then discard the real answer
	//     deltas for the rest of the turn.
	//
	//  3. **The perf win it was added for no longer existed.** P0-03 reduced
	//     ~50-150 IPC/s to ~60 IPC/s back when it was the only emitter. Once
	//     R3.0 added per-delta emission in the other bridge, the coalescer only
	//     ADDED a second IPC per delta. Deleting it halves live-stream IPC
	//     traffic rather than regressing it.
	//
	// The `tool_execution_*` flush() calls are gone with it: they existed to
	// force buffered text out before tool output so ordering stayed correct.
	// The remaining bridge emits deltas synchronously, so ordering is now
	// guaranteed by construction with nothing to flush.
	agentHost.onEvent((event: any) => {
		const win = getWindow();
		if (!win || win.isDestroyed()) return;
		const contents = win.webContents;
		const sessionId = (event as { sessionId?: string }).sessionId ?? agentHost.getSession()?.sessionId ?? "";
		emitServerRequest("session.event", event, "event");
		// Broadcast the agent event on the canonical channel. The previous
		// implementation also sent the same payload on `pi://event`, but a
		// repo-wide scan found zero renderer consumers of that alias and the
		// `openbuddy://plugin-event` channel already carries the same plugin
		// surface, so the duplicate broadcast only added a second structured
		// clone per event. The `pi://event` channel name remains in the preload
		// allowlist for backward compatibility.
		win.webContents.send("openbuddy://agent-event", event);
		const payload = event as unknown as Record<string, any>;
		// `message_update` is deliberately not handled here — see the comment
		// above `agentHost.onEvent`. `handle-session-event.ts` owns the whole
		// AssistantMessageEvent surface (text, thinking, tool-call deltas).
		if (payload.type === "tool_execution_start") {
			sendSafe(win, "pi://update", { sessionId, type: "tool_call", toolCallId: payload.toolCallId, title: payload.toolName, kind: payload.toolName, status: "in_progress", rawInput: payload.args, content: [] });
		}
		// R-ToolStream-1 — forward incremental tool output (bash logs, build
		// progress, etc.) to the renderer so ToolCallCard.StreamingToolOutput
		// can render live progress. Pi SDK emits ToolExecutionUpdateEvent
		// { toolCallId, partialResult } on every extension runner tick
		// (node_modules/@earendil-works/pi-coding-agent/.../types.d.ts:599-606).
		// The renderer side handler at useAgentSession.ts:523-555 already reads
		// `update.partial / update.partialResult`, so this is the missing wire.
		if (payload.type === "tool_execution_update") {
			sendSafe(win, "pi://update", { sessionId, type: "tool_call_update", toolCallId: payload.toolCallId, update: { partial: true, partialResult: payload.partialResult } });
		}
		if (payload.type === "tool_execution_end") {
			// F3 perf: result stays as a structured-clone-able object instead of
			// being JSON.stringified on the hot path. The renderer can lazily
			// stringify if it needs to display it.
			sendSafe(win, "pi://update", { sessionId, type: "tool_call_update", toolCallId: payload.toolCallId, status: payload.isError ? "failed" : "completed", content: payload.result !== undefined ? [{ type: "text", text: typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result) }] : [] });
		}
		// `agent_end` no longer emits `pi://complete` here. It was one of four
		// completes the renderer received per prompt: `handle-session-event.ts`
		// emits on `turn_end`, `agent_end` AND `agent_settled`, and this line
		// added a second `agent_end` one. Completion is owned by that bridge.
	});
	agentHost.onPluginEvent((event: any) => {
		const win = getWindow();
		if (!win || win.isDestroyed()) return;
		const payload = event.payload;
		const requestId = payload && typeof payload === "object" && typeof (payload as { requestId?: unknown }).requestId === "string"
			? (payload as { requestId: string }).requestId : undefined;
		if (event.type === "session/permission") emitServerRequest("session.permission", payload, "permission", requestId);
		else if (event.type === "session/question") emitServerRequest("session.question", payload, "question", requestId);
		emitServerRequest("plugin.event", event, "plugin-event");
		sendSafe(win, "openbuddy://plugin-event", event);
	});

	const currentWindow = () => getWindow();
	const winForNativeEvents = currentWindow();
	const onWindowResize = () => {
		const win = currentWindow();
		if (win) sendSafe(win, "openbuddy://window-resized", { maximized: win.isMaximized() });
	};
	const onWindowClosed = () => {
		winForNativeEvents?.removeListener("resize", onWindowResize);
		winForNativeEvents?.removeListener("closed", onWindowClosed);
	};
	winForNativeEvents?.on("resize", onWindowResize);
	winForNativeEvents?.once("closed", onWindowClosed);
	const unbindRendererEmitter = bindRendererEventEmitter((channel, payload) => {
		const win = currentWindow();
		if (win) sendSafe(win, channel, payload);
	});
	void unbindRendererEmitter;

	// === Session lifecycle (Pi SDK) ===
	// Compatibility bridge for legacy renderer refresh calls. Pi provider/model
	// writes already rebuild the runtime in agent-host; this handler keeps the
	// remaining renderer refresh path deterministic without a second backend.
	ipcMain.handle("collaboration:snapshot", async () => {
		const { collaborationRuntime } = await import("../collaboration/collaboration-runtime");
		const resources = await agentHost.resourceInventory();
		collaborationRuntime.setCapabilityCards([
			...resources.skills.map((entry: any) => ({
				id: `pi-skill:${entry.name}`,
				name: entry.name,
				source: "pi-skill" as const,
				visibility: "local" as const,
				status: "available" as const,
				contract: { input: "context-refs" as const, output: "artifact-or-message" as const, approval: "before-external-commit" as const },
			})),
			...resources.extensions.map((entry: any) => ({
				id: `pi-extension:${entry.id}`,
				name: entry.name,
				source: "pi-extension" as const,
				visibility: entry.sourceScope === "project" ? "organization" as const : "local" as const,
				status: entry.health === "failed" ? "degraded" as const : "available" as const,
				contract: { input: "context-refs" as const, output: "artifact-or-message" as const, approval: "before-external-commit" as const },
			})),
			...resources.prompts.map((entry: any) => ({
				id: `prompt:${entry.name}`,
				name: entry.name,
				source: "prompt" as const,
				visibility: "local" as const,
				status: "available" as const,
				contract: { input: "context-refs" as const, output: "artifact-or-message" as const, approval: "before-external-commit" as const },
			})),
		]);
		const snapshot = collaborationRuntime.snapshot();
		const data = snapshot.data;
		let emailInboxItems: typeof data.inbox = [];
		try {
			const { emailHandlers } = await import("@openbuddy/capability-email");
			const replyZero = await emailHandlers.replyZero({ limit: 50 });
			const inboxReceipts = new Map((await emailHandlers.inboxReceipts()).map((receipt) => [`${receipt.accountId}:${receipt.threadId}`, receipt]));
			emailInboxItems = replyZero.needsReply.map((item) => ({
				id: `email-inbox:${item.accountId}:${item.threadId}`,
				kind: "message" as const,
				principalId: data.identity.id,
				communityId: "email",
				eventId: `email:${item.accountId}:${item.threadId}`,
				title: `待回复：${item.subject || "（无主题）"}`,
				summary: `${item.sender.address} · ${item.reason}`,
				createdAt: item.date,
				read: (() => { const receipt = inboxReceipts.get(`${item.accountId}:${item.threadId}`); return Boolean(receipt && (!receipt.messageDate || Date.parse(item.date) <= Date.parse(receipt.messageDate))); })(),
				source: "email" as const,
				emailAccountId: item.accountId,
				emailThreadId: item.threadId,
			}));
		} catch {
			// 邮箱未连接时不影响协作 Inbox；邮件面板仍显示连接/授权入口。
		}
		return {
			...snapshot,
			mcpCapabilities: agentHost.mcpCapabilityGovernance(),
			inbox: [...data.inbox, ...emailInboxItems].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
			capabilities: {
				local: resources.skills.length,
				room: 0,
				organization: resources.extensions.filter((entry: any) => entry.sourceScope === "project").length,
				directory: resources.prompts.length,
			},
		};
	});

	// === Pi resource adapters ===

	// === Lightweight local catalogs ===

	// === Teams ===

	// === Shell + filesystem ===

	// === Sessions ===

	// === Automations ===

	// === Notifications ===
	// === Email ===
	// Legacy renderer aliases retained during the Electron migration.

	// === Memory ===

	// === Tasks ===

	// === Calendar ===

	// === Plan mode ===

	// === Folder trust ===

	// === Inspiration ===

	// === Subagents ===

	// === Web search toggle ===

	// === Permission ===

	// === Casdoor enterprise identity ===

	// === Storage Renderer Bootstrap (SQLite-first; redacted DTOs) ===


	// Domain registrators — see ./casdoor.ts, ./storage.ts, ./email.ts, ./collaboration.ts, ./harness.ts, ./agent.ts, ./connectors.ts, ./misc.ts
	registerCasdoorIpc(getWindow);
	registerStorageIpc(getWindow);
	registerEmailIpc(getWindow);
	registerCollaborationIpc(getWindow);
	registerHarnessIpc(getWindow);
	registerAgentIpc(getWindow);
	registerConnectorsIpc(getWindow);
	registerMiscIpc(getWindow);
}
