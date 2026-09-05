import { describe, expect, it, vi } from "vitest"
import { Context } from "@openbuddy/cordis"
import { AuthorizationDeclinedError, mountAuthorization } from "./index"

describe("authorization capability", () => {
	it("registers flows, forwards interaction, and cleans up", async () => {
		const ctx = new Context()
		const service = mountAuthorization(ctx)
		await ctx.lifecycle.start()
		const notify = vi.fn()
		const run = vi.fn(async (session: { notify: (notice: { message: string }) => void }) => {
			session.notify({ message: "open browser" })
		})
		const dispose = service.registerFlow({ key: "mcp/demo", label: "Demo", methods: [{ id: "oauth", label: "OAuth" }], run })
		expect(service.describe("mcp/demo")).toMatchObject({ inFlight: false, methods: [{ id: "oauth" }] })
		await expect(service.begin({ key: "mcp/demo", interaction: { notify, prompt: vi.fn() } })).resolves.toEqual({ status: "authorized" })
		expect(notify).toHaveBeenCalledWith({ message: "open browser" })
		expect(run).toHaveBeenCalledOnce()
		dispose()
		expect(service.list()).toEqual([])
	})

	it("cancels a flow that does not react immediately", async () => {
		const service = mountAuthorization(new Context())
		const started = Promise.withResolvers<void>()
		const attempt = service.registerFlow({ key: "mcp/slow", label: "Slow", methods: [{ id: "oauth", label: "OAuth" }], run: async () => { started.resolve(); await new Promise(() => undefined) } })
		const pending = service.begin({ key: "mcp/slow", interaction: { notify: vi.fn(), prompt: vi.fn() } })
		await started.promise
		expect(service.describe("mcp/slow")?.inFlight).toBe(true)
		expect(service.cancel("mcp/slow")).toBe(true)
		await expect(pending).resolves.toEqual({ status: "cancelled" })
		attempt()
	})

	it("maps an explicit human decline to cancellation", async () => {
		const service = mountAuthorization(new Context())
		service.registerFlow({ key: "mcp/decline", label: "Decline", methods: [{ id: "oauth", label: "OAuth" }], run: async (session) => {
			await session.prompt({ kind: "text", message: "code" })
		} })
		await expect(service.begin({ key: "mcp/decline", interaction: { notify: vi.fn(), prompt: async () => { throw new AuthorizationDeclinedError() } } })).resolves.toEqual({ status: "cancelled" })
	})
})
