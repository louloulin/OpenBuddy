import { describe, expect, it, vi } from "vitest";
import {
	authorizeMcpServer,
	buildMcpAuthorizationUrl,
	createPkceChallenge,
	createPkceVerifier,
} from "./mcp-authorization";

describe("MCP OAuth authorization", () => {
	it("builds an HTTPS authorization URL with PKCE", () => {
		const result = buildMcpAuthorizationUrl({
			authorizationUrl: "https://mcp.example.test/authorize?existing=1",
			clientId: "openbuddy",
			scope: "tools",
		}, "http://127.0.0.1:4321/openbuddy/oauth/callback", "00000000-0000-4000-8000-000000000001", "verifier-1");

		expect(result?.state).toBe("00000000-0000-4000-8000-000000000001");
		expect(result?.verifier).toBe("verifier-1");
		const url = new URL(result!.url);
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("state")).toBe("00000000-0000-4000-8000-000000000001");
		expect(url.searchParams.get("code_challenge")).toBe(createPkceChallenge("verifier-1"));
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(createPkceVerifier()).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("rejects insecure remote authorization endpoints", () => {
		expect(buildMcpAuthorizationUrl({ authorizationUrl: "http://mcp.example.test/authorize", clientId: "x" }, "http://127.0.0.1/callback")).toBeUndefined();
		expect(buildMcpAuthorizationUrl({ authorizationUrl: "https://mcp.example.test/authorize" }, "http://127.0.0.1/callback")).toBeUndefined();
	});

	it("validates callback state and exchanges the code", async () => {
		let callback: ((request: { url?: string; respond: (status: number, body: string) => void }) => void) | undefined;
		const openExternal = vi.fn(async () => {
			callback?.({
				url: "/openbuddy/oauth/callback?code=auth-code&state=known-state",
				respond: vi.fn(),
			});
		});
		const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			expect(new URLSearchParams(String(init?.body)).get("code")).toBe("auth-code");
			expect(new URLSearchParams(String(init?.body)).get("code_verifier")).toBe("verifier");
			return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", token_type: "Bearer", expires_in: 3600 }), { status: 200 });
		});
		const result = await authorizeMcpServer({
			authorizationUrl: "https://mcp.example.test/authorize",
			tokenUrl: "https://mcp.example.test/token",
			clientId: "openbuddy",
			redirectUri: "http://127.0.0.1:4321/openbuddy/oauth/callback",
		}, {
			openExternal,
			fetchImpl,
			listen: async (handler) => {
				callback = handler;
				return { url: "http://127.0.0.1:4321/openbuddy/oauth/callback", close: async () => undefined };
			},
			timeoutMs: 100,
		});

		expect(result).toEqual({ status: "failed", error: "OAuth state validation failed" });
		expect(openExternal).toHaveBeenCalledOnce();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("returns authenticated after a valid callback and token response", async () => {
		let callback: ((request: { url?: string; respond: (status: number, body: string) => void }) => void) | undefined;
		const openExternal = vi.fn(async (url: string) => {
			const state = new URL(url).searchParams.get("state");
			callback?.({ url: `/openbuddy/oauth/callback?code=auth-code&state=${state}`, respond: vi.fn() });
		});
		const result = await authorizeMcpServer({
			authorizationUrl: "https://mcp.example.test/authorize",
			tokenUrl: "https://mcp.example.test/token",
			clientId: "openbuddy",
		}, {
			openExternal,
			fetchImpl: async () => new Response(JSON.stringify({ access_token: "access" }), { status: 200 }),
			listen: async (handler) => {
				callback = handler;
				return { url: "http://127.0.0.1:4321/openbuddy/oauth/callback", close: async () => undefined };
			},
		});

		expect(result).toMatchObject({ status: "authenticated", accessToken: "access" });
	});

	it("does not open a browser when required OAuth metadata is missing", async () => {
		const openExternal = vi.fn();
		await expect(authorizeMcpServer({ clientId: "x" }, { openExternal })).resolves.toEqual({
			status: "setup_required",
			error: "MCP OAuth tokenUrl is not configured",
		});
		expect(openExternal).not.toHaveBeenCalled();
	});
});
