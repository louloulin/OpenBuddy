export interface McpGovernedServer {
	serverName: string;
	status: string;
}

export interface McpCapabilityGovernanceProjection {
	serverName: string;
	toolName: string;
	providerId: string;
	roomId: string;
	dataScopes: string[];
	allowedActions: string[];
	approval: "before_external_commit";
	status: string;
}

export function projectMcpCapabilityGovernance(
	servers: readonly McpGovernedServer[],
	listToolNames: (serverName: string) => readonly string[],
): McpCapabilityGovernanceProjection[] {
	return servers.flatMap((server) => [...new Set(listToolNames(server.serverName).map((tool) => tool.trim()).filter(Boolean))].map((toolName) => ({
		serverName: server.serverName,
		toolName,
		providerId: `mcp:${server.serverName}`,
		roomId: "personal-room",
		dataScopes: ["room:personal-room"],
		allowedActions: [`mcp:call:${server.serverName}:${toolName}`],
		approval: "before_external_commit" as const,
		status: server.status,
	})));
}
