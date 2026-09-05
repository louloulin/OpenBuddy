import type { Context } from "@openbuddy/cordis"
import { OpenBuddyService } from "@openbuddy/cordis"

export interface AuthorizationNotice {
	message: string
	url?: string
	code?: string
}

export type AuthorizationPrompt = {
	signal?: AbortSignal
} & ({
	kind: "text" | "secret"
	message: string
	placeholder?: string
} | {
	kind: "select"
	message: string
	options: readonly { id: string; label: string; description?: string }[]
})

export interface AuthorizationInteraction {
	notify(notice: AuthorizationNotice): void
	prompt(prompt: AuthorizationPrompt): Promise<string>
}

export interface AuthorizationSession {
	readonly key: string
	readonly method: string
	readonly signal: AbortSignal
	notify(notice: AuthorizationNotice): void
	prompt(prompt: AuthorizationPrompt): Promise<string>
}

export interface AuthorizationMethod {
	id: string
	label: string
}

export interface AuthorizationFlow {
	readonly key: string
	readonly label: string
	readonly methods: readonly [AuthorizationMethod, ...AuthorizationMethod[]]
	run(session: AuthorizationSession): Promise<void>
}

export interface AuthorizationEntry {
	key: string
	label: string
	methods: readonly AuthorizationMethod[]
	inFlight: boolean
}

export type AuthorizationSettlement = "authorized" | "cancelled" | "failed"

export class AuthorizationDeclinedError extends Error {
	readonly code = "DECLINED"

	constructor(message = "authorization prompt was declined") {
		super(message)
		this.name = "AuthorizationDeclinedError"
	}
}

interface RunningAttempt {
	controller: AbortController
	settled: boolean
}

export class Authorization extends OpenBuddyService {
	static provide = "authorization" as const

	private readonly flows = new Map<string, AuthorizationFlow>()
	private readonly running = new Map<string, RunningAttempt>()

	constructor(ctx: Context) {
		super(ctx, "authorization")
		ctx.effect(() => () => {
			for (const attempt of this.running.values()) attempt.controller.abort()
			this.running.clear()
			this.ctx.emit("authorization/cleanup", {})
		})
	}

	registerFlow(flow: AuthorizationFlow): () => void {
		if (!flow.key.trim()) throw new Error("authorization flow key is required")
		if (!flow.methods.length) throw new Error(`authorization flow has no methods: ${flow.key}`)
		if (this.flows.has(flow.key)) throw new Error(`authorization flow already registered: ${flow.key}`)
		this.flows.set(flow.key, flow)
		const dispose = () => {
			if (this.flows.get(flow.key) !== flow) return false
			this.running.get(flow.key)?.controller.abort()
			this.flows.delete(flow.key)
			return true
		}
		return dispose
	}

	list(): AuthorizationEntry[] {
		return [...this.flows.values()].map((flow) => this.describeFlow(flow))
	}

	describe(key: string): AuthorizationEntry | undefined {
		const flow = this.flows.get(key)
		return flow ? this.describeFlow(flow) : undefined
	}

	cancel(key: string): boolean {
		const attempt = this.running.get(key)
		if (!attempt) return false
		attempt.controller.abort()
		return true
	}

	async begin(request: {
		key: string
		method?: string
		interaction: AuthorizationInteraction
		signal?: AbortSignal
	}): Promise<{ status: "authorized" | "cancelled" }> {
		const flow = this.flows.get(request.key)
		if (!flow) throw new Error(`authorization flow not found: ${request.key}`)
		const method = request.method ?? flow.methods[0].id
		if (!flow.methods.some((candidate) => candidate.id === method)) {
			throw new Error(`authorization flow ${request.key} does not offer method ${method}`)
		}
		if (request.signal?.aborted) return { status: "cancelled" }
		if (this.running.has(request.key)) throw new Error(`authorization already running: ${request.key}`)

		const controller = new AbortController()
		const attempt: RunningAttempt = { controller, settled: false }
		this.running.set(request.key, attempt)
		const forwardAbort = () => controller.abort()
		request.signal?.addEventListener("abort", forwardAbort, { once: true })
		this.ctx.emit("authorization/started", { key: request.key, method })

		const running = Promise.resolve().then(() => flow.run({
			key: request.key,
			method,
			signal: controller.signal,
			notify: (notice) => {
				try { request.interaction.notify(notice) } catch { /* isolate UI surfaces */ }
			},
			prompt: (prompt) => request.interaction.prompt(prompt),
		}))
		try {
			await Promise.race([
				running,
				new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true })),
			])
			if (controller.signal.aborted) {
				void running.catch(() => undefined)
				return { status: "cancelled" }
			}
			await running
			this.ctx.emit("authorization/settled", { key: request.key, status: "authorized" as const })
			return { status: "authorized" }
		} catch (error) {
			if (controller.signal.aborted || error instanceof AuthorizationDeclinedError) {
				this.ctx.emit("authorization/settled", { key: request.key, status: "cancelled" as const })
				return { status: "cancelled" }
			}
			this.ctx.emit("authorization/settled", { key: request.key, status: "failed" as const })
			throw error
		} finally {
			attempt.settled = true
			if (this.running.get(request.key) === attempt) this.running.delete(request.key)
			request.signal?.removeEventListener("abort", forwardAbort)
		}
	}

	private describeFlow(flow: AuthorizationFlow): AuthorizationEntry {
		return { key: flow.key, label: flow.label, methods: [...flow.methods], inFlight: this.running.has(flow.key) }
	}
}

declare module "@openbuddy/cordis" {
	interface Context {
		authorization: Authorization
	}
	interface Events {
		"authorization/started"(payload: { key: string; method: string }): void
		"authorization/settled"(payload: { key: string; status: AuthorizationSettlement }): void
		"authorization/cleanup"(payload: Record<string, never>): void
	}
}

let serviceRef: Authorization | null = null

export function mountAuthorization(ctx: Context): Authorization {
	const service = new Authorization(ctx)
	serviceRef = service
	return service
}

function getAuthorization(): Authorization {
	const service = serviceRef
	if (!service) throw new Error("openbuddy-authorization: service is not initialized")
	return service
}

export const authorizationHandlers = {
	list: () => getAuthorization().list(),
	describe: (key: string) => getAuthorization().describe(key),
	cancel: (key: string) => getAuthorization().cancel(key),
}
