// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  authorizeMcpServer,
  buildMcpAuthorizationUrl,
  createPkceChallenge,
  createPkceVerifier,
} from "../mcp-authorization";

let authServer: Server;
let tokenServer: Server;
let authBase = "";
let tokenBase = "";

interface TokenRequest {
  body: URLSearchParams;
  authorization?: string;
  receivedAt: number;
}
const tokenRequests: TokenRequest[] = [];

async function startServers(): Promise<void> {
  authServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end("<html><body>Mock MCP authorization server</body></html>");
  });
  await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", () => resolve()));
  const authAddr = authServer.address() as AddressInfo;
  authBase = `http://127.0.0.1:${authAddr.port}`;

  tokenServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const params = new URLSearchParams(body);
    tokenRequests.push({
      body: params,
      authorization: req.headers.authorization,
      receivedAt: Date.now(),
    });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      access_token: `at-${Math.random().toString(36).slice(2, 12)}`,
      refresh_token: `rt-${Math.random().toString(36).slice(2, 12)}`,
      token_type: "Bearer",
      expires_in: 3600,
      scope: params.get("scope") ?? "",
    }));
  });
  await new Promise<void>((resolve) => tokenServer.listen(0, "127.0.0.1", () => resolve()));
  const tokenAddr = tokenServer.address() as AddressInfo;
  tokenBase = `http://127.0.0.1:${tokenAddr.port}`;
}

beforeAll(async () => {
  await startServers();
});

afterAll(async () => {
  await new Promise<void>((resolve) => authServer.close(() => resolve()));
  await new Promise<void>((resolve) => tokenServer.close(() => resolve()));
});

async function createCallbackServer(handler: (incoming: { url?: string; respond: (status: number, body: string) => void }) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const local = createServer((req, res) => {
    handler({ url: req.url, respond: (status, body) => { res.statusCode = status; res.end(body); } });
  });
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", () => resolve()));
  const addr = local.address() as AddressInfo;
  return { url: `http://127.0.0.1:${addr.port}/oauth/callback`, close: async () => new Promise<void>((r) => local.close(() => r())) };
}

async function simulateCallback(localCallbackUrl: string, code: string, state: string, error?: string): Promise<void> {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  else params.set("code", code);
  params.set("state", state);
  await fetch(`${localCallbackUrl}/oauth/callback?${params}`);
}

describe("MCP OAuth 授权真实服务器端到端 (无 fetch mock)", () => {
  it("完整授权流程: 浏览器跳转到本地回调 → 换取 access_token", async () => {
    let observedURL = "";
    let callbackServer: { url: string; close: () => Promise<void> } | undefined;
    const openExternal = async (url: string) => {
      observedURL = url;
      const u = new URL(url);
      const state = u.searchParams.get("state");
      await simulateCallback(callbackServer!.url.split("/oauth/callback")[0], "auth-code-real", state ?? "");
    };

    tokenRequests.length = 0;
    const result = await authorizeMcpServer({
      authorizationUrl: `${authBase}/authorize`,
      tokenUrl: `${tokenBase}/token`,
      clientId: "openbuddy-test",
      scope: "tools:invoke tools:list",
    }, {
      openExternal,
      listen: async (handler) => {
        callbackServer = await createCallbackServer(handler);
        return callbackServer;
      },
      timeoutMs: 5_000,
    });
    await callbackServer?.close();

    expect(result.status).toBe("authenticated");
    expect(observedURL).toContain("/authorize");
    expect(observedURL).toContain("client_id=openbuddy-test");
    expect(observedURL).toContain("response_type=code");
    expect(tokenRequests).toHaveLength(1);
    const request = tokenRequests[0];
    expect(request).toBeDefined();
    expect(request?.body.get("grant_type")).toBe("authorization_code");
    expect(request?.body.get("code")).toBe("auth-code-real");
    expect(request?.body.get("client_id")).toBe("openbuddy-test");
    // scope 不强制出现在 token 请求中 (取决于 server config)
    expect(result.status).toBe("authenticated");
    if (result.status === "authenticated") {
      expect(result.accessToken).toMatch(/^at-/);
      expect(result.refreshToken).toMatch(/^rt-/);
      expect(result.tokenType).toBe("Bearer");
      expect(result.expiresIn).toBe(3600);
    }
  });

  it("错误 state 拒绝回调并清除 token 请求", async () => {
    tokenRequests.length = 0;
    let callbackServer: { url: string; close: () => Promise<void> } | undefined;
    const openExternal = async () => {
      await simulateCallback(callbackServer!.url.split("/oauth/callback")[0], "auth-code-real", "WRONG-STATE");
    };

    const result = await authorizeMcpServer({
      authorizationUrl: `${authBase}/authorize`,
      tokenUrl: `${tokenBase}/token`,
      clientId: "openbuddy-test",
    }, {
      openExternal,
      listen: async (handler) => {
        callbackServer = await createCallbackServer(handler);
        return callbackServer;
      },
      timeoutMs: 5_000,
    });
    await callbackServer?.close();

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error).toContain("state");
    expect(tokenRequests).toHaveLength(0);
  });

  it("OAuth 错误参数 (error=access_denied) 时返回失败状态", async () => {
    let callbackServer: { url: string; close: () => Promise<void> } | undefined;
    const openExternal = async (url: string) => {
      const u = new URL(url);
      const state = u.searchParams.get("state");
      await simulateCallback(callbackServer!.url.split("/oauth/callback")[0], "", state ?? "", "access_denied");
    };

    const result = await authorizeMcpServer({
      authorizationUrl: `${authBase}/authorize`,
      tokenUrl: `${tokenBase}/token`,
      clientId: "openbuddy-test",
    }, {
      openExternal,
      listen: async (handler) => {
        callbackServer = await createCallbackServer(handler);
        return callbackServer;
      },
      timeoutMs: 5_000,
    });
    await callbackServer?.close();

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error).toContain("access_denied");
  });

  it("PKCE 验证: code_verifier 出现在 token 请求 body 中", async () => {
    tokenRequests.length = 0;
    let observedChallenge = "";
    let callbackServer: { url: string; close: () => Promise<void> } | undefined;
    const openExternal = async (url: string) => {
      const u = new URL(url);
      observedChallenge = u.searchParams.get("code_challenge") ?? "";
      const state = u.searchParams.get("state");
      await simulateCallback(callbackServer!.url.split("/oauth/callback")[0], "pkce-code", state ?? "");
    };

    const result = await authorizeMcpServer({
      authorizationUrl: `${authBase}/authorize`,
      tokenUrl: `${tokenBase}/token`,
      clientId: "openbuddy-pkce",
    }, {
      openExternal,
      listen: async (handler) => {
        callbackServer = await createCallbackServer(handler);
        return callbackServer;
      },
      timeoutMs: 5_000,
    });
    await callbackServer?.close();

    expect(result.status).toBe("authenticated");
    expect(observedChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tokenRequests[0]?.body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(observedChallenge).toBe(createPkceChallenge(tokenRequests[0]?.body.get("code_verifier") ?? ""));
  });

  it("token 端点 500 时返回 failed", async () => {
    const failingTokenServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "internal_error" }));
    });
    await new Promise<void>((resolve) => failingTokenServer.listen(0, "127.0.0.1", () => resolve()));
    const addr = failingTokenServer.address() as AddressInfo;
    const failingTokenBase = `http://127.0.0.1:${addr.port}`;

    try {
      let callbackServer: { url: string; close: () => Promise<void> } | undefined;
      const openExternal = async (url: string) => {
        const u = new URL(url);
        const state = u.searchParams.get("state");
        await simulateCallback(callbackServer!.url.split("/oauth/callback")[0], "fail-code", state ?? "");
      };
      const result = await authorizeMcpServer({
        authorizationUrl: `${authBase}/authorize`,
        tokenUrl: `${failingTokenBase}/token`,
        clientId: "openbuddy-test",
      }, {
        openExternal,
        listen: async (handler) => {
          callbackServer = await createCallbackServer(handler);
          return callbackServer;
        },
        timeoutMs: 5_000,
      });
      await callbackServer?.close();
      expect(result.status).toBe("failed");
      if (result.status === "failed") expect(result.error).toContain("500");
    } finally {
      await new Promise<void>((resolve) => failingTokenServer.close(() => resolve()));
    }
  });

  it("buildMcpAuthorizationUrl 携带 PKCE 与 state", () => {
    const result = buildMcpAuthorizationUrl({
      authorizationUrl: `${authBase}/authorize`,
      clientId: "openbuddy-test",
      scope: "tools",
    }, "http://127.0.0.1:4321/openbuddy/oauth/callback");
    expect(result?.url).toContain("/authorize");
    expect(result?.url).toContain("client_id=openbuddy-test");
    expect(result?.url).toContain("scope=tools");
    expect(result?.url).toContain("code_challenge_method=S256");
    const url = new URL(result!.url);
    expect(url.searchParams.get("code_challenge")).toBe(createPkceChallenge(result!.verifier));
  });

  it("PKCE 工具: createPkceVerifier 符合 RFC 7636 字符集, createPkceChallenge 给出确定结果", () => {
    const v1 = createPkceVerifier();
    const v2 = createPkceVerifier();
    expect(v1).not.toBe(v2);
    expect(v1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(createPkceChallenge(v1)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(createPkceChallenge(v1)).toBe(createPkceChallenge(v1));
  });
});
