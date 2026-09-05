/**
 * IPC surface — agent domain.
 *
 * Split out of `./index.ts`.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { agentHost, bindRendererEventEmitter } from "./agent-host-proxy";
import { hostReceived, hostDispatched, hostFailed } from "../agent/agent-host-log";
import { generateTraceId } from "@openbuddy/logging-shared";
import * as resources from "../agent/pi-resources";
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
	memoryScope,
	modelId,
	normalizePromptContent,
	promptContent,
	thinkingLevel,
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

/**
 * Phase 5 — module-scope helper. Mutating IPCs (`agent:prompt`,
 * `agent:set-model`, `agent:prompt-content`, …) call this before
 * issuing their RPC so they don't race with the fire-and-forget
 * `bindExtensions` that runs after `rebindSession` /
 * `initialize`. Errors are swallowed (bind failures are non-fatal —
 * the session is still usable, just without extension hooks).
 *
 * Module-scope (not inside `registerAgentIpc`) because some handlers
 * (e.g. `agent:prompt-content`) are registered outside the function
 * in the same file.
 */
const awaitExtensionsBound = async () => {
	await agentHost.extensionsBound()?.catch(() => undefined);
};

export function registerAgentIpc(getWindow: () => BrowserWindow | null): void {
	const ensureAgentHost = async () => {
		await agentHost.waitUntilReady();
	};

		ipcMain.handle("agent:new-session", async (_e, input?: string | { cwd?: string; modelId?: string; traceId?: string }) => {
			const payload = typeof input === "string" ? undefined : recordValue(input, "agent:new-session payload");
			const cwd = absolutePath(typeof input === "string" ? input : payload?.cwd, "cwd");
			const modelId = payload?.modelId === undefined ? undefined : requiredString(payload.modelId, "modelId");
			const traceId = optionalString((typeof input === "string" ? undefined : payload?.traceId), "traceId") ?? generateTraceId();
			hostReceived("agent:new-session", traceId);
			try {
				const result = await agentHost.newSession(cwd, modelId, { traceId });
				hostDispatched("agent:new-session", traceId);
				return result;
			} catch (err) {
				hostFailed("agent:new-session", traceId, err);
				throw err;
			}
		});
		// Coalesced variant of `agent:new-session` — concurrent callers with the
		// same `${cwd}\0${modelId}` key share one in-flight Promise. Use this
		// from renderer-side code that wants to *lazily* obtain a fresh session
		// id (e.g. extension methods, double-clicks of "新建任务"). The returned
		// sessionId is indistinguishable from a `agent:new-session` result.
		ipcMain.handle("agent:ensure-new-session", async (_e, input?: string | { cwd?: string; modelId?: string; traceId?: string }) => {
			const payload = typeof input === "string" ? undefined : recordValue(input, "agent:ensure-new-session payload");
			const cwd = absolutePath(typeof input === "string" ? input : payload?.cwd, "cwd");
			const modelId = payload?.modelId === undefined ? undefined : requiredString(payload.modelId, "modelId");
			const traceId = optionalString((typeof input === "string" ? undefined : payload?.traceId), "traceId") ?? generateTraceId();
			hostReceived("agent:ensure-new-session", traceId);
			try {
				const result = await agentHost.ensureNewSession(cwd, modelId, { traceId });
				hostDispatched("agent:ensure-new-session", traceId);
				return result;
			} catch (err) {
				hostFailed("agent:ensure-new-session", traceId, err);
				throw err;
			}
		});
		ipcMain.handle("agent:prompt", async (_e, input: string | { sessionId?: string; text: string; traceId?: string }) => {
			const payload = typeof input === "string" ? undefined : recordValue(input, "agent:prompt payload");
			const sessionId = payload?.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			const activeSessionId = agentHost.getSession()?.sessionId;
			if (sessionId !== undefined && sessionId !== activeSessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const text = requiredString(typeof input === "string" ? input : payload?.text, "prompt");
			const traceId = optionalString((typeof input === "string" ? undefined : payload?.traceId), "traceId") ?? generateTraceId();
			hostReceived("agent:prompt", traceId, sessionId);
			try {
				await awaitExtensionsBound();
				await agentHost.prompt(text, { traceId, sessionId });
				hostDispatched("agent:prompt", traceId, sessionId);
				return { ok: true };
			} catch (err) {
				hostFailed("agent:prompt", traceId, err);
				throw err;
			}
		});
		ipcMain.handle("agent:steer", async (_e, input: { sessionId?: string; text: string; traceId?: string }) => {
			const payload = recordValue(input, "agent:steer payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:steer", traceId, sessionId);
			try {
				await awaitExtensionsBound();
				await agentHost.steer(requiredString(payload.text, "text"), { traceId, sessionId });
				hostDispatched("agent:steer", traceId, sessionId);
				return { ok: true };
			} catch (err) {
				hostFailed("agent:steer", traceId, err);
				throw err;
			}
		});
		ipcMain.handle("agent:follow-up", async (_e, input: { sessionId?: string; text: string; traceId?: string }) => {
			const payload = recordValue(input, "agent:follow-up payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:follow-up", traceId, sessionId);
			try {
				await awaitExtensionsBound();
				await agentHost.followUp(requiredString(payload.text, "text"), { traceId, sessionId });
				hostDispatched("agent:follow-up", traceId, sessionId);
				return { ok: true };
			} catch (err) {
				hostFailed("agent:follow-up", traceId, err);
				throw err;
			}
		});
		ipcMain.handle("agent:abort", async (_e, input?: { sessionId?: string; traceId?: string }) => {
			let sessionId: string | undefined;
			const traceId = optionalString(input?.traceId, "traceId") ?? generateTraceId();
			if (input !== undefined) {
				const payload = recordValue(input, "agent:abort payload");
				sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
				if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			}
			hostReceived("agent:abort", traceId, sessionId);
			try {
				await awaitExtensionsBound();
				await agentHost.abort({ traceId, sessionId });
				hostDispatched("agent:abort", traceId, sessionId);
				return { ok: true };
			} catch (err) {
				hostFailed("agent:abort", traceId, err);
				throw err;
			}
		});
		ipcMain.handle("agent:set-model", async (_e, input: string | { sessionId?: string; modelId: string; traceId?: string }) => {
			const payload = typeof input === "string" ? undefined : recordValue(input, "agent:set-model payload");
			const sessionId = payload?.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const modelId = requiredString(typeof input === "string" ? input : payload?.modelId, "modelId");
			const traceId = optionalString((typeof input === "string" ? undefined : payload?.traceId), "traceId") ?? generateTraceId();
			hostReceived("agent:set-model", traceId, sessionId);
			try {
				await awaitExtensionsBound();
				await assertPolicyModelAllowed(modelId);
				await agentHost.setModel(modelId, { traceId, sessionId });
				hostDispatched("agent:set-model", traceId, sessionId);
				return { ok: true, model: agentHost.getModel() };
			} catch (err) {
				hostFailed("agent:set-model", traceId, err);
				throw err;
			}
		});
		ipcMain.handle("agent:current-model", async () => agentHost.getModel());
		ipcMain.handle("agent:presets-list", async (_e, input?: unknown) => {
			const cwd = input === undefined || input === null ? agentHost.getCwd() : absolutePath(String(input), "cwd");
			return agentHost.listAgentPresets(cwd);
		});
		ipcMain.handle("agent:preset-current", async () => ({ id: agentHost.currentAgentPreset() }));
		ipcMain.handle("agent:preset-select", async (_e, input?: unknown) => {
			const payload = recordValue(input, "preset selection payload");
			const id = requiredString(payload.id, "id");
			return agentHost.selectAgentPreset(id);
		});
		ipcMain.handle("agent:preset-default-save", async (_e, input?: unknown) => {
			const payload = input === undefined || input === null ? {} : recordValue(input, "preset default payload");
			const id = payload.id === undefined || payload.id === null ? undefined : requiredString(payload.id, "id");
			return resources.writeAgentPresetDefault(id);
		});
		ipcMain.handle("agent:plugin-list", async () => agentHost.listPlugins());
		ipcMain.handle("agent:plugin-inventory", async () => agentHost.pluginInventory());
		ipcMain.handle("agent:tools-list", async () => {
			// Surface every tool the active pi runtime exposes (G-1d
			// compatibilityAdapter tools + built-in pi tools), tagged with
			// source + piPackageHint so the renderer can group / disable
			// them and the user can tell pi-native from openbuddy-styled.
			//
			// Classifier: a tool is "openbuddy" if any of these match —
			//   (a) G-1d adapter naming: `openbuddy_<verb>`
			//   (b) Cordis capability namespace: `calendar_`, `team_`,
			//       `buddy_`, `email_`, `mcp_` (see capability-plugins.ts)
			// Everything else is treated as a pi built-in / extension tool.
			const openbuddyPrefix = /^(openbuddy_|calendar_|team_|buddy_|email_|mcp_)/;
			const tools = agentHost.listTools();
			return tools.map((tool) => {
				const name = tool.name;
				const isOpenbuddyOrigin = openbuddyPrefix.test(name);
				return {
					name,
					label: tool.label,
					description: tool.description,
					source: isOpenbuddyOrigin ? "openbuddy" : "pi",
					piPackageHint: isOpenbuddyOrigin ? null : name,
				};
			});
		});
		ipcMain.handle("agent:plugin-snapshot", async () => agentHost.pluginSnapshot());
		ipcMain.handle("agent:plugin-readiness", async () => agentHost.pluginReadiness());
		ipcMain.handle("agent:deepseek-cordis-snapshot", async () => agentHost.deepSeekCordisSnapshot());
		ipcMain.handle("agent:deepseek-pi-describe", async () => agentHost.deepSeekPiBridgeDescription());
		ipcMain.handle("agent:deepseek-cordis-invoke", async (_e, args: unknown) => {
			const payload = recordValue(args, "DeepSeek Cordis invocation payload");
			return agentHost.invokeDeepSeekCordis({
				service: requiredString(payload.service, "service"),
				method: requiredString(payload.method, "method"),
				...(payload.args === undefined ? {} : { args: payload.args as readonly unknown[] | Record<string, unknown> }),
				...(payload.parameters === undefined ? {} : { parameters: payload.parameters as string[] }),
			});
		});
		ipcMain.handle("agent:profile-packages", async () => agentHost.profilePackages());
		ipcMain.handle("agent:profile-install", async (_e, args: unknown) => {
			const input = recordValue(args, "profile install payload");
			const source = input.source !== undefined
				? requiredString(input.source, "source")
				: absolutePath(input.sourcePath, "sourcePath");
			return agentHost.installProfileBundle(source);
		});
		// C6: Opt-in install of the curated default Pi package bundle. The
		// renderer UI calls this when the user presses "Enable Default Pi Bundle"
		// in OpenBuddyPluginPanel. Force flag re-installs already-present
		// packages, otherwise existing installs are skipped.
		ipcMain.handle("agent:profile-install-default-pi", async (_e, args: unknown) => {
			const input = recordValue(args, "profile install default pi payload") as { force?: unknown } | Record<string, unknown>;
			const force = (input as { force?: unknown }).force === true;
			return agentHost.installDefaultPiPackages({ force });
		});
		ipcMain.handle("agent:profile-remove", async (_e, args: unknown) => {
			const input = recordValue(args, "profile remove payload");
			await agentHost.removeProfileBundle(requiredString(input.name, "name"));
			return { ok: true };
		});
		ipcMain.handle("agent:plugin-events", async () => agentHost.pluginEvents());
		ipcMain.handle("agent:transaction-receipt", async (_e, args: unknown) => {
			const input = recordValue(args, "transaction-receipt payload");
			const transactionId = requiredString(input.transactionId, "transactionId");
			const surface = requiredString(input.surface, "surface");
			const details = input.details === undefined ? undefined : recordValue(input.details, "details");
			return agentHost.reportActivePluginTransaction(transactionId, surface, details);
		});
		ipcMain.handle("agent:transaction-list", async () => agentHost.listActivePluginTransactions());
		ipcMain.handle("agent:event-log", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "event log payload");
			return agentHost.pluginEvents({
				...(input.sessionId === undefined ? {} : { sessionId: requiredString(input.sessionId, "sessionId") }),
				...(input.sinceSequence === undefined ? {} : { sinceSequence: optionalFiniteInteger(input.sinceSequence, "sinceSequence", 0, 0, Number.MAX_SAFE_INTEGER) }),
				...(input.limit === undefined ? {} : { limit: optionalFiniteInteger(input.limit, "limit", 2000, 1, 2000) }),
			});
		});
		ipcMain.handle("agent:event-log-replay", async (_e, args?: unknown) => {
			// Cursor-based replay used after bridge recovery. Returns events
			// from `fromSequence` forward so the renderer can rehydrate
			// stores without a full reload. Gated by
			// OPENBUDDY_REPLAY_ON_SUBSCRIBE.
			const input = args === undefined || args === null ? {} : recordValue(args, "event-log-replay payload");
			const sessionId = requiredString(input.sessionId, "sessionId");
			const fromSequence = input.fromSequence === undefined ? 0 : optionalFiniteInteger(input.fromSequence, "fromSequence", 0, 0, Number.MAX_SAFE_INTEGER);
			const limit = input.limit === undefined ? 500 : optionalFiniteInteger(input.limit, "limit", 500, 1, 2000);
			const entries = await agentHost.pluginEvents({ sessionId, sinceSequence: fromSequence, limit });
			return { sessionId, fromSequence, count: Array.isArray(entries) ? entries.length : 0, entries };
		});
		ipcMain.handle("agent:plugin-enable", async (_e, args: { id: string; enabled: boolean }) => {
			const input = recordValue(args, "plugin-enable payload");
			return agentHost.setPluginEnabled(requiredString(input.id, "plugin id"), requiredBoolean(input.enabled, "enabled"));
		});
		ipcMain.handle("agent:plugin-reload", async (_e, args: { id: string }) => {
			return agentHost.reloadPlugin(requiredString(recordValue(args, "plugin-reload payload").id, "plugin id"));
		});
		ipcMain.handle("agent:extensions-reload", async () => agentHost.reloadPiExtensions());
		ipcMain.handle("agent:plugin-config", async (_e, args: { id: string; config: unknown }) => {
			const input = recordValue(args, "plugin-config payload");
			return agentHost.updatePluginConfig(requiredString(input.id, "plugin id"), input.config);
		});
		ipcMain.handle("agent:plugin-state-get", async () => {
			return agentHost.getStoredPluginState();
		});
		ipcMain.handle("agent:plugin-state-reset", async (_e, args: { id: string }) => {
			return agentHost.resetPluginState(requiredString(recordValue(args, "plugin-state-reset payload").id, "plugin id"));
		});
		ipcMain.handle("agent:renderer-plugin-entries", async () => agentHost.listRendererPluginEntries());
		ipcMain.handle("agent:renderer-plugin-boot", async () => agentHost.rendererPluginBootGraph());
		ipcMain.handle("agent:renderer-plugin-module", async (_e, args: unknown) => agentHost.resolveRendererPluginModule(requiredString(recordValue(args, "renderer plugin module payload").moduleKey, "moduleKey")));
		ipcMain.handle("agent:remote-contributions", async () => agentHost.listProfileRemoteContributions());
		ipcMain.handle("agent:init", async (_e, cwd?: string | { cwd?: string; traceId?: string }) => {
			const opts = typeof cwd === "object" && cwd !== null ? cwd : undefined;
			const normalizedCwd = (typeof cwd === "string" ? cwd : opts?.cwd) === undefined ? undefined : absolutePath(typeof cwd === "string" ? cwd : opts?.cwd, "cwd");
			const traceId = optionalString(opts?.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:init", traceId);
			try {
				await agentHost.init(normalizedCwd ? { cwd: normalizedCwd, traceId } : { traceId });
				const auth = await agentHost.authStatus();
				hostDispatched("agent:init", traceId);
				return {
					ok: true,
					cwd: agentHost.getCwd(),
					auth,
					agentVersion: process.versions.electron,
					defaultModelId: agentHost.getModel() ? `${agentHost.getModel()?.provider}/${agentHost.getModel()?.id}` : undefined,
				};
			} catch (err) {
				hostFailed("agent:init", traceId, err);
				throw err;
			}
		});
		ipcMain.handle("agent:dispose", async () => {
			await agentHost.dispose();
			return { ok: true };
		});
		ipcMain.handle("agent:resolve-permission", async (_e, args: { requestId: string; optionId?: string; cancelled?: boolean }) => {
			const input = recordValue(args, "permission response payload");
			const cancelled = input.cancelled === undefined ? false : requiredBoolean(input.cancelled, "cancelled");
			const optionId = input.optionId === undefined || input.optionId === null ? undefined : requiredString(input.optionId, "optionId");
			const value = cancelled || optionId === undefined || optionId === "deny" ? false : optionId === "allow_always" ? { decision: "allow_always" as const } : optionId === "allow" ? true : false;
			return { ok: agentHost.resolveUiRequest(requiredString(input.requestId, "requestId"), value) };
		});
		ipcMain.handle("agent:resolve-question", async (_e, args: { requestId: string; answers?: Record<string, string | string[]>; annotations?: Record<string, { preview?: string; notes?: string }>; cancelled?: boolean }) => {
			const input = recordValue(args, "question response payload");
			const cancelled = input.cancelled === undefined ? false : requiredBoolean(input.cancelled, "cancelled");
			const answers = input.answers === undefined ? {} : recordValue(input.answers, "answers");
			const annotations = input.annotations === undefined ? {} : recordValue(input.annotations, "annotations");
			const normalizedAnswers = Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string")) ? value : String(value)]));
			const normalizedAnnotations = Object.fromEntries(Object.entries(annotations).map(([key, value]) => [key, recordValue(value, `annotations.${key}`)]));
			return { ok: agentHost.resolveUiRequest(requiredString(input.requestId, "requestId"), cancelled ? undefined : { answers: normalizedAnswers as Record<string, string | string[]>, annotations: normalizedAnnotations as Record<string, { preview?: string; notes?: string }> }) };
		});
		ipcMain.handle("agent:auth-status", async () => {
			await ensureAgentHost();
			return agentHost.authStatus();
		});
		ipcMain.handle("agent:providers-list", async () => {
			await ensureAgentHost();
			return agentHost.providerCatalog();
		});
		ipcMain.handle("internal_reload", async (_event, args?: { kind?: string }) => {
			if (args !== undefined) recordValue(args, "internal_reload payload");
			await ensureAgentHost();
			if (args?.kind === "skills" || args?.kind === "mcp_all" || args?.kind === "mcp_project") await agentHost.reloadPiRuntime(`internal-reload:${args.kind}`);
			return { ok: true, kind: args?.kind ?? "unknown" };
		});
		ipcMain.handle("agents_list", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "agents list payload");
			return resources.listAgents(optionalCwd(input));
		});
		ipcMain.handle("agents_get", async (_e, args: { path: string; cwd?: string | null }) => {
			const input = recordValue(args, "agent get payload");
			return resources.getAgent(requiredString(input.path, "agent path"), input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("agents_save", async (_e, args: { name: string; raw: string; cwd?: string | null }) => {
			const input = recordValue(args, "agent save payload");
			return resources.saveAgent(requiredString(input.name, "agent name"), requiredString(input.raw, "agent content"), input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("agents_delete", async (_e, args: { path: string; cwd?: string | null }) => {
			const input = recordValue(args, "agent delete payload");
			return resources.deleteAgent(requiredString(input.path, "agent path"), input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("agents_template", async (_e, args: { name: string; description: string; systemPrompt: string }) => {
			const input = recordValue(args, "agent template payload");
			return resources.agentTemplate(requiredString(input.name, "agent name"), requiredString(input.description, "agent description"), requiredString(input.systemPrompt, "agent prompt"));
		});
		ipcMain.handle("agents_defaults_get", async () => resources.readAgentDefaults());
		ipcMain.handle("agents_defaults_save", async (_e, args: unknown) => {
			const input = recordValue(args, "agents defaults payload");
			const defaults = input.defaults === undefined ? {} : recordValue(input.defaults, "defaults");
			const patch: Partial<resources.AgentDefaults> = {};
			if (defaults.defaultModel !== undefined) patch.defaultModel = stringValue(defaults.defaultModel, "defaultModel");
			if (defaults.defaultPermission !== undefined) patch.defaultPermission = stringValue(defaults.defaultPermission, "defaultPermission");
			if (defaults.rememberToolApprovals !== undefined) patch.rememberToolApprovals = requiredBoolean(defaults.rememberToolApprovals, "rememberToolApprovals");
			return resources.writeAgentDefaults(patch);
		});
		ipcMain.handle("tasks_list", async () => agentHost.listRunningTasks());
		ipcMain.handle("task_kill", async (_e, args: { taskId: string }) => agentHost.killTask(requiredString(recordValue(args, "task kill payload").taskId, "task id")));
		ipcMain.handle("agent:load-session", async (_e, args: { sessionId: string; cwd: string; traceId?: string }) => {
			await ensureAgentHost();
			const input = recordValue(args, "load session payload");
			casdoorAuth.authorize({ capability: "team.workspace" });
			const sessionId = requiredString(input.sessionId, "session id");
			const traceId = optionalString(input.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:load-session", traceId, sessionId);
			try {
				const result = await agentHost.loadSession(sessionId, input.cwd ? absolutePath(input.cwd, "cwd") : "", { traceId, sessionId });
				hostDispatched("agent:load-session", traceId, sessionId);
				return result;
			} catch (err) {
				hostFailed("agent:load-session", traceId, err);
				throw err;
			}
		});
		ipcMain.handle("agent:session-info", async (_e, args: { sessionId: string }) => {
			await ensureAgentHost();
			casdoorAuth.authorize({ capability: "team.workspace" });
			try {
				return agentHost.sessionInfo(requiredString(recordValue(args, "session info payload").sessionId, "session id"));
			} catch (error) {
				if (error instanceof Error && /^Pi session is not loaded:/u.test(error.message)) return null;
				throw error;
			}
		});
		ipcMain.handle("agent:session-messages", async (_e, args: { sessionId: string }) => {
			await ensureAgentHost();
			casdoorAuth.authorize({ capability: "team.workspace" });
			const input = recordValue(args, "session messages payload");
			return agentHost.readSessionEntries(requiredString(input.sessionId, "session id"));
		});
		ipcMain.handle("agent:session-usage", async (_e, args: { sessionId: string }) => {
			await ensureAgentHost();
			casdoorAuth.authorize({ capability: "team.workspace" });
			try {
				return agentHost.sessionUsage(requiredString(recordValue(args, "session usage payload").sessionId, "session id"));
			} catch (error) {
				if (error instanceof Error && /^Pi session is not loaded:/u.test(error.message)) return null;
				throw error;
			}
		});
		ipcMain.handle("agent:session-metadata-clear", async () => {
			await agentHost.clearSessionMetadata();
			return { ok: true };
		});
		ipcMain.handle("agent:commands-list", async () => agentHost.listCommands());
		ipcMain.handle("agent:resource-inventory", async () => agentHost.resourceInventory());
		ipcMain.handle("prompt_history", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "prompt history payload");
			// P2-13: readPromptHistory lives in the memory module, which pulls
			// in SessionManager (Rust-backed NAPI). Lazy-load on demand.
			const { readPromptHistory } = await import("../agent/pi-resources/memory");
			return readPromptHistory(optionalFiniteInteger(input.limit, "limit", 100, 1, 500));
		});
		ipcMain.handle("session_search", async (_e, args: { query: string; cwd?: string | null; limit?: number | null }) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			const input = recordValue(args, "session search payload");
			// P2-13: searchSessions is in the memory module — same NAPI cost.
			const { searchSessions } = await import("../agent/pi-resources/memory");
			return searchSessions(requiredString(input.query, "query"), input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd"), optionalFiniteInteger(input.limit, "limit", 50, 1, 200));
		});
		ipcMain.handle("session_fork", async (_e, args: { sessionId: string; cwd?: string | null }) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			const input = recordValue(args, "session fork payload");
			const sessionId = requiredString(input.sessionId, "session id");
			const cwd = input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd");
			// P2-13: forkSession + forkSessionFromFile both live in memory.ts.
			const { forkSession, forkSessionFromFile } = await import("../agent/pi-resources/memory");
			try {
				return await forkSessionFromFile(await agentHost.sessionFile(sessionId) as any, cwd);
			} catch {
				return forkSession(sessionId, cwd);
			}
		});
		ipcMain.handle("rewind_points", async (_e, args: { sessionId: string }) => {
			// P2-13: rewindPoints lives in memory.ts — same NAPI cost.
			const { rewindPoints } = await import("../agent/pi-resources/memory");
			return rewindPoints(await agentHost.sessionFile(requiredString(recordValue(args, "rewind points payload").sessionId, "session id")));
		});
		ipcMain.handle("rewind_execute", async (_e, args: { sessionId: string; targetPromptIndex: number; mode?: string; force?: boolean }) => {
			const input = recordValue(args, "rewind execute payload");
			if (input.force !== undefined) requiredBoolean(input.force, "force");
			return agentHost.rewindSession(requiredString(input.sessionId, "session id"), optionalFiniteInteger(input.targetPromptIndex, "targetPromptIndex", -1, 0, 100000), input.mode === undefined ? undefined : requiredString(input.mode, "rewind mode"));
		});
		ipcMain.handle("permission_list", async () => {
			await ensureAgentHost();
			return (await import("@openbuddy/auth-permission")).permissionHandlers.readRules();
		});
		ipcMain.handle("permission_save", async (_e, args: { rules: unknown }) => {
			await ensureAgentHost();
			const input = recordValue(args, "permission_save payload");
			return (await import("@openbuddy/auth-permission")).permissionHandlers.writeRules(permissionRules(input.rules) as never);
		});
		// subagent config moved to pi-subagents (122k weekly downloads, native pi).
		ipcMain.handle("plugins_list", async () => {
			// P2-13: listPlugins lives in the heavy marketplace module.
			const { listPlugins } = await import("../agent/pi-resources/marketplace");
			return { plugins: await listPlugins(agentHost.getCwd()) };
		});
		ipcMain.handle("plugins_action", async (_e, args: unknown) => {
			const input = recordValue(args, "plugins action payload");
			const action = recordValue(input.action, "action");
			const pluginName = requiredString(action.pluginName, "pluginName");
			if (action.type === "enable" || action.type === "disable") {
				// P2-13: same lazy-load as plugins_list.
				const { setPluginEnabled } = await import("../agent/pi-resources/marketplace");
				await setPluginEnabled(pluginName, action.type === "enable");
				return agentHost.setPluginEnabled(pluginName, action.type === "enable");
			}
			if (action.type === "reload") return agentHost.reloadPlugin(pluginName);
			throw new Error(`unsupported plugin action: ${action.type ?? "unknown"}`);
		});
		ipcMain.handle("sessions:rename", async (_e, args: unknown) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			const input = recordValue(args, "session rename payload");
			return agentHost.renameSession(requiredString(input.sessionId, "sessionId"), requiredString(input.title, "title"), input.cwd === undefined ? agentHost.getCwd() : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("sessions:delete", async (_e, args: unknown) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			const input = recordValue(args, "session delete payload");
			return agentHost.deleteSession(requiredString(input.sessionId, "sessionId"), input.cwd === undefined ? agentHost.getCwd() : absolutePath(input.cwd, "cwd"));
		});
		ipcMain.handle("agent:providers-save-provider", async (_e, args: unknown) => {
			const input = recordValue(args, "provider save payload");
			const provider = recordValue(input.provider, "provider");
			const normalized = {
				...provider,
				id: providerId(provider.id),
				providerKind: requiredString(provider.providerKind, "providerKind"),
				...(provider.label === undefined ? {} : { label: requiredString(provider.label, "label") }),
				...(provider.apiKey === undefined ? {} : { apiKey: requiredString(provider.apiKey, "apiKey") }),
				...(provider.baseUrl === undefined ? {} : { baseUrl: httpUrl(provider.baseUrl, "baseUrl") }),
				...(provider.apiBackend === undefined ? {} : { apiBackend: enumValue(provider.apiBackend, "apiBackend", ["messages", "responses", "chat_completions"] as const) }),
				...(provider.authScheme === undefined ? {} : { authScheme: enumValue(provider.authScheme, "authScheme", ["bearer", "x_api_key"] as const) }),
				...(provider.contextWindow === undefined ? {} : { contextWindow: optionalFiniteInteger(provider.contextWindow, "contextWindow", 128000, 1, 10_000_000) }),
			};
			return agentHost.saveProvider(normalized);
		});
		ipcMain.handle("agent:providers-save-model", async (_e, args: unknown) => {
			const input = recordValue(args, "model save payload");
			const model = recordValue(input.model, "model");
			return agentHost.saveModel({
				...model,
				providerId: providerId(model.providerId),
				modelId: modelId(model.modelId),
				...(model.name === undefined ? {} : { name: requiredString(model.name, "name") }),
				...(model.contextWindow === undefined ? {} : { contextWindow: optionalFiniteInteger(model.contextWindow, "contextWindow", 128000, 1, 10_000_000) }),
				// `reasoning` gates the entire thinking-level surface. Pi's Model
				// type requires it, and `session.setThinkingLevel(...)` clamps any
				// request to "off" when the active model reports no reasoning
				// support — which silently kills the `agent_thought_chunk` channel
				// and the collapsible 深度思考 block for every custom provider that
				// omits it (e.g. a hand-added MiniMax-M3, which does reason).
				...(model.reasoning === undefined ? {} : { reasoning: Boolean(model.reasoning) }),
			});
		});
		ipcMain.handle("agent:providers-delete-provider", async (_e, args: unknown) => agentHost.deleteProvider(providerId(recordValue(args, "provider delete payload").id)));
		ipcMain.handle("agent:providers-delete-model", async (_e, args: unknown) => {
			const input = recordValue(args, "model delete payload");
			return agentHost.deleteModel(providerId(input.providerId), modelId(input.modelId));
		});
		ipcMain.handle("agent:providers-fetch-models", async (_e, args: unknown) => {
			const input = recordValue(args, "model discovery payload");
			const baseUrl = httpUrl(input.baseUrl, "baseUrl");
			const apiKey = requiredString(input.apiKey, "apiKey");
			const providerKind = optionalString(input.providerKind, "providerKind");
	        const isAnthropic = providerKind === "anthropic" || providerKind === "custom_anthropic" || providerKind === "minimax_cn";
			const headers: Record<string, string> = isAnthropic
				? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
				: { Authorization: `Bearer ${apiKey}` };
			const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { headers });
			if (!response.ok) throw new Error(`Model catalog request failed (${response.status})`);
			const payload = await response.json() as { data?: Array<{ id: string; owned_by?: string }> };
			return (payload.data ?? []).map((model) => ({ id: model.id, ownedBy: model.owned_by }));
		});
		ipcMain.handle("sessions:list", async (_e, cwd: string) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			await ensureAgentHost();
			return agentHost.listSessions(absolutePath(cwd, "cwd"));
		});
		ipcMain.handle("sessions:list-workspaces", async () => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			await ensureAgentHost();
			return agentHost.listWorkspaces();
		});
		ipcMain.handle("workspace:list", async () => {
			await ensureAgentHost();
			return { items: await agentHost.listWorkspaces(), archivedSessionIds: [...(agentHost.getContext()?.get("workspaceRegistry") as { archivedSessionIds?: readonly string[] } | undefined)?.archivedSessionIds ?? []] };
		});
		ipcMain.handle("workspace:create", async (_e, args: unknown) => {
			try {
				await ensureAgentHost();
				const input = recordValue(args, "workspace create payload");
				return await agentHost.createWorkspace(absolutePath(input.path, "path"), input.title === undefined ? undefined : requiredString(input.title, "title"));
			} catch (error) {
				throwWorkspaceIpcError(error);
			}
		});
		ipcMain.handle("workspace:rename", async (_e, args: unknown) => {
			try {
				await ensureAgentHost();
				const input = recordValue(args, "workspace rename payload");
				return { workspace: await agentHost.renameWorkspace(requiredString(input.workspaceId, "workspaceId"), requiredString(input.title, "title")) };
			} catch (error) {
				throwWorkspaceIpcError(error);
			}
		});
		ipcMain.handle("workspace:delete", async (_e, args: unknown) => {
			try {
				await ensureAgentHost();
				const input = recordValue(args, "workspace delete payload");
				return { deleted: await agentHost.deleteWorkspace(requiredString(input.workspaceId, "workspaceId")) };
			} catch (error) {
				throwWorkspaceIpcError(error);
			}
		});
		ipcMain.handle("workspace:insert-before", async (_e, args: unknown) => {
			try {
				await ensureAgentHost();
				const input = recordValue(args, "workspace reorder payload");
				return { workspaceIds: await agentHost.insertWorkspaceBefore(requiredString(input.workspaceId, "workspaceId"), input.beforeWorkspaceId === undefined ? undefined : requiredString(input.beforeWorkspaceId, "beforeWorkspaceId")) };
			} catch (error) {
				throwWorkspaceIpcError(error);
			}
		});
		ipcMain.handle("workspace:insert-session-before", async (_e, args: unknown) => {
			try {
				await ensureAgentHost();
				const input = recordValue(args, "workspace session reorder payload");
				return { workspace: await agentHost.insertWorkspaceSessionBefore(requiredString(input.workspaceId, "workspaceId"), requiredString(input.sessionId, "sessionId"), input.beforeSessionId === undefined ? undefined : requiredString(input.beforeSessionId, "beforeSessionId")) };
			} catch (error) {
				const input = recordValue(args, "workspace session reorder payload");
				throwWorkspaceIpcError(error, {
					workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : "",
					sessionId: typeof input.sessionId === "string" ? input.sessionId : "",
					...(typeof input.beforeSessionId === "string" ? { beforeSessionId: input.beforeSessionId } : {}),
				});
			}
		});
		ipcMain.handle("workspace:archive-session", async (_e, args: unknown) => {
			try {
				await ensureAgentHost();
				const input = recordValue(args, "workspace archive payload");
				return { archivedSessionIds: await agentHost.archiveWorkspaceSession(requiredString(input.sessionId, "sessionId"), input.archived === undefined ? true : requiredBoolean(input.archived, "archived")) };
			} catch (error) {
				throwWorkspaceIpcError(error);
			}
		});
		ipcMain.handle("sessions:set-pinned", async (_e, args: { id: string; pinned: boolean }) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			await ensureAgentHost();
			const input = recordValue(args, "session pin payload");
			return agentHost.setSessionPinned(requiredString(input.id, "session id"), requiredBoolean(input.pinned, "pinned"));
		});
		ipcMain.handle("sessions:set-archived", async (_e, args: { id: string; archived: boolean }) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			await ensureAgentHost();
			const input = recordValue(args, "session archive payload");
			return agentHost.setSessionArchived(requiredString(input.id, "session id"), requiredBoolean(input.archived, "archived"));
		});
		// R2.5 — bulk archive/unarchive for the Sidebar's 恢复全部 / 归档全部 actions.
		ipcMain.handle("sessions:set-all-archived", async (_e, args: { archived: boolean }) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			await ensureAgentHost();
			const input = recordValue(args, "bulk archive payload");
			return agentHost.setAllArchived(requiredBoolean(input.archived, "archived"));
		});
		ipcMain.handle("sessions:set-expert", async (_e, args: { id: string; expertId?: string; expertName?: string; avatarLocal?: string }) => {
			casdoorAuth.authorize({ capability: "team.workspace" });
			await ensureAgentHost();
			const input = recordValue(args, "session expert payload");
			const id = requiredString(input.id, "session id");
			const binding = input.expertId && input.expertName
				? { expertId: requiredString(input.expertId, "expert id"), expertName: requiredString(input.expertName, "expert name"), avatarLocal: optionalString(input.avatarLocal, "avatarLocal") }
				: null;
			return agentHost.setSessionExpert(id, binding);
		});
		ipcMain.handle("pi_set_session_expert", async (_e, args: { sessionId: string; expertId: string; expertName: string; avatarLocal?: string }) => {
			const input = recordValue(args, "session expert payload");
			await awaitExtensionsBound();
			return agentHost.setSessionExpert(requiredString(input.sessionId, "session id"), { expertId: requiredString(input.expertId, "expert id"), expertName: requiredString(input.expertName, "expert name"), avatarLocal: optionalString(input.avatarLocal, "avatarLocal") });
		});
		ipcMain.handle("pi_clear_session_expert", async (_e, args: { sessionId: string }) => {
			await awaitExtensionsBound();
			return agentHost.setSessionExpert(requiredString(recordValue(args, "session expert payload").sessionId, "session id"), null);
		});
		// subagent config IPC moved to pi-subagents; capability.snapshot no longer ships capability.subagents.
}

// R1 — content-based prompt (text + image). Mirrors the renderer `piSendContent`
// surface. The session-bound guard matches `agent:prompt` and the same trace
// telemetry envelope (received → dispatched / failed) is reused so log queries
// stay uniform.
		ipcMain.handle("agent:prompt-content", async (_e, input: { sessionId?: string; content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }>; mode?: "queue" | "steer"; traceId?: string }) => {
			const payload = recordValue(input, "agent:prompt-content payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			const content = promptContent(payload.content, "content");
			hostReceived("agent:prompt-content", traceId, sessionId);
			try {
				// Reuse the existing promptContent IPC bridge in the harness RPC
				// router. The agent-host wrapper does the typed dispatch and
				// re-validates the content shape, so we go through `session.prompt`
				// (available via dispatchHarnessRpc) rather than re-implementing.
				const ctx = agentHost.getContext() as { get?: (k: string) => { promptContent?: (parts: readonly unknown[], mode?: "queue" | "steer") => Promise<{ itemId?: string }> } | undefined } | undefined;
				const piSession = ctx?.get?.("piSession");
				if (!piSession?.promptContent) throw new Error("Pi session prompt is unavailable");
				await awaitExtensionsBound();
				const result = await piSession.promptContent(content, payload.mode === "steer" ? "steer" : "queue");
				hostDispatched("agent:prompt-content", traceId, sessionId);
				return { ok: true, itemId: result?.itemId };
			} catch (err) {
				hostFailed("agent:prompt-content", traceId, err);
				throw err;
			}
		});

// R1 — set thinking level (off / low / medium / high). Pi persists
// thinking_level_change to the session tree; we expose it as a top-level IPC so
// the renderer topbar segmented control can drive it without going through a
// command.
		ipcMain.handle("agent:set-thinking-level", async (_e, input: { sessionId?: string; level: "off" | "low" | "medium" | "high"; traceId?: string }) => {
			const payload = recordValue(input, "agent:set-thinking-level payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			const level = thinkingLevel(payload.level, "level");
			hostReceived("agent:set-thinking-level", traceId, sessionId);
			try {
				const ctx = agentHost.getContext() as { get?: (k: string) => { setThinkingLevel?: (l: "off" | "low" | "medium" | "high") => Promise<"off" | "low" | "medium" | "high"> } | undefined } | undefined;
				const piSession = ctx?.get?.("piSession");
				if (!piSession?.setThinkingLevel) throw new Error("Pi session setThinkingLevel is unavailable");
				// Pi clamps the requested level to the active model's capabilities, so
				// the returned value may differ from the requested one (e.g. "high"
				// downgraded to "medium"). Surface the *actual* level so the renderer's
				// optimistic UI and the persisted session entry stay in sync.
				const applied = await piSession.setThinkingLevel(level);
				hostDispatched("agent:set-thinking-level", traceId, sessionId);
				return { ok: true, level: applied };
			} catch (err) {
				hostFailed("agent:set-thinking-level", traceId, err);
				throw err;
			}
		});

// R1 — set public permission mode (default / acceptEdits / dontAsk / plan /
// bypassPermissions). Mirrors Pi's `setMode`. The Cordis-backed permission
// store (openbuddy/auth-permission) is the single source of truth on disk;
// the in-memory mode is wired through the same plugin so that Pi's tool
// interceptor and the OpenBuddy permission rules see a consistent view.
		ipcMain.handle("agent:set-permission-mode", async (_e, input: { sessionId?: string; mode: "default" | "acceptEdits" | "dontAsk" | "plan" | "bypassPermissions"; traceId?: string }) => {
			const payload = recordValue(input, "agent:set-permission-mode payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			const mode = publicPermissionMode(payload.mode, "mode");
			hostReceived("agent:set-permission-mode", traceId, sessionId);
			try {
				const handlers = (await import("@openbuddy/auth-permission")).permissionHandlers;
				// writeMode takes the PermissionMode string directly (not an object).
				handlers.writeMode(mode as never);
				hostDispatched("agent:set-permission-mode", traceId, sessionId);
				return { ok: true, mode };
			} catch (err) {
				hostFailed("agent:set-permission-mode", traceId, err);
				throw err;
			}
		});

// R1 - workspace search for the @-mention picker in the Composer.
		ipcMain.handle("agent:workspace-search", async (_e, input: { query: string; cwd: string; limit?: number; kinds?: Array<"file" | "folder" | "symbol">; traceId?: string }) => {
			const payload = recordValue(input, "agent:workspace-search payload");
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			const cwd = absolutePath(payload.cwd, "cwd");
			hostReceived("agent:workspace-search", traceId);
			try {
				const { workspaceSearch } = await import("../agent/workspace-search");
				const kinds = Array.isArray(payload.kinds)
					? (payload.kinds.filter((k): k is "file" | "folder" | "symbol" => k === "file" || k === "folder" || k === "symbol"))
					: undefined;
				const result = await workspaceSearch(requiredString(payload.query, "query"), {
					cwd,
					limit: optionalFiniteInteger(payload.limit, "limit", 30, 1, 100),
					kinds,
				});
				hostDispatched("agent:workspace-search", traceId);
				return { hits: result.hits, duration_ms: result.duration_ms, source: result.source };
			} catch (err) {
				hostFailed("agent:workspace-search", traceId, err);
				throw err;
			}
		});
