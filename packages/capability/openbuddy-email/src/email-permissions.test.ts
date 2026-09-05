import { describe, expect, it } from "vitest"
import { EmailPermissionError, EmailPermissionResolver } from "./email-permissions"

const account = (id: string) => ({
	id,
	address: `${id}@example.com`,
	provider: "mcp" as const,
	status: "connected" as const,
	capabilities: { read: true, write: true, attachments: true, multipleAccounts: true },
})

const preview = (accountId: string, threadId: string) => ({
	id: threadId,
	accountId,
	subject: `Thread ${threadId}`,
	from: { address: "user@example.com" },
	date: "2026-08-30T10:00:00.000Z",
	messageCount: 1,
	unread: false,
	labels: [],
})

describe("EmailPermissionResolver", () => {
	it("owner sees all accounts and allows all owner scopes", () => {
		const resolver = EmailPermissionResolver.owner("user-1")
		expect(resolver.can("read")).toBe(true)
		expect(resolver.can("write")).toBe(true)
		expect(resolver.isAccountAllowed("any")).toBe(true)
		expect(resolver.isScopeAllowed("room:personal-room")).toBe(true)
		expect(resolver.isScopeAllowed("room:project-123")).toBe(true)
		expect(resolver.isScopeAllowed("secret:prompt")).toBe(false)
		expect(resolver.isScopeAllowed("credential:vault")).toBe(false)
	})

	it("readonly resolver denies write and manage but keeps read", () => {
		const resolver = EmailPermissionResolver.readonly("viewer-1")
		expect(resolver.can("read")).toBe(true)
		expect(resolver.can("write")).toBe(false)
		expect(resolver.can("manage")).toBe(false)
	})

	it("account allow-list filters accounts, previews, and threads", () => {
		const resolver = new EmailPermissionResolver({
			actor: "agent-1",
			allowedAccountIds: ["acc-1"],
			allowedScopes: ["room:personal-room"],
			forbiddenScopes: [],
			capabilities: ["read"],
		})
		expect(resolver.isAccountAllowed("acc-1")).toBe(true)
		expect(resolver.isAccountAllowed("acc-2")).toBe(false)
		expect(resolver.filterAccounts([account("acc-1"), account("acc-2")]).map((a) => a.id)).toEqual(["acc-1"])
		expect(resolver.filterThreadPreviews([preview("acc-1", "t1"), preview("acc-2", "t2")]).map((p) => p.id)).toEqual(["t1"])
	})

	it("scope allow-list uses wildcard and pattern matching", () => {
		const resolver = new EmailPermissionResolver({
			actor: "agent-2",
			allowedAccountIds: "*",
			allowedScopes: ["room:project-*"],
			forbiddenScopes: [],
			capabilities: ["read"],
		})
		expect(resolver.isScopeAllowed("room:project-alpha")).toBe(true)
		expect(resolver.isScopeAllowed("room:project-beta/threads")).toBe(false)
		expect(resolver.isScopeAllowed("room:personal-room")).toBe(false)
	})

	it("forbidden scopes win over allowed scopes", () => {
		const resolver = new EmailPermissionResolver({
			actor: "agent-3",
			allowedAccountIds: "*",
			allowedScopes: ["*"],
			forbiddenScopes: ["credential:*"],
			capabilities: ["read"],
		})
		expect(resolver.isScopeAllowed("credential:vault")).toBe(false)
		expect(resolver.isScopeAllowed("credential:smtp-password")).toBe(false)
		expect(resolver.isScopeAllowed("room:personal-room")).toBe(true)
	})

	it("assertCan throws EmailPermissionError with the right code", () => {
		const resolver = new EmailPermissionResolver({
			actor: "agent-4",
			allowedAccountIds: ["acc-1"],
			allowedScopes: ["room:personal-room"],
			forbiddenScopes: [],
			capabilities: ["read"],
		})
		expect(() => resolver.assertCan("write", "acc-1", "room:personal-room")).toThrow(EmailPermissionError)
		try { resolver.assertCan("read", "acc-2", "room:personal-room") } catch (cause) {
			expect((cause as EmailPermissionError).code).toBe("account_denied")
		}
		try { resolver.assertCan("read", "acc-1", "secret:prompt") } catch (cause) {
			expect((cause as EmailPermissionError).code).toBe("scope_denied")
		}
		expect(() => resolver.assertCan("read", "acc-1", "room:personal-room")).not.toThrow()
	})

	it("rejects invalid permission inputs", () => {
		expect(() => new EmailPermissionResolver({
			actor: "",
			allowedAccountIds: "*",
			allowedScopes: ["*"],
			forbiddenScopes: [],
			capabilities: ["read"],
		})).toThrow(/actor is required/)
		expect(() => new EmailPermissionResolver({
			actor: "x",
			allowedAccountIds: "*",
			allowedScopes: ["*"],
			forbiddenScopes: [],
			capabilities: ["delete-everything" as never],
		})).toThrow(/Unsupported email capability/)
	})
})
