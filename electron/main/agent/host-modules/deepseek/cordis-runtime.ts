/**
 * host-modules/deepseek/cordis-runtime.ts — DeepSeek Cordis runtime.
 *
 * Phase 8.3 Batch A 收尾: 从 agent-host.ts 抽出 Region 1b (lines 1336-1657),
 * 围绕 DeepSeek Cordis runtime + bundle helpers (deepSeekCoreRuntimeEntries /
 * normalizeDeepSeekRuntimeEntry / filterPublishedCoreBundle / allowDeepSeekCordisInvocation
 * / createDeepSeekPiToolPlugin / syncDeepSeekCordisRuntime / isDeepSeekCorePackage /
 * currentSessionProjection)。
 *
 * 设计:
 *   - DEEPSEEK_CORE_PACKAGE_NAMES + deepSeekCordisInvocationMethods 是 module-level
 *     const, 只被本模块的 isDeepSeekCorePackage / allowDeepSeekCordisInvocation 使用,
 *     跟随函数搬过来
 *   - state / emitPluginEvent / prompt / abort / listSessions / listSubagentChildren /
 *     promptSubagent / interruptSubagent / listWorkspaces / currentSessionProjection /
 *     piHome 通过环形 import 自 ../../agent-host 注入 — 已由 lifecycle.ts:9-11 +
 *     harness-cursors.ts:23 验证可行
 *   - 来自 profile/* + deepseek/* + @openbuddy/plugin-host 的工具/类型 import 走
 *     相对路径 (../../../deepseek/...、../../../@openbuddy/plugin-host)
 */
import { join } from "node:path";

import { type PluginBundle, type PluginEntryOptions, DeepSeekCordisRuntime, type DeepSeekCordisPluginEntry, type DeepSeekCordisRuntimeSnapshot } from "@openbuddy/plugin-host";

import type { AgentHostState } from "../_state-shape";

/**
 * Phase 8.3 Architectural Refactor: deepseek/cordis-runtime 反向依赖消除。
 *
 * 修复前: state / emitPluginEvent / prompt / abort / listSessions /
 *         listSubagentChildren / promptSubagent / interruptSubagent /
 *         piHome / profileArtifactModuleUrl 通过 `from "../../agent-host"`
 *         反向依赖 agent-host.ts。
 * 修复后: 运行时依赖通过 installDeepSeekCordisRuntime() 注入,模块仅 import 类型。
 */

let state: AgentHostState;
let emitPluginEvent: (type: string, payload: unknown) => void;
let promptFn: any;
let abortFn: any;
let listSessions: (cwd: string) => Promise<readonly unknown[]>;
let listSubagentChildren: (parentSessionId: string) => Promise<readonly unknown[]>;
let promptSubagent: (
	parentSessionId: string,
	childSessionId: string,
	parts: readonly unknown[],
) => Promise<unknown>;
let interruptSubagent: (parentSessionId: string, childSessionId: string) => Promise<unknown>;
let piHome: () => string;
let profileArtifactModuleUrl: (id: string) => string;

export function installDeepSeekCordisRuntime(deps: {
	state: AgentHostState;
	emitPluginEvent: (type: string, payload: unknown) => void;
	prompt: (text: string) => Promise<unknown>;
	abort: () => Promise<unknown> | unknown;
	listSessions: (cwd: string) => Promise<readonly unknown[]>;
	listSubagentChildren: (parentSessionId: string) => Promise<readonly unknown[]>;
	promptSubagent: (
		parentSessionId: string,
		childSessionId: string,
		parts: readonly unknown[],
	) => Promise<unknown>;
	interruptSubagent: (parentSessionId: string, childSessionId: string) => Promise<unknown>;
	piHome: () => string;
	profileArtifactModuleUrl: (id: string) => string;
}): void {
	state = deps.state;
	emitPluginEvent = deps.emitPluginEvent;
	promptFn = deps.prompt;
	abortFn = deps.abort;
	listSessions = deps.listSessions;
	listSubagentChildren = deps.listSubagentChildren;
	promptSubagent = deps.promptSubagent;
	interruptSubagent = deps.interruptSubagent;
	piHome = deps.piHome;
	profileArtifactModuleUrl = deps.profileArtifactModuleUrl;
}
import { listWorkspaces } from "../workbench-scope";
import { SubprocessRuntime, SandboxPolicyService, SandboxRuntime } from "../../../deepseek/subprocess-runtime";
import { createDeepSeekExecutionAdapter, provideDeepSeekExecutionServices, DEEPSEEK_EXECUTION_PACKAGES } from "../../../deepseek/deepseek-execution-adapters";
import { resolveDeepSeekModule } from "../../../deepseek/deepseek-compat";
import { createDeepSeekPiBridge, createDeepSeekPiLlmInterceptor, createDeepSeekPiToolInterceptor, type DeepSeekPiBridgeRuntime } from "../../../deepseek/deepseek-pi-bridge";
import { createDeepSeekPiCapabilityRuntime } from "../../../deepseek/deepseek-pi-capabilities";
import { artifactPackageJsonByName } from "../profile/paths";
import { createProfileArtifactResolvers } from "../../profile-artifact-resolution";

// --- Bundles / entries ------------------------------------------------------

const DEEPSEEK_CORE_PACKAGE_NAMES = new Set([
	"@deepseek-ai/dsh-typert-registry",
	"@deepseek-ai/dsh-system-prompt",
	"@deepseek-ai/dsh-llm",
	"@deepseek-ai/dsh-session",
	"@deepseek-ai/dsh-agent",
	"@deepseek-ai/dsh-tools",
	"@deepseek-ai/dsh-subagent",
	"@deepseek-ai/dsh-web",
]);

const deepSeekCordisInvocationMethods: Readonly<Record<string, readonly string[]>> = {
	pi: ["get", "listSessions", "listPersistedSessions", "listProviders", "listModels", "complete", "listTools", "executeTool", "prompt", "abort", "invokeCapability"],
	typert: ["get", "list", "getPackage", "listPackages", "toJSONSchema", "revision"],
	systemPrompt: ["list", "sections", "render"],
	llm: ["listProviders", "listModels", "resolveModelInfo", "discoverModels", "complete"],
	sessions: ["get", "list", "create", "load", "listPersisted", "history", "info", "usage", "selectModel"],
	session: ["get", "list", "create", "load", "listPersisted", "history", "info", "usage", "selectModel"],
	agents: ["get", "list", "currentInitiator"],
	tools: ["schemas", "execute"],
	subagents: ["list", "getProvider", "run"],
	web: ["search", "fetch", "status"],
};

function isDeepSeekCorePackage(name: string): boolean {
	return DEEPSEEK_CORE_PACKAGE_NAMES.has(name);
}

function allowDeepSeekCordisInvocation(service: string, method: string): boolean {
	return deepSeekCordisInvocationMethods[service]?.includes(method) ?? false;
}

function normalizeDeepSeekRuntimeEntry<T extends { id: string; name: string; config?: unknown }>(entry: T): T {
	if (entry.name === "@deepseek-ai/cordis-plugin-hmr" && (!entry.config || typeof entry.config !== "object" || !("root" in entry.config))) {
		return { ...entry, config: { root: ["."] } };
	}
	if (entry.name === "@deepseek-ai/dsh-session-persistence-jsonl" && (!entry.config || typeof entry.config !== "object" || !("root" in entry.config))) {
		return { ...entry, config: { root: join(piHome(), "sessions") } };
	}
	if ((entry.id === "tool-fs-search" || entry.id === "openbuddy-dsh-tool-fs-search")
		&& (!entry.config || typeof entry.config !== "object" || !("sampleOverCapGlobResults" in entry.config))) {
		return { ...entry, config: { sampleOverCapGlobResults: false } };
	}
	if ((entry.id === "agent-default-model" || entry.id === "openbuddy-dsh-agent-default-model")
		&& (!entry.config || typeof entry.config !== "object"
			|| typeof (entry.config as { provider?: unknown }).provider !== "string"
			|| !(entry.config as { model?: unknown }).model
			|| typeof (entry.config as { model?: unknown }).model !== "string")) {
		return { ...entry, config: { provider: "pi", model: "default" } };
	}
	if ((entry.id === "tool-subagent" || entry.id === "openbuddy-dsh-tool-subagent")
		&& (!entry.config || typeof entry.config !== "object" || typeof (entry.config as { provider?: unknown }).provider !== "string")) {
		return { ...entry, config: { provider: "spawn", toolName: "subagent", backgroundMode: "continuable" } };
	}
	return entry;
}

function deepSeekCoreRuntimeEntries(profileEntries: readonly { id: string; name: string; config?: unknown; disabled?: boolean }[] = []): Array<{ id: string; name: string; config?: unknown; disabled?: boolean }> {
	const coreIds = new Set(["typert", "systemPrompt", "llm", "session", "agent", "tools", "subagent", "web"]);
	const core = [
		["typert", "@deepseek-ai/dsh-typert-registry"],
		["systemPrompt", "@deepseek-ai/dsh-system-prompt"],
		["llm", "@deepseek-ai/dsh-llm"],
		["session", "@deepseek-ai/dsh-session"],
		["agent", "@deepseek-ai/dsh-agent"],
		["tools", "@deepseek-ai/dsh-tools"],
		["subagent", "@deepseek-ai/dsh-subagent"],
		["web", "@deepseek-ai/dsh-web"],
	].map(([id, name]) => ({ id, name }));
	const extra = profileEntries
		.filter((entry) => !coreIds.has(entry.id) && !isDeepSeekCorePackage(entry.name))
		.filter((entry) => entry.name.startsWith("@deepseek-ai/") || entry.name.startsWith("@cordisjs/"))
		.map((entry) => normalizeDeepSeekRuntimeEntry({ ...entry }));
	const merged = new Map<string, { id: string; name: string; config?: unknown; disabled?: boolean }>();
	for (const entry of [...core, ...extra]) merged.set(entry.id, entry);
	return [...merged.values()];
}

function filterPublishedCoreBundle(bundle: PluginBundle): PluginBundle {
	const coreIds = new Set(["typert", "systemPrompt", "llm", "session", "agent", "tools", "subagent", "web"]);
	const normalizeEntry = (entry: PluginEntryOptions): PluginEntryOptions => {
		if (entry.id === "hmr" && (!entry.config || typeof entry.config !== "object" || !("root" in entry.config))) {
			return { ...entry, config: { root: ["."] } };
		}
		if (entry.id === "session-persistence-jsonl" && (!entry.config || typeof entry.config !== "object" || !("root" in entry.config))) {
			return { ...entry, config: { root: join(piHome(), "sessions") } };
		}
		if ((entry.id === "tool-fs-search" || entry.id === "openbuddy-dsh-tool-fs-search")
			&& (!entry.config || typeof entry.config !== "object" || !("sampleOverCapGlobResults" in entry.config))) {
			return { ...entry, config: { sampleOverCapGlobResults: false } };
		}
		return entry;
	};
	const entries = bundle.entries.filter((entry) => !coreIds.has(entry.id) && !isDeepSeekCorePackage(entry.name)).map(normalizeEntry);
	const patches = (bundle.patches ?? []).map((layer) => layer.flatMap((patch) => {
		if (patch.insert !== undefined) {
			const inserts = Array.isArray(patch.insert) ? patch.insert : [patch.insert];
			const filtered = inserts.filter((entry) => !coreIds.has(entry.id) && !isDeepSeekCorePackage(entry.name));
			if (!filtered.length) return [];
			return [{ ...patch, insert: Array.isArray(patch.insert) ? filtered.map(normalizeEntry) : normalizeEntry(filtered[0]!) }];
		}
		if ((patch.id !== undefined && coreIds.has(patch.id)) || (patch.name !== undefined && isDeepSeekCorePackage(patch.name))) {
			return [];
		}
		if (patch.id === "hmr" && patch.config === undefined) return [{ ...patch, config: { root: ["."] } }];
		if (patch.id === "session-persistence-jsonl" && patch.config === undefined) return [{ ...patch, config: { root: join(piHome(), "sessions") } }];
		if (patch.id === "tool-fs-search" && patch.config === undefined) return [{ ...patch, config: { sampleOverCapGlobResults: false } }];
		if (patch.id === "tool-subagent" && patch.config === undefined) {
			return [{ ...patch, config: { provider: "spawn", toolName: "subagent", backgroundMode: "continuable" } }];
		}
		return [patch];
	}));
	return { entries, patches };
}

// --- Runtime wiring ------------------------------------------------------

function currentSessionProjection(): Record<string, unknown> | undefined {
	const session = state.session;
	if (!session) return undefined;
	return {
		sessionId: session.sessionId,
		...(state.cwd ? { cwd: state.cwd } : {}),
		...(state.model?.id ? { modelId: state.model.id } : {}),
	};
}

function createDeepSeekPiToolPlugin(runtime: DeepSeekPiBridgeRuntime): (context: unknown) => void | (() => void | Promise<void>) {
	return (context) => {
		const target = context as { get?: (name: string, strict?: boolean) => unknown };
		const tools = target.get?.("tools") as {
			register?: (definition: unknown) => () => void;
			get?: (name: string) => unknown;
		} | undefined;
		if (!tools?.register) return undefined;
		const register = tools.register;
		let disposers: Array<() => void> = [];
		const sync = (): void => {
			for (const dispose of disposers.reverse()) dispose();
			disposers = [];
			for (const tool of state.toolRegistry.list()) {
				if (typeof tools.get === "function" && tools.get(tool.name) !== undefined) continue;
				try {
					const dispose = register({
						name: tool.name,
						description: tool.description,
						parameters: tool.parameters,
						output: {
							schema: {},
							render: (_args: unknown, value: unknown) => [{ type: "text", text: JSON.stringify(value) ?? String(value) }],
						},
						execute: async (args: unknown, exec: { signal: AbortSignal }) => {
							const result = await runtime.executeTool(tool.name, args, exec.signal);
							return result && typeof result === "object" && "details" in result
								? (result as { details: unknown }).details
								: result;
						},
					});
					if (typeof dispose === "function") disposers.push(dispose);
				} catch (error) {
					console.warn(`[openbuddy] failed to register Pi tool in DeepSeek registry: ${tool.name}`, error);
				}
			}
		};
		sync();
		state.deepSeekPiToolSync = sync;
		return () => {
			if (state.deepSeekPiToolSync === sync) state.deepSeekPiToolSync = null;
			for (const dispose of disposers.reverse()) dispose();
			disposers = [];
		};
	};
}

async function syncDeepSeekCordisRuntime(entries: readonly { id: string; name: string; config?: unknown; disabled?: boolean }[]): Promise<void> {
	const cwd = state.cwd ?? process.cwd();
	const packageJsonByName = await artifactPackageJsonByName(state.profilePackagePaths, state.cwd);
	if (!packageJsonByName.has("@deepseek-ai/dsh-base")) {
		if (state.deepSeekCordisRuntime) {
			state.deepSeekCordisSnapshot = await state.deepSeekCordisRuntime.dispose();
			state.deepSeekCordisRuntime = null;
		}
		state.deepSeekCordisSnapshot = null;
		return;
	}
	const cordisPackageJson = packageJsonByName.get("@deepseek-ai/cordis");
	if (!cordisPackageJson) {
		if (state.deepSeekCordisRuntime) {
			state.deepSeekCordisSnapshot = await state.deepSeekCordisRuntime.dispose();
			state.deepSeekCordisRuntime = null;
		}
		state.deepSeekCordisSnapshot = null;
		return;
	}
	const resolvers = createProfileArtifactResolvers({
		packageJsonByName,
		profilePackageJson: state.profilePackageJson,
	});
	const importer = async (specifier: string): Promise<unknown> => {
		const compatibilityModule = resolveDeepSeekModule(specifier);
		if (compatibilityModule !== undefined) return compatibilityModule;
		const packageJson = packageJsonByName.get(specifier) ?? await resolvers.resolvePackageJson(specifier);
		packageJsonByName.set(specifier, packageJson);
		return import(/* @vite-ignore */ profileArtifactModuleUrl(await resolvers.resolveModule(specifier, packageJson)));
	};
	const cordisModule = await importer("@deepseek-ai/cordis");
	const runtimeEntries: DeepSeekCordisPluginEntry[] = [];
	for (const entry of entries) {
		if (resolveDeepSeekModule(entry.name) !== undefined) {
			runtimeEntries.push(entry as DeepSeekCordisPluginEntry);
			continue;
		}
		try {
			const packageJson = await resolvers.resolvePackageJson(entry.name);
			await resolvers.resolveModule(entry.name, packageJson);
			runtimeEntries.push(entry as DeepSeekCordisPluginEntry);
		} catch {
			/* skip entries whose modules cannot be resolved */
		}
	}
	const executionServices = {
		subprocess: state.subprocessRuntime ?? new SubprocessRuntime(),
		sandboxPolicy: state.context?.get("sandboxPolicy") as SandboxPolicyService ?? new SandboxPolicyService({ workspaceRoot: cwd }),
		sandbox: state.context?.get("sandbox") as SandboxRuntime ?? new SandboxRuntime(),
		owned: false,
	};
	const piBridgeRuntime: DeepSeekPiBridgeRuntime = {
		getSession: () => {
			const session = state.session;
			return session ? { sessionId: session.sessionId, cwd: state.cwd ?? undefined, modelId: state.model?.id } : undefined;
		},
		listPersistedSessions: (cwd) => listSessions(cwd).then((items) => items),
		getProviders: () => state.modelRuntime?.getProviders().map((provider) => ({ id: provider.id, name: provider.name })) ?? [],
		getModels: (provider) => state.modelRuntime?.getModels(provider) ?? [],
		getModel: (provider, model) => state.modelRuntime?.getModel(provider, model),
		getCurrentModel: () => state.model,
		listTools: () => state.toolRegistry.list().map((tool) => ({ name: tool.name, label: tool.label, description: tool.description })),
		executeTool: async (name, argumentsValue, signal) => {
			const tool = state.toolRegistry.list().find((candidate) => candidate.name === name);
			if (!tool) throw new Error(`pi bridge: tool is unavailable: ${name}`);
			const session = state.session;
			if (!session) throw new Error("pi bridge: AgentSession is not ready");
			const result = await tool.execute(
				`deepseek-cordis:${name}:${Date.now().toString(36)}`,
				argumentsValue,
				signal,
				undefined,
				session.extensionRunner.createContext(),
			);
			return { content: result.content, details: result.details, ...(result.usage ? { usage: result.usage } : {}) };
		},
		prompt: promptFn,
		abort: abortFn,
		capability: createDeepSeekPiCapabilityRuntime({
			session: {
				get: () => currentSessionProjection(),
				list: (cwd, _context) => listSessions(cwd),
				listWorkspaces: (_context) => listWorkspaces(),
			},
			subagent: {
				list: (parentSessionId, _context) => listSubagentChildren(parentSessionId),
				prompt: (parentSessionId, childSessionId, text, _context) => promptSubagent(parentSessionId, childSessionId, [{ type: "text", text }]),
				interrupt: (parentSessionId, childSessionId, _context) => interruptSubagent(parentSessionId, childSessionId),
			},
		}, {
			onAudit: (entry) => emitPluginEvent("deepseek-cordis/pi-capability", entry),
		}),
	};
	const nextRuntime = new DeepSeekCordisRuntime({
		cordisModule,
		importer: async (specifier) => {
			const executionAdapter = DEEPSEEK_EXECUTION_PACKAGES.has(specifier)
				? createDeepSeekExecutionAdapter(specifier, executionServices)
				: undefined;
			if (executionAdapter) return { default: executionAdapter };
			return importer(specifier);
		},
		bootstrap: (context) => {
			const target = context as {
				provide?: (name: string, value: unknown) => unknown;
				on?: (name: string, listener: (...args: any[]) => unknown, options?: unknown) => () => unknown;
			};
			if (typeof target.provide !== "function") throw new Error("deepseek-cordis: Context.provide is unavailable for Pi bridge");
			const disposers: Array<() => unknown> = [];
			const executionCleanup = provideDeepSeekExecutionServices(target, executionServices);
			disposers.push(executionCleanup);
			const provided = target.provide("pi", createDeepSeekPiBridge(piBridgeRuntime));
			if (typeof provided === "function") disposers.push(provided as () => unknown);
			const sessionsProvided = target.provide("sessions", {
				list: () => piBridgeRuntime.listPersistedSessions(cwd),
			});
			if (typeof sessionsProvided === "function") disposers.push(sessionsProvided as () => unknown);
			if (typeof target.on === "function") {
				const disposeLlm = target.on("llm/stream", createDeepSeekPiLlmInterceptor(piBridgeRuntime), { prepend: true });
				if (typeof disposeLlm === "function") disposers.push(disposeLlm);
				const disposeTools = target.on("tools/execute", createDeepSeekPiToolInterceptor(piBridgeRuntime), { prepend: true });
				if (typeof disposeTools === "function") disposers.push(disposeTools);
			}
			return async () => {
				for (const dispose of disposers.reverse()) await dispose();
			};
		},
		onPluginActive: (context, entry) => entry.name === "@deepseek-ai/dsh-tools"
			? createDeepSeekPiToolPlugin(piBridgeRuntime)(context)
			: undefined,
		allowInvocation: allowDeepSeekCordisInvocation,
		onEvent: (type, payload) => emitPluginEvent(`deepseek-cordis/${type}`, payload),
	});
	let nextSnapshot: DeepSeekCordisRuntimeSnapshot;
	try {
		nextSnapshot = await nextRuntime.load(runtimeEntries);
	} catch (error) {
		await nextRuntime.dispose().catch((disposeError) => {
			console.warn("[openbuddy] failed to dispose rejected DeepSeek Cordis runtime", disposeError);
		});
		throw error;
	}
	const previousRuntime = state.deepSeekCordisRuntime;
	state.deepSeekCordisRuntime = nextRuntime;
	state.deepSeekCordisSnapshot = nextSnapshot;
	state.deepSeekPiToolSync?.();
	await previousRuntime?.dispose();
	emitPluginEvent("deepseek-cordis/snapshot", state.deepSeekCordisSnapshot);
}

export {
	createDeepSeekPiToolPlugin,
	syncDeepSeekCordisRuntime,
	deepSeekCoreRuntimeEntries,
	normalizeDeepSeekRuntimeEntry,
	filterPublishedCoreBundle,
	allowDeepSeekCordisInvocation,
	isDeepSeekCorePackage,
	currentSessionProjection,
};