/**
 * host-modules/harness-cursors.ts — harness cursor store + session command /
 * skill / resource inventory surface.
 *
 * Phase 8.3 Batch A: 从 agent-host.ts 抽出 line 4156-4174 (listCommands),
 * 5303-5392 (harness cursor store + resume token), 5601-5717 (listSkills +
 * resourceInventory)。
 *
 * 设计:
 *   - harnessResumeTokenWrite / harnessCursorWrite 是 module-level 串行化队列,
 *     必须在模块内部保留 (agent-host.ts 不可访问)
 *   - state / piHome / isPathWithin 通过环形 import 自 ../agent-host 注入
 *   - 没有事件发送 — 调用方 (agentHost aggregate 路径) 仍由 agent-host.ts
 *     统一调度 emitRendererEvent
 */
import { readFile, mkdir, writeFile, rename, rm, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

import { HarnessCursorStore } from "@openbuddy/storage";

// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { state, piHome, isPathWithin } from "../agent-host"` (reverse dep)
//   修复后: 这三个依赖通过 installHarnessCursors() 在 agent-host.ts:initialize()
//   中一次性注入, 本模块不再 import agent-host. 内部函数继续使用 module-level
//   bindings (state / piHome / isPathWithin), 避免对每个函数签名加 DI 参数.
import { piHome as _piHome, isPathWithin as _isPathWithin } from "./_host-paths";
import { type AgentHostState } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";

let state: AgentHostState = createDefaultAgentHostState();
let piHome: () => string = () => process.env.PI_HOME ?? process.env.PI_CODING_AGENT_DIR ?? homedir();
let isPathWithin: (root: string, candidate: string) => boolean = () => false;

/**
 * Bind the harness-cursors module's dependencies. Called once from
 * agent-host.ts:initialize() so this module never needs to import
 * agent-host. Idempotent.
 */
export function installHarnessCursors(deps: {
  state: AgentHostState;
  piHome: () => string;
  isPathWithin: (root: string, candidate: string) => boolean;
}): void {
  state = deps.state;
  piHome = deps.piHome;
  isPathWithin = deps.isPathWithin;
}
import { listProfilePackages } from "@openbuddy/plugin-host";
import { hookConfigSummary } from "../agent-hooks";

// --- Harness cursor store + resume token ------------------------------------

function harnessCursorPath(): string {
	return join(piHome(), "openbuddy-harness-cursors.json");
}

function getHarnessCursorStore(): HarnessCursorStore {
	state.harnessCursorStore ??= new HarnessCursorStore(join(piHome(), "openbuddy.sqlite"));
	return state.harnessCursorStore;
}

function harnessResumeTokenPath(): string {
	return join(piHome(), "openbuddy-harness-resume-token");
}

async function getHarnessResumeToken(): Promise<string | undefined> {
	try {
		return (await readFile(harnessResumeTokenPath(), "utf8")).trim() || undefined;
	} catch {
		return undefined;
	}
}

// Per-file serialisation queues. Tokens and cursors each have their own queue
// so a slow token write doesn't block cursor persistence (and vice versa).
let harnessResumeTokenWrite: Promise<void> = Promise.resolve();
let harnessCursorWrite: Promise<void> = Promise.resolve();

async function setHarnessResumeToken(token: unknown): Promise<string | undefined> {
	if (typeof token !== "string") {
		throw Object.assign(new Error("harness resume token must be a string"), { code: "bad-request" });
	}
	if (token.length < 16 || token.length > 4096) {
		throw Object.assign(
			new Error(`harness resume token length must be between 16 and 4096 characters (received ${token.length})`),
			{ code: "bad-request" },
		);
	}
	const path = harnessResumeTokenPath();
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	harnessResumeTokenWrite = harnessResumeTokenWrite
		.catch(() => undefined)
		.then(async () => {
			await mkdir(piHome(), { recursive: true });
			try {
				await writeFile(temporary, `${token}\n`, { encoding: "utf8", mode: 0o600 });
				await rename(temporary, path);
			} finally {
				await rm(temporary, { force: true }).catch(() => undefined);
			}
		});
	await harnessResumeTokenWrite;
	return token;
}

async function readHarnessSessionCursors(): Promise<Record<string, number>> {
	const path = harnessCursorPath();
	let legacyNormalized: Record<string, number> | undefined;
	try {
		const raw = JSON.parse(await readFile(path, "utf8")) as { cursors?: unknown };
		const cursors = raw && typeof raw === "object" ? (raw as { cursors?: unknown }).cursors : undefined;
		if (cursors && typeof cursors === "object") {
			const normalized: Record<string, number> = {};
			for (const [sessionId, value] of Object.entries(cursors as Record<string, unknown>)) {
				if (typeof sessionId === "string" && Number.isSafeInteger(value) && Number(value) >= -1) {
					normalized[sessionId] = Number(value);
				}
			}
			legacyNormalized = normalized;
		}
	} catch {
		/* legacy file missing or unreadable; defer to SQLite */
	}
	const persisted = await getHarnessCursorStore().read().catch(() => ({}));
	if (Object.keys(persisted).length === 0 && legacyNormalized && Object.keys(legacyNormalized).length > 0) {
		await getHarnessCursorStore().replace(legacyNormalized).catch(() => undefined);
		await rm(path, { force: true }).catch(() => undefined);
		return legacyNormalized;
	}
	if (legacyNormalized && (await stat(path).catch(() => null))) {
		await rm(path, { force: true }).catch(() => undefined);
	}
	return persisted;
}

async function writeHarnessSessionCursors(cursors: Record<string, unknown>): Promise<void> {
	harnessCursorWrite = harnessCursorWrite
		.catch(() => undefined)
		.then(async () => {
			const existing = await readHarnessSessionCursors();
			const normalized: Record<string, number> = { ...existing };
			for (const [sessionId, value] of Object.entries(cursors)) {
				if (typeof sessionId === "string" && Number.isSafeInteger(value) && Number(value) >= -1) {
					normalized[sessionId] = Number(value);
				}
			}
			await getHarnessCursorStore().replace(normalized);
			// SQLite is authoritative now; remove the legacy JSON file if it lingers.
			await rm(harnessCursorPath(), { force: true }).catch(() => undefined);
		});
	await harnessCursorWrite;
}

async function getHarnessSessionCursors(): Promise<Record<string, number>> {
	return readHarnessSessionCursors();
}

async function setHarnessSessionCursors(cursors: unknown): Promise<Record<string, number>> {
	if (!cursors || typeof cursors !== "object" || Array.isArray(cursors)) {
		throw Object.assign(new Error("harness session cursors must be an object"), { code: "bad-request" });
	}
	await writeHarnessSessionCursors(cursors as Record<string, unknown>);
	return readHarnessSessionCursors();
}

// --- Renderer-facing inventory surfaces -------------------------------------

function listCommands() {
	// Build the set of slash command names that the compatibility adapter has
	// projected onto Pi. The renderer uses this to mark them visually so users
	// can tell apart a native Pi command from a delegated OpenBuddy one.
	const adapterCommandNames = new Set<string>();
	for (const status of state.piExtensionStatuses) {
		if (status.mode !== "adapter") continue;
		for (const name of status.commands ?? []) adapterCommandNames.add(name);
	}
	return (state.session?.extensionRunner.getRegisteredCommands() ?? []).map((command) => {
		const name = command.invocationName || command.name;
		return {
			name,
			description: command.description,
			source: command.sourceInfo.source,
			isAdapter: adapterCommandNames.has(name),
		};
	});
}

async function listSkills(requestedCwd?: string | null) {
	// P2-13: listSkills lives in the skills sub-module. Lazy-load to keep
	// the skills + workspace-instructions code out of the entry chunk.
	const { listSkills } = await import("../pi-resources/skills");
	const localSkills = await listSkills(requestedCwd ?? state.cwd);
	const loadedSkills = state.piResourceLoader?.getSkills().skills ?? [];
	const merged = new Map(localSkills.map((skill) => [skill.name, skill]));
	for (const skill of loadedSkills) {
		if (merged.has(skill.name)) continue;
		try {
			await stat(skill.filePath);
		} catch {
			continue;
		}
		const sourceInfo = skill.sourceInfo;
		merged.set(skill.name, {
			name: skill.name,
			displayName: skill.name,
			description: skill.description,
			scope: sourceInfo?.scope === "project" ? "project" : "user",
			enabled: true,
			userInvocable: true,
			path: skill.filePath,
		});
	}
	return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function resourceInventory() {
	const loader = state.piResourceLoader;
	const skills = loader?.getSkills() ?? { skills: [], diagnostics: [] };
	const prompts = loader?.getPrompts() ?? { prompts: [], diagnostics: [] };
	const themes = loader?.getThemes() ?? { themes: [], diagnostics: [] };
	const agents = loader?.getAgentsFiles() ?? { agentsFiles: [] };
	const extensionResult = loader?.getExtensions() ?? { extensions: [], errors: [] };
	const extensionStatuses = state.piExtensionStatuses;
	const profilePackages = state.profileOptions ? await listProfilePackages(state.profileOptions) : [];
	const packageNameForPath = (path: string | undefined): string | undefined => {
		if (!path) return undefined;
		return profilePackages.find((pkg) => isPathWithin(pkg.path, path))?.name;
	};
	const extensions = extensionResult.extensions.map((extension) => {
		const source = extension.resolvedPath ?? extension.path;
		const status = extensionStatuses.find((entry) => entry.source === source || entry.id === source);
		const commands = [...extension.commands.keys()];
		const tools = [...extension.tools.keys()];
		return {
			id: status?.id ?? source,
			name: status?.name ?? basename(extension.path),
			path: extension.path,
			resolvedPath: extension.resolvedPath,
			state: status?.state ?? "loaded",
			source: status?.source ?? source,
			builtIn: status?.builtIn ?? false,
			managed: status?.managed ?? false,
			sourceScope: status?.sourceScope,
			sourceOrigin: status?.sourceOrigin,
			sourceBaseDir: status?.sourceBaseDir,
			packageName: status?.packageName ?? packageNameForPath(status?.sourceBaseDir ?? extension.path),
			version: status?.version,
			diagnostics: status?.diagnostics,
			disabledReason: status?.disabledReason,
			mode: status?.mode,
			adapter: status?.adapter,
			commands,
			tools,
			commandCount: commands.length,
			toolCount: tools.length,
			health: status?.health ?? "healthy",
			error: status?.error,
		};
	});
	const extensionIds = new Set(extensions.map((extension) => extension.id));
	for (const status of extensionStatuses) {
		if (extensionIds.has(status.id)) continue;
		extensions.push({
			id: status.id,
			name: status.name,
			path: status.source ?? status.id,
			resolvedPath: status.source ?? status.id,
			state: status.state,
			source: status.source ?? status.id,
			builtIn: status.builtIn ?? false,
			managed: status.managed ?? false,
			sourceScope: status.sourceScope,
			sourceOrigin: status.sourceOrigin,
			sourceBaseDir: status.sourceBaseDir,
			packageName: status.packageName ?? packageNameForPath(status.sourceBaseDir ?? status.source),
			version: status.version,
			diagnostics: status.diagnostics,
			disabledReason: status.disabledReason,
			mode: status.mode,
			adapter: status.adapter,
			commands: [...(status.commands ?? [])],
			tools: [],
			commandCount: status.commands?.length ?? 0,
			toolCount: status.toolCount ?? 0,
			health: status.health ?? (status.state === "failed" ? "failed" : status.state === "disabled" ? "degraded" : "healthy"),
			error: status.error,
		});
	}
	const extensionDiagnostics: Array<{ type: "error"; path: string | undefined; message: string }> = extensionResult.errors.map((error) => ({
		type: "error" as const,
		path: error.path,
		message: error.error,
	}));
	return {
		agents: agents.agentsFiles.map((agent) => ({ name: basename(agent.path, ".md"), path: agent.path })),
		extensions,
		hooks: hookConfigSummary(state.hookConfigs),
		skills: skills.skills.map((skill) => ({ name: skill.name, path: skill.filePath })),
		prompts: prompts.prompts.map((prompt) => ({ name: prompt.name, path: prompt.filePath })),
		themes: themes.themes.map((theme) => ({ name: theme.name, path: theme.sourcePath })),
		diagnostics: [...skills.diagnostics, ...prompts.diagnostics, ...themes.diagnostics]
			.map((diagnostic) => ({
				type: diagnostic.type,
				path: diagnostic.path,
				message: diagnostic.message,
			}))
			.concat(extensionDiagnostics),
	};
}

export {
	harnessCursorPath,
	getHarnessCursorStore,
	harnessResumeTokenPath,
	getHarnessResumeToken,
	setHarnessResumeToken,
	readHarnessSessionCursors,
	writeHarnessSessionCursors,
	getHarnessSessionCursors,
	setHarnessSessionCursors,
	listCommands,
	listSkills,
	resourceInventory,
};