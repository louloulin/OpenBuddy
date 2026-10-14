/**
 * IPC surface — misc domain.
 *
 * Split out of `./index.ts`.
 */
import { clipboard, dialog, shell, type BrowserWindow } from "electron";
import { wrapIpcHandler } from "./_wrap";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import * as fs from "node:fs/promises";
import { approveSavePath, requireApprovedSavePath } from "./save-path-approval";
import { agentHost, bindRendererEventEmitter, ensureAgentHostLoaded } from "./agent-host-proxy";
import { readKnowledgeSources, readNotifyChannels, readPolicyConfig, readStorageSources, readSubagentsConfig, writeKnowledgeSources, writeNotifyChannels, writePolicyConfig, writeSubagentsConfig } from "../agent/pi-resources";
import type { OpenBuddySubagentsConfig } from "../agent/pi-resources";
import { dispatchMainNotifications } from "../notifications";
import { piHome } from "../agent/host-modules/_host-paths";
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
	resolvedCwd,
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
// dynamic: @openbuddy/folder-trust
// dynamic: @openbuddy/team-team

export function registerMiscIpc(getWindow: () => BrowserWindow | null): void {
	const ensureAgentHost = async () => {
		await ensureAgentHostLoaded();
	};
	const currentWindow = () => getWindow();

	// Save-dialog-approved paths: `export_text_file` / `audit:export` may only
	// write where the user explicitly picked a destination in the native save
	// dialog. R41 — 实现提到 `./save-path-approval`(模块级单例):审计导出复用的是
	// 同一份安全不变式,而不是第二份复制品。
	// Write containment only helps if the root is chosen by the main process:
	// reject any workspaceRoot that is neither the active agent cwd nor a
	// registered storage source.
	const resolveWriteRoot = async (candidate: unknown): Promise<string> => {
		await ensureAgentHost();
		const root = resolve(writeAllowedRoot(absolutePath(candidate, "workspaceRoot")));
		const allowed = new Set<string>([resolve(agentHost.getCwd())]);
		for (const source of await readStorageSources()) {
			if (typeof source === "string" && source.trim()) allowed.add(resolve(source));
		}
		if (!allowed.has(root)) throw new Error("workspaceRoot 必须是已注册的工作区");
		return root;
	};

		wrapIpcHandler("clipboard:read-text", () => clipboard.readText());
		wrapIpcHandler("clipboard:write-text", (_event, text: unknown) => {
			clipboard.writeText(stringValue(text, "text"));
		});
		wrapIpcHandler("dialog:open", async (_event, options?: Electron.OpenDialogOptions) => {
			const safeOptions = openDialogOptions(options);
			const win = currentWindow();
			const result = win
				? await dialog.showOpenDialog(win, safeOptions)
				: await dialog.showOpenDialog(safeOptions);
			return result.canceled ? null : result.filePaths;
		});
		wrapIpcHandler("dialog:save", async (_event, options?: Electron.SaveDialogOptions) => {
			const safeOptions = saveDialogOptions(options);
			const win = currentWindow();
			const result = win
				? await dialog.showSaveDialog(win, safeOptions)
				: await dialog.showSaveDialog(safeOptions);
			return approveSavePath(result.canceled ? null : result.filePath ?? null);
		});
		
		wrapIpcHandler("window:minimize", () => currentWindow()?.minimize());
		wrapIpcHandler("window:toggle-maximize", () => currentWindow()?.isMaximized() ? currentWindow()?.unmaximize() : currentWindow()?.maximize());
		wrapIpcHandler("window:close", () => currentWindow()?.close());
		wrapIpcHandler("window:is-maximized", () => currentWindow()?.isMaximized() ?? false);
		wrapIpcHandler("debug:toggle-devtools", async () => {
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
		wrapIpcHandler("debug:reload", () => {
			const win = currentWindow();
			if (!win || win.isDestroyed()) {
				console.warn("[openbuddy-pi] debug:reload ignored — no main window");
				return;
			}
			win.webContents.reload();
			return true;
		});
		wrapIpcHandler("debug:force-reload", () => {
			const win = currentWindow();
			if (!win || win.isDestroyed()) {
				console.warn("[openbuddy-pi] debug:force-reload ignored — no main window");
				return;
			}
			win.webContents.reloadIgnoringCache();
			return true;
		});
		wrapIpcHandler("debug:info", () => {
			const win = currentWindow();
			return {
				url: win?.webContents.getURL() ?? "",
				webContentsId: win?.webContents.id ?? 0,
				readyState: win?.webContents.isLoading() ? "loading" : "complete",
				userAgent: win?.webContents.getUserAgent() ?? "",
			};
		});
		// Folder trust — backed by @openbuddy/folder-trust. That capability package
		// existed all along, but `mountFolderTrust()` was never called in
		// production, so `folderTrustHandlers.*` threw "store is not mounted";
		// Stage C-1 then removed the IPC channels entirely while
		// FolderTrustDialog (packages/ui/openbuddy-ui-dialogs) kept calling them —
		// the user's "信任此目录" click could only ever throw. Mount lazily here so
		// the decision actually persists.
		let folderTrustModule: typeof import("@openbuddy/folder-trust") | null = null;
		const folderTrust = async () => {
			folderTrustModule ??= await import("@openbuddy/folder-trust");
			if (!folderTrustModule.getFolderTrustStore()) {
				folderTrustModule.mountFolderTrust({ storagePath: join(piHome(), "folder-trust.json") });
			}
			return folderTrustModule.folderTrustHandlers;
		};
		wrapIpcHandler("folder-trust:list", async () => (await folderTrust()).list());
		wrapIpcHandler("folder-trust:is-trusted", async (_e, cwd: unknown) =>
			(await folderTrust()).isTrusted(requiredString(cwd, "cwd")));
		wrapIpcHandler("folder-trust:grant", async (_e, cwd: unknown) => {
			return (await folderTrust()).grant(requiredString(cwd, "cwd"));
		});
		wrapIpcHandler("folder-trust:revoke", async (_e, cwd: unknown) => {
			return (await folderTrust()).revoke(requiredString(cwd, "cwd"));
		});
		wrapIpcHandler("folder_trust_respond", async (_e, args: unknown) => {
			const input = recordValue(args, "folder trust payload");
			return (await folderTrust()).respond(
				requiredString(input.cwd, "cwd"),
				requiredBoolean(input.trusted, "trusted"),
			);
		});
		wrapIpcHandler("subagents:get-config", async () => {
			casdoorAuth.assertAuthorized({ capability: "team.workspace" });
			return readSubagentsConfig();
		});
		// The handler intentionally throws so callers see a clear "removed" error rather than a silent no-op.
		wrapIpcHandler("subagents:set-config", async (_e, args: unknown) => {
			casdoorAuth.assertAuthorized({ capability: "team.workspace" });
			const input = recordValue(args, "subagents set-config payload");
			const patch: OpenBuddySubagentsConfig = {};
			if (input.maxDepth !== undefined) patch.maxDepth = optionalFiniteInteger(input.maxDepth, "maxDepth", 1, 1, 8);
			return writeSubagentsConfig(patch);
		});
		wrapIpcHandler("policy:get", async () => readPolicyConfig());
		wrapIpcHandler("policy:save", async (_e, args: unknown) => {
			const input = recordValue(args, "policy save payload");
			const policy = recordValue(input.policy, "policy");
			if (!Array.isArray(policy.rules)) throw new Error("policy.rules must be an array");
			return writePolicyConfig({ rules: policy.rules.map((rule, index) => {
				const item = recordValue(rule, `policy.rules[${index}]`);
				return {
					type: requiredString(item.type, `policy.rules[${index}].type`),
					value: item.value,
					...(item.priority === undefined ? {} : { priority: optionalFiniteInteger(item.priority, `policy.rules[${index}].priority`, 0, -100, 100) }),
					...(item.source === undefined ? {} : { source: stringValue(item.source, `policy.rules[${index}].source`) }),
				};
			}) });
		});
		wrapIpcHandler("notify-channels:list", async () => readNotifyChannels());
		wrapIpcHandler("notify-channels:save", async (_e, args: unknown) => {
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
			return writeNotifyChannels(channels);
		});
		wrapIpcHandler("notify:dispatch", async (_e, args: unknown) => {
			const input = recordValue(args, "notification dispatch payload");
			const message = recordValue(input.message, "notification message");
			return dispatchMainNotifications(await readNotifyChannels(), {
				title: requiredString(message.title, "message.title"),
				...(message.body === undefined ? {} : { body: stringValue(message.body, "message.body") }),
				...(message.level === undefined ? {} : { level: enumValue(message.level, "message.level", ["info", "warn", "error"] as const) }),
				...(message.sessionId === undefined ? {} : { sessionId: requiredString(message.sessionId, "message.sessionId") }),
			});
		});
		wrapIpcHandler("knowledge-sources:list", async () => readKnowledgeSources());
		wrapIpcHandler("knowledge-sources:save", async (_e, args: unknown) => {
			const input = recordValue(args, "knowledge sources save payload");
			if (!Array.isArray(input.sources)) throw new Error("sources must be an array");
			const sources = input.sources.map((source, index) => {
				const value = requiredString(source, `sources[${index}]`);
				if (!isAbsolute(value)) throw new Error(`sources[${index}] must be absolute`);
				return value;
			});
			return writeKnowledgeSources([...new Set(sources)]);
		});
		wrapIpcHandler("teams:create", async (_e, args: unknown) => {
			const input = recordValue(args, "team create payload");
			const { teamToolsHandlers } = await import("@openbuddy/team-team");
			return teamToolsHandlers.create(requiredString(input.goal, "goal"), input.size === undefined ? "medium" : enumValue(input.size, "size", ["small", "medium", "large"] as const));
		});
		wrapIpcHandler("teams:status", async (_e, teamId: unknown) => {
			const { teamToolsHandlers } = await import("@openbuddy/team-team");
			return teamToolsHandlers.status(requiredString(teamId, "teamId"));
		});
		wrapIpcHandler("teams:delete", async (_e, teamId: unknown) => {
			const { teamToolsHandlers } = await import("@openbuddy/team-team");
			return teamToolsHandlers.delete(requiredString(teamId, "teamId"));
		});
		wrapIpcHandler("shellfs:open-url", async (_e, url: string) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			return shellFsHandlers.openUrl(httpUrl(url, "url"));
		});
		wrapIpcHandler("shellfs:open-path", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "open path payload");
			return shellFsHandlers.openPath(requiredString(input.path, "path"), resolvedCwd(input, () => agentHost.getCwd()));
		});
		wrapIpcHandler("shellfs:reveal", async (_e, args: unknown) => {
			await ensureAgentHost();
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "reveal payload");
			return shellFsHandlers.reveal(requiredString(input.path, "path"), resolvedCwd(input, () => agentHost.getCwd()));
		});
		wrapIpcHandler("shellfs:stat", async (_e, args: unknown) => {
			await ensureAgentHost();
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "stat payload");
			return shellFsHandlers.stat(requiredString(input.path, "path"), resolvedCwd(input, () => agentHost.getCwd()));
		});
		wrapIpcHandler("shellfs:read-text", async (_e, args: { path: string; cwd?: string; maxBytes?: number }) => {
			await ensureAgentHost();
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "read text payload");
			const pathValue = requiredString(input.path, "path");
			const cwd = resolvedCwd(input, () => agentHost.getCwd());
			if (cwd && resolve(cwd) === resolve(cwd, "..")) throw new Error("cwd cannot be the filesystem root");
			const maxBytes = input.maxBytes === undefined || input.maxBytes === null
				? undefined
				: optionalFiniteInteger(input.maxBytes, "maxBytes", 256 * 1024, 1, 50 * 1024 * 1024);
			return shellFsHandlers.readTextFile(pathValue, cwd, maxBytes);
		});
		wrapIpcHandler("shellfs:read-file-base64", async (_e, args: { path: string; cwd?: string; maxBytes?: number }) => {
			await ensureAgentHost();
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "read file payload");
			const cwd = resolvedCwd(input, () => agentHost.getCwd());
			return shellFsHandlers.readFileBase64(requiredString(input.path, "path"), cwd, optionalFiniteInteger(input.maxBytes, "maxBytes", 20 * 1024 * 1024, 1, 50 * 1024 * 1024));
		});
		wrapIpcHandler("shellfs:write-text", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "write text payload");
			return shellFsHandlers.writeTextFile(requiredString(input.path, "path"), stringValue(input.content, "content"), await resolveWriteRoot(input.workspaceRoot));
		});
		wrapIpcHandler("shellfs:export-text", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "export text payload");
			return shellFsHandlers.exportTextFile(requireApprovedSavePath(absolutePath(input.path, "path")), stringValue(input.content, "content"));
		});
		wrapIpcHandler("shellfs:import-file", async (_e, args: unknown) => {
			const input = recordValue(args, "import file payload");
			const sourcePath = absolutePath(input.sourcePath, "sourcePath");
			const workspaceRoot = await resolveWriteRoot(input.workspaceRoot);
			const sourceStat = await fs.stat(sourcePath);
			if (!sourceStat.isFile()) throw new Error("sourcePath must be a file");
			const requestedName = input.fileName === undefined ? sourcePath.split(/[\\/]/).pop() : requiredString(input.fileName, "fileName");
			if (!requestedName || requestedName === "." || requestedName === ".." || /[\\/]/.test(requestedName)) throw new Error("fileName is invalid");
			const destination = resolve(workspaceRoot, requestedName);
			if (relative(workspaceRoot, destination).startsWith("..") || isAbsolute(relative(workspaceRoot, destination))) throw new Error("destination is outside workspace");
			await fs.copyFile(sourcePath, destination);
			return { path: destination, size: sourceStat.size, name: requestedName };
		});
		wrapIpcHandler("shellfs:remove", async (_e, args: unknown) => {
			const input = recordValue(args, "remove path payload");
			const workspaceRoot = await resolveWriteRoot(input.workspaceRoot);
			const target = resolve(workspaceRoot, requiredString(input.path, "path"));
			const rel = relative(workspaceRoot, target);
			if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error("path is outside workspace");
			await fs.rm(target, { recursive: true, force: false });
			return { ok: true };
		});
		wrapIpcHandler("inspiration_generate", async (_e, args: unknown) => {
			await ensureAgentHost();
			const input = recordValue(args, "inspiration payload");
			const request = input.request === undefined ? {} : recordValue(input.request, "request");
			const count = optionalFiniteInteger(request.count, "count", 1, 1, 20);
			return (agentHost as any).inspirationGenerate(
				request.category === undefined ? "general" : requiredString(request.category, "category"),
				count,
				request.cwd === undefined ? undefined : absolutePath(request.cwd, "cwd"),
			);
		});
		wrapIpcHandler("shellfs:mkdir", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "make directory payload");
			return shellFsHandlers.makeDirectory(requiredString(input.path, "path"), await resolveWriteRoot(input.workspaceRoot));
		});
		wrapIpcHandler("shellfs:list-dir", async (_e, args: unknown) => {
			await ensureAgentHost();
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "list directory payload");
			return shellFsHandlers.listDir(requiredString(input.path, "path"), resolvedCwd(input, () => agentHost.getCwd()), optionalFiniteInteger(input.maxEntries, "maxEntries", 2000, 1, 10000));
		});
		wrapIpcHandler("shellfs:browse-directory", async (_e, args: unknown) => {
			await ensureAgentHost();
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			if (typeof args === "string") return shellFsHandlers.browseDirectory(requiredString(args, "path"), agentHost.getCwd());
			const input = recordValue(args, "browse directory payload");
			return shellFsHandlers.browseDirectory(requiredString(input.path, "path"), resolvedCwd(input, () => agentHost.getCwd()));
		});
		wrapIpcHandler("list_dir", async (_e, args: unknown) => {
			await ensureAgentHost();
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "list directory payload");
			return shellFsHandlers.listDir(requiredString(input.path, "path"), resolvedCwd(input, () => agentHost.getCwd()), optionalFiniteInteger(input.maxEntries, "maxEntries", 2000, 1, 10000));
		});
		wrapIpcHandler("open_url", async (_e, args: { url: string } | string) => {
			const url = httpUrl(typeof args === "string" ? args : recordValue(args, "open URL payload").url, "url");
			await shell.openExternal(url);
		});
		wrapIpcHandler("export_text_file", async (_e, args: unknown) => {
			const { shellFsHandlers } = await import("@openbuddy/fs-fs-local");
			const input = recordValue(args, "export text payload");
			return shellFsHandlers.exportTextFile(requireApprovedSavePath(absolutePath(input.path, "path")), stringValue(input.content, "content"));
		});
		wrapIpcHandler("shell:open-external", async (_e, url: string) => {
			await shell.openExternal(httpUrl(url, "url"));
			return { ok: true };
		});
		// automations:* / automation_records_* 由 automations.ts 提供真实实现
		// (阶段 1.4 恢复调度引擎,模型与 UI 契约共用 shared-types)。
		wrapIpcHandler("subagents_config_get", async () => readSubagentsConfig());
		wrapIpcHandler("subagents_config_save", async (_e, args: unknown) => {
			const input = recordValue(args, "subagents_config_save payload");
			const patch: OpenBuddySubagentsConfig = {};
			if (input.maxDepth !== undefined) patch.maxDepth = optionalFiniteInteger(input.maxDepth, "maxDepth", 1, 1, 8);
			return writeSubagentsConfig(patch);
		});
		// Stage G-1c: removed automation IPC channels (delegate to pi-background-tasks):
		//   automations:save / automations:delete / automations:set-status
		//   automations:run / automations:archive
		//   automations_snapshot / automations_save / automations_delete
		//   automations_set_status / automations_run / automation_records_archive
		// These channels now throw "unknown channel" — see preload/index.ts
		// (allowedInvokeChannels) for the deleted entries.
		wrapIpcHandler("calendar:list", async (_e, args?: { from?: string; to?: string; roomId?: string; contextRef?: string }) => {
			const input = args === undefined ? {} : recordValue(args, "calendar list payload");
			const { calendarHandlers } = await import("@openbuddy/capability-calendar");
			return calendarHandlers.list({
				...(input.from === undefined ? {} : { from: requiredString(input.from, "from") }),
				...(input.to === undefined ? {} : { to: requiredString(input.to, "to") }),
				...(input.roomId === undefined ? {} : { roomId: requiredString(input.roomId, "roomId") }),
				...(input.contextRef === undefined ? {} : { contextRef: requiredString(input.contextRef, "contextRef") }),
			});
		});
		wrapIpcHandler("calendar:create", async (_e, args: unknown) => {
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
		wrapIpcHandler("calendar:update", async (_e, args: unknown) => {
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
		wrapIpcHandler("calendar:delete", async (_e, id: string) => {
			const { calendarHandlers } = await import("@openbuddy/capability-calendar");
			return calendarHandlers.remove(requiredString(id, "id"));
		});
		wrapIpcHandler("permission:list", async () => {
			casdoorAuth.assertAuthorized({ capability: "team.workspace" });
			await ensureAgentHost();
			const { agentPermissionBridge: permissionHandlers } = await import("../agent/agent-permission-bridge");
			return permissionHandlers.readRules();
		});
		wrapIpcHandler("permission:save", async (_e, rules: unknown) => {
			casdoorAuth.assertAuthorized({ capability: "team.workspace" });
			await ensureAgentHost();
			const { agentPermissionBridge: permissionHandlers } = await import("../agent/agent-permission-bridge");
			return permissionHandlers.writeRules(permissionRules(rules) as never);
		});
		wrapIpcHandler("permission:mode-get", async () => {
			casdoorAuth.assertAuthorized({ capability: "team.workspace" });
			await ensureAgentHost();
			const { agentPermissionBridge: permissionHandlers } = await import("../agent/agent-permission-bridge");
			return fromPiPermissionMode(await permissionHandlers.readMode());
		});
		wrapIpcHandler("permission:mode-set", async (_e, mode: unknown) => {
			casdoorAuth.assertAuthorized({ capability: "team.workspace" });
			await ensureAgentHost();
			const { agentPermissionBridge: permissionHandlers } = await import("../agent/agent-permission-bridge");
			return permissionHandlers.writeMode(toPiPermissionMode(publicPermissionMode(mode)));
		});
}
