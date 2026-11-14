// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings } from "../settings.js";
import { McpAuthService } from "../mcp-auth.js";
import { createEngineHandlers } from "@openbuddy/host/handlers/agent";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s.split("").reverse().join("")),
  decryptString: (b: Buffer) => b.toString().split("").reverse().join(""),
};
async function setup(
  browser: "success" | "wait" | "error" = "success",
  timeoutMs = 5000,
) {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-oauth-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  let origin = "",
    opens = 0,
    refreshes = 0,
    wrongStateStatus = 0,
    authorizedRequests = 0;
  let lastAuthorization: URL | undefined;
  let rejectToken = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, origin);
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/mcp") {
      if (req.headers.authorization === "Bearer secret-access-token") {
        authorizedRequests++;
        if (req.method === "DELETE") {
          res.end("{}");
          return;
        }
        const message = JSON.parse(body || "{}");
        if (message.id === undefined) {
          res.statusCode = 202;
          res.end();
          return;
        }
        const result =
          message.method === "initialize"
            ? {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "oauth-fixture", version: "1" },
              }
            : {
                tools: [
                  {
                    name: "ping",
                    description: "Authenticated ping",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              };
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
        return;
      }
      res.writeHead(401, {
        "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end("{}");
      return;
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      res.end(
        JSON.stringify({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ["read"],
        }),
      );
      return;
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      res.end(
        JSON.stringify({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        }),
      );
      return;
    }
    if (url.pathname === "/register") {
      const client = JSON.parse(body);
      res.end(JSON.stringify({ client_id: "local-client", ...client }));
      return;
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "refresh_token") refreshes++;
      else {
        expect(form.get("code")).toBe("local-code");
        expect(form.get("code_verifier")?.length).toBeGreaterThan(30);
      }
      if (rejectToken) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      res.end(
        JSON.stringify({
          access_token: "secret-access-token",
          refresh_token: "secret-refresh-token",
          token_type: "Bearer",
          expires_in: 1,
          scope: "read",
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const settings = createSettings(root, safe);
  const openUrl = async (value: string) => {
    opens++;
    const url = new URL(value);
    lastAuthorization = url;
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();
    if (browser === "wait") return;
    const redirect = new URL(url.searchParams.get("redirect_uri")!);
    redirect.searchParams.set("code", "local-code");
    redirect.searchParams.set("state", "wrong-state");
    wrongStateStatus = (await fetch(redirect)).status;
    redirect.searchParams.set("state", url.searchParams.get("state")!);
    if (browser === "error") {
      redirect.searchParams.delete("code");
      redirect.searchParams.set("error", "access_denied");
    }
    await fetch(redirect);
  };
  const auth = new McpAuthService(settings, openUrl, () => {}, timeoutMs);
  cleanup.push(async () => {
    auth.cancel();
  });
  return {
    root,
    auth,
    openUrl,
    get authorizedRequests() {
      return authorizedRequests;
    },
    url: `${origin}/mcp`,
    get opens() {
      return opens;
    },
    get refreshes() {
      return refreshes;
    },
    get wrongStateStatus() {
      return wrongStateStatus;
    },
    get lastAuthorization() {
      return lastAuthorization;
    },
    failToken: () => {
      rejectToken = true;
    },
  };
}
async function until(fn: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > deadline) throw Error("timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
it("uses real SDK PKCE, rejects a mismatched callback state, stores encrypted tokens and refreshes without reopening browser", async () => {
  const f = await setup();
  expect(f.auth.status("fixture", f.url)).toMatchObject({
    status: "needs_auth",
  });
  expect(await f.auth.trigger("session", "fixture", f.url)).toEqual({
    status: "authenticated",
  });
  expect(f.wrongStateStatus).toBe(400);
  expect(f.auth.status("fixture", f.url)).toMatchObject({
    status: "authenticated",
  });
  expect(JSON.stringify(f.auth.status("fixture", f.url))).not.toContain(
    "secret-",
  );
  expect(await f.auth.trigger("session", "fixture", f.url)).toEqual({
    status: "authenticated",
  });
  expect(f.opens).toBe(1);
  expect(f.refreshes).toBe(1);
  const files = await readdir(join(f.root, "pi"));
  expect(files).not.toContain("mcp-auth.json");
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const body = await readFile(join(f.root, "pi", file), "utf8");
    expect(body).not.toContain("secret-access-token");
    expect(body).not.toContain("secret-refresh-token");
  }
});
it("reports failed token exchange after an expired refresh instead of claiming authentication", async () => {
  const f = await setup();
  expect(await f.auth.trigger("session", "fixture", f.url)).toEqual({
    status: "authenticated",
  });
  f.failToken();
  expect(await f.auth.trigger("session", "fixture", f.url)).toMatchObject({
    status: "failed",
  });
  expect(f.refreshes).toBeGreaterThan(0);
  expect(f.auth.status("fixture", f.url).status).toBe("needs_auth");
});
it("exposes IPC auth status and sends the encrypted OAuth token through the real MCP extension", async () => {
  const f = await setup();
  const app = await createEngineHandlers({
    userDataDir: f.root,
    safeStorage: safe,
    emit: () => {},
    shell: {
      openPath: async () => "",
      showItemInFolder: () => {},
      openExternal: f.openUrl,
    },
  });
  cleanup.push(app.dispose);
  const call = async (name: string, p: Record<string, unknown> = {}) =>
    app.handlers[name](p);
  await call("providers_save_provider", {
    provider: {
      id: "fixture",
      providerKind: "custom",
      baseUrl: f.url.replace("/mcp", "/v1"),
      apiKey: "model-key",
    },
  });
  await call("providers_save_model", {
    model: { modelId: "fixture", providerId: "fixture" },
  });
  const sid = await call("agent_new_session", {
    cwd: f.root,
    modelId: "fixture",
  });
  await call("mcp_upsert", {
    sessionId: sid,
    server: { name: "secured", transport: "http", target: f.url },
  });
  expect(f.opens).toBe(0);
  expect(await call("mcp_auth_status", { sessionId: sid })).toEqual([
    { serverName: "secured", status: "needs_auth" },
  ]);
  expect(
    await call("mcp_auth_trigger", { sessionId: sid, serverName: "secured" }),
  ).toEqual({ status: "authenticated" });
  await until(() => f.authorizedRequests > 0);
  expect(
    ((await call("mcp_auth_status", { sessionId: sid })) as any[])[0].status,
  ).toBe("authenticated");
});
it("cancels a waiting SDK callback, closes its listener, and clears pending PKCE state", async () => {
  const f = await setup("wait");
  const flow = f.auth.trigger("session", "fixture", f.url);
  await until(() => f.opens === 1);
  f.auth.cancel("session");
  expect(await flow).toEqual({ status: "cancelled" });
  expect(f.auth.status("fixture", f.url)).toMatchObject({
    status: "needs_auth",
  });
  const state = await f.auth.credentials.forServer("fixture", f.url).load();
  expect(state?.codeVerifier).toBeUndefined();
  expect(state?.oauthState).toBeUndefined();
  const callback = f.lastAuthorization!.searchParams.get("redirect_uri")!;
  await expect(fetch(callback)).rejects.toThrow();
});
it("times out a waiting SDK callback and reports authorization denial without saving tokens", async () => {
  const timeout = await setup("wait", 80);
  expect(await timeout.auth.trigger("session", "fixture", timeout.url)).toEqual(
    { status: "cancelled" },
  );
  const denied = await setup("error");
  expect(
    await denied.auth.trigger("session", "fixture", denied.url),
  ).toMatchObject({ status: "failed" });
  expect(denied.auth.status("fixture", denied.url)).toMatchObject({
    status: "needs_auth",
  });
});
