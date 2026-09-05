import { describe, expect, it, vi } from "vitest";
import { Context } from "@openbuddy/cordis";
import { DeepSeekHostConnectionService } from "./deepseek-runtime";

describe("DeepSeek Host Connection compatibility", () => {
	it("routes namespaced channels and disposes them transactionally", async () => {
		const context = new Context();
		const service = new DeepSeekHostConnectionService(context);
		const handler = vi.fn(async (endpoint: string, payload: unknown) => ({ endpoint, payload }));
		const dispose = service.rpc.handle("/plugin", handler, { authority: "trusted-host" });

		await expect(service.dispatch("plugin/ping", { value: 1 }, new AbortController().signal, { authority: "trusted-host" })).resolves.toEqual({
			handled: true,
			value: { endpoint: "ping", payload: { value: 1 } },
		});
		await expect(service.dispatch("other/ping", {}, new AbortController().signal, { authority: "trusted-host" })).resolves.toEqual({ handled: false });
		await dispose();
		await expect(service.dispatch("plugin/ping", {}, new AbortController().signal, { authority: "trusted-host" })).resolves.toEqual({ handled: false });
	});

	it("enforces loopback authority for privileged routes and supports one shared interceptor", async () => {
		const context = new Context();
		const service = new DeepSeekHostConnectionService(context);
		const handler = vi.fn(async () => "ok");
		service.rpc.intercept("/api", (endpoint) => endpoint === "settings/read", handler, { authority: "loopback" });

		await expect(service.dispatch("settings/read", {}, new AbortController().signal, { authority: "trusted-host" })).rejects.toMatchObject({ code: "forbidden" });
		await expect(service.dispatch("settings/read", {}, new AbortController().signal, { authority: "loopback" })).resolves.toEqual({ handled: true, value: "ok" });
		await expect(service.dispatch("settings/write", {}, new AbortController().signal, { authority: "loopback" })).resolves.toEqual({ handled: false });
		await expect(() => service.rpc.intercept("/api", () => true, handler, { authority: "trusted-host" })).toThrow("already registered");
	});

	it("rejects invalid or conflicting channel registrations", () => {
		const context = new Context();
		const service = new DeepSeekHostConnectionService(context);
		const handler = async () => undefined;
		expect(() => service.rpc.handle("api", handler, { authority: "trusted-host" })).toThrow("invalid");
		expect(() => service.rpc.handle("/api", handler, { authority: "trusted-host" })).toThrow("invalid or reserved");
		service.rpc.handle("/plugin", handler, { authority: "trusted-host" });
		expect(() => service.rpc.handle("/plugin", handler, { authority: "trusted-host" })).toThrow("already registered");
	});
});
