import { describe, expect, it, vi } from "vitest";
import { invokeRemoteWithGateway } from "./remote-invocation";

describe("invokeRemoteWithGateway", () => {
	it("routes named Remote requests through the strict gateway", async () => {
		const gateway = { invoke: vi.fn(async () => "gateway") };
		const fallback = vi.fn(async () => "fallback");

		await expect(invokeRemoteWithGateway({ namespace: "goals", method: "create", args: {} }, gateway, fallback)).resolves.toBe("gateway");
		expect(gateway.invoke).toHaveBeenCalledOnce();
		expect(fallback).not.toHaveBeenCalled();
	});

	it("keeps legacy array Remote requests on the dispatcher", async () => {
		const gateway = { invoke: vi.fn(async () => "gateway") };
		const fallback = vi.fn(async () => "fallback");

		await expect(invokeRemoteWithGateway({ namespace: "goals", method: "create", args: [] }, gateway, fallback)).resolves.toBe("fallback");
		expect(gateway.invoke).not.toHaveBeenCalled();
		expect(fallback).toHaveBeenCalledOnce();
	});

	it("does not treat inherited argument properties as a named request", async () => {
		const gateway = { invoke: vi.fn(async () => "gateway") };
		const fallback = vi.fn(async () => "fallback");
		const args = Object.create({ title: "inherited" }) as Record<string, unknown>;

		await expect(invokeRemoteWithGateway({ namespace: "goals", method: "create", args }, gateway, fallback)).resolves.toBe("fallback");
	});
});
