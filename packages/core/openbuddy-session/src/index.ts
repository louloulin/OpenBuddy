/**
 * @openbuddy/core-session — session inventory + openbuddy-only metadata.
 *
 * Ports `extensions/openbuddy/sessions/index.ts` into a Cordis Service class.
 * Mirrors DeepSeek Harness's `dsh-session` capability seam:
 *   - Service Definition: `Session` (the public shape)
 *   - Service Provider:   this class (local filesystem + JSONL reader)
 *   - Consumer:           renderer via IPC; tool plugins via ctx.<consumer>
 *
 * Sessions are sourced from:
 *   Pi JSONL tree — ~/.pi/agent/sessions/<encoded-cwd>/*.jsonl
 *
 * OpenBuddy-only metadata (pinned / archived / expert bindings) is owned by
 * the SQLite session catalog; ~/.pi/openbuddy-state.json remains a compatibility
 * mirror and migration source.
 */
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Context } from "@openbuddy/cordis"
import { OpenBuddyService, brand, type Branded } from "@openbuddy/cordis"
import { closeStorage, openStorage, PiSessionCatalogAdapter, SessionCatalog, type OpenStorageResult } from "@openbuddy/storage"

export type SessionId = Branded<"SessionId">
export type WorkspaceCwd = Branded<"WorkspaceCwd">

export interface SessionSummary {
	sessionId: string
	title: string
	updatedAt?: string
	cwd: string
	isGitRepo?: boolean
	pinned?: boolean
	archived?: boolean
	currentModelId?: string
	expertId?: string
	expertName?: string
	expertAvatar?: string
}

export interface WorkspaceInfo {
	cwd: string
	sessionCount: number
	lastTitle?: string
}

interface StateFile {
	pinned: string[]
	archived: string[]
	experts: Record<string, { expertId: string; expertName: string; avatarLocal?: string }>
}

const emptyState: StateFile = { pinned: [], archived: [], experts: {} }

class SessionStorageUnavailableError extends Error {
	constructor(cause: unknown) {
		super("SQLite session storage is unavailable", { cause })
		this.name = "SessionStorageUnavailableError"
	}
}

function statePath(): string {
	const agentHome = process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.PI_HOME ?? os.homedir(), ".pi", "agent")
	return path.join(agentHome, "openbuddy-state.json")
}

async function readState(): Promise<StateFile> {
	try {
		const text = await fs.readFile(statePath(), "utf-8")
		return { ...emptyState, ...JSON.parse(text) }
	} catch {
		return emptyState
	}
}

// R2.5 — JSON mirror write. The renderer reads `openbuddy-state.json`
// directly through `agentHost.listSessions()`, so we keep it in sync with
// the SQLite catalog even though SQLite is the long-term source of truth.
// The JSON file is rewritten atomically (write-temp + rename) so a crash
// mid-write never leaves a partial file behind.
async function writeState(state: StateFile): Promise<void> {
	const target = statePath()
	const temp = `${target}.${process.pid}.${Date.now()}.tmp`
	const payload = JSON.stringify({ ...emptyState, ...state }, null, 2)
	await fs.mkdir(path.dirname(target), { recursive: true })
	await fs.writeFile(temp, payload, "utf-8")
	await fs.rename(temp, target)
}

function piAgentRoot(): string {
	const agentHome = process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.PI_HOME ?? os.homedir(), ".pi", "agent")
	return agentHome
}

async function sessionFiles(root: string): Promise<string[]> {
	const files: string[] = []
	const entries = await fs.readdir(root, { withFileTypes: true })
	for (const entry of entries) {
		const file = path.join(root, entry.name)
		if (entry.isDirectory() || entry.isSymbolicLink()) {
			try { if ((await fs.stat(file)).isDirectory()) files.push(...await sessionFiles(file)) } catch { /* stale symlink */ }
		}
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(file)
	}
	return files
}

export class Session extends OpenBuddyService {
	static provide = "sessions" as const
	static inject = [] as const

	constructor(ctx: Context) {
		super(ctx, "sessions")
		ctx.effect(() => this.#onDispose())
	}

	#storage: Promise<OpenStorageResult> | undefined

	#storagePath(): string {
		const agentHome = process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.PI_HOME ?? os.homedir(), ".pi", "agent")
		return path.join(agentHome, "openbuddy.sqlite")
	}

	async #catalog(): Promise<SessionCatalog> {
		try {
			this.#storage ??= openStorage({ filePath: this.#storagePath(), appVersion: "openbuddy-core-session" })
			return new SessionCatalog((await this.#storage).driver)
		} catch (error) {
			this.#storage = undefined
			throw new SessionStorageUnavailableError(error)
		}
	}

	async #ensureCatalogSession(id: string): Promise<SessionCatalog> {
		const catalog = await this.#catalog()
		if (!catalog.get(id)) {
			const importResult = await new PiSessionCatalogAdapter(catalog).importSession(id, {
				sessionsRoot: piAgentRoot(),
				stateFile: statePath(),
				includeArchived: true,
			})
			if (!catalog.get(id)) throw new Error(`SQLite session not found: ${id}`)
		}
		return catalog
	}

	async #closeStorage(): Promise<void> {
		if (!this.#storage) return
		try { await closeStorage(this.#storage) } catch { }
		this.#storage = undefined
	}

	#onDispose(): () => void {
		return () => {
			void this.#closeStorage()
			this.ctx.emit("sessions/cleanup", {})
		}
	}

	async list(cwd: string): Promise<SessionSummary[]> {
		const pi = await this.#scanPi(cwd)
		const merged = new Map<string, SessionSummary>()
		for (const s of pi) {
			if (!merged.has(s.sessionId)) merged.set(s.sessionId, s)
		}
		const state = await readState()
		let out = Array.from(merged.values())
		try {
			const catalog = await this.#catalog()
			await new PiSessionCatalogAdapter(catalog).importWorkspace(cwd, {
				sessionsRoot: piAgentRoot(),
				stateFile: statePath(),
				includeArchived: true,
			})
			const catalogRows = new Map(catalog.list({ workspaceCwd: cwd, includeArchived: true }).map((row) => [row.sessionId, row]))
			out = out.map((session) => {
				const row = catalogRows.get(session.sessionId)
				const binding = row?.expertMetadata ?? state.experts[session.sessionId]
				const expertName = binding && typeof binding.expertName === "string" ? binding.expertName : undefined
				const expertAvatar = binding && typeof binding.avatarLocal === "string" ? binding.avatarLocal : undefined
				return {
					...session,
					pinned: row?.pinned ?? false,
					archived: row?.archived ?? false,
					...(row?.expertId ? { expertId: row.expertId } : {}),
					...(expertName ? { expertName } : {}),
					...(expertAvatar ? { expertAvatar } : {}),
				}
			});
			// R2.5 — do NOT filter archived rows here. The renderer's
			// Sidebar routes archived rows into the 已归档 group with a
			// 恢复 action so an accidental bulk archive is recoverable
			// through the UI instead of being silently dropped.
		} catch (error) {
			if (!(error instanceof SessionStorageUnavailableError)) throw error
			// R2.5 — SQLite unavailable (first run, missing file, etc.):
			// fall back to the legacy JSON state file but preserve the
			// archived flag instead of dropping the row.
			const pinned = new Set(state.pinned)
			const archived = new Set(state.archived)
			out = out.map((session) => ({
				...session,
				pinned: pinned.has(session.sessionId),
				archived: archived.has(session.sessionId),
				...(state.experts[session.sessionId] ? { expertId: state.experts[session.sessionId].expertId, expertName: state.experts[session.sessionId].expertName, expertAvatar: state.experts[session.sessionId].avatarLocal } : {}),
			}))
		}
		// R2.5 — archived rows sink to the bottom (the renderer renders
		// them in a dedicated group, but the order still helps when the
		// caller doesn't filter). Within each tier: pinned first, then
		// most-recently-active.
		out.sort((a, b) => {
			const archivedRank = Number(!!a.archived) - Number(!!b.archived)
			if (archivedRank !== 0) return archivedRank
			const pa = a.pinned ? 1 : 0
			const pb = b.pinned ? 1 : 0
			if (pb !== pa) return pb - pa
			const ua = a.updatedAt ?? ""
			const ub = b.updatedAt ?? ""
			if (ua !== ub) return ub.localeCompare(ua)
			return b.sessionId.localeCompare(a.sessionId)
		})
		this.ctx.emit("sessions/listed", { cwd, count: out.length })
		return out
	}

	async listWorkspaces(): Promise<WorkspaceInfo[]> {
		const map = new Map<string, { count: number; lastTitle?: string; modified: number }>()
		let files: string[]
		try {
			files = await sessionFiles(piAgentRoot())
		} catch {
			return []
		}
		for (const filePath of files) {
			const header = await this.#readHeader(filePath)
			const sessionCwd = typeof header?.cwd === "string" && header.cwd.trim() ? header.cwd : path.dirname(filePath)
			const e = map.get(sessionCwd) ?? { count: 0, modified: 0 }
			e.count += 1
			const modified = await fs.stat(filePath).then((value) => value.mtimeMs).catch(() => 0)
			if (modified >= e.modified) {
				e.modified = modified
				const title = typeof header?.name === "string" && header.name.trim()
					? header.name
					: typeof header?.title === "string" && header.title.trim() ? header.title : undefined
				e.lastTitle = title
			}
			map.set(sessionCwd, e)
		}
		const out: WorkspaceInfo[] = Array.from(map.entries()).map(([cwd, v]) => ({
			cwd,
			sessionCount: v.count,
			lastTitle: v.lastTitle,
		}))
		out.sort((a, b) => b.sessionCount - a.sessionCount || a.cwd.localeCompare(b.cwd))
		this.ctx.emit("sessions/workspaces-listed", { count: out.length })
		return out
	}

	async #readHeader(file: string): Promise<Record<string, unknown> | undefined> {
		try {
			const firstLine = (await fs.readFile(file, "utf8")).split("\n", 1)[0]
			const value = JSON.parse(firstLine) as unknown
			return value && typeof value === "object" ? value as Record<string, unknown> : undefined
		} catch {
			return undefined
		}
	}

	async setPinned(id: string, pinned: boolean): Promise<void> {
		const catalog = await this.#ensureCatalogSession(id)
		catalog.setPinned(id, pinned)
		// R2.5 — mirror to JSON so the renderer keeps working while we
		// migrate to SQLite as the single source of truth.
		const state = await readState()
		const set = new Set(state.pinned)
		if (pinned) set.add(id)
		else set.delete(id)
		state.pinned = Array.from(set)
		await writeState(state)
		this.ctx.emit("sessions/pinned", { id, pinned })
	}

	async setArchived(id: string, archived: boolean): Promise<void> {
		const catalog = await this.#ensureCatalogSession(id)
		catalog.setArchived(id, archived)
		// R2.5 — mirror to JSON so agentHost.listSessions() sees the
		// flag immediately (it reads the JSON mirror, not the catalog).
		const state = await readState()
		const set = new Set(state.archived)
		if (archived) set.add(id)
		else set.delete(id)
		state.archived = Array.from(set)
		await writeState(state)
		this.ctx.emit("sessions/archived", { id, archived })
	}

	async setExpert(
		id: string,
		expert: { expertId: string; expertName: string; avatarLocal?: string } | null,
	): Promise<void> {
		const catalog = await this.#ensureCatalogSession(id)
		catalog.setExpert(id, expert?.expertId, expert ? { expertName: expert.expertName, ...(expert.avatarLocal ? { avatarLocal: expert.avatarLocal } : {}) } : {})
		// R2.5 — mirror to JSON so listSessions keeps the binding visible.
		const state = await readState()
		if (expert) {
			state.experts[id] = {
				expertId: expert.expertId,
				expertName: expert.expertName,
				...(expert.avatarLocal ? { avatarLocal: expert.avatarLocal } : {}),
			}
		} else {
			delete state.experts[id]
		}
		await writeState(state)
		this.ctx.emit("sessions/expert-set", { id, binding: expert })
	}

	async clearMetadata(): Promise<void> {
		(await this.#catalog()).clearMetadata()
		this.ctx.emit("sessions/metadata-cleared", {})
	}

	async #scanPi(cwd: string): Promise<SessionSummary[]> {
		const out: SessionSummary[] = []
		let files: string[]
		try {
			files = await sessionFiles(piAgentRoot())
		} catch {
			return out
		}
		for (const filePath of files) {
			const file = path.basename(filePath)
			const header = await this.#readHeader(filePath)
			const sessionCwd = typeof header?.cwd === "string" && header.cwd.trim() ? header.cwd : cwd
			if (typeof header?.cwd === "string" && path.resolve(header.cwd) !== path.resolve(cwd)) continue
			const modified = await fs.stat(filePath).then((value) => value.mtimeMs).catch(() => 0)
			const id = typeof header?.id === "string" && header.id.trim() ? header.id : file.replace(/\.jsonl$/, "")
			out.push({
				sessionId: id,
				title: typeof header?.name === "string" && header.name.trim()
					? header.name
					: typeof header?.title === "string" && header.title.trim() ? header.title : "Pi 会话",
				updatedAt: typeof header?.timestamp === "string" ? header.timestamp : new Date(modified).toISOString(),
				cwd: sessionCwd,
			})
		}
		return out
	}
}

declare module "@openbuddy/cordis" {
	interface Context {
		sessions: Session
	}
	interface Events {
		/** Emitted after a workspace session list is computed. */
		"sessions/listed"(payload: { cwd: string; count: number }): void
		/** Emitted after the workspace list is computed. */
		"sessions/workspaces-listed"(payload: { count: number }): void
		/** Emitted when a session is pinned/unpinned. */
		"sessions/pinned"(payload: { id: string; pinned: boolean }): void
		/** Emitted when a session is archived/unarchived. */
		"sessions/archived"(payload: { id: string; archived: boolean }): void
		/** Emitted when an expert is bound/unbound to a session. */
		"sessions/expert-set"(payload: {
			id: string
			binding: { expertId: string; expertName: string; avatarLocal?: string } | null
		}): void
		/** Emitted during service teardown so consumers can flush. */
		"sessions/cleanup"(payload: Record<string, never>): void
	}
}

/** Legacy free-function façade used by older code paths. */
export const sessionsHandlers = {
	listSessions: (cwd: string) => {
		const service = _serviceRef
		if (!service) throw new Error("sessionsHandlers bound before Session mounted")
		return service.list(cwd)
	},
	listWorkspaces: () => {
		const service = _serviceRef
		if (!service) throw new Error("sessionsHandlers bound before Session mounted")
		return service.listWorkspaces()
	},
	setPinned: (id: string, pinned: boolean) => {
		const service = _serviceRef
		if (!service) throw new Error("sessionsHandlers bound before Session mounted")
		return service.setPinned(id, pinned)
	},
	setArchived: (id: string, archived: boolean) => {
		const service = _serviceRef
		if (!service) throw new Error("sessionsHandlers bound before Session mounted")
		return service.setArchived(id, archived)
	},
	setExpert: (
		id: string,
		expert: { expertId: string; expertName: string; avatarLocal?: string } | null,
	) => {
		const service = _serviceRef
		if (!service) throw new Error("sessionsHandlers bound before Session mounted")
		return service.setExpert(id, expert)
	},
	clearMetadata: () => {
		const service = _serviceRef
		if (!service) throw new Error("sessionsHandlers bound before Session mounted")
		return service.clearMetadata()
	},
}

let _serviceRef: Session | null = null
/** Mount the Session service into a Cordis context. */
export function mountSession(ctx: Context): Session {
	const svc = new Session(ctx)
	_serviceRef = svc
	return svc
}

export { brand }
export type { Branded }
