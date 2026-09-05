/**
 * IPC surface — misc domain.
 *
 * Split out of `./index.ts`.
 */
import { clipboard, dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import * as fs from "node:fs/promises";
import { agentHost, bindRendererEventEmitter } from "./agent-host-proxy";
import * as resources from "../agent/pi-resources";
import { dispatchMainNotifications } from "../notifications";
import { casdoorAuth } from "../casdoor/casdoor-auth";
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
// dynamic: @openbuddy/auth-permission
// dynamic: @openbuddy/capability-automation
// dynamic: @openbuddy/capability-calendar
// dynamic: @openbuddy/fs-fs-local
// dynamic: @openbuddy/team-team

export function registerMiscIpc(getWindow: () => BrowserWindow | null): void {
	const ensureAgentHost = async () => {
		await agentHost.waitUntilReady();
	};
	const currentWindow = () => getWindow();

		ipcMain.handle("clipboard:read-text", () => clipboard.readText());
		ipcMain.handle("clipboard:write-text", (_event, text: unknown) => {
			clipboard.writeText(stringValue(text, "text"));
		});
		ipcMain.handle("dialog:open", async (_event, options?: Electron.OpenDialogOptions) => {
			const safeOptions = openDialogOptions(options);
			const win = currentWindow();
			const result = win
				? await dialog.showOpenDialog(win, safeOptions)
				: await dialog.showOpenDialog(safeOptions);
			return result.canceled ? null : result.filePaths;
		});
		ipcMain.handle("dialog:save", async (_event, options?: Electron.SaveDialogOptions) => {
			const safeOptions = saveDialogOptions(options);
			const win = currentWindow();
			const result = win
				? await dialog.showSaveDialog(win, safeOptions)
				: await dialog.showSaveDialog(safeOptions);
			return result.canceled ? null : result.filePath ?? null;
		});
		ipcMain.handle("dialog:ask", async (_event, args: unknown) => {
			const input = recordValue(args, "dialog ask payload");
			const options = { type: "question" as const, buttons: [optionalString(input.cancelLabel, "cancelLabel") ?? "取消", optionalString(input.okLabel, "okLabel") ?? "确定"], defaultId: 1, title: optionalString(input.title, "title"), message: requiredString(input.message, "message") };
			const win = currentWindow();
			const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
			return result.response === 1;
		});
		ipcMain.handle("dialog:confirm", async (_event, args: unknown) => {
			const options = { type: "question" as const, buttons: ["取消", "确定"], defaultId: 1, message: requiredString(recordValue(args, "dialog confirm payload").message, "message") };
			const win = currentWindow();
			const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
			return result.response === 1;
		});
		ipcMain.handle("dialog:message", async (_event, args: unknown) => {
			const options = { type: "info" as const, buttons: ["确定"], message: requiredString(recordValue(args, "dialog message payload").message, "message") };
			const win = currentWindow();
			await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
		});
		ipcMain.handle("window:minimize", () => currentWindow()?.minimize());
		ipcMain.handle("window:toggle-maximize", () => currentWindow()?.isMaximized() ? currentWindow()?.unmaximize() : currentWindow()?.maximize());
		ipcMain.handle("window:close", () => currentWindow()?.close());
		ipcMain.handle("window:is-maximized", () => currentWindow()?.isMaximized() ?? false);
		ipcMain.handle("debug:toggle-devtools", async () => {
			const contents = currentWindow()?.webContents;
			if (!contents) return false;
			if (contents.isDevToolsOpened()) {
				contents.closeDevTools();
				return false;
			}
			const opened = new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, 2_000);
				contents.once("devtools-opened", () => {
					clearTimeout(timer);
					resolve();
				});
			});
			contents.openDevTools({ mode: "detach", activate: true });
			await opened;
			return contents.isDevToolsOpened();
		});
		ipcMain.handle("debug:reload", () => {
			const win = currentWindow();
			if (!win || win.isDestroyed()) {
				console.warn("[openbuddy-pi] debug:reload ignored — no main window");
				return;
			}
			win.webContents.reload();
			return true;
		});
		ipcMain.handle("debug:force-reload", () => {
			const win = currentWindow();
			if (!win || win.isDestroyed()) {
				console.warn("[openbuddy-pi] debug:force-reload ignored — no main window");
				return;
			}
			win.webContents.reloadIgnoringCache();
			return true;
		});
		ipcMain.handle("debug:info", () => {
			const win = currentWindow();
			return {
				url: win?.webContents.getURL() ?? "",
				webContentsId: win?.webContents.id ?? 0,
				readyState: win?.webContents.isLoading() ? "loading" : "complete",
				userAgent: win?.webContents.getUserAgent() ?? "",
			};
		});
		// Stage C-1: openbuddy-folder-trust removed; folder trust is owned by the
		// system (no plugin). Handlers intentionally throw so callers see a clear
		// "removed" error rather than a silent no-op.
		ipcMain.handle("folder-trust:list", async () => {
			throw new Error("folder-trust:list is removed (Stage C-1); folder trust is owned by the system");
		});
		ipcMain.handle("folder-trust:is-trusted", async (_e, _cwd: unknown) => {
			throw new Error("folder-trust:is-trusted is removed (Stage C-1); folder trust is owned by the system");
		});
		ipcMain.handle("folder-trust:grant", async (_e, _cwd: unknown) => {
			throw new Error("folder-trust:grant is removed (Stage C-1); folder trust is owned by the system");
		});
		ipcMain.handle("folder-trust:revoke", async (_e, _cwd: unknown) => {
			throw new Error("folder-trust:revoke is removed (Stage C-1); folder trust is owned by the system");
		});
		ipcMain.handle("folder_trust_respond", async (_e, _args: unknown) => {
			throw new Error("folder_trust_respond is removed (Stage C-1); folder trust is owned by the system");
		});
		// Stage C-4: openbuddy-memory removed; memory is owned by pi-hermes-memory
		// (passthrough). Handlers intentionally throw so callers see a clear
		// "removed" error rather than a silent no-op.
		ipcMain.handle("memory:list", async () => {
			throw new Error("memory:list is removed (Stage C-4); memory is owned by pi-hermes-memory");
		});
		ipcMain.handle("memory:get", async (_e, _id: unknown) => {
			throw new Error("memory:get is removed (Stage C-4); memory is owned by pi-hermes-memory");
		});
		ipcMain.handle("memory:save", async (_e, _payload: unknown) => {
			throw new Error("memory:save is removed (Stage C-4); memory is owned by pi-hermes-memory");
		});
		ipcMain.handle("memory:delete", async (_e, _id: unknown) => {
			throw new Error("memory:delete is removed (Stage C-4); memory is owned by pi-hermes-memory");
		});
		ipcMain.handle("memory:rewrite", async (_e, _payload: unknown) => {
			throw new Error("memory:rewrite is removed (Stage C-4); memory is owned by pi-hermes-memory");
		});
		ipcMain.handle("memory_list", async () => {
			throw new Error("memory_list is removed (Stage C-4); memory is owned by pi-hermes-memory");
		});
		ipcMain.handle("memory_get", async (_e, _id: unknown) => {
			throw new Error("memory_get is removed (Stage C-4); memory is owned by pi-hermes-memory");
		});
		ipcMain.handle("memory_save", async (_e, _payload: unknown) => {
			throw new Error("memory_save is removed (Stage C-4); memory is owned by pi-hermes-memory");
		});
		ipcMain.handle("memory_delete", async (_e, _id: unknown) => {
			throw new Error("memory_delete is removed (Stage C-4); memory is owned by pi-hermes-memory");
		});
		ipcMain.handle("memory_rewrite", async (_e, _payload: unknown) => {
			throw new Error("memory_rewrite is removed (Stage C-4); memory is owned by pi-hermes-memory");
		});
		ipcMain.handle("memory_flush", async () => null);
		ipcMain.handle("subagents:get-config", async () => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			return resources.readSubagentsConfig();
		});
		// Stub channels for legacy / 3rd-party IPC keep preload allowlist in sync.
		// Stage G-1c: storage:automation-bootstrap removed; automation is owned by pi-background-tasks (passthrough).
		// The handler intentionally throws so callers see a clear "removed" error rather than a silent no-op.
		ipcMain.handle("storage:automation-bootstrap", async () => {
			throw new Error("storage:automation-bootstrap is removed (Stage G-1c); automation is owned by pi-background-tasks (passthrough)");
		});
		ipcMain.handle("toggle_plan_mode", async () => null);
		ipcMain.handle("web_search_config_get", async () => null);
		ipcMain.handle("web_search_config_save", async () => null);
		ipcMain.handle("websearch:fetch", async () => null);
		ipcMain.handle("websearch:get-config", async () => null);
		ipcMain.handle("websearch:search", async () => null);
		ipcMain.handle("websearch:set-config", async () => null);
		ipcMain.handle("websearch:set-enabled", async () => null);
		ipcMain.handle("plan-mode:approve", async () => null);
		ipcMain.handle("plan-mode:get", async () => null);
		ipcMain.handle("plan-mode:reject", async () => null);
		ipcMain.handle("plan-mode:set-enabled", async () => null);
		ipcMain.handle("plan-mode:set-plan", async () => null);
		ipcMain.handle("tasks:add", async (_e, args: unknown) => {
			const input = recordValue(args, "tasks:add payload");
			requiredString(input.sessionId, "sessionId");
			return null;
		});
		ipcMain.handle("tasks:clear-completed", async () => null);
		ipcMain.handle("tasks:delete", async (_e, args: unknown) => {
			const input = recordValue(args, "tasks:delete payload");
			requiredString(input.id, "id");
			return null;
		});
		ipcMain.handle("tasks:list", async () => null);
		ipcMain.handle("tasks:update", async (_e, args: unknown) => {
			const input = recordValue(args, "tasks:update payload");
			requiredString(input.id, "id");
			return null;
		});
		ipcMain.handle("automations:archive", async () => null);
		ipcMain.handle("automations:delete", async () => null);
		ipcMain.handle("automations:run", async () => null);
		ipcMain.handle("automations:save", async () => null);
		ipcMain.handle("automations:set-status", async () => null);
		ipcMain.handle("inspiration:list", async () => null);
		ipcMain.handle("inspiration:next", async () => null);
		ipcMain.handle("notification_append", async () => null);
		ipcMain.handle("notification_clear", async () => null);
		ipcMain.handle("notification_list", async () => null);
		ipcMain.handle("notification_mark_all_read", async () => null);
		ipcMain.handle("notification_mark_read", async () => null);
		ipcMain.handle("notifications:append", async () => null);
		ipcMain.handle("notifications:clear", async () => null);
		ipcMain.handle("notifications:list", async () => null);
		ipcMain.handle("notifications:mark-all-read", async () => null);
		ipcMain.handle("notifications:mark-read", async () => null);
		ipcMain.handle("subagents:set-config", async (_e, args: unknown) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			const input = recordValue(args, "subagents set-config payload");
			const patch: resources.OpenBuddySubagentsConfig = {};
			if (input.maxDepth !== undefined) patch.maxDepth = optionalFiniteInteger(input.maxDepth, "maxDepth", 1, 1, 8);
			return resources.writeSubagentsConfig(patch);
		});
		ipcMain.handle("policy:get", async () => resources.readPolicyConfig());
		ipcMain.handle("policy:save", async (_e, args: unknown) => {
			const input = recordValue(args, "policy save payload");
			const policy = recordValue(input.policy, "policy");
			if (!Array.isArray(policy.rules)) throw new Error("policy.rules must be an array");
			return resources.writePolicyConfig({ rules: policy.rules.map((rule, index) => {
				const item = recordValue(rule, `policy.rules[${index}]`);
				return {
					type: requiredString(item.type, `policy.rules[${index}].type`),
					value: item.value,
					...(item.priority === undefined ? {} : { priority: optionalFiniteInteger(item.priority, `policy.rules[${index}].priority`, 0, -100, 100) }),
					...(item.source === undefined ? {} : { source: stringValue(item.source, `policy.rules[${index}].source`) }),
				};
			}) });
		});
		ipcMain.handle("notify-channels:list", async () => resources.readNotifyChannels());
		ipcMain.handle("notify-channels:save", async (_e, args: unknown) => {
			const input = recordValue(args, "notify channels save payload");
			if (!Array.isArray(input.channels)) throw new Error("channels must be an array");
			const channels = input.channels.map((entry, index) => {
				const channel = recordValue(entry, `channels[${index}]`);
				const kind = enumValue(channel.kind, `channels[${index}].kind`, ["slack-webhook", "discord-webhook", "generic-webhook", "email", "desktop"] as const);
				return {
					id: requiredString(channel.id, `channels[${index}].id`),
					label: requiredString(channel.label, `channels[${index}].label`),
					kind,
					...(channel.endpoint === undefined ? {} : { endpoint: requiredString(channel.endpoint, `channels[${index}].endpoint`) }),
					enabled: requiredBoolean(channel.enabled, `channels[${index}].enabled`),
				};
			});
			return resources.writeNotifyChannels(channels);
		});
		ipcMain.handle("notify:dispatch", async (_e, args: unknown) => {
			const input = recordValue(args, "notification dispatch payload");
			const message = recordValue(input.message, "notification message");
			return dispatchMainNotifications(await resources.readNotifyChannels(), {
				title: requiredString(message.title, "message.title"),
				...(message.body === undefined ? {} : { body: stringValue(message.body, "message.body") }),
				...(message.level === undefined ? {} : { level: enumValue(message.level, "message.level", ["info", "warn", "error"] as const) }),
				...(message.sessionId === undefined ? {} : { sessionId: requiredString(message.sessionId, "message.sessionId") }),
			});
		});
		ipcMain.handle("knowledge-sources:list", async () => resources.readKnowledgeSources());
		ipcMain.handle("knowledge-sources:save", async (_e, args: unknown) => {
			const input = recordValue(args, "knowledge sources save payload");
			if (!Array.isArray(input.sources)) throw new Error("sources must be an array");
			const sources = input.sources.map((source, index) => {
				const value = requiredString(source, `sources[${index}]`);
				if (!isAbsolute(value)) throw new Error(`sources[${index}] must be absolute`);
				return value;
			});
			return resources.writeKnowledgeSources([...new Set(sources)]);
		});
		ipcMain.handle("teams:create", async (_e, args: unknown) => {
			const input = recordValue(args, "team create payload");
			const { teamToolsHandlers } = await import("@openbuddy/team-team");
			return teamToolsHandlers.create(requiredString(input.goal, "goal"), input.size === undefined ? "medium" : enumValue(input.size, "size", ["small", "medium", "large"] as const));
		});
		ipcMain.handle("teams:status", async (_e, teamId: unknown) => {
			const { teamToolsHandlers } = await import("@openbuddy/team-team");
			return teamToolsHandlers.status(requiredString(teamId, "teamId"));
		});
		ipcMain.handle("teams:delete", async (_e, teamId: unknown) => {
			const { teamToolsHandlers } = await import("@openbuddy/team-team");
			return teamToolsHandlers.delete(requiredString(teamId, "teamId"));
		});
		ipcMain.handle("shellfs:open-url", async (_e, url: string) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			return shellFsHandlers.openUrl(httpUrl(url, "url"));
		});
		ipcMain.handle("shellfs:open-path", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "open path payload");
			return shellFsHandlers.openPath(requiredString(input.path, "path"), input.cwd === undefined ? agentHost.getCwd() : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("shellfs:reveal", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "reveal payload");
			return shellFsHandlers.reveal(requiredString(input.path, "path"), input.cwd === undefined ? agentHost.getCwd() : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("shellfs:stat", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "stat payload");
			return shellFsHandlers.stat(requiredString(input.path, "path"), input.cwd === undefined ? agentHost.getCwd() : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("shellfs:read-text", async (_e, args: { path: string; cwd?: string; maxBytes?: number }) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "read text payload");
			const pathValue = requiredString(input.path, "path");
			const cwd = input.cwd === undefined || input.cwd === null ? agentHost.getCwd() : absolutePath(input.cwd, "cwd");
			if (cwd && resolve(cwd) === resolve(cwd, "..")) throw new Error("cwd cannot be the filesystem root");
			const maxBytes = input.maxBytes === undefined || input.maxBytes === null
				? undefined
				: optionalFiniteInteger(input.maxBytes, "maxBytes", 256 * 1024, 1, 50 * 1024 * 1024);
			return shellFsHandlers.readTextFile(pathValue, cwd, maxBytes);
		});
		ipcMain.handle("shellfs:read-file-base64", async (_e, args: { path: string; cwd?: string; maxBytes?: number }) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "read file payload");
			const cwd = input.cwd === undefined || input.cwd === null ? agentHost.getCwd() : absolutePath(input.cwd, "cwd");
			return shellFsHandlers.readFileBase64(requiredString(input.path, "path"), cwd, optionalFiniteInteger(input.maxBytes, "maxBytes", 20 * 1024 * 1024, 1, 50 * 1024 * 1024));
		});
		ipcMain.handle("shellfs:write-text", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "write text payload");
			return shellFsHandlers.writeTextFile(requiredString(input.path, "path"), stringValue(input.content, "content"), writeAllowedRoot(absolutePath(input.workspaceRoot, "workspaceRoot")));
		});
		ipcMain.handle("shellfs:export-text", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "export text payload");
			return shellFsHandlers.exportTextFile(absolutePath(input.path, "path"), stringValue(input.content, "content"));
		});
		ipcMain.handle("shellfs:import-file", async (_e, args: unknown) => {
			const input = recordValue(args, "import file payload");
			const sourcePath = absolutePath(input.sourcePath, "sourcePath");
			const workspaceRoot = writeAllowedRoot(absolutePath(input.workspaceRoot, "workspaceRoot"));
			const sourceStat = await fs.stat(sourcePath);
			if (!sourceStat.isFile()) throw new Error("sourcePath must be a file");
			const requestedName = input.fileName === undefined ? sourcePath.split(/[\\/]/).pop() : requiredString(input.fileName, "fileName");
			if (!requestedName || requestedName === "." || requestedName === ".." || /[\\/]/.test(requestedName)) throw new Error("fileName is invalid");
			const destination = resolve(workspaceRoot, requestedName);
			if (relative(workspaceRoot, destination).startsWith("..") || isAbsolute(relative(workspaceRoot, destination))) throw new Error("destination is outside workspace");
			await fs.copyFile(sourcePath, destination);
			return { path: destination, size: sourceStat.size, name: requestedName };
		});
		ipcMain.handle("shellfs:remove", async (_e, args: unknown) => {
			const input = recordValue(args, "remove path payload");
			const workspaceRoot = writeAllowedRoot(absolutePath(input.workspaceRoot, "workspaceRoot"));
			const target = resolve(workspaceRoot, requiredString(input.path, "path"));
			const rel = relative(workspaceRoot, target);
			if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error("path is outside workspace");
			await fs.rm(target, { recursive: true, force: false });
			return { ok: true };
		});
		ipcMain.handle("inspiration_generate", async (_e, args: unknown) => {
			const input = recordValue(args, "inspiration payload");
			const request = input.request === undefined ? {} : recordValue(input.request, "request");
			const count = optionalFiniteInteger(request.count, "count", 1, 1, 20);
			return (agentHost as any).inspirationGenerate(
				request.category === undefined ? "general" : requiredString(request.category, "category"),
				count,
				request.cwd === undefined ? undefined : absolutePath(request.cwd, "cwd"),
			);
		});
		ipcMain.handle("shellfs:mkdir", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "make directory payload");
			return shellFsHandlers.makeDirectory(requiredString(input.path, "path"), writeAllowedRoot(absolutePath(input.workspaceRoot, "workspaceRoot")));
		});
		ipcMain.handle("shellfs:list-dir", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "list directory payload");
			return shellFsHandlers.listDir(requiredString(input.path, "path"), input.cwd === undefined ? agentHost.getCwd() : absolutePath(input.cwd, "cwd"), optionalFiniteInteger(input.maxEntries, "maxEntries", 2000, 1, 10000));
		});
		ipcMain.handle("shellfs:browse-directory", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			if (typeof args === "string") return shellFsHandlers.browseDirectory(requiredString(args, "path"), agentHost.getCwd());
			const input = recordValue(args, "browse directory payload");
			return shellFsHandlers.browseDirectory(requiredString(input.path, "path"), input.cwd === undefined ? agentHost.getCwd() : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("list_dir", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "list directory payload");
			return shellFsHandlers.listDir(requiredString(input.path, "path"), input.cwd === null || input.cwd === undefined ? agentHost.getCwd() : absolutePath(input.cwd, "cwd"), optionalFiniteInteger(input.maxEntries, "maxEntries", 2000, 1, 10000));
		});
		ipcMain.handle("open_url", async (_e, args: { url: string } | string) => {
			const url = httpUrl(typeof args === "string" ? args : recordValue(args, "open URL payload").url, "url");
			await shell.openExternal(url);
		});
		ipcMain.handle("export_text_file", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "export text payload");
			return shellFsHandlers.exportTextFile(absolutePath(input.path, "path"), stringValue(input.content, "content"));
		});
		ipcMain.handle("shell:open-external", async (_e, url: string) => {
			await shell.openExternal(httpUrl(url, "url"));
			return { ok: true };
		});
		ipcMain.handle("automations:snapshot", async () => {
			// Stage G-1c + H-4: openbuddy-automation removed; the canonical
			// automation backplane is `pi-goal-list-loop-audit`
			// (npm 18,959 downloads/month, source of truth for goal-loop
			// queue + audit). This legacy IPC channel throws so the UI
			// surfaces a clear migration message instead of silently
			// rendering empty data; AutomationPanel still exists (per
			// "保留auto" user constraint) and points users at the new path.
			throw new Error("automations:snapshot has been retired — automation is now owned by pi-goal-list-loop-audit (passthrough). Install it via /marketplace and run /goal to manage automations.");
		});
		// Legacy snake_case aliases kept so the preload allowlist stays
		// consistent; every call rejects with the same migration message
		// so the UI stops emitting fake success toasts.
		const automationRetired = "automations:* IPC has been retired — automation is now owned by pi-goal-list-loop-audit (passthrough). Install via /marketplace and use /goal to manage automations.";
		ipcMain.handle("automations_snapshot", async () => { throw new Error(automationRetired); });
		ipcMain.handle("automations_save", async () => { throw new Error(automationRetired); });
		ipcMain.handle("automations_delete", async () => { throw new Error(automationRetired); });
		ipcMain.handle("automations_set_status", async () => { throw new Error(automationRetired); });
		ipcMain.handle("automations_run", async () => { throw new Error(automationRetired); });
		ipcMain.handle("automation_records_archive", async () => { throw new Error(automationRetired); });
		ipcMain.handle("automation_records_delete", async () => { throw new Error(automationRetired); });
		ipcMain.handle("subagents_config_get", async () => resources.readSubagentsConfig());
		ipcMain.handle("subagents_config_save", async (_e, args: unknown) => {
			const input = recordValue(args, "subagents_config_save payload");
			const patch: resources.OpenBuddySubagentsConfig = {};
			if (input.maxDepth !== undefined) patch.maxDepth = optionalFiniteInteger(input.maxDepth, "maxDepth", 1, 1, 8);
			return resources.writeSubagentsConfig(patch);
		});
		// Stage G-1c: removed automation IPC channels (delegate to pi-background-tasks):
		//   automations:save / automations:delete / automations:set-status
		//   automations:run / automations:archive
		//   automations_snapshot / automations_save / automations_delete
		//   automations_set_status / automations_run / automation_records_archive
		// These channels now throw "unknown channel" — see preload/index.ts
		// (allowedInvokeChannels) for the deleted entries.
		ipcMain.handle("calendar:list", async (_e, args?: { from?: string; to?: string; roomId?: string; contextRef?: string }) => {
			const input = args === undefined ? {} : recordValue(args, "calendar list payload");
			const { calendarHandlers } = await import("@openbuddy/capability-calendar");
			return calendarHandlers.list({
				...(input.from === undefined ? {} : { from: requiredString(input.from, "from") }),
				...(input.to === undefined ? {} : { to: requiredString(input.to, "to") }),
				...(input.roomId === undefined ? {} : { roomId: requiredString(input.roomId, "roomId") }),
				...(input.contextRef === undefined ? {} : { contextRef: requiredString(input.contextRef, "contextRef") }),
			});
		});
		ipcMain.handle("calendar:create", async (_e, args: unknown) => {
			const input = recordValue(args, "calendar create payload");
			const { calendarHandlers } = await import("@openbuddy/capability-calendar");
			return calendarHandlers.create({
				title: requiredString(input.title, "title"),
				start: requiredString(input.start, "start"),
				end: requiredString(input.end, "end"),
				...(input.timeZone === undefined ? {} : { timeZone: requiredString(input.timeZone, "timeZone") }),
				...(input.allDay === undefined ? {} : { allDay: requiredBoolean(input.allDay, "allDay") }),
				...(input.status === undefined ? {} : { status: enumValue(input.status, "status", ["confirmed", "tentative", "cancelled"] as const) }),
				...(input.roomId === undefined ? {} : { roomId: requiredString(input.roomId, "roomId") }),
				...(input.contextRefs === undefined ? {} : { contextRefs: requiredStringArray(input.contextRefs, "contextRefs") }),
				...(input.description === undefined ? {} : { description: requiredString(input.description, "description") }),
				...(input.location === undefined ? {} : { location: requiredString(input.location, "location") }),
				...(input.attendees === undefined ? {} : { attendees: requiredStringArray(input.attendees, "attendees") }),
			});
		});
		ipcMain.handle("calendar:update", async (_e, args: unknown) => {
			const input = recordValue(args, "calendar update payload");
			const patch = recordValue(input.patch, "calendar update patch");
			const { calendarHandlers } = await import("@openbuddy/capability-calendar");
			return calendarHandlers.update(requiredString(input.id, "id"), {
				...(patch.title === undefined ? {} : { title: requiredString(patch.title, "patch.title") }),
				...(patch.start === undefined ? {} : { start: requiredString(patch.start, "patch.start") }),
				...(patch.end === undefined ? {} : { end: requiredString(patch.end, "patch.end") }),
				...(patch.timeZone === undefined ? {} : { timeZone: requiredString(patch.timeZone, "patch.timeZone") }),
				...(patch.allDay === undefined ? {} : { allDay: requiredBoolean(patch.allDay, "patch.allDay") }),
				...(patch.status === undefined ? {} : { status: enumValue(patch.status, "patch.status", ["confirmed", "tentative", "cancelled"] as const) }),
				...(patch.contextRefs === undefined ? {} : { contextRefs: requiredStringArray(patch.contextRefs, "patch.contextRefs") }),
				...(patch.description === undefined ? {} : { description: requiredString(patch.description, "patch.description") }),
				...(patch.location === undefined ? {} : { location: requiredString(patch.location, "patch.location") }),
				...(patch.attendees === undefined ? {} : { attendees: requiredStringArray(patch.attendees, "patch.attendees") }),
			});
		});
		ipcMain.handle("calendar:delete", async (_e, id: string) => {
			const { calendarHandlers } = await import("@openbuddy/capability-calendar");
			return calendarHandlers.remove(requiredString(id, "id"));
		});
		ipcMain.handle("permission:list", async () => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			await ensureAgentHost();
			const { permissionHandlers } = await import("@openbuddy/auth-permission");
			return permissionHandlers.readRules();
		});
		ipcMain.handle("permission:save", async (_e, rules: unknown) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			await ensureAgentHost();
			const { permissionHandlers } = await import("@openbuddy/auth-permission");
			return permissionHandlers.writeRules(permissionRules(rules) as never);
		});
		ipcMain.handle("permission:mode-get", async () => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			await ensureAgentHost();
			const { permissionHandlers } = await import("@openbuddy/auth-permission");
			return fromPiPermissionMode(await permissionHandlers.readMode());
		});
		ipcMain.handle("permission:mode-set", async (_e, mode: unknown) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			await ensureAgentHost();
			const { permissionHandlers } = await import("@openbuddy/auth-permission");
			return permissionHandlers.writeMode(toPiPermissionMode(publicPermissionMode(mode)));
		});
}
