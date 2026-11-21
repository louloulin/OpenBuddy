import {
  createMcpExtension,
  type McpExtensionOptions,
} from "@earendil-works/pi-coding-agent";
import { McpClient, StdioTransport, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import { join } from "node:path";
import { JsonStore, object, text, type Settings } from "../settings/settings.js";
import { McpAuthService } from "./mcp-auth.js";
import type { Emit } from "@openbuddy/kernel";
import type { McpOAuthSettings } from "@earendil-works/pi-mcp/oauth";
import type { McpServerEntry, McpTestResult } from "@openbuddy/protocol/dto";
type Config = { mcpServers: Record<string, Record<string, unknown>> };
export type { McpTestResult };
export class McpService {
  private store: JsonStore<Config>;
  readonly auth: McpAuthService;
  constructor(
    private settings: Settings,
    openUrl: (url: string) => Promise<void>,
    emit: Emit,
  ) {
    this.auth = new McpAuthService(settings, openUrl, emit);
    this.store = new JsonStore(join(settings.dir, "mcp.json"), () => ({
      mcpServers: {},
    }), { versioned: true, snapshots: settings.snapshots });
  }
  get path() {
    return this.store.path;
  }
  list(): McpServerEntry[] {
    return Object.entries(this.store.read().mcpServers).map(([name, c]) => ({
      name,
      transport: c.command ? "stdio" : "streamable_http",
      target: String(c.command ?? c.url ?? ""),
      enabled: c.enabled !== false,
      source: "user",
      // W2.4 status: a URL server whose OAuth token is missing/expired needs the user's sign-in.
      ...(typeof c.url === "string" &&
      !Object.keys(object(c.headers ?? {})).some((k) => k.toLowerCase() === "authorization") &&
      this.auth.status(name, c.url).status !== "authenticated"
        ? { needsAuth: true }
        : {}),
    }));
  }
  read() {
    return {
      filePath: this.path,
      content: JSON.stringify(this.store.read(), null, 2),
    };
  }

  /**
   * 能力包 MCP (B1b): register declared servers as **disabled**; the user enables them in
   * 连接器. Same-name entries are left untouched so a package never overwrites the user's config.
   */
  registerFromPack(servers: Array<{ name: string; config: Record<string, unknown> }>): {
    installed: string[];
    skipped: Array<{ name: string; reason: string }>;
  } {
    const config = this.store.read();
    const installed: string[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    for (const server of servers) {
      if (config.mcpServers[server.name]) {
        skipped.push({ name: server.name, reason: "同名 MCP 服务已存在" });
        continue;
      }
      config.mcpServers[server.name] = { ...server.config, enabled: false };
      installed.push(server.name);
    }
    if (installed.length) this.store.write(config);
    return { installed, skipped };
  }

  /** 延迟暴露 (W2.4 / S11): true when at least one server defers its tools behind `tool_search`. */
  usesDeferred(): boolean {
    return Object.values(this.store.read().mcpServers).some(
      (server) => server.exposure === "deferred" || server.exposure === "codemode",
    );
  }

  /**
   * Rewrite every server's default exposure. The advanced JSON editor can override a single server
   * afterwards. Returns the new deferred state.
   */
  setDeferred(deferred: boolean): boolean {
    const config = this.store.read();
    const exposure = deferred ? "deferred" : "direct";
    config.mcpServers = Object.fromEntries(
      Object.entries(config.mcpServers).map(([name, server]) => [name, { ...server, exposure }]),
    );
    this.store.write(config);
    return this.usesDeferred();
  }
  save(content: string) {
    const parsed = object(JSON.parse(content)),
      servers = object(parsed.mcpServers ?? {}),
      result: Config = { mcpServers: {} };
    const secretUpdates: Array<[string, string]> = [];
    for (const [name, raw] of Object.entries(servers)) {
      text(name);
      const c = object(raw);
      if (c.auth) throw Error("not_implemented: MCP provider token delegation");
      const known = [
        "command",
        "url",
        "args",
        "env",
        "headers",
        "enabled",
        "exposure",
        "timeout",
        "cwd",
        "type",
        "description",
        "oauth",
      ];
      if (Object.keys(c).some((k) => !known.includes(k)))
        throw Error(`不支持的 MCP 配置字段: ${name}`);
      if (typeof c.command !== "string" && typeof c.url !== "string")
        throw Error(`MCP ${name} 缺少 command/url`);
      if (c.url) {
        const url = new URL(text(c.url));
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw Error("MCP URL 不允许凭据、查询或片段");
      }
      if (
        c.args !== undefined &&
        (!Array.isArray(c.args) || !c.args.every((a) => typeof a === "string"))
      )
        throw Error("MCP args必须为字符串数组");
      if (c.enabled !== undefined && typeof c.enabled !== "boolean")
        throw Error("MCP enabled必须为布尔值");
      // 延迟暴露 (W2.4 / S11): keep the user's exposure. `deferred` needs the built-in tool_search,
      // which the session adds when any server uses it; default stays `direct`.
      const exposure = c.exposure ?? "direct";
      if (!["direct", "deferred", "codemode", "hidden"].includes(String(exposure)))
        throw Error(`MCP ${name} exposure 无效`);
      const value: Record<string, unknown> = { ...c, exposure };
      if (c.oauth !== undefined) {
        if (!c.url) throw Error("OAuth只适用于HTTP MCP");
        const oauth = { ...object(c.oauth) };
        const allowed = [
          "clientId",
          "clientSecret",
          "callbackPort",
          "callbackUrl",
          "scope",
          "clientName",
          "clientRegistration",
        ];
        if (Object.keys(oauth).some((k) => !allowed.includes(k)))
          throw Error("不支持的OAuth设置");
        for (const field of [
          "clientId",
          "clientSecret",
          "callbackUrl",
          "scope",
          "clientName",
        ])
          if (oauth[field] !== undefined && typeof oauth[field] !== "string")
            throw Error(`OAuth ${field}必须为字符串`);
        if (
          oauth.callbackPort !== undefined &&
          (typeof oauth.callbackPort !== "number" ||
            !Number.isInteger(oauth.callbackPort) ||
            oauth.callbackPort < 1 ||
            oauth.callbackPort > 65535)
        )
          throw Error("无效的OAuth回调端口");
        if (
          oauth.clientRegistration !== undefined &&
          !["auto", "dcr", "cimd"].includes(String(oauth.clientRegistration))
        )
          throw Error("无效的OAuth客户端注册模式");
        if (oauth.clientSecret !== undefined) {
          const id = `mcp:${name}:oauth:clientSecret`;
          if (oauth.clientSecret === "••••") {
            if (!this.settings.secrets.has(id))
              throw Error("OAuth secret掩码没有对应凭据");
          } else secretUpdates.push([id, String(oauth.clientSecret)]);
          oauth.clientSecret = "••••";
        }
        value.oauth = oauth;
      }
      for (const field of ["env", "headers"])
        if (c[field] !== undefined) {
          const values = object(c[field]),
            masked: Record<string, string> = {};
          for (const [key, v] of Object.entries(values)) {
            if (typeof v !== "string")
              throw Error("MCP env/header必须为字符串");
            const id = `mcp:${name}:${field}:${key}`;
            if (v === "••••") {
              if (!this.settings.secrets.has(id))
                throw Error("掩码没有已保存的凭据");
            } else secretUpdates.push([id, v]);
            masked[key] = "••••";
          }
          value[field as "env"] = masked;
        }
      result.mcpServers[name] = value;
    }
    for (const [id, value] of secretUpdates)
      this.settings.secrets.set(id, value);
    this.store.write(result);
  }
  upsert(raw: unknown) {
    const s = object(raw),
      name = text(s.name),
      transport = text(s.transport),
      config = this.store.read();
    if (!["stdio", "http", "streamable_http"].includes(transport))
      throw Error("不支持的 MCP transport");
    config.mcpServers[name] = {
      ...(transport === "stdio"
        ? { command: text(s.target), args: s.args ?? [], env: s.env ?? {} }
        : { url: text(s.target), headers: s.headers ?? {} }),
      enabled: s.enabled ?? true,
      ...(s.oauth === undefined ? {} : { oauth: s.oauth }),
    };
    this.save(JSON.stringify(config));
  }
  delete(name: string) {
    const c = this.store.read();
    if (!c.mcpServers[name]) throw Error("MCP server不存在");
    delete c.mcpServers[name];
    this.store.write(c);
  }
  toggle(name: string, enabled: boolean) {
    const c = this.store.read();
    if (!c.mcpServers[name]) throw Error("MCP server不存在");
    c.mcpServers[name].enabled = enabled;
    this.store.write(c);
  }
  /** Unmask `env` / `headers` for a server (W2.4: both the live extension and the test connect). */
  private secretsOf(name: string, config: Record<string, unknown>) {
    const out: Record<string, Record<string, string>> = {};
    for (const field of ["env", "headers"] as const)
      if (config[field])
        out[field] = Object.fromEntries(
          Object.keys(object(config[field])).map((key) => [
            key,
            this.settings.secrets.get(`mcp:${name}:${field}:${key}`) ?? "",
          ]),
        );
    return out;
  }
  /**
   * 测试连接 (pii W2.4): connect once, list the tools, close. Runs without a session, so a server
   * can be validated before it is used in a turn; the duration tells the user whether it is slow.
   */
  async testConnect(name: string, timeoutMs = 8000): Promise<McpTestResult> {
    const config = this.store.read().mcpServers[name];
    if (!config) throw Error("MCP server不存在");
    const stdio = typeof config.command === "string";
    const transportName = stdio ? "stdio" : "streamable_http";
    const secrets = this.secretsOf(name, config);
    const client = new McpClient({ name: "OpenBuddy", version: "1.0.0", requestTimeoutMs: timeoutMs });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const started = Date.now();
    try {
      const transport = stdio
        ? new StdioTransport({
            command: String(config.command),
            args: Array.isArray(config.args) ? config.args.map(String) : [],
            cwd: typeof config.cwd === "string" ? config.cwd : undefined,
            env: secrets.env ?? {},
            stderr: "pipe",
          })
        : new StreamableHttpTransport({
            url: String(config.url),
            headers: {
              ...(secrets.headers ?? {}),
              // A completed OAuth sign-in supplies the bearer token when no static one is configured.
              ...(Object.keys(secrets.headers ?? {}).some((k) => k.toLowerCase() === "authorization")
                ? {}
                : this.auth.credentials.tokens(name, String(config.url))?.access_token
                  ? { Authorization: `Bearer ${this.auth.credentials.tokens(name, String(config.url))!.access_token}` }
                  : {}),
            },
            openGetStream: false,
          });
      const init = await client.connect(transport);
      const tools = await client.listTools({ signal: controller.signal, timeoutMs });
      return {
        name,
        ok: true,
        ms: Date.now() - started,
        transport: transportName,
        serverInfo: {
          ...(init.serverInfo?.name ? { name: init.serverInfo.name } : {}),
          ...(init.serverInfo?.version ? { version: String(init.serverInfo.version) } : {}),
        },
        tools: tools.map((tool) => ({
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
        })),
      };
    } catch (error) {
      const message =
        controller.signal.aborted
          ? `连接超时（${timeoutMs}ms）`
          : error instanceof Error
            ? error.message
            : String(error);
      return {
        name,
        ok: false,
        ms: Date.now() - started,
        transport: transportName,
        error: String(this.settings.secrets.redact(message)),
      };
    } finally {
      clearTimeout(timer);
      await client.close().catch(() => {});
    }
  }
  private oauthSettings(
    name: string,
    config: Record<string, unknown>,
  ): McpOAuthSettings {
    const oauth = { ...object(config.oauth ?? {}) };
    if (oauth.clientSecret === "••••")
      oauth.clientSecret = this.settings.secrets.get(
        `mcp:${name}:oauth:clientSecret`,
      );
    return oauth as McpOAuthSettings;
  }
  authStatus() {
    return Object.entries(this.store.read().mcpServers)
      .filter(
        ([, c]) =>
          typeof c.url === "string" &&
          !Object.keys(object(c.headers ?? {})).some(
            (k) => k.toLowerCase() === "authorization",
          ),
      )
      .map(([name, c]) => this.auth.status(name, String(c.url)));
  }
  async signIn(sessionId: string, name: string) {
    const config = this.authConfig(name);
    return this.auth.trigger(
      sessionId,
      name,
      config.url,
      config.oauth,
    );
  }
  /** 授权尝试 (B3a): start without waiting; the UI polls/awaits `agent://mcp-auth`. */
  authBegin(sessionId: string, name: string) {
    const config = this.authConfig(name);
    return this.auth.begin(sessionId, name, config.url, config.oauth);
  }
  authAttempt(id: string) {
    return this.auth.attempt(id);
  }
  authAttempts(sessionId?: string) {
    return this.auth.attemptsFor(sessionId);
  }
  authCancelAttempt(id: string) {
    return this.auth.cancelAttempt(id);
  }
  private authConfig(name: string) {
    const config = this.store.read().mcpServers[name];
    if (!config || config.enabled === false)
      throw Error("MCP server不存在或未启用");
    if (typeof config.url !== "string") throw Error("stdio MCP无需OAuth");
    if (
      Object.keys(object(config.headers ?? {})).some(
        (k) => k.toLowerCase() === "authorization",
      )
    )
      throw Error("该MCP使用静态Authorization，请先移除再使用OAuth");
    return { url: config.url, oauth: this.oauthSettings(name, config) };
  }
  /** `disabled`: 本任务连接器开关 (W2.4 P2) — names this session keeps off. */
  extension(disabled: string[] = []) {
    const off = new Set(disabled);
    const loadConfig: NonNullable<McpExtensionOptions["loadConfig"]> = () => ({
      servers: Object.entries(this.store.read().mcpServers)
        .filter(([name]) => !off.has(name))
        .map(([name, raw]) => {
          const config = { ...raw };
          if (config.oauth) config.oauth = this.oauthSettings(name, config);
          for (const field of ["env", "headers"])
            if (config[field])
              config[field] = Object.fromEntries(
                Object.keys(object(config[field])).map((key) => [
                  key,
                  this.settings.secrets.get(`mcp:${name}:${field}:${key}`) ??
                    "",
                ]),
              );
          return {
            name,
            config: config as never,
            source: this.path,
            scope: "global" as const,
          };
        }),
      errors: [],
      autoEnableCodemode: false,
    });
    return createMcpExtension({
      loadConfig,
      credentials: this.auth.credentials.asSdkCredentials(),
      // Authentication is initiated exclusively through mcp_auth_trigger IPC.
      openUrl: () => {
        throw Error("请通过MCP授权按钮启动认证");
      },
    });
  }
}
