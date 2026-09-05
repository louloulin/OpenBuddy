import type { EmailAccount, EmailThread, EmailThreadPreview } from "./index"

export type EmailPermissionAccountScope = "*" | readonly string[]

export interface EmailPermission {
	/** Stable identifier for the actor that is requesting email data. */
	actor: string
	/** Allow-list of account ids the actor may read. Use "*" to allow all accounts. */
	allowedAccountIds: EmailPermissionAccountScope
	/** Allow-list of collaboration data scopes. Matched against the existing `room:personal-room`, `room:project-*`, `community:*` conventions. */
	allowedScopes: readonly string[]
	/** Hard-denied collaboration data scopes; checked before allowed list. */
	forbiddenScopes: readonly string[]
	/** Maximum allowed actions: "read" | "write" | "manage". */
	capabilities: readonly EmailPermissionCapability[]
}

export type EmailPermissionCapability = "read" | "write" | "manage" | "share" | "audit"

export const EMAIL_DEFAULT_FORBIDDEN_SCOPES: readonly string[] = [
	"secret:prompt",
	"credential:vault",
	"credential:token",
] as const

export const EMAIL_DEFAULT_OWNER_SCOPES: readonly string[] = [
	"room:personal-room",
	"room:project-*",
	"community:local-community",
	"organization:local-organization",
] as const

const PERMISSION_CAPABILITIES: ReadonlySet<EmailPermissionCapability> = new Set([
	"read",
	"write",
	"manage",
	"share",
	"audit",
])

const SCOPE_WILDCARD = "*"
const SCOPE_SEGMENT = "[A-Za-z0-9_.-]+"
const SCOPE_PATTERN_CACHE = new Map<string, RegExp>()

function compileScopePattern(scope: string): RegExp | null {
	if (scope === SCOPE_WILDCARD) return null
	const cached = SCOPE_PATTERN_CACHE.get(scope)
	if (cached) return cached
	const escaped = scope
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, SCOPE_SEGMENT)
	const pattern = new RegExp(`^${escaped}$`)
	SCOPE_PATTERN_CACHE.set(scope, pattern)
	return pattern
}

function matchesScope(pattern: string, scope: string): boolean {
	if (pattern === SCOPE_WILDCARD) return true
	const compiled = compileScopePattern(pattern)
	return compiled ? compiled.test(scope) : pattern === scope
}

export class EmailPermissionResolver {
	constructor(private readonly permission: EmailPermission) {
		if (!permission.actor.trim()) throw new Error("EmailPermission.actor is required")
		for (const capability of permission.capabilities) {
			if (!PERMISSION_CAPABILITIES.has(capability)) throw new Error(`Unsupported email capability: ${capability}`)
		}
	}

	can(capability: EmailPermissionCapability): boolean {
		return this.permission.capabilities.includes(capability)
	}

	isAccountAllowed(accountId: string): boolean {
		if (this.permission.allowedAccountIds === SCOPE_WILDCARD) return true
		return this.permission.allowedAccountIds.includes(accountId)
	}

	isScopeAllowed(scope: string): boolean {
		for (const forbidden of this.permission.forbiddenScopes) {
			if (matchesScope(forbidden, scope)) return false
		}
		if (this.permission.allowedScopes.includes(SCOPE_WILDCARD)) return true
		return this.permission.allowedScopes.some((allowed) => matchesScope(allowed, scope))
	}

	/** Throws a typed error if the actor may not perform the capability on the given account. */
	assertCan(capability: EmailPermissionCapability, accountId: string, scope: string): void {
		if (!this.can(capability)) throw new EmailPermissionError("capability_denied", `actor "${this.permission.actor}" lacks email capability "${capability}"`)
		if (!this.isAccountAllowed(accountId)) throw new EmailPermissionError("account_denied", `actor "${this.permission.actor}" may not access account "${accountId}"`)
		if (!this.isScopeAllowed(scope)) throw new EmailPermissionError("scope_denied", `actor "${this.permission.actor}" may not access scope "${scope}"`)
	}

	filterAccounts<T extends EmailAccount>(accounts: readonly T[]): T[] {
		if (this.permission.allowedAccountIds === SCOPE_WILDCARD) return [...accounts]
		return accounts.filter((account) => this.isAccountAllowed(account.id))
	}

	filterThreadPreviews(previews: readonly EmailThreadPreview[]): EmailThreadPreview[] {
		if (this.permission.allowedAccountIds === SCOPE_WILDCARD) return [...previews]
		return previews.filter((preview) => this.isAccountAllowed(preview.accountId))
	}

	filterThreads(threads: readonly EmailThread[]): EmailThread[] {
		if (this.permission.allowedAccountIds === SCOPE_WILDCARD) return [...threads]
		return threads.filter((thread) => this.isAccountAllowed(thread.accountId))
	}

	filterMessages(thread: EmailThread): EmailThread {
		if (this.permission.allowedAccountIds === SCOPE_WILDCARD) return thread
		if (this.isAccountAllowed(thread.accountId)) return thread
		throw new EmailPermissionError("account_denied", `actor "${this.permission.actor}" may not read messages for account "${thread.accountId}"`)
	}

	static owner(actor: string): EmailPermissionResolver {
		return new EmailPermissionResolver({
			actor,
			allowedAccountIds: "*",
			allowedScopes: [...EMAIL_DEFAULT_OWNER_SCOPES, SCOPE_WILDCARD],
			forbiddenScopes: [...EMAIL_DEFAULT_FORBIDDEN_SCOPES],
			capabilities: ["read", "write", "manage", "share", "audit"],
		})
	}

	static readonly(actor: string, accountIds?: readonly string[]): EmailPermissionResolver {
		return new EmailPermissionResolver({
			actor,
			allowedAccountIds: accountIds ? [...accountIds] : "*",
			allowedScopes: [...EMAIL_DEFAULT_OWNER_SCOPES, "room:shared-inbox"],
			forbiddenScopes: [...EMAIL_DEFAULT_FORBIDDEN_SCOPES, "credential:smtp-password"],
			capabilities: ["read", "audit"],
		})
	}

	static share(actor: string): EmailPermissionResolver {
		return new EmailPermissionResolver({
			actor,
			allowedAccountIds: "*",
			allowedScopes: [...EMAIL_DEFAULT_OWNER_SCOPES, "room:project-*", "room:shared-inbox"],
			forbiddenScopes: [...EMAIL_DEFAULT_FORBIDDEN_SCOPES],
			capabilities: ["read", "share", "audit"],
		})
	}
}

export class EmailPermissionError extends Error {
	constructor(readonly code: "capability_denied" | "account_denied" | "scope_denied", message: string) {
		super(message)
		this.name = "EmailPermissionError"
	}
}

export interface EmailPermissionAuditContext {
	permission: EmailPermission
	accountId?: string
	scope?: string
	capability?: EmailPermissionCapability
}
