import { describe, expect, it } from "vitest";
import { projectMcpCapabilityGovernance } from "./mcp-capability-governance";

describe("MCP capability governance projection", () => {
	it("maps tools to a scoped provider contract without credentials", () => {
		const result = projectMcpCapabilityGovernance(
			[{ serverName: "calendar", status: "ready" }],
			() => ["create_event", "create_event", " ", "list_events"],
		);

		expect(result).toEqual([
			expect.objectContaining({
				serverName: "calendar",
				toolName: "create_event",
				providerId: "mcp:calendar",
				roomId: "personal-room",
				dataScopes: ["room:personal-room"],
				allowedActions: ["mcp:call:calendar:create_event"],
				approval: "before_external_commit",
			}),
			expect.objectContaining({ toolName: "list_events" }),
		]);
		expect(JSON.stringify(result)).not.toMatch(/token|secret|password/i);
	});
});
