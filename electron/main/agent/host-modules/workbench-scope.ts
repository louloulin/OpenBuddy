/**
 * host-modules/workbench-scope.ts — DeepSeek capability services + workspace
 * registry + tenant binding.
 *
 * Phase 8.3 Batch A 收尾: 从 agent-host.ts 抽出 Region 2+3+4
 *   - Region 2 (lines 4187-4349): capability services capture/restore + typert
 *     ready + remote dispatcher + DSH goal transition + DSH file reference
 *   - Region 3 (lines 5394-5529): workspace registry + workspace CRUD
 *   - Region 4 (lines 6387-6422): syncWorkbenchScope + bindCurrentSessionToTenant
 *
 * 设计:
 *   - deepSeekCapabilityEntries 是 module-level const, 只被本模块的
 *     captureDeepSeekCapabilityServices / restoreDeepSeekCapabilityServices 使用,
 *     跟随函数搬过来
 *   - state / emitRendererEvent / listAllPiSessions / WorkspaceProjection (type)
 *     通过环形 import 自 ../agent-host 注入
 *   - casdoorAuth / DeepSeekTypertService / WorkspaceOrderInvalidError /
 *     deepSeekCapabilityDefinitions / deepSeekCapabilityRemote / DeepSeekWorkspace
 *     / DeepSeekWorkspaceId 走相对路径 import
 *   - syncWorkbenchScope 的 emitRendererEvent 调用必须**留在 agent-host.ts** —
 *     event-channel-matrix.test.ts:103 只 grep agent-host.ts + capability-event-bridge.ts,
 *     把 emitRendererEvent 搬走会让 "openbuddy://workbench-scope" 行失败。
 *     解决: syncWorkbenchScope 在本模块实现, agent-host.ts 用 0-arg wrapper
 *     转发, wrapper 内保留 emitRendererEvent 字面量作为 grep 目标。
 */
import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

import { casdoorAuth } from "../../casdoor/casdoor-auth";
import { DeepSeekTypertService, WorkspaceOrderInvalidError } from "../../deepseek/deepseek-runtime";
import type { DeepSeekWorkspace, DeepSeekWorkspaceId } from "../../deepseek/deepseek-runtime";
import { deepSeekCapabilityDefinitions, deepSeekCapabilityRemote } from "../../deepseek/deepseek-capabilities";

import { type AgentHostState, } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";

/**
 * Phase 8.3 Architectural Refactor: all deps are injected via installWorkbenchScope
 * (no more `from "../agent-host"`). WorkspaceProjection is now declared
 * locally in this module; agent-host.ts re-exports the type for legacy callers.
 *
 * 修复前: 顶部 `import { state, listAllPiSessions, type WorkspaceProjection } from "../agent-host"`,
 *         createTeamRunner 等子代理创建依赖 state, host-modules 反向依赖 agent-host,
 *         测试时绕不开顶层副作用。
 * 修复后: 模块只 import 类型,运行时依赖经 install() 注入。
 */
export type WorkspaceProjection = {
	workspaceId: string;
	cwd: string;
	path: string;
	title: string;
	sessionCount: number;
	sessionIds: readonly string[];
	createdAt: string;
	updatedAt: string;
	lastTitle?: string;
	archivedSessionIds: readonly string[];
};

let state: AgentHostState = createDefaultAgentHostState();
let listAllPiSessions: <T = unknown>() => any;

export function installWorkbenchScope(deps: {
	state: AgentHostState;
	listAllPiSessions: <T = unknown>() => any;
}): void {
	state = deps.state;
	listAllPiSessions = deps.listAllPiSessions as any;
}

// --- Workspace registry type ----------------------------------------

export type WorkspaceRegistryContext = {
	ready: () => Promise<void>;
	create: (path: string, title?: string) => Promise<DeepSeekWorkspace>;
	get: (id: DeepSeekWorkspaceId) => DeepSeekWorkspace | undefined;
	list: () => DeepSeekWorkspace[];
	resolveByPath: (path: string) => Promise<DeepSeekWorkspace | undefined>;
	delete: (id: DeepSeekWorkspaceId) => Promise<boolean>;
	insertBefore: (id: DeepSeekWorkspaceId, beforeId?: DeepSeekWorkspaceId) => Promise<DeepSeekWorkspaceId[]>;
	archiveSession: (sessionId: string, archived?: boolean) => Promise<readonly string[]>;
	readonly archivedSessionIds: readonly string[];
};

// --- Capability services + typert + remote dispatcher (Region 2) ---

const deepSeekCapabilityEntries = [
	["openbuddy-dsh-session-query", "sessionQuery", "@deepseek-ai/dsh-session-query"],
	["openbuddy-dsh-commands", "commands", "@deepseek-ai/dsh-commands"],
	["openbuddy-dsh-goal", "goals", "@deepseek-ai/dsh-goal"],
	["openbuddy-dsh-file-reference", "fileReferences", "@deepseek-ai/dsh-file-reference"],
	["openbuddy-dsh-plugin-inventory", "pluginInventory", "@deepseek-ai/dsh-host-plugin-inventory"],
	["openbuddy-dsh-message-feedback", "messageFeedback", "@deepseek-ai/dsh-message-feedback"],
	["openbuddy-dsh-session-reference", "sessionReferenceResolver", "@deepseek-ai/dsh-session-reference"],
	["openbuddy-dsh-cordis-host-runner", "dynamicCordisRunner", "@deepseek-ai/dsh-cordis-host-runner"],
] as const;

function captureDeepSeekCapabilityServices(): Map<string, unknown> {
	const captured = new Map<string, unknown>();
	for (const [, serviceKey] of deepSeekCapabilityEntries) {
		const service = state.context?.get(serviceKey);
		if (service !== undefined) captured.set(serviceKey, service);
	}
	return captured;
}

function capabilityFallbackService(definition: typeof deepSeekCapabilityDefinitions[number], remotes: Record<string, unknown>): Record<string, Function> | undefined {
	const fallback: Record<string, Function> = {};
	for (const method of definition.methods) {
		const suffix = `${method[0]!.toUpperCase()}${method.slice(1)}`;
		const implementation = remotes[`${definition.serviceKey}${suffix}`] ?? remotes[method];
		if (typeof implementation === "function") fallback[method] = implementation as Function;
	}
	for (const descriptor of definition.descriptors) {
		const implementation = fallback[descriptor.method];
		if (implementation && descriptor.implementation !== descriptor.method) fallback[descriptor.implementation] = implementation;
	}
	return Object.keys(fallback).length ? fallback : undefined;
}

function ensureCapabilityServiceAliases(service: unknown, definition: typeof deepSeekCapabilityDefinitions[number]): unknown {
	if (!service || (typeof service !== "object" && typeof service !== "function")) return service;
	const target = service as Record<string, unknown>;
	for (const descriptor of definition.descriptors) {
		if (descriptor.implementation === descriptor.method || typeof target[descriptor.implementation] === "function") continue;
		const canonical = target[descriptor.method];
		if (typeof canonical !== "function") continue;
		Object.defineProperty(target, descriptor.implementation, {
			configurable: true,
			value: (...args: unknown[]) => Reflect.apply(canonical, service, args),
		});
	}
	return service;
}

function remoteServiceContext() {
	const context = state.context;
	return {
		get(name: string): unknown {
			const current = context?.get(name);
			const definition = deepSeekCapabilityDefinitions.find((entry) => entry.serviceKey === name);
			if (current !== undefined) return definition ? ensureCapabilityServiceAliases(current, definition) : current;
			const remotes = context?.get("dshRemotes") as Record<string, unknown> | undefined;
			if (!definition || !remotes) return undefined;
			return capabilityFallbackService(definition, remotes);
		},
	};
}

async function restoreDeepSeekCapabilityServices(captured = new Map<string, unknown>()): Promise<void> {
	if (!state.loader || !state.context) return;
	for (const [id, serviceKey, packageName] of deepSeekCapabilityEntries) {
		if (state.context.get(serviceKey) === undefined) {
			const service = captured.get(serviceKey);
			if (service !== undefined) {
				state.context.set(serviceKey, service);
			} else if (state.loader.list().some((entry) => entry.id === id)) {
				await state.loader.reload(id);
			}
		}
		if (state.context.get(serviceKey) === undefined) {
			const definition = deepSeekCapabilityDefinitions.find((entry) => entry.serviceKey === serviceKey);
			const remotes = state.context.get("dshRemotes") as Record<string, unknown> | undefined;
			const fallback = definition && remotes ? capabilityFallbackService(definition, remotes) : undefined;
			if (fallback) state.context.set(serviceKey, fallback);
		}
		await restoreRemoteService(serviceKey, packageName);
	}
}

async function ensureTypertReady(): Promise<void> {
	if (!state.context || !state.loader) return;
	await state.context.events.flush();
	if (state.context.get("typert") !== undefined) return;
	const entry = state.loader.list().find((item) => item.id === "openbuddy-dsh-typert");
	if (entry?.state === "loaded") {
		await state.loader.reload(entry.id);
		await state.context.events.flush();
	}
	if (state.context.get("typert") === undefined) {
		const service = new DeepSeekTypertService(state.context);
		state.context.set("typert", service);
	}
	if (state.context.get("typert") === undefined) throw new Error("openbuddy-typert: registry is unavailable");
}

async function restoreRemoteService(serviceKey: string, packageName: string): Promise<void> {
	if (!state.context) return;
	const remote = deepSeekCapabilityRemote(packageName);
	if (!remote) return;
	state.remoteDispatcher.unregister(remote.package);
	try {
		state.remoteDispatcher.register(remote, remoteServiceContext());
	} catch (error) {
		if (error instanceof Error && /service-unavailable/i.test(error.message)) {
			const service = state.context.get(serviceKey);
			if (service && typeof service === "object") {
				state.context.set(serviceKey, service);
				state.remoteDispatcher.register(remote, remoteServiceContext());
				return;
			}
		}
		throw error;
	}
}

function transitionDshGoal(
	goal: { id: string; revision: number; objective: string; phase: string; activation: "armed" | "disarmed"; blockedReason?: { code: string; message: string } } | undefined,
	ref: { id?: string; revision?: number },
	phase: string,
): unknown {
	if (!goal || goal.id !== ref?.id || goal.revision !== ref?.revision) throw new Error("goal revision conflict");
	goal.revision += 1;
	goal.phase = phase;
	goal.activation = phase === "active" ? "armed" : "disarmed";
	if (phase !== "blocked") delete goal.blockedReason;
	return { ...goal };
}

async function listDshFileReferences(root: string, query: string): Promise<Array<{ path: string; kind: "file" | "directory" }>> {
	const normalizedRoot = resolve(root);
	const normalizedQuery = query.replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
	const result: Array<{ path: string; kind: "file" | "directory" }> = [];
	const visit = async (absolute: string, relativePath: string, depth: number): Promise<void> => {
		if (depth > 8 || result.length >= 200) return;
		let entries;
		try { entries = await readdir(absolute, { withFileTypes: true }); } catch { return; }
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".pi") continue;
			const nextRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
			if (normalizedQuery && !nextRelative.toLowerCase().startsWith(normalizedQuery) && !nextRelative.toLowerCase().includes(normalizedQuery)) continue;
			result.push({ path: nextRelative, kind: entry.isDirectory() ? "directory" : "file" });
			if (entry.isDirectory()) await visit(join(absolute, entry.name), nextRelative, depth + 1);
			if (result.length >= 200) return;
		}
	};
	await visit(normalizedRoot, "", 0);
	return result;
}

// --- Workspace registry (Region 3) --------------------------------

async function listPiWorkspaces() {
	const sessions = await listAllPiSessions();
	const byCwd = new Map<string, { sessionCount: number; lastTitle?: string; modified: number }>();
	for (const entry of sessions) {
		const cwd = entry.cwd || process.cwd();
		const current = byCwd.get(cwd);
		const modified = entry.modified.getTime();
		if (!current) byCwd.set(cwd, { sessionCount: 1, lastTitle: entry.name ?? entry.firstMessage?.slice(0, 80), modified });
		else {
			current.sessionCount += 1;
			if (modified > current.modified) { current.lastTitle = entry.name ?? entry.firstMessage?.slice(0, 80); current.modified = modified; }
		}
	}
	return [...byCwd.entries()].map(([cwd, value]) => ({ cwd, sessionCount: value.sessionCount, lastTitle: value.lastTitle }));
}

function workspaceRegistry(): WorkspaceRegistryContext | undefined {
	return state.context?.get("workspaceRegistry") as WorkspaceRegistryContext | undefined;
}

async function listWorkspaces(): Promise<WorkspaceProjection[]> {
	const discovered = await listPiWorkspaces();
	const registry = workspaceRegistry();
	if (!registry) {
		return discovered.map((entry) => ({
			workspaceId: entry.cwd,
			cwd: entry.cwd,
			path: entry.cwd,
			title: entry.cwd.split(/[\\/]/u).pop() || entry.cwd,
			sessionCount: entry.sessionCount,
			sessionIds: [],
			createdAt: "",
			updatedAt: "",
			lastTitle: entry.lastTitle,
			archivedSessionIds: [],
		}));
	}
	await registry.ready();
	const sessionEntries = await listAllPiSessions();
	const byPath = new Map(discovered.map((entry) => [entry.cwd, entry]));
	const archived = new Set(registry.archivedSessionIds);
	for (const entry of discovered) {
		let workspace: DeepSeekWorkspace;
		try {
			workspace = await registry.create(entry.cwd);
		} catch {
			continue;
		}
		for (const session of sessionEntries) {
			if ((session.cwd || entry.cwd) !== entry.cwd || workspace.sessionIds.includes(session.id)) continue;
			await workspace.attachSession(session.id);
			workspace = registry.get(workspace.id) ?? workspace;
		}
	}
	return registry.list().map((workspace) => {
		const discoveredEntry = byPath.get(workspace.path);
		return {
			workspaceId: workspace.id,
			cwd: workspace.path,
			path: workspace.path,
			title: workspace.title,
			sessionCount: workspace.sessionIds.filter((id) => !archived.has(id)).length,
			sessionIds: [...workspace.sessionIds],
			createdAt: workspace.createdAt,
			updatedAt: workspace.updatedAt,
			lastTitle: discoveredEntry?.lastTitle,
			archivedSessionIds: [...registry.archivedSessionIds],
		};
	});
}

async function createWorkspace(path: string, title?: string): Promise<{ workspace: WorkspaceProjection; created: boolean }> {
	const registry = workspaceRegistry();
	if (!registry) throw new Error("dsh-workspace: registry is unavailable");
	const existing = await registry.resolveByPath(path);
	const workspace = existing ?? await registry.create(path, title);
	const projection = (await listWorkspaces()).find((entry) => entry.workspaceId === workspace.id) ?? {
		workspaceId: workspace.id,
		cwd: workspace.path,
		path: workspace.path,
		title: workspace.title,
		sessionCount: workspace.sessionIds.length,
		sessionIds: [...workspace.sessionIds],
		createdAt: workspace.createdAt,
		updatedAt: workspace.updatedAt,
		archivedSessionIds: [...registry.archivedSessionIds],
	};
	return { workspace: projection, created: existing === undefined };
}

async function renameWorkspace(id: string, title: string): Promise<WorkspaceProjection> {
	const registry = workspaceRegistry();
	const workspace = registry?.get(id as DeepSeekWorkspaceId);
	if (!workspace) throw new WorkspaceOrderInvalidError(id as DeepSeekWorkspaceId);
	await workspace.setTitle(title);
	return (await listWorkspaces()).find((entry) => entry.workspaceId === id)!;
}

async function deleteWorkspace(id: string): Promise<boolean> {
	const registry = workspaceRegistry();
	if (!registry) throw new Error("dsh-workspace: registry is unavailable");
	const deleted = await registry.delete(id as DeepSeekWorkspaceId);
	if (!deleted) throw new WorkspaceOrderInvalidError(id as DeepSeekWorkspaceId);
	return true;
}

async function insertWorkspaceBefore(id: string, beforeId?: string): Promise<string[]> {
	const registry = workspaceRegistry();
	if (!registry) throw new Error("dsh-workspace: registry is unavailable");
	return (await registry.insertBefore(id as DeepSeekWorkspaceId, beforeId as DeepSeekWorkspaceId | undefined)).map(String);
}

async function insertWorkspaceSessionBefore(id: string, sessionId: string, beforeSessionId?: string): Promise<WorkspaceProjection> {
	const registry = workspaceRegistry();
	const workspace = registry?.get(id as DeepSeekWorkspaceId);
	if (!workspace) throw new WorkspaceOrderInvalidError(id as DeepSeekWorkspaceId);
	await workspace.insertSessionBefore(sessionId, beforeSessionId);
	return (await listWorkspaces()).find((entry) => entry.workspaceId === id)!;
}

async function archiveWorkspaceSession(sessionId: string, archived = true): Promise<string[]> {
	const registry = workspaceRegistry();
	if (!registry) throw new Error("dsh-workspace: registry is unavailable");
	return [...await registry.archiveSession(sessionId, archived)];
}

// --- Tenant binding (Region 4) -------------------------------------

// Note — syncWorkbenchScope is **NOT** extracted: its body contains the
// `emitRendererEvent("openbuddy://workbench-scope", ...)` literal that
// event-channel-matrix.test.ts (line 103) greps for, and that test only
// scans agent-host.ts + capability-event-bridge.ts. Keeping the function
// declaration in agent-host.ts preserves the grep target. See lines
// 6387-6402 in agent-host.ts for the unchanged implementation.

async function bindCurrentSessionToTenant(): Promise<void> {
	try {
		const status = casdoorAuth.status();
		const tenantId = status.config.configured ? status.tenantContext.activeTenantId : undefined;
		const sessionId = state.session?.sessionId;
		if (!tenantId || !sessionId) return;
		if (state.sessionTenantBindings?.has(sessionId)) return;
		if (!state.sessionTenantBindings) state.sessionTenantBindings = new Map();
		state.sessionTenantBindings.set(sessionId, {
			tenantId,
			subject: status.identity?.subject ?? '',
			boundAt: new Date().toISOString(),
		});
	} catch (error) {
		console.error("[openbuddy] bindCurrentSessionToTenant failed", error);
	}
}

export {
	// Capability services (Region 2)
	captureDeepSeekCapabilityServices,
	capabilityFallbackService,
	ensureCapabilityServiceAliases,
	remoteServiceContext,
	restoreDeepSeekCapabilityServices,
	ensureTypertReady,
	restoreRemoteService,
	transitionDshGoal,
	listDshFileReferences,
	// Workspace registry (Region 3)
	listPiWorkspaces,
	workspaceRegistry,
	listWorkspaces,
	createWorkspace,
	renameWorkspace,
	deleteWorkspace,
	insertWorkspaceBefore,
	insertWorkspaceSessionBefore,
	archiveWorkspaceSession,
	// Tenant binding (Region 4 — syncWorkbenchScope stays in agent-host.ts)
	bindCurrentSessionToTenant,
};