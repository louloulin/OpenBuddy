/**
 * @openbuddy/team-team — multi-agent team orchestration Service.
 *
 * Ports `extensions/openbuddy/team-tools/index.ts` (which itself ported
 * former embedded MCP server. Each team is a
 * small in-process registry of sub-AgentSession instances; members are
 * spawned via SessionManager.inMemory() and run in parallel using
 * Promise.all. They share Pi's auth + extension host but have isolated
 * message contexts (recursion guard: members do NOT get the team-tools).
 *
 * Storage: ~/.pi/agent/openbuddy-teams.json
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { Context } from "@openbuddy/cordis"
import { OpenBuddyService } from "@openbuddy/cordis"

export interface TeamMember {
	id: string
	role: string
	model?: string
	status: "idle" | "running" | "done" | "failed"
	output?: string
	startedAt?: number
	endedAt?: number
}

export interface TeamRecord {
	id: string
	tenantId: string
	goal: string
	size: "small" | "medium" | "large"
	members: TeamMember[]
	createdAt: number
	status: "active" | "completed" | "failed" | "deleted"
}

export interface TeamMemberInput {
	teamId: string
	tenantId: string
	memberId: string
	buddyTaskId?: string
	executionId?: string
	workflowId?: string
	stepId?: string
	role: string
	goal: string
	provider?: string
	model?: string
	schema?: unknown
	persist?: boolean
}

export interface TeamRunner {
	runMember(input: TeamMemberInput, signal: AbortSignal): Promise<string | { text: string; sessionId?: string }>
}

export interface TeamTenantContext {
	getActiveTenantId(): string | undefined
	canUseTeamWorkspace(): boolean
	authorizeResource?(request: { tenantId: string; resource: string; resourceId?: string; action: "create" | "read" | "delete" }): Promise<boolean>
}

type TeamsFile = Record<string, TeamRecord>
type TeamContext = {
	team: Pick<Team, "create" | "status" | "deleteTeam">
	teamTenantContext?: TeamTenantContext
}

function teamsFile(): string {
	return join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent"), "openbuddy-teams.json")
}

async function readTeams(file = teamsFile()): Promise<TeamsFile> {
	if (!(await stat(file, { throwIfNoEntry: false }))) return {}
	try {
		const raw = await readFile(file, "utf8")
		const parsed = JSON.parse(raw) as Record<string, Partial<TeamRecord>>
		return Object.fromEntries(Object.entries(parsed).map(([id, team]) => [id, { ...team, id: team.id ?? id, tenantId: team.tenantId ?? "local" } as TeamRecord]))
	} catch {
		return {}
	}
}

async function writeTeams(teams: TeamsFile, file = teamsFile()): Promise<void> {
	await mkdir(dirname(file), { recursive: true })
	const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
	try {
		await writeFile(temporary, JSON.stringify(teams, null, 2), { encoding: "utf8", mode: 0o600 })
		await rename(temporary, file)
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => undefined)
		throw error
	}
}

function uid(): string {
	return Math.random().toString(36).slice(2, 10)
}

export class Team extends OpenBuddyService {
	static provide = "team" as const
	private readonly storageFile = teamsFile()
	private readonly activeRuns = new Map<string, AbortController>()
	private teamWriteQueue: Promise<void> = Promise.resolve()
	private readonly tenantContext: TeamTenantContext

	constructor(ctx: Context) {
		super(ctx, "team")
		this.tenantContext = ctx.get("teamTenantContext") as TeamTenantContext | undefined ?? {
			getActiveTenantId: () => "local",
			canUseTeamWorkspace: () => true,
		}
		ctx.effect(() => () => this.ctx.emit("team/cleanup", {}))
		ctx.effect(() => () => {
			for (const controller of this.activeRuns.values()) controller.abort()
			this.activeRuns.clear()
		})
	}

	async create(goal: string, size: "small" | "medium" | "large"): Promise<TeamRecord> {
		const tenantId = this.requireTenantId()
		await this.requireResourceAccess({ tenantId, resource: "team", action: "create" })
		const teams = await readTeams(this.storageFile)
		const memberCount = size === "small" ? 2 : size === "medium" ? 4 : 8
		const team: TeamRecord = {
			id: uid(),
			tenantId,
			goal,
			size,
			status: "active",
			createdAt: Date.now(),
			members: Array.from({ length: memberCount }, (_, i) => ({
				id: uid(),
				role: ["planner", "explorer", "implementer", "reviewer", "tester"][i % 5],
				status: "idle",
			})),
		}
		teams[team.id] = team
		await writeTeams(teams, this.storageFile)
		this.ctx.emit("team/created", { id: team.id, memberCount })
		if (this.ctx.get("teamRunner")) void this.execute(team)
		return team
	}

	private async execute(team: TeamRecord): Promise<void> {
		const runner = this.ctx.get("teamRunner") as TeamRunner | undefined
		if (!runner) return
		const controller = new AbortController()
		this.activeRuns.set(team.id, controller)
		await this.updateTeam(team.id, (current) => ({ ...current, members: current.members.map((member) => ({ ...member, status: "running", startedAt: Date.now() })), status: "active" }), team.tenantId)
		await Promise.all(team.members.map(async (member) => {
			try {
				const output = await runner.runMember({ tenantId: team.tenantId, teamId: team.id, memberId: member.id, role: member.role, goal: team.goal }, controller.signal)
				if (controller.signal.aborted) return
				const text = typeof output === "string" ? output : output.text
				await this.updateMember(team.id, member.id, { status: "done", output: text, endedAt: Date.now() }, team.tenantId)
			} catch (error) {
				const cancelled = controller.signal.aborted
				if (!cancelled) await this.updateMember(team.id, member.id, { status: "failed", output: String(error), endedAt: Date.now() }, team.tenantId)
			}
		}))
		if (!controller.signal.aborted) {
			await this.updateTeam(team.id, (current) => ({ ...current, status: current.members.every((member) => member.status === "done") ? "completed" : "failed" }), team.tenantId)
		}
		this.activeRuns.delete(team.id)
		this.ctx.emit("team/finished", { id: team.id, cancelled: controller.signal.aborted })
	}

	private async updateTeam(teamId: string, update: (team: TeamRecord) => TeamRecord, expectedTenantId?: string): Promise<void> {
		this.teamWriteQueue = this.teamWriteQueue.then(async () => {
			const teams = await readTeams(this.storageFile)
			if (!teams[teamId] || (expectedTenantId && teams[teamId].tenantId !== expectedTenantId)) return
			teams[teamId] = update(teams[teamId])
			await writeTeams(teams, this.storageFile)
		})
		await this.teamWriteQueue
	}

	private async updateMember(teamId: string, memberId: string, patch: Partial<TeamMember>, expectedTenantId?: string): Promise<void> {
		await this.updateTeam(teamId, (team) => ({ ...team, members: team.members.map((member) => member.id === memberId ? { ...member, ...patch } : member) }), expectedTenantId)
		this.ctx.emit("team/member-updated", { teamId, memberId, patch })
	}

	async status(teamId: string): Promise<TeamRecord | undefined> {
		const tenantId = this.requireTenantId()
		const teams = await readTeams(this.storageFile)
		const team = teams[teamId]
		if (team?.tenantId === tenantId) await this.requireResourceAccess({ tenantId, resource: "team", resourceId: teamId, action: "read" })
		return team?.tenantId === tenantId ? team : undefined
	}

	async deleteTeam(teamId: string): Promise<boolean> {
		const tenantId = this.requireTenantId()
		if (!this.activeRuns.has(teamId)) {
			const teams = await readTeams(this.storageFile)
			if (teams[teamId]?.tenantId !== tenantId) return false
		}
		const current = await this.status(teamId)
		if (!current) return false
		await this.requireResourceAccess({ tenantId, resource: "team", resourceId: teamId, action: "delete" })
		this.activeRuns.get(teamId)?.abort()
		await this.updateTeam(teamId, (current) => ({ ...current, status: "deleted" }), tenantId)
		this.ctx.emit("team/deleted", { id: teamId })
		return true
	}

	private requireTenantId(): string {
		if (!this.tenantContext.canUseTeamWorkspace()) {
			throw new Error("当前账户没有团队工作区权限")
		}
		const tenantId = this.tenantContext.getActiveTenantId()?.trim()
		if (!tenantId) throw new Error("未选择有效租户，无法访问团队工作区")
		return tenantId
	}

	private async requireResourceAccess(request: { tenantId: string; resource: string; resourceId?: string; action: "create" | "read" | "delete" }): Promise<void> {
		if (this.tenantContext.authorizeResource && !(await this.tenantContext.authorizeResource(request))) {
			throw new Error("当前账户没有当前租户团队资源权限")
		}
	}
}

declare module "@openbuddy/cordis" {
	interface Events {
		"team/created"(payload: { id: string; memberCount: number }): void
		"team/deleted"(payload: { id: string }): void
		"team/finished"(payload: { id: string; cancelled: boolean }): void
		"team/member-updated"(payload: { teamId: string; memberId: string; patch: Partial<TeamMember> }): void
		"team/cleanup"(payload: Record<string, never>): void
	}
}

let _ctxRef: TeamContext | null = null
let _teamRef: Team | null = null

export function mountTeam(ctx: Context): Team {
	const svc = new Team(ctx)
	_ctxRef = ctx as unknown as TeamContext
	_teamRef = svc
	return svc
}

export const teamToolsHandlers = {
	create: (goal: string, size: "small" | "medium" | "large") =>
		(_teamRef ?? _ctxRef?.team as Team).create(goal, size),
	status: (teamId: string) => (_teamRef ?? _ctxRef?.team as Team).status(teamId),
	delete: (teamId: string) => (_teamRef ?? _ctxRef?.team as Team).deleteTeam(teamId),
}
