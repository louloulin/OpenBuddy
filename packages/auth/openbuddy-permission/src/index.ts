/**
 * @openbuddy/auth-permission — Pi permission rule + mode Service.
 *
 * Ports `extensions/openbuddy/permission/index.ts`. Reads/writes the
 * Pi-native settings.json permission block. Supports compact
 * `Tool(pattern)` and structured `{action, tool, pattern}` forms.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Context } from "@openbuddy/cordis"
import { OpenBuddyService } from "@openbuddy/cordis"

export type PermissionAction = "allow" | "deny" | "ask"

export interface PermissionRule {
	action: PermissionAction
	tool: string
	pattern?: string
}

export function matchesPermissionRule(rule: PermissionRule, tool: string, pattern?: string): boolean {
	const toolPattern = rule.tool.trim().toLowerCase()
	const normalizedTool = tool.trim().toLowerCase()
	if (!globMatches(toolPattern, normalizedTool)) return false
	if (!rule.pattern) return true
	return globMatches(rule.pattern, pattern ?? "")
}

export function resolvePermissionAction(rules: readonly PermissionRule[], tool: string, pattern?: string): PermissionAction | undefined {
	const matching = rules.filter((rule) => matchesPermissionRule(rule, tool, pattern))
	if (matching.some((rule) => rule.action === "deny")) return "deny"
	if (matching.some((rule) => rule.action === "ask")) return "ask"
	if (matching.some((rule) => rule.action === "allow")) return "allow"
	return undefined
}

function globMatches(glob: string, value: string): boolean {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
	return new RegExp(`^${escaped}$`, "i").test(value)
}

export type PermissionMode =
	| "default"
	| "acceptEdits"
	| "dontAsk"
	| "plan"
	| "bypassPermissions"

interface PiSettings {
	permission?: {
		deny?: string[]
		allow?: string[]
		ask?: string[]
		rules?: PermissionRule[]
		defaultMode?: PermissionMode
	}
}

function settingsPath(): string {
	const agentHome = process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.PI_HOME ?? os.homedir(), ".pi", "agent")
	return path.join(agentHome, "settings.json")
}

async function readSettings(): Promise<PiSettings> {
	try {
		const text = await readFile(settingsPath(), "utf-8")
		return JSON.parse(text)
	} catch {
		return {}
	}
}

async function writeSettings(settings: PiSettings): Promise<void> {
	const p = settingsPath()
	await mkdir(path.dirname(p), { recursive: true })
	const temporary = `${p}.${process.pid}.${Date.now()}.tmp`
	try {
		await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 })
		await rename(temporary, p)
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => undefined)
		throw error
	}
}

async function readRulesFromSettings(): Promise<PermissionRule[]> {
	const s = await readSettings()
	const perm = s.permission ?? {}
	const out: PermissionRule[] = []
	for (const action of ["deny", "allow", "ask"] as const) {
		const arr = perm[action]
		if (Array.isArray(arr)) {
			for (const v of arr) {
				if (typeof v === "string") out.push(parseCompact(v, action))
				else if (v && typeof v === "object" && "tool" in v) out.push(v as PermissionRule)
			}
		}
	}
	if (Array.isArray(perm.rules)) out.push(...perm.rules)
	return out
}

async function writeRulesToSettings(rules: PermissionRule[]): Promise<void> {
	const s = await readSettings()
	const deny: string[] = []
	const allow: string[] = []
	const ask: string[] = []
	for (const r of rules) {
		const compact = r.pattern ? `${r.tool}(${r.pattern})` : r.tool
		if (r.action === "deny") deny.push(compact)
		else if (r.action === "allow") allow.push(compact)
		else if (r.action === "ask") ask.push(compact)
	}
	s.permission = { ...(s.permission ?? {}), deny, allow, ask }
	await writeSettings(s)
}

async function readModeFromSettings(): Promise<PermissionMode> {
	const s = await readSettings()
	return s.permission?.defaultMode ?? "default"
}

async function writeModeToSettings(mode: PermissionMode): Promise<void> {
	const s = await readSettings()
	s.permission = { ...(s.permission ?? {}), defaultMode: mode }
	await writeSettings(s)
}

function parseCompact(s: string, action: PermissionAction): PermissionRule {
	const open = s.indexOf("(")
	if (open < 0) {
		return { action, tool: s.toLowerCase() }
	}
	const tool = s.slice(0, open).trim().toLowerCase()
	const pattern = s.slice(open + 1).trimEnd().replace(/\)$/, "").trim()
	return { action, tool, pattern: pattern || undefined }
}

export class Permission extends OpenBuddyService {
	static provide = "permission" as const

	constructor(ctx: Context) {
		super(ctx, "permission")
		ctx.effect(() => () => this.ctx.emit("permission/cleanup", {}))
	}

	async readRules(): Promise<PermissionRule[]> {
		return readRulesFromSettings()
	}

	async writeRules(rules: PermissionRule[]): Promise<void> {
		await writeRulesToSettings(rules)
		this.ctx.emit("permission/rules-saved", { count: rules.length })
	}

	async readMode(): Promise<PermissionMode> {
		return readModeFromSettings()
	}

	async writeMode(mode: PermissionMode): Promise<void> {
		await writeModeToSettings(mode)
		this.ctx.emit("permission/mode-set", { mode })
	}
}

declare module "@openbuddy/cordis" {
	interface Context {
		permission: Permission
	}
	interface Events {
		"permission/rules-saved"(payload: { count: number }): void
		"permission/mode-set"(payload: { mode: PermissionMode }): void
		"permission/cleanup"(payload: Record<string, never>): void
	}
}

let _ctxRef: Context | null = null

export function mountPermission(ctx: Context): Permission {
	const svc = new Permission(ctx)
	ctx.set("permission", svc)
	_ctxRef = ctx
	ctx.effect(() => () => {
		if (_ctxRef === ctx && ctx.get("permission") === svc) _ctxRef = null
		if (ctx.get("permission") === svc) ctx.set("permission", undefined)
	})
	return svc
}

export const permissionHandlers = {
	readRules: () => getPermissionService()?.readRules() ?? readRulesFromSettings(),
	writeRules: (rules: PermissionRule[]) => getPermissionService()?.writeRules(rules) ?? writeRulesToSettings(rules),
	readMode: () => getPermissionService()?.readMode() ?? readModeFromSettings(),
	writeMode: (mode: PermissionMode) => getPermissionService()?.writeMode(mode) ?? writeModeToSettings(mode),
}

function getPermissionService(): Permission | undefined {
	const service = _ctxRef?.get("permission") as Permission | undefined
	return service
}
