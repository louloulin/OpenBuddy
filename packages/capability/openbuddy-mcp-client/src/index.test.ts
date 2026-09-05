import { describe, expect, it, vi } from "vitest";
import { Context } from "@openbuddy/cordis";
import {
	McpClient,
	buildMcpChildEnv,
	buildMcpParentEnv,
	buildMcpHttpHeaders,
	createMcpToolDefinitions,
	createMcpOAuthProvider,
	mcpToolName,
	type McpConnection,
	type McpConnectionFactory,
	type McpResourceHost,
} from "./index";

function tool(name: string) {
	return { name, description: `description for ${name}`, inputSchema: { type: "object" as const, properties: {} } };
}

function connection(tools: ReturnType<typeof tool>[]): McpConnection & { closeSpy: ReturnType<typeof vi.fn>; closeNotify: () => void } {
	const closeSpy = vi.fn(async () => undefined);
	let closeNotify: () => void = () => undefined;
	return {
		listTools: vi.fn(async () => tools),
		callTool: vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] })),
		close: closeSpy,
		setClosed: (listener) => { closeNotify = listener; return undefined; },
		closeNotify: () => closeNotify(),
		closeSpy,
	};
}

function authorization() {
	return {
		registerFlow: vi.fn(() => () => undefined),
		begin: vi.fn(async () => ({ status: "authorized" as const })),
		cancel: vi.fn(() => false),
	};
}

describe("openbuddy MCP client", () => {
	it("namespaces tools and preserves the MCP input schema", async () => {
		expect(mcpToolName("github.com/demo", "list-issues")).toBe("mcp__github_com_demo__list-issues");
		const callTool = vi.fn(async () => ({ content: [{ type: "text" as const, text: "result" }] }));
		const definitions = createMcpToolDefinitions("demo", [tool("search")], { callTool });
		expect(definitions[0]).toMatchObject({
			name: "mcp__demo__search",
			parameters: { type: "object", properties: {} },
		});
		await definitions[0].execute("call-1", {}, undefined, undefined, {} as never);
		expect(callTool).toHaveBeenCalledWith("search", {}, undefined);
	});

	it("emits paired, non-sensitive lifecycle events for Pi tool calls", async () => {
		const events: unknown[] = [];
		const callTool = vi.fn(async () => ({ content: [{ type: "text" as const, text: "result" }] }));
		const definitions = createMcpToolDefinitions("demo", [tool("search")], { callTool }, (event) => events.push(event));
		await definitions[0].execute("call-42", { secret: "must-not-leak" }, undefined, undefined, {} as never);

		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({ phase: "start", callId: "call-42", serverName: "demo", toolName: "search", piToolName: "mcp__demo__search" });
		expect(events[1]).toMatchObject({ phase: "end", callId: "call-42", ok: true });
		expect(JSON.stringify(events)).not.toContain("must-not-leak");
	});

	it("emits an end event when an MCP tool fails", async () => {
		const events: unknown[] = [];
		const callTool = vi.fn(async () => { throw new Error("provider failed"); });
		const definitions = createMcpToolDefinitions("demo", [tool("search")], { callTool }, (event) => events.push(event));
		await expect(definitions[0].execute("call-43", {}, undefined, undefined, {} as never)).rejects.toThrow("provider failed");
		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({ phase: "end", callId: "call-43", ok: false, error: "provider failed" });
	});

	it("injects stored credentials only into the selected transport boundary", () => {
		const credential = { accessToken: "secret", tokenType: "Token" };
		expect(buildMcpHttpHeaders({ url: "https://mcp.example.test" }, credential)).toEqual({ Authorization: "Token secret" });
		expect(buildMcpHttpHeaders({ url: "https://mcp.example.test", headers: { "x-api-key": "configured" } }, credential)).toEqual({ "x-api-key": "configured", Authorization: "Token secret" });
		process.env.OPENBUDDY_MCP_SCRUB_TOKEN = "ambient";
		process.env.OPENBUDDY_MCP_SCRUB_PLAIN = "visible";
		process.env.OPENBUDDY_EMAIL_AUTH_CODE = "ambient-secret";
		try {
			expect(buildMcpParentEnv().OPENBUDDY_MCP_SCRUB_TOKEN).toBeUndefined();
			expect(buildMcpParentEnv().OPENBUDDY_EMAIL_AUTH_CODE).toBeUndefined();
			expect(buildMcpParentEnv().OPENBUDDY_MCP_SCRUB_PLAIN).toBe("visible");
			expect(buildMcpChildEnv({ command: "mcp-server" }, credential)).toMatchObject({ MCP_ACCESS_TOKEN: "secret", OPENBUDDY_MCP_SCRUB_PLAIN: "visible" });
		} finally {
			delete process.env.OPENBUDDY_MCP_SCRUB_TOKEN;
			delete process.env.OPENBUDDY_MCP_SCRUB_PLAIN;
			delete process.env.OPENBUDDY_EMAIL_AUTH_CODE;
		}
		process.env.OPENBUDDY_EMAIL_AUTH_CODE = "configured-secret";
		try {
			expect(buildMcpChildEnv({ command: "mail", env: { OPENBUDDY_EMAIL_AUTH_CODE: "${OPENBUDDY_EMAIL_AUTH_CODE}" } }).OPENBUDDY_EMAIL_AUTH_CODE).toBe("configured-secret");
		} finally {
			delete process.env.OPENBUDDY_EMAIL_AUTH_CODE;
		}
			expect(buildMcpChildEnv({ command: "mcp-server", authEnv: "CUSTOM_TOKEN", env: { MCP_ACCESS_TOKEN: "explicit" } }, credential)).toMatchObject({ MCP_ACCESS_TOKEN: "explicit", CUSTOM_TOKEN: "secret" });
	});

	it("loads enabled servers, skips disabled servers, and disposes tools and transports", async () => {
		const context = new Context();
		context.provide("authorization", authorization());
		const registered = new Map<string, () => void>();
		const pi = {
			registerTool: vi.fn((definition: { name: string }) => {
				registered.set(definition.name, () => registered.delete(definition.name));
				return () => registered.delete(definition.name);
			}),
		};
		const demoConnection = connection([tool("search")]);
		const factory: McpConnectionFactory = {
			connect: vi.fn(async () => demoConnection),
		};
		const host: McpResourceHost = {
			getCwd: () => "/workspace",
		readConfig: async () => ({ mcpServers: { demo: { url: "https://mcp.example.test", emailProfile: "gmail" }, disabled: { disabled: true } } }),
			readCredential: async () => ({ accessToken: "secret" }),
		};
		const service = new McpClient(context, host, pi, factory);
		await service.reload();
		expect(factory.connect).toHaveBeenCalledWith("demo", { url: "https://mcp.example.test", emailProfile: "gmail" }, { accessToken: "secret" });
		expect(service.list()).toEqual([
			{ serverName: "demo", status: "ready", toolCount: 1, emailProfile: "gmail" },
			{ serverName: "disabled", status: "disabled", toolCount: 0 },
		]);
		expect([...registered.keys()]).toEqual(["mcp__demo__search"]);
		expect(service.listToolNames("demo")).toEqual(["search"]);
		expect(service.listToolNames("missing")).toEqual([]);
		await service.disposeConnectionsAndStop();
		expect(demoConnection.closeSpy).toHaveBeenCalledOnce();
		expect(registered.size).toBe(0);
	});

	it("refreshes the registered tool set after a reload", async () => {
		const context = new Context();
		context.provide("authorization", authorization());
		const registered = new Set<string>();
		const pi = { registerTool: (definition: { name: string }) => { registered.add(definition.name); return () => registered.delete(definition.name); } };
		const demoConnection = connection([tool("old")]);
		const factory: McpConnectionFactory = { connect: async () => demoConnection };
		let config: { mcpServers?: Record<string, { url: string }> } = { mcpServers: { demo: { url: "https://mcp.example.test" } } };
		const host: McpResourceHost = { getCwd: () => "/workspace", readConfig: async () => config, readCredential: async () => undefined };
		const service = new McpClient(context, host, pi, factory);
		await service.reload();
		expect(registered).toEqual(new Set(["mcp__demo__old"]));
		config = { mcpServers: {} };
		await service.reload();
		expect(registered.size).toBe(0);
	});

	it("emits the same lifecycle events for capability consumers using callTool", async () => {
		const context = new Context();
		context.provide("authorization", authorization());
		const demoConnection = connection([tool("send_email")]);
		const factory: McpConnectionFactory = { connect: async () => demoConnection };
		const host: McpResourceHost = {
			getCwd: () => "/workspace",
			readConfig: async () => ({ mcpServers: { mail: { url: "https://mcp.example.test" } } }),
			readCredential: async () => undefined,
		};
		const events: unknown[] = [];
		context.on("mcp/tool-start", (event) => events.push(event));
		context.on("mcp/tool-end", (event) => events.push(event));
		const service = new McpClient(context, host, { registerTool: () => () => undefined }, factory);
		await service.reload();
		await service.callTool("mail", "send_email", { body: "private" });
		await service.disposeConnectionsAndStop();

		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({ phase: "start", serverName: "mail", toolName: "send_email", piToolName: "mcp__mail__send_email" });
		expect(events[1]).toMatchObject({ phase: "end", serverName: "mail", toolName: "send_email", ok: true });
		expect(JSON.stringify(events)).not.toContain("private");
	});

	it("serializes concurrent reloads and closes the previous generation first", async () => {
		const context = new Context();
		context.provide("authorization", authorization());
		const registered = new Set<string>();
		const pi = { registerTool: (definition: { name: string }) => { registered.add(definition.name); return () => registered.delete(definition.name); } };
		const first = connection([tool("first")]);
		const second = connection([tool("second")]);
		const factory: McpConnectionFactory = {
			connect: vi.fn()
				.mockResolvedValueOnce(first)
				.mockResolvedValueOnce(second),
		};
		const host: McpResourceHost = { getCwd: () => "/workspace", readConfig: async () => ({ mcpServers: { demo: { url: "https://mcp.example.test" } } }), readCredential: async () => undefined };
		const service = new McpClient(context, host, pi, factory);
		await Promise.all([service.reload(), service.reload()]);
		expect(first.closeSpy).toHaveBeenCalledOnce();
		expect(second.closeSpy).not.toHaveBeenCalled();
		expect(registered).toEqual(new Set(["mcp__demo__second"]));
		await service.disposeConnectionsAndStop();
		expect(second.closeSpy).toHaveBeenCalledOnce();
	});

	it("reconnects after an unexpected transport close", async () => {
		const context = new Context();
		context.provide("authorization", authorization());
		const registered = new Set<string>();
		const pi = { registerTool: (definition: { name: string }) => { registered.add(definition.name); return () => registered.delete(definition.name); } };
		const first = connection([tool("first")]);
		const second = connection([tool("second")]);
		const factory: McpConnectionFactory = { connect: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };
		const host: McpResourceHost = { getCwd: () => "/workspace", readConfig: async () => ({ mcpServers: { demo: { url: "https://mcp.example.test", reconnect: { initialDelayMs: 1, maxDelayMs: 2, maxAttempts: 2 } } } }), readCredential: async () => undefined };
		const service = new McpClient(context, host, pi, factory);
		await service.reload();
		first.closeNotify();
		await vi.waitFor(() => expect(factory.connect).toHaveBeenCalledTimes(2), { timeout: 1000 });
		expect(registered).toEqual(new Set(["mcp__demo__second"]));
		await service.disposeConnectionsAndStop();
	});

	it("routes authorization through the Cordis authorization seam", async () => {
		const context = new Context();
		const auth = authorization();
		context.provide("authorization", auth);
		const host: McpResourceHost = {
			getCwd: () => "/workspace",
			readConfig: async () => ({ mcpServers: { demo: { url: "https://mcp.example.test" } } }),
			readCredential: async () => undefined,
			authorize: vi.fn(async () => ({ status: "authenticated" as const })),
		};
		const service = new McpClient(context, host, { registerTool: () => () => undefined }, { connect: async () => connection([]) });
		await service.authorize("demo");
		expect(auth.registerFlow).toHaveBeenCalledWith(expect.objectContaining({ key: "mcp/demo" }));
		expect(auth.begin).toHaveBeenCalledWith(expect.objectContaining({ key: "mcp/demo" }));
		await service.disposeConnectionsAndStop();
	});

	it("rejects an expired stdio credential before spawning the child process", async () => {
		const { defaultMcpConnectionFactory } = await import("./index");
		await expect(defaultMcpConnectionFactory.connect("demo", { command: "echo" }, { accessToken: "stale", tokenType: "Bearer", expiresAt: new Date(Date.now() - 60_000).toISOString() })).rejects.toMatchObject({ code: "awaiting_authorization" });
	});

	it("exposes a refresh-capable OAuth provider when refreshToken is present", () => {
		const provider = createMcpOAuthProvider({ clientId: "id", refreshToken: "refresh-secret" }, {
			accessToken: "access",
			refreshToken: "refresh-secret",
			expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
		});
		expect(provider?.clientMetadata.grant_types).toEqual(expect.arrayContaining(["refresh_token"]));
		expect(provider?.tokens()).toMatchObject({ access_token: "access", refresh_token: "refresh-secret" });
	});

	it("hides expired tokens so the SDK is forced to refresh", () => {
		const provider = createMcpOAuthProvider({ clientId: "id" }, {
			accessToken: "stale",
			refreshToken: "refresh",
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
		});
		expect(provider?.tokens()).toBeUndefined();
	});
});
