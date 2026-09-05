import { createServer, type Server } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export type McpAuthResult =
	| { status: "authenticated"; accessToken: string; refreshToken?: string; tokenType?: string; expiresIn?: number }
	| { status: "setup_required"; error: string; authorizationUrl?: string }
	| { status: "cancelled"; error: string }
	| { status: "failed"; error: string };

export interface McpOAuthServerConfig {
	authorizationUrl?: string;
	oauthUrl?: string;
	authUrl?: string;
	tokenUrl?: string;
	clientId?: string;
	clientSecret?: string;
	scope?: string;
	redirectUri?: string;
	redirectUris?: string[];
	oauth?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface McpOAuthOptions {
	openExternal: (url: string) => Promise<void> | void;
	fetchImpl?: typeof fetch;
	listen?: (handler: (request: { url?: string; respond: (status: number, body: string) => void }) => void) => Promise<{ url: string; close: () => Promise<void> }>;
	timeoutMs?: number;
	signal?: AbortSignal;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeHttpUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		if (url.protocol === "https:") return url.toString();
		if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return url.toString();
	} catch {
		return undefined;
	}
	return undefined;
}

function safeLoopbackRedirect(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
	} catch {
		return false;
	}
}

function configText(server: McpOAuthServerConfig, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const direct = text(server[key]);
		if (direct) return direct;
		const nested = server.oauth && text(server.oauth[key]);
		if (nested) return nested;
	}
	return undefined;
}

export function createPkceVerifier(): string {
	return randomBytes(32).toString("base64url");
}

export function createPkceChallenge(verifier: string): string {
	return createHash("sha256").update(verifier).digest("base64url");
}

export function buildMcpAuthorizationUrl(
	server: McpOAuthServerConfig,
	redirectUri: string,
	state = randomUUID(),
	verifier = createPkceVerifier(),
): { url: string; state: string; verifier: string } | undefined {
	const authorizationUrl = safeHttpUrl(configText(server, "authorizationUrl", "authorization_url", "oauthUrl", "oauth_url", "authUrl", "auth_url"));
	const clientId = configText(server, "clientId", "client_id");
	if (!authorizationUrl || !clientId || !safeLoopbackRedirect(redirectUri)) return undefined;
	const url = new URL(authorizationUrl);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("state", state);
	url.searchParams.set("code_challenge", createPkceChallenge(verifier));
	url.searchParams.set("code_challenge_method", "S256");
	const scope = configText(server, "scope");
	if (scope) url.searchParams.set("scope", scope);
	return { url: url.toString(), state, verifier };
}

async function defaultListen(handler: (request: { url?: string; respond: (status: number, body: string) => void }) => void) {
	let server: Server | undefined;
	server = createServer((request, response) => {
		handler({
			url: request.url,
			respond: (status, body) => {
				response.statusCode = status;
				response.setHeader("content-type", "text/plain; charset=utf-8");
				response.end(body);
			},
		});
	});
	await new Promise<void>((resolve, reject) => {
		server!.once("error", reject);
		server!.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("OAuth callback server did not expose a port");
	return {
		url: `http://127.0.0.1:${address.port}/openbuddy/oauth/callback`,
		close: async () => {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
		},
	};
}

export async function authorizeMcpServer(
	server: McpOAuthServerConfig,
	options: McpOAuthOptions,
): Promise<McpAuthResult> {
	const tokenUrl = safeHttpUrl(configText(server, "tokenUrl", "token_url"));
	if (!tokenUrl) return { status: "setup_required", error: "MCP OAuth tokenUrl is not configured" };
	if (!configText(server, "clientId", "client_id")) return { status: "setup_required", error: "MCP OAuth clientId is not configured" };
	const authorizationUrl = safeHttpUrl(configText(server, "authorizationUrl", "authorization_url", "oauthUrl", "oauth_url", "authUrl", "auth_url"));
	if (!authorizationUrl) return { status: "setup_required", error: "MCP OAuth authorizationUrl is not configured" };

	let callback: Awaited<ReturnType<NonNullable<McpOAuthOptions["listen"]>>> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let redirectUri: string | undefined;
	let authorizationRequest: ReturnType<typeof buildMcpAuthorizationUrl>;
	try {
		const result = await new Promise<{ code?: string; error?: string }>((resolve) => {
			const finish = (value: { code?: string; error?: string }) => { if (timer) clearTimeout(timer); resolve(value); };
			void (async () => {
				callback = await (options.listen ?? defaultListen)((incoming) => {
				try {
					const url = new URL(incoming.url ?? "/", callback!.url);
					if (url.pathname !== new URL(callback!.url).pathname || !authorizationRequest) return;
					if (url.searchParams.get("state") !== authorizationRequest.state) {
						incoming.respond(400, "Invalid OAuth state");
						finish({ error: "OAuth state validation failed" });
						return;
					}
					const error = url.searchParams.get("error");
					if (error) { incoming.respond(400, "OAuth authorization failed"); finish({ error }); return; }
					const code = url.searchParams.get("code");
					if (!code) { incoming.respond(400, "OAuth code is missing"); finish({ error: "OAuth authorization code is missing" }); return; }
					incoming.respond(200, "OpenBuddy authorization complete. You can close this window.");
					finish({ code });
				} catch { finish({ error: "Invalid OAuth callback" }); }
				});
				const configuredRedirect = configText(server, "redirectUri", "redirect_uri") ?? server.redirectUris?.map(text).find(Boolean);
				redirectUri = configuredRedirect ?? callback.url;
				if (!safeLoopbackRedirect(redirectUri)) { finish({ error: "MCP OAuth redirectUri must use a loopback HTTP callback" }); return; }
				authorizationRequest = buildMcpAuthorizationUrl(server, redirectUri);
				if (!authorizationRequest) { finish({ error: "MCP OAuth authorizationUrl is not configured" }); return; }
				timer = setTimeout(() => finish({ error: "OAuth authorization timed out" }), options.timeoutMs ?? 5 * 60_000);
				if (options.signal?.aborted) { finish({ error: "OAuth authorization cancelled" }); return; }
				options.signal?.addEventListener("abort", () => finish({ error: "OAuth authorization cancelled" }), { once: true });
				await options.openExternal(authorizationRequest.url);
			})().catch((error) => finish({ error: error instanceof Error ? error.message : String(error) }));
		});
		if (!result.code) return { status: result.error === "OAuth authorization cancelled" ? "cancelled" : "failed", error: result.error ?? "OAuth authorization failed" };
		if (!redirectUri || !authorizationRequest) return { status: "failed", error: "OAuth callback was not initialized" };

		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code: result.code,
			client_id: configText(server, "clientId", "client_id")!,
			redirect_uri: redirectUri,
			code_verifier: authorizationRequest.verifier,
		});
		const secret = configText(server, "clientSecret", "client_secret");
		if (secret) body.set("client_secret", secret);
		const response = await (options.fetchImpl ?? fetch)(tokenUrl, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
			body,
			signal: options.signal,
		});
		const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
		if (!response.ok) return { status: "failed", error: `OAuth token exchange failed (${response.status})` };
		const accessToken = text(payload.access_token);
		if (!accessToken) return { status: "failed", error: "OAuth token response did not contain access_token" };
		return {
			status: "authenticated",
			accessToken,
			refreshToken: text(payload.refresh_token),
			tokenType: text(payload.token_type),
			expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : undefined,
		};
	} catch (error) {
		return { status: "failed", error: error instanceof Error ? error.message : String(error) };
	} finally {
		if (timer) clearTimeout(timer);
		await callback?.close().catch(() => undefined);
	}
}
