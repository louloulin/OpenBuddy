/**
 * IPC surface — connectors domain.
 *
 * Split out of `./index.ts`.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { agentHost, bindRendererEventEmitter } from "./agent-host-proxy";
import * as connectors from "../connectors";
import * as resources from "../agent/pi-resources";
import * as workbuddyImport from "../workbuddy-import";

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

export function registerConnectorsIpc(getWindow: () => BrowserWindow | null): void {
	const currentWindow = () => getWindow();
	const emitConnectorEvent = (channel: string, payload: unknown) => {
		const win = currentWindow();
		if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
	};
		ipcMain.handle("skills:list", async (_e, args?: { cwd?: string | null }) => agentHost.listSkills(args?.cwd));
		ipcMain.handle("skills:add", async (_e, args: { path: string; cwd?: string | null }) => {
			const input = recordValue(args, "skill add payload");
			await assertPolicySkillUploadAllowed();
			return resources.addSkill(requiredString(input.path, "skill path"), input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("skills:remove", async (_e, args: { path: string; cwd?: string | null }) => {
			const input = recordValue(args, "skill remove payload");
			return resources.removeSkill(requiredString(input.path, "skill path"), input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("skills:toggle", async (_e, args: { name: string; enabled: boolean }) => {
			const input = recordValue(args, "skill toggle payload");
			return resources.toggleSkill(requiredString(input.name, "skill name"), requiredBoolean(input.enabled, "enabled"));
		});
		ipcMain.handle("mcp:list", async () => {
			const configured = await resources.mcpList(agentHost.getCwd());
			const live = new Map(agentHost.mcpStatus().map((entry) => [entry.serverName, entry]));
			return configured.map((entry) => {
				const current = live.get(String(entry.name));
				return current ? { ...entry, runtimeStatus: current.status, toolCount: current.toolCount, ...(current.emailProfile ? { emailProfile: current.emailProfile } : {}), ...(current.error ? { runtimeError: current.error } : {}) } : entry;
			});
		});
		ipcMain.handle("mcp:status", async () => agentHost.mcpStatus());
		ipcMain.handle("mcp:upsert", async (_e, args: { server: { name?: string; [key: string]: unknown } }) => {
			const input = recordValue(args, "MCP upsert payload");
			const server = recordValue(input.server, "MCP server");
			const name = typeof server.name === "string" && server.name.trim() ? server.name : "server";
			if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) throw new Error("MCP server name must be 1-64 chars of [a-zA-Z0-9._-]");
			await resources.mcpUpsert(name, server, agentHost.getCwd());
			await agentHost.reloadMcp();
		});
		ipcMain.handle("mcp:delete", async (_e, args: { name: string }) => {
			await resources.mcpDelete(requiredString(recordValue(args, "MCP delete payload").name, "MCP server name"), agentHost.getCwd());
			await agentHost.reloadMcp();
		});
		ipcMain.handle("mcp:toggle", async (_e, args: { name: string; enabled: boolean }) => {
			const input = recordValue(args, "MCP toggle payload");
			await resources.mcpToggle(requiredString(input.name, "MCP server name"), requiredBoolean(input.enabled, "enabled"), agentHost.getCwd());
			await agentHost.reloadMcp();
		});
		ipcMain.handle("mcp:config-path", async () => resources.mcpConfigPath());
		ipcMain.handle("mcp:config-read", async () => ({ filePath: await resources.mcpConfigPath(), content: JSON.stringify(await resources.mcpConfigRead(agentHost.getCwd()), null, 2) }));
		ipcMain.handle("mcp:config-save", async (_e, args: { content: string }) => {
			const input = recordValue(args, "MCP config-save payload");
			await resources.mcpConfigSave(requiredString(input.content, "content"), agentHost.getCwd());
			await agentHost.reloadMcp();
		});
		ipcMain.handle("mcp_auth_trigger", async (_e, args: unknown) => {
			const serverName = requiredString(recordValue(args, "MCP auth payload").serverName, "serverName");
			const result = await agentHost.authorizeMcp(serverName);
			return result.status === "authenticated" ? result : { ...result, status: result.status };
		});
		ipcMain.handle("mcp_auth_cancel", async (_e, args: unknown) => {
			return { cancelled: agentHost.cancelMcpAuthorization(requiredString(recordValue(args, "MCP auth cancel payload").serverName, "serverName")) };
		});
		ipcMain.handle("mcp_auth_status", async () => resources.mcpAuthStatus(agentHost.getCwd()));
		ipcMain.handle("skills_catalog_default_root", async () => join(agentHost.getCwd(), ".pi", "skills"));
		ipcMain.handle("skills_catalog_list_roots", async (_e, args: unknown) => {
			const input = recordValue(args, "skills catalog roots payload");
			return [absolutePath(input.root, "root")];
		});
		ipcMain.handle("skills_catalog_load", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "skills catalog load payload");
			const root = input.root === undefined || input.root === null ? join(agentHost.getCwd(), ".pi", "skills") : absolutePath(input.root, "root");
			const builtinRoot = input.builtinRoot === undefined || input.builtinRoot === null || input.builtinRoot === "" ? "" : absolutePath(input.builtinRoot, "builtinRoot");
			return resources.listSkillCatalog(root, builtinRoot);
		});
		ipcMain.handle("skills_catalog_read_skill", async (_e, args: unknown) => {
			const input = recordValue(args, "skills catalog read payload");
			const dir = absolutePath(input.dir, "dir");
			const root = input.root === undefined || input.root === null ? join(agentHost.getCwd(), ".pi", "skills") : absolutePath(input.root, "root");
			const builtinRoot = input.builtinRoot === undefined || input.builtinRoot === null || input.builtinRoot === "" ? "" : absolutePath(input.builtinRoot, "builtinRoot");
			const roots = [root, builtinRoot, join(agentHost.getCwd(), ".pi", "skills")].filter(Boolean);
			return resources.readSkillCatalogSkill(dir, [...new Set(roots)]);
		});
		ipcMain.handle("connectors_default_root", async () => connectors.defaultRoot(agentHost.getCwd()));
		ipcMain.handle("connectors_list_roots", async (_e, args: unknown) => connectors.listRoots(absolutePath(recordValue(args, "connector roots payload").root, "root")));
		ipcMain.handle("connectors_load", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "connector load payload");
			return connectors.loadCatalog(agentHost.getCwd(), input.root === undefined || input.root === null ? undefined : absolutePath(input.root, "root"));
		});
		ipcMain.handle("connectors_icon", async (_e, args: unknown) => {
			const input = recordValue(args, "connector icon payload");
			const root = input.root === undefined || input.root === null ? await connectors.defaultRoot(agentHost.getCwd()) : absolutePath(input.root, "root");
			if (!root) throw new Error("connector asset root is unavailable");
			return connectors.readImageData(absolutePath(input.path, "path"), root);
		});
		ipcMain.handle("connectors_read_mcp_config", async (_e, args: unknown) => { const input = recordValue(args, "connector mcp payload"); return connectors.readMcpConfig(absolutePath(input.root, "root"), requiredString(input.source, "source")); });
		ipcMain.handle("connectors_cli_status", async (_e, args: unknown) => { const input = recordValue(args, "connector status payload"); return connectors.cliStatus(absolutePath(input.root, "root"), requiredString(input.source, "source")); });
		ipcMain.handle("connectors_cli_auth", async (_e, args: unknown) => { const input = recordValue(args, "connector auth payload"); return connectors.cliAuth(absolutePath(input.root, "root"), requiredString(input.source, "source"), emitConnectorEvent); });
		ipcMain.handle("connectors_cli_auth_cancel", async (_e, args: unknown) => connectors.cliCancel(requiredString(recordValue(args, "connector auth cancel payload").source, "source")));
		ipcMain.handle("connectors_cli_unauth", async (_e, args: unknown) => { const input = recordValue(args, "connector unauth payload"); return connectors.cliUnauth(absolutePath(input.root, "root"), requiredString(input.source, "source")); });
		ipcMain.handle("connectors_cli_skills_dir", async (_e, args: unknown) => { const input = recordValue(args, "connector skills payload"); return connectors.cliSkillsDir(absolutePath(input.root, "root"), requiredString(input.source, "source")); });
		ipcMain.handle("experts_default_root", async () => resources.expertDefaultRoot(agentHost.getCwd()));
		ipcMain.handle("experts_list_roots", async (_e, args: unknown) => resources.expertListRoots(absolutePath(recordValue(args, "expert roots payload").root, "root")));
		ipcMain.handle("experts_load", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "expert load payload");
			const root = input.root === undefined || input.root === null || input.root === "" ? await resources.expertDefaultRoot(agentHost.getCwd()) : absolutePath(input.root, "root");
			return resources.listExpertCatalog(root);
		});
		ipcMain.handle("experts_thumbnail", async (_e, args: unknown) => {
			const input = recordValue(args, "expert thumbnail payload");
			const root = input.root === undefined || input.root === null ? await resources.expertDefaultRoot(agentHost.getCwd()) : absolutePath(input.root, "root");
			if (!root) throw new Error("expert asset root is unavailable");
			return resources.readImageData(absolutePath(input.path, "path"), [root]);
		});
		ipcMain.handle("experts_image_bytes", async (_e, args: unknown) => {
			const input = recordValue(args, "expert image payload");
			const root = input.root === undefined || input.root === null ? await resources.expertDefaultRoot(agentHost.getCwd()) : absolutePath(input.root, "root");
			if (!root) throw new Error("expert asset root is unavailable");
			return resources.readImageData(absolutePath(input.path, "path"), [root]);
		});
		ipcMain.handle("experts_read_agent_prompt", async (_e, args: unknown) => {
			const input = recordValue(args, "expert prompt payload");
			return resources.readExpertAgent(absolutePath(input.root, "root"), requiredString(input.plugin, "plugin"), requiredString(input.agentName, "agentName"));
		});
		ipcMain.handle("experts_link_agents", async (_e, args: unknown) => {
			const input = recordValue(args, "expert link payload");
			return resources.linkExpertAgents(absolutePath(input.root, "root"), requiredString(input.plugin, "plugin"), optionalStringArray(input.agentNames, "agentNames"));
		});
		ipcMain.handle("workbuddy_import_preview", async (_e, args: unknown) => {
			const input = recordValue(args, "WorkBuddy import preview payload");
			return workbuddyImport.previewWorkBuddyImport(absolutePath(input.sourceRoot, "sourceRoot"), requiredString(input.pluginId, "pluginId"));
		});
		ipcMain.handle("workbuddy_import_confirm", async (_e, args: unknown) => {
			const input = recordValue(args, "WorkBuddy import confirm payload");
			return workbuddyImport.confirmWorkBuddyImport(requiredString(input.previewToken, "previewToken"));
		});
		ipcMain.handle("workbuddy_import_status", async (_e, args: unknown) => {
			const input = recordValue(args, "WorkBuddy import status payload");
			return workbuddyImport.getWorkBuddyImportStatus(requiredString(input.importId, "importId"));
		});
		ipcMain.handle("workbuddy_import_rollback", async (_e, args: unknown) => {
			const input = recordValue(args, "WorkBuddy import rollback payload");
			return workbuddyImport.rollbackWorkBuddyImport(requiredString(input.importId, "importId"));
		});
		ipcMain.handle("marketplace_list", async (_e, opts?: { force?: boolean; maxPages?: number }) => {
			// Defensive defaults: callers that omit `opts` get the cache-first
			// path, which serves the local sources plus any fresh
			// (TTL < 1h) remote cache entries without firing any HTTP
			// request. The IPC channel is therefore never blocked by a
			// full pi.dev paginated scan (5,573 packages / 112 pages,
			// worst-case ~22 minutes).
			const safeOpts = opts && typeof opts === "object" ? opts : {};
			const maxPages = safeOpts.maxPages;
			const force = safeOpts.force === true;
			// P2-13: marketplace module is heavy (~800 lines of HTML parser
			// + execFile tarball unpack). Lazy-load so cold-start doesn't
			// pay for it until a renderer hits a marketplace IPC.
			const { marketplaceScan } = await import("../agent/pi-resources/marketplace");
			return marketplaceScan({
				...(force ? { force: true } : {}),
				...(typeof maxPages === "number" && Number.isInteger(maxPages) && maxPages > 0
					? { maxPages }
					: {}),
			});
		});
		ipcMain.handle("marketplace_action", async (_e, args: unknown) => {
			const input = recordValue(args, "marketplace action payload");
			const action = recordValue(input.action, "action");
			const type = enumValue(action.type, "action.type", ["install", "update", "uninstall", "refresh", "add_source", "remove_source", "add-source", "remove-source"] as const);
			const normalizedType = type === "add-source" ? "add_source" : type === "remove-source" ? "remove_source" : type;
			const normalized: Record<string, unknown> = { ...action, type: normalizedType };
			if (action.path !== undefined) normalized.path = absolutePath(action.path, "action.path");
			if (action.sourcePath !== undefined) normalized.sourcePath = absolutePath(action.sourcePath, "sourcePath");
			if (action.sourceUrlOrPath !== undefined && action.sourceUrlOrPath !== null) normalized.sourceUrlOrPath = requiredString(action.sourceUrlOrPath, "sourceUrlOrPath");
			if (action.url !== undefined) normalized.url = requiredString(action.url, "url");
			if (action.pluginRelativePath !== undefined) normalized.pluginRelativePath = requiredString(action.pluginRelativePath, "pluginRelativePath");
			// P2-13: same lazy-load as marketplaceScan — both functions
			// live in the heavy marketplace module.
			const { marketplaceAction, marketplaceScan } = await import("../agent/pi-resources/marketplace");
			const result = await marketplaceAction(normalized);
			if (normalizedType === "install" || normalizedType === "update" || normalizedType === "uninstall") {
				await agentHost.reloadPiExtensions();
			} else if (normalizedType === "refresh") {
				// B17: pin the refresh branch to a 50-page cap so the IPC
				await marketplaceScan({ force: true, maxPages: 50 });
				await agentHost.reloadMcp();
			}
			return result;
		});
}
