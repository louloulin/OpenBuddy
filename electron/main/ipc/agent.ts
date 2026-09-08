/**
 * IPC surface — agent domain.
 *
 * Split out of `./index.ts`.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { agentHost, bindRendererEventEmitter, ensureAgentHostLoaded } from "./agent-host-proxy";
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
// Phase B.1 round 3 — per-capability IPC modules. Each owns a self-contained
// subset of the handlers that used to live in this file's giant
// registerAgentIpc() body.
import { registerPresetIpc } from "./preset";
import { registerTaskIpc } from "./task";
import { registerPermissionIpc } from "./permission";
import { registerSessionMiscIpc } from "./session-misc";
import { registerAgentInfoIpc } from "./agent-info";
import { registerPluginIpc } from "./plugin";
import { registerProfileIpc } from "./profile";
import { registerDeepSeekIpc } from "./deepseek";
import { registerProvidersIpc } from "./providers";
import { registerModelIpc } from "./model";
import { registerCompactionIpc } from "./compaction";

// A-5: AbortSignal plumbing for prompt/steer/follow-up.
//
// The most recent in-flight request per sessionId is registered here so
// `agent:abort` can cancel it without the renderer needing to round-trip
// a controller through the IPC channel (AbortSignal is not
// structured-cloneable). The map is keyed by sessionId so concurrent
// sessions each have their own cancel target. A handler clears its own
// entry once the request resolves.
const inflightAbortControllers = new Map<string, AbortController>();

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
		await ensureAgentHostLoaded();
		await agentHost.waitUntilReady();
	};

	// Phase B.1 round 3 — per-capability IPC modules receive a deps bag
	// so the local closures of ensureAgentHost / casdoorAuth / agentHost
	// are still accessible to handlers that live in their own files.
	// Each module returns immediately and registers its own subset.
	const sharedDeps = {
		agentHost,
		casdoorAuth,
		ensureAgentHost,
		awaitExtensionsBound,
		inflightAbortControllers,
		getWindow,
	};
	registerPresetIpc(sharedDeps);
	registerTaskIpc(sharedDeps);
	registerPermissionIpc(sharedDeps);
	registerSessionMiscIpc(sharedDeps);
	registerAgentInfoIpc(sharedDeps);
	registerPluginIpc(sharedDeps);
	registerProfileIpc(sharedDeps);
	registerDeepSeekIpc(sharedDeps);
	registerProvidersIpc(sharedDeps);
	registerModelIpc(sharedDeps);
	registerCompactionIpc(sharedDeps);

		ipcMain.handle("agent:new-session", async (_e, input?: string | { cwd?: string; modelId?: string; traceId?: string }) => {
			await ensureAgentHost();
			const payload = typeof input === "string" ? undefined : recordValue(input, "agent:new-session payload");
			// preload allows {modelId}-only payloads; fall back to the active cwd.
			const cwd = typeof input === "string"
				? absolutePath(input, "cwd")
				: payload?.cwd === undefined || payload?.cwd === null ? agentHost.getCwd() : absolutePath(payload.cwd, "cwd");
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
			await ensureAgentHost();
			const payload = typeof input === "string" ? undefined : recordValue(input, "agent:ensure-new-session payload");
			const cwd = typeof input === "string"
				? absolutePath(input, "cwd")
				: payload?.cwd === undefined || payload?.cwd === null ? agentHost.getCwd() : absolutePath(payload.cwd, "cwd");
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
			await ensureAgentHost();
			const payload = typeof input === "string" ? undefined : recordValue(input, "agent:prompt payload");
			const sessionId = payload?.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			const activeSessionId = agentHost.getSession()?.sessionId;
			if (sessionId !== undefined && sessionId !== activeSessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const text = requiredString(typeof input === "string" ? input : payload?.text, "prompt");
			const traceId = optionalString((typeof input === "string" ? undefined : payload?.traceId), "traceId") ?? generateTraceId();
			hostReceived("agent:prompt", traceId, sessionId);
			// A-5: register a per-request AbortController so agent:abort can
			// cancel the in-flight prompt. If an earlier prompt is still
			// running for the same session, abort it first (back-pressure).
			const key = activeSessionId ?? traceId;
			inflightAbortControllers.get(key)?.abort();
			const controller = new AbortController();
			inflightAbortControllers.set(key, controller);
			try {
				await awaitExtensionsBound();
				await agentHost.prompt(text, { traceId, sessionId, signal: controller.signal });
				hostDispatched("agent:prompt", traceId, sessionId);
				return { ok: true };
			} catch (err) {
				hostFailed("agent:prompt", traceId, err);
				throw err;
			} finally {
				if (inflightAbortControllers.get(key) === controller) inflightAbortControllers.delete(key);
			}
		});
		ipcMain.handle("agent:steer", async (_e, input: { sessionId?: string; text: string; traceId?: string }) => {
			await ensureAgentHost();
			const payload = recordValue(input, "agent:steer payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:steer", traceId, sessionId);
			const key = sessionId ?? traceId;
			inflightAbortControllers.get(key)?.abort();
			const controller = new AbortController();
			inflightAbortControllers.set(key, controller);
			try {
				await awaitExtensionsBound();
				await agentHost.steer(requiredString(payload.text, "text"), { traceId, sessionId, signal: controller.signal });
				hostDispatched("agent:steer", traceId, sessionId);
				return { ok: true };
			} catch (err) {
				hostFailed("agent:steer", traceId, err);
				throw err;
			} finally {
				if (inflightAbortControllers.get(key) === controller) inflightAbortControllers.delete(key);
			}
		});
		ipcMain.handle("agent:follow-up", async (_e, input: { sessionId?: string; text: string; traceId?: string }) => {
			await ensureAgentHost();
			const payload = recordValue(input, "agent:follow-up payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:follow-up", traceId, sessionId);
			const key = sessionId ?? traceId;
			inflightAbortControllers.get(key)?.abort();
			const controller = new AbortController();
			inflightAbortControllers.set(key, controller);
			try {
				await awaitExtensionsBound();
				await agentHost.followUp(requiredString(payload.text, "text"), { traceId, sessionId, signal: controller.signal });
				hostDispatched("agent:follow-up", traceId, sessionId);
				return { ok: true };
			} catch (err) {
				hostFailed("agent:follow-up", traceId, err);
				throw err;
			} finally {
				if (inflightAbortControllers.get(key) === controller) inflightAbortControllers.delete(key);
			}
		});
		ipcMain.handle("agent:abort", async (_e, input?: { sessionId?: string; traceId?: string }) => {
			await ensureAgentHost();
			let sessionId: string | undefined;
			const traceId = optionalString(input?.traceId, "traceId") ?? generateTraceId();
			if (input !== undefined) {
				const payload = recordValue(input, "agent:abort payload");
				sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
				if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			}
			hostReceived("agent:abort", traceId, sessionId);
			// A-5: abort the in-flight controller for this session (or traceId)
			// and delegate the heavier abort to the existing agentHost.abort.
			const key = sessionId ?? agentHost.getSession()?.sessionId ?? traceId;
			const inflight = inflightAbortControllers.get(key);
			inflight?.abort();
			if (inflight) inflightAbortControllers.delete(key);
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
			await ensureAgentHost();
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
			return agentHost.setSessionExpert(requiredString(recordValue(args, "session expert payload").sessionId, "session id"), null);
		});

// ─────────────────────────────────────────────────────────────────────
		// Phase 8.3 Batch D-11 — pi-web RPC API parity.
		// Each handler below corresponds to one method on the pi-web
		// `RpcClient` (see node_modules/@earendil-works/pi-coding-agent/dist/
		// modes/rpc/rpc-client.d.ts). The agentHost facade forwards them to
		// `host-modules/pi-session-capabilities.ts`.
		// ─────────────────────────────────────────────────────────────────────

		ipcMain.handle("agent:compact", async (_e, input?: { sessionId?: string; customInstructions?: string; traceId?: string }) => {
			await ensureAgentHost();
			const payload = input === undefined ? {} : recordValue(input, "agent:compact payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:compact", traceId, sessionId);
			try {
				await awaitExtensionsBound();
				const customInstructions = payload.customInstructions === undefined ? undefined : optionalString(payload.customInstructions, "customInstructions");
				const result = await agentHost.compact(customInstructions);
				hostDispatched("agent:compact", traceId, sessionId);
				return { ok: true, result };
			} catch (err) {
				hostFailed("agent:compact", traceId, err);
				throw err;
			}
		});

		ipcMain.handle("agent:set-auto-compaction", async (_e, input: { sessionId?: string; enabled: boolean; traceId?: string }) => {
			await ensureAgentHost();
			const payload = recordValue(input, "agent:set-auto-compaction payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:set-auto-compaction", traceId, sessionId);
			try {
				agentHost.setAutoCompaction(requiredBoolean(payload.enabled, "enabled"));
				hostDispatched("agent:set-auto-compaction", traceId, sessionId);
				return { ok: true, enabled: requiredBoolean(payload.enabled, "enabled") };
			} catch (err) {
				hostFailed("agent:set-auto-compaction", traceId, err);
				throw err;
			}
		});

		ipcMain.handle("agent:set-auto-retry", async (_e, input: { sessionId?: string; enabled: boolean; traceId?: string }) => {
			await ensureAgentHost();
			const payload = recordValue(input, "agent:set-auto-retry payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:set-auto-retry", traceId, sessionId);
			try {
				agentHost.setAutoRetry(requiredBoolean(payload.enabled, "enabled"));
				hostDispatched("agent:set-auto-retry", traceId, sessionId);
				return { ok: true, enabled: requiredBoolean(payload.enabled, "enabled") };
			} catch (err) {
				hostFailed("agent:set-auto-retry", traceId, err);
				throw err;
			}
		});

		ipcMain.handle("agent:abort-retry", async (_e, input?: { sessionId?: string; traceId?: string }) => {
			await ensureAgentHost();
			const payload = input === undefined ? {} : recordValue(input, "agent:abort-retry payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:abort-retry", traceId, sessionId);
			try {
				agentHost.abortRetry();
				hostDispatched("agent:abort-retry", traceId, sessionId);
				return { ok: true };
			} catch (err) {
				hostFailed("agent:abort-retry", traceId, err);
				throw err;
			}
		});

		ipcMain.handle("agent:abort-bash", async (_e, input?: { sessionId?: string; traceId?: string }) => {
			await ensureAgentHost();
			const payload = input === undefined ? {} : recordValue(input, "agent:abort-bash payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:abort-bash", traceId, sessionId);
			try {
				agentHost.abortBash();
				hostDispatched("agent:abort-bash", traceId, sessionId);
				return { ok: true };
			} catch (err) {
				hostFailed("agent:abort-bash", traceId, err);
				throw err;
			}
		});

		ipcMain.handle("agent:set-steering-mode", async (_e, input: { sessionId?: string; mode: "all" | "one-at-a-time"; traceId?: string }) => {
			await ensureAgentHost();
			const payload = recordValue(input, "agent:set-steering-mode payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:set-steering-mode", traceId, sessionId);
			try {
				agentHost.setSteeringMode(stringValue(payload.mode, "mode") as "all" | "one-at-a-time");
				hostDispatched("agent:set-steering-mode", traceId, sessionId);
				return { ok: true, mode: payload.mode };
			} catch (err) {
				hostFailed("agent:set-steering-mode", traceId, err);
				throw err;
			}
		});

		ipcMain.handle("agent:set-follow-up-mode", async (_e, input: { sessionId?: string; mode: "all" | "one-at-a-time"; traceId?: string }) => {
			await ensureAgentHost();
			const payload = recordValue(input, "agent:set-follow-up-mode payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			hostReceived("agent:set-follow-up-mode", traceId, sessionId);
			try {
				agentHost.setFollowUpMode(stringValue(payload.mode, "mode") as "all" | "one-at-a-time");
				hostDispatched("agent:set-follow-up-mode", traceId, sessionId);
				return { ok: true, mode: payload.mode };
			} catch (err) {
				hostFailed("agent:set-follow-up-mode", traceId, err);
				throw err;
			}
		});


		ipcMain.handle("agent:fork-session", async (_e, input: { sessionId?: string; entryId: string; traceId?: string }) => {
			await ensureAgentHost();
			const payload = recordValue(input, "agent:fork-session payload");
			const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
			if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
			const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
			const entryId = requiredString(payload.entryId, "entryId");
			hostReceived("agent:fork-session", traceId, sessionId);
			try {
				const result = await agentHost.forkSession(entryId);
				hostDispatched("agent:fork-session", traceId, sessionId);
				return result;
			} catch (err) {
				hostFailed("agent:fork-session", traceId, err);
				throw err;
			}
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
