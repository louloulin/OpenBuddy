import type { Context } from "@openbuddy/cordis";
import { OpenBuddyService } from "@openbuddy/cordis";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ToolListChangedNotificationSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

export interface McpServerConfig {
	transport?: string;
	command?: string;
	args?: unknown;
	env?: unknown;
	cwd?: string;
	url?: string;
	headers?: unknown;
	disabled?: boolean;
	enabled?: boolean;
	reconnect?: { enabled?: boolean; initialDelayMs?: number; maxDelayMs?: number; maxAttempts?: number };
	[key: string]: unknown;
}

export interface McpConfig {
	mcpServers?: Record<string, McpServerConfig>;
	[key: string]: unknown;
}

export interface McpCredential {
	accessToken: string;
	refreshToken?: string;
	tokenType?: string;
	expiresAt?: string;
}

export interface McpResourceHost {
	getCwd(): string | null | undefined;
	readConfig(cwd?: string | null): Promise<McpConfig>;
	readCredential(serverName: string, cwd?: string | null): Promise<McpCredential | undefined>;
	authorize?(serverName: string, signal?: AbortSignal): Promise<McpAuthorizationResult>;
	saveCredential?(serverName: string, credential: McpCredential): Promise<void>;
}

export type McpAuthorizationResult =
	| { status: "authenticated" }
	| { status: "setup_required" | "cancelled" | "failed"; error: string };

export class McpAuthorizationError extends Error {
	readonly result: Exclude<McpAuthorizationResult, { status: "authenticated" }>;

	constructor(result: Exclude<McpAuthorizationResult, { status: "authenticated" }>) {
		super(result.error);
		this.name = "McpAuthorizationError";
		this.result = result;
	}
}

export interface McpPiTools {
	registerTool(tool: ToolDefinition): () => void;
}

export interface McpConnection {
	listTools(): Promise<Tool[]>;
	callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>;
	setToolsChanged?(listener: () => void): void;
	setClosed?(listener: () => void): void;
	close(): Promise<void>;
}

export interface McpConnectionFactory {
	connect(serverName: string, config: McpServerConfig, credential?: McpCredential, hooks?: { saveCredential?: (credential: McpCredential) => Promise<void> }): Promise<McpConnection>;
}

export interface McpServerStatus {
	serverName: string;
	status: "connecting" | "ready" | "disabled" | "failed";
	toolCount: number;
	emailProfile?: string;
	error?: string;
}

export interface McpToolCallResult {
	serverName: string
	toolName: string
	result: CallToolResult
}

export interface McpToolCallEvent {
	phase: "start" | "end"
	callId: string
	serverName: string
	toolName: string
	piToolName: string
	durationMs?: number
	ok?: boolean
	error?: string
}

export type McpToolCallObserver = (event: McpToolCallEvent) => void

interface ActiveServer {
	connection: McpConnection;
	toolDisposers: Array<() => void>;
	toolNames: string[];
}

interface ServerRuntime {
	serverName: string;
	config: McpServerConfig;
	generation: number;
	active?: ActiveServer;
	connecting?: Promise<void>;
	timer?: ReturnType<typeof setTimeout>;
	attempts: number;
	connectedAt?: number;
	disposed: boolean;
}

const RECONNECT_DEFAULTS = { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 } as const;

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringRecord(value: unknown): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(record(value))) {
		if (typeof item === "string") result[key] = item;
	}
	return result;
}

function expandConfiguredEnv(value: string): string {
	return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => process.env[name] ?? match)
}

export function buildMcpParentEnv(): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !/KEY|PASSWORD|SECRET|TOKEN|AUTH_CODE/i.test(key) && !key.toUpperCase().startsWith("DSH_")) result[key] = value;
	}
	return result;
}

function safeServerName(value: string): string {
	const normalized = value.replace(/[^A-Za-z0-9_-]/g, "_");
	return normalized.slice(0, 32) || "server";
}

export function mcpToolName(serverName: string, toolName: string): string {
	return `mcp__${safeServerName(serverName)}__${toolName.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function toolResult(result: CallToolResult): AgentToolResult<CallToolResult> {
	const content = result.content.map((item) => {
		if (item.type === "text") return item;
		if (item.type === "image") return { type: "text" as const, text: `[image ${item.mimeType}]` };
		if (item.type === "audio") return { type: "text" as const, text: `[audio ${item.mimeType}]` };
		return { type: "text" as const, text: JSON.stringify(item) };
	});
	return { content, details: result };
}

export function createMcpToolDefinitions(
	serverName: string,
	tools: readonly Tool[],
	connection: Pick<McpConnection, "callTool">,
	onCall?: McpToolCallObserver,
): ToolDefinition[] {
	return tools.map((tool) => ({
		name: mcpToolName(serverName, tool.name),
		label: `${serverName}: ${tool.name}`,
		description: tool.description || `Call ${tool.name} on MCP server ${serverName}.`,
		parameters: tool.inputSchema as ToolDefinition["parameters"],
		execute: async (toolCallId, args, signal) => {
			const piToolName = mcpToolName(serverName, tool.name);
			const callId = typeof toolCallId === "string" && toolCallId ? toolCallId : `mcp-${Date.now().toString(36)}`;
			const startedAt = Date.now();
			onCall?.({ phase: "start", callId, serverName, toolName: tool.name, piToolName });
			try {
				const result = await connection.callTool(tool.name, record(args), signal);
				onCall?.({ phase: "end", callId, serverName, toolName: tool.name, piToolName, durationMs: Date.now() - startedAt, ok: true });
				return toolResult(result);
			} catch (error) {
				onCall?.({ phase: "end", callId, serverName, toolName: tool.name, piToolName, durationMs: Date.now() - startedAt, ok: false, error: error instanceof Error ? error.message : String(error) });
				throw error;
			}
		},
	}));
}

export function buildMcpHttpHeaders(config: McpServerConfig, credential?: McpCredential): Record<string, string> {
	const headers = stringRecord(config.headers);
	if (credential?.accessToken && !Object.keys(headers).some((key) => key.toLowerCase() === "authorization")) {
		headers.Authorization = `${credential.tokenType || "Bearer"} ${credential.accessToken}`;
	}
	return headers;
}

export function buildMcpChildEnv(config: McpServerConfig, credential?: McpCredential): Record<string, string> {
	const configuredEnv = Object.fromEntries(Object.entries(stringRecord(config.env)).map(([key, value]) => [key, expandConfiguredEnv(value)]));
	const env = { ...buildMcpParentEnv(), ...configuredEnv };
	if (credential?.accessToken) {
		const tokenEnv = text(config.authEnv) || text(config.tokenEnv) || "MCP_ACCESS_TOKEN";
		if (!Object.keys(env).some((key) => key === tokenEnv)) env[tokenEnv] = credential.accessToken;
	}
	return env;
}

function credentialExpired(credential: McpCredential): boolean {
	if (!credential.expiresAt) return false;
	const expires = Date.parse(credential.expiresAt);
	if (!Number.isFinite(expires)) return false;
	// Treat tokens within one minute of expiry as expired so the SDK does
	// not race the refresh path with an actually-expired credential.
	return Date.now() >= expires - 60_000;
}

function oauthClientMetadata(config: McpServerConfig): OAuthClientMetadata {
	const redirectUri = text(config.redirectUri) || text(config.redirect_uri) || "http://127.0.0.1/openbuddy/oauth/callback";
	return {
		redirect_uris: [redirectUri],
		client_name: "OpenBuddy",
		grant_types: config.refreshToken || text(config.refresh_token) ? ["authorization_code", "refresh_token"] : ["authorization_code"],
		response_types: ["code"],
		...(text(config.scope) ? { scope: text(config.scope) } : {}),
	};
}

export function createMcpOAuthProvider(config: McpServerConfig, credential: McpCredential | undefined, saveCredential?: (credential: McpCredential) => Promise<void>): OAuthClientProvider | undefined {
	if (!credential?.accessToken && !credential?.refreshToken) return undefined;
	const clientId = text(config.clientId) || text(config.client_id);
	if (!clientId) return undefined;
	const initialExpiry = credential.expiresAt && Number.isFinite(Date.parse(credential.expiresAt))
		? Math.max(0, Math.floor((Date.parse(credential.expiresAt) - Date.now()) / 1000))
		: undefined;
	let tokens: OAuthTokens | undefined = !credential?.accessToken
		? undefined
		: {
			access_token: credential.accessToken,
			token_type: credential.tokenType || "Bearer",
			...(credential.refreshToken ? { refresh_token: credential.refreshToken } : {}),
			...(initialExpiry !== undefined ? { expires_in: initialExpiry } : {}),
		};
	const metadata = oauthClientMetadata(config);
	const provider: OAuthClientProvider = {
		redirectUrl: metadata.redirect_uris[0],
		clientMetadata: metadata,
		clientInformation: () => ({ client_id: clientId, ...(text(config.clientSecret) ? { client_secret: text(config.clientSecret) } : {}) }),
		tokens: () => (credentialExpired(credential) ? undefined : tokens),
		saveTokens: async (next) => {
			const expiresAt = typeof next.expires_in === "number" ? new Date(Date.now() + next.expires_in * 1000).toISOString() : undefined;
			tokens = { ...next, ...(expiresAt ? { expires_in: Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)) } : {}) };
			if (saveCredential) await saveCredential({
				accessToken: next.access_token,
				refreshToken: next.refresh_token,
				tokenType: next.token_type,
				expiresAt,
			});
		},
		redirectToAuthorization: async () => undefined,
		saveCodeVerifier: () => undefined,
		codeVerifier: () => "openbuddy-mcp-code-verifier",
	};
	return provider;
}

export const defaultMcpConnectionFactory: McpConnectionFactory = {
	async connect(serverName, config, credential, hooks) {
		let transport: Transport;
		const url = text(config.url);
		if (url) {
			transport = new StreamableHTTPClientTransport(new URL(url), {
				requestInit: { headers: buildMcpHttpHeaders(config, credential) },
				authProvider: createMcpOAuthProvider(config, credential, hooks?.saveCredential),
			});
		} else {
		const command = text(config.command);
		if (!command) throw new Error(`MCP server ${serverName} has neither url nor command`);
		if (credential && credentialExpired(credential)) {
			throw Object.assign(new Error(`MCP server ${serverName}: stored OAuth access token is expired; re-authorization is required`), { code: "awaiting_authorization" });
		}
		transport = new StdioClientTransport({
				command,
				args: stringArray(config.args),
				env: buildMcpChildEnv(config, credential),
				cwd: text(config.cwd),
			});
		}
		const client = new Client({ name: "openbuddy", version: "0.14.0" }, { capabilities: {} });
		let closedListener: (() => void) | undefined;
		transport.onclose = () => closedListener?.();
		await client.connect(transport);
		return {
			listTools: async () => (await client.listTools()).tools,
			callTool: async (name, args, signal) => await client.callTool({ name, arguments: args }, CallToolResultSchema, { signal }) as CallToolResult,
			setToolsChanged: (listener) => client.setNotificationHandler(ToolListChangedNotificationSchema, listener),
			setClosed: (listener) => { closedListener = listener; },
			close: () => client.close(),
		};
	},
};

export class McpClient extends OpenBuddyService {
	static provide = "mcpClient" as const;

	private readonly host: McpResourceHost;
	private readonly pi: McpPiTools;
	private readonly factory: McpConnectionFactory;
	private readonly authorization?: { registerFlow(flow: { key: string; label: string; methods: readonly [{ id: string; label: string }, ...{ id: string; label: string }[]]; run(session: { signal: AbortSignal }): Promise<void> }): () => void; begin(request: { key: string; signal?: AbortSignal; interaction: { notify: () => void; prompt: () => Promise<string> } }): Promise<{ status: "authorized" | "cancelled" }> };
	private readonly active = new Map<string, ActiveServer>();
	private readonly runtimes = new Map<string, ServerRuntime>();
	private readonly statuses = new Map<string, McpServerStatus>();
	private reloadPromise: Promise<void> = Promise.resolve();
	private readonly authorizationDisposers = new Map<string, () => void>();
	private callSequence = 0;

	constructor(ctx: Context, host: McpResourceHost, pi: McpPiTools, factory = defaultMcpConnectionFactory) {
		super(ctx, "mcpClient");
		this.host = host;
		this.pi = pi;
		this.factory = factory;
		this.authorization = ctx.get("authorization") as typeof this.authorization;
	}

	list(): McpServerStatus[] {
		return [...this.statuses.values()].map((status) => ({ ...status }));
	}

	/** Return the raw tool names discovered from one connected MCP server. */
	listToolNames(serverName: string): string[] {
		const active = this.active.get(serverName);
		if (!active) return [];
		const prefix = `mcp__${safeServerName(serverName)}__`;
		return active.toolNames.map((name) => name.startsWith(prefix) ? name.slice(prefix.length) : name);
	}

	/** Call an already-connected MCP tool without creating a second transport. */
	async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
		const active = this.active.get(serverName);
		if (!active) throw new Error(`MCP server is not connected: ${serverName}`);
		const piToolName = mcpToolName(serverName, toolName);
		const callId = `mcp-${Date.now().toString(36)}-${++this.callSequence}`;
		const startedAt = Date.now();
		this.emitToolEvent({ phase: "start", callId, serverName, toolName, piToolName });
		try {
			const result = await active.connection.callTool(toolName, args);
			this.emitToolEvent({ phase: "end", callId, serverName, toolName, piToolName, durationMs: Date.now() - startedAt, ok: true });
			return { serverName, toolName, result };
		} catch (error) {
			this.emitToolEvent({ phase: "end", callId, serverName, toolName, piToolName, durationMs: Date.now() - startedAt, ok: false, error: error instanceof Error ? error.message : String(error) });
			throw error;
		}
	}

	private emitToolEvent(event: McpToolCallEvent): void {
		this.ctx.emit(`mcp/tool-${event.phase}`, event);
	}

	reload(): Promise<void> {
		this.reloadPromise = this.reloadPromise.catch(() => undefined).then(() => this.reloadNow());
		return this.reloadPromise;
	}

	private async reloadNow(): Promise<void> {
		await this.disposeConnections();
		for (const dispose of this.authorizationDisposers.values()) dispose();
		this.authorizationDisposers.clear();
		const config = await this.host.readConfig(this.host.getCwd());
		this.statuses.clear();
		for (const [serverName, server] of Object.entries(config.mcpServers ?? {})) {
			this.registerAuthorizationFlow(serverName);
			if (server.disabled === true || server.enabled === false) {
				this.statuses.set(serverName, { serverName, status: "disabled", toolCount: 0 });
				continue;
			}
			await this.connectServer(serverName, server);
		}
	}

	private registerAuthorizationFlow(serverName: string): void {
		if (!this.authorization || !this.host.authorize || this.authorizationDisposers.has(serverName)) return;
		const dispose = this.authorization.registerFlow({
			key: `mcp/${serverName}`,
			label: `MCP: ${serverName}`,
			methods: [{ id: "oauth", label: "OAuth" }],
			run: async ({ signal }) => {
				const result = await this.host.authorize!(serverName, signal);
				if (result.status !== "authenticated") throw new McpAuthorizationError(result);
			},
		});
		this.authorizationDisposers.set(serverName, dispose);
	}

	async authorize(serverName: string, signal?: AbortSignal): Promise<McpAuthorizationResult> {
		if (!this.authorization || !this.host.authorize) return { status: "failed", error: "MCP authorization service is unavailable" };
		if (!this.authorizationDisposers.has(serverName)) {
			const config = await this.host.readConfig(this.host.getCwd());
			if (!config.mcpServers?.[serverName]) return { status: "failed", error: `MCP server not found: ${serverName}` };
			this.registerAuthorizationFlow(serverName);
		}
		try {
			const result = await this.authorization.begin({
				key: `mcp/${serverName}`,
				signal,
				interaction: { notify: () => undefined, prompt: async () => "" },
			});
			return result.status === "authorized" ? { status: "authenticated" } : { status: "cancelled", error: "OAuth authorization cancelled" };
		} catch (error) {
			if (error instanceof McpAuthorizationError) return error.result;
			return { status: "failed", error: error instanceof Error ? error.message : String(error) };
		}
	}

	private async connectServer(serverName: string, config: McpServerConfig): Promise<void> {
		const runtime: ServerRuntime = { serverName, config, generation: 0, attempts: 0, disposed: false };
		this.runtimes.set(serverName, runtime);
		await this.startRuntime(runtime);
	}

	private reconnectPolicy(runtime: ServerRuntime) {
		const config = runtime.config.reconnect;
		return {
			enabled: config?.enabled ?? RECONNECT_DEFAULTS.enabled,
			initialDelayMs: Math.max(1, config?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs),
			maxDelayMs: Math.max(1, config?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs),
			maxAttempts: Math.max(1, Math.floor(config?.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts)),
		};
	}

	private async startRuntime(runtime: ServerRuntime): Promise<void> {
		if (runtime.disposed || runtime.connecting) return runtime.connecting;
		runtime.generation += 1;
		const generation = runtime.generation;
		this.statuses.set(runtime.serverName, { serverName: runtime.serverName, status: "connecting", toolCount: runtime.active?.toolNames.length ?? 0 });
		const connecting = this.connectRuntime(runtime, generation);
		runtime.connecting = connecting;
		try { await connecting; } finally {
			if (runtime.connecting === connecting) runtime.connecting = undefined;
			if (!runtime.disposed && generation === runtime.generation && !runtime.active && !runtime.timer) this.scheduleReconnect(runtime);
		}
	}

	private async connectRuntime(runtime: ServerRuntime, generation: number): Promise<void> {
		let connection: McpConnection | undefined;
		try {
			const credential = await this.host.readCredential(runtime.serverName, this.host.getCwd());
			const saveCredential = this.host.saveCredential ? {
				saveCredential: (next: McpCredential) => this.host.saveCredential!(runtime.serverName, next),
			} : undefined;
			connection = saveCredential
				? await this.factory.connect(runtime.serverName, runtime.config, credential, saveCredential)
				: await this.factory.connect(runtime.serverName, runtime.config, credential);
			if (runtime.disposed || generation !== runtime.generation) {
				await connection.close();
				return;
			}
			const active: ActiveServer = { connection, toolDisposers: [], toolNames: [] };
			runtime.active = active;
			this.active.set(runtime.serverName, active);
			connection.setToolsChanged?.(() => {
				void this.refreshTools(runtime.serverName).catch((error) => this.connectionFailed(runtime, generation, error));
			});
			connection.setClosed?.(() => this.connectionClosed(runtime, generation, active));
			await this.refreshTools(runtime.serverName);
			if (runtime.active !== active) return;
			runtime.connectedAt = Date.now();
		} catch (error) {
			if (connection) {
				try { await connection.close(); } catch { /* transport already gone */ }
			}
			if (!runtime.disposed && generation === runtime.generation) this.connectionFailed(runtime, generation, error);
		}
	}

	private connectionClosed(runtime: ServerRuntime, generation: number, active: ActiveServer): void {
		if (runtime.disposed || generation !== runtime.generation || runtime.active !== active) return;
		runtime.active = undefined;
		this.active.delete(runtime.serverName);
		for (const dispose of active.toolDisposers.splice(0)) dispose();
		void active.connection.close().catch((error) => this.ctx.emit("mcp/close-failed", { serverName: runtime.serverName, error: String(error) }));
		this.statuses.set(runtime.serverName, { serverName: runtime.serverName, status: "failed", toolCount: 0, error: "MCP connection closed" });
		this.scheduleReconnect(runtime);
	}

	private connectionFailed(runtime: ServerRuntime, generation: number, error: unknown): void {
		if (runtime.disposed || generation !== runtime.generation) return;
		const active = runtime.active;
		if (active) {
			runtime.active = undefined;
			this.active.delete(runtime.serverName);
			for (const dispose of active.toolDisposers.splice(0)) dispose();
			void active.connection.close().catch((closeError) => this.ctx.emit("mcp/close-failed", { serverName: runtime.serverName, error: String(closeError) }));
		}
		this.statuses.set(runtime.serverName, { serverName: runtime.serverName, status: "failed", toolCount: 0, error: String(error) });
		this.ctx.emit("mcp/failed", { serverName: runtime.serverName, error: String(error) });
		this.scheduleReconnect(runtime);
	}

	private scheduleReconnect(runtime: ServerRuntime): void {
		if (runtime.disposed || runtime.timer || runtime.connecting) return;
		const policy = this.reconnectPolicy(runtime);
		if (!policy.enabled || runtime.attempts >= policy.maxAttempts) return;
		if (runtime.connectedAt && Date.now() - runtime.connectedAt >= policy.maxDelayMs) runtime.attempts = 0;
		runtime.attempts += 1;
		const delay = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (runtime.attempts - 1));
		runtime.timer = setTimeout(() => {
			runtime.timer = undefined;
			void this.startRuntime(runtime);
		}, delay);
		runtime.timer.unref?.();
	}

	private async refreshTools(serverName: string): Promise<void> {
		const active = this.active.get(serverName);
		if (!active) return;
		const runtime = this.runtimes.get(serverName);
		const tools = await active.connection.listTools();
		if (this.active.get(serverName) !== active) return;
		const definitions = createMcpToolDefinitions(serverName, tools, active.connection, (event) => this.emitToolEvent(event));
		for (const dispose of active.toolDisposers.splice(0)) dispose();
		active.toolNames = definitions.map((tool) => tool.name);
		active.toolDisposers = definitions.map((tool) => this.pi.registerTool(tool));
		this.statuses.set(serverName, { serverName, status: "ready", toolCount: definitions.length, ...(typeof runtime?.config.emailProfile === "string" && runtime.config.emailProfile.trim() ? { emailProfile: runtime.config.emailProfile.trim() } : {}) });
		this.ctx.emit("mcp/ready", { serverName, toolCount: definitions.length });
	}

	private async disposeConnections(): Promise<void> {
		const runtimes = [...this.runtimes.values()];
		for (const runtime of runtimes) {
			runtime.disposed = true;
			runtime.generation += 1;
			if (runtime.timer) clearTimeout(runtime.timer);
			runtime.timer = undefined;
		}
		await Promise.all(runtimes.map((runtime) => runtime.connecting));
		const entries = [...this.active.entries()];
		this.active.clear();
		this.runtimes.clear();
		for (const [serverName, active] of entries) {
			for (const dispose of active.toolDisposers.splice(0)) dispose();
			try { await active.connection.close(); } catch (error) { this.ctx.emit("mcp/close-failed", { serverName, error: String(error) }); }
		}
	}

	async disposeConnectionsAndStop(): Promise<void> {
		await this.reloadPromise;
		await this.disposeConnections();
		for (const dispose of this.authorizationDisposers.values()) dispose();
		this.authorizationDisposers.clear();
	}
}

declare module "@openbuddy/cordis" {
	interface Context {
		mcpClient: McpClient
	}
}

export function mountMcpClient(ctx: Context): () => void {
	const host = ctx.get("mcpResources") as McpResourceHost | undefined;
	const pi = (ctx.get("pi") as { tools?: McpPiTools } | undefined)?.tools;
	if (!host || !pi || !ctx.get("authorization")) throw new Error("openbuddy-mcp-client requires mcpResources, authorization, and pi services");
	const service = new McpClient(ctx, host, pi);
	void service.reload().catch((error) => ctx.emit("mcp/failed", { error: String(error) }));
	ctx.effect(() => () => { void service.disposeConnectionsAndStop(); });
	return () => { void service.disposeConnectionsAndStop(); };
}
