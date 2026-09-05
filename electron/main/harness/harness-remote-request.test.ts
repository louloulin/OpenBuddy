import { describe, expect, it } from "vitest";
import { remoteRequestFromHarnessRequest } from "./harness-remote-request";

describe("remoteRequestFromHarnessRequest", () => {
	it("derives namespace and method from a Harness endpoint", () => {
		expect(remoteRequestFromHarnessRequest({
			method: "goals/create",
			payload: { package: "@fixture/goals", args: { title: "Ship" } },
		})).toEqual({
			package: "@fixture/goals",
			args: { title: "Ship" },
			namespace: "goals",
			method: "create",
		});
	});

	it("preserves an explicit generated Remote route", () => {
		expect(remoteRequestFromHarnessRequest({
			method: "goals/create",
			payload: { namespace: "other", method: "inspect", args: {} },
		})).toEqual({ namespace: "other", method: "inspect", args: {} });
	});

	it("rejects malformed carrier payloads and endpoints", () => {
		expect(() => remoteRequestFromHarnessRequest({ method: "goals/create", payload: null })).toThrow("payload");
		expect(() => remoteRequestFromHarnessRequest({ method: "goals", payload: { args: {} } })).toThrow("endpoint");
	});
});
