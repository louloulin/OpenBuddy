import {
  createMcpExtension,
  type McpExtensionOptions,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { JsonStore, object, text, type Settings } from "./settings.js";
type Config = { mcpServers: Record<string, Record<string, unknown>> };
export class McpService {
  private store: JsonStore<Config>;
  constructor(private settings: Settings) {
    this.store = new JsonStore(join(settings.dir, "mcp.json"), () => ({
      mcpServers: {},
    }));
  }
  get path() {
    return this.store.path;
  }
  list() {
    return Object.entries(this.store.read().mcpServers).map(([name, c]) => ({
      name,
      transport: c.command ? "stdio" : "streamable_http",
      target: c.command ?? c.url,
      enabled: c.enabled !== false,
      source: "user",
    }));
  }
  read() {
    return {
      filePath: this.path,
      content: JSON.stringify(this.store.read(), null, 2),
    };
  }
  save(content: string) {
    const parsed = object(JSON.parse(content)),
      servers = object(parsed.mcpServers ?? {}),
      result: Config = { mcpServers: {} };
    const secretUpdates: Array<[string, string]> = [];
    for (const [name, raw] of Object.entries(servers)) {
      text(name);
      const c = object(raw);
      if (c.oauth || c.auth)
        throw Error("not_implemented: MCP OAuth/provider token delegation");
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
      const value: Record<string, unknown> = { ...c, exposure: "direct" };
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
  extension() {
    const loadConfig: NonNullable<McpExtensionOptions["loadConfig"]> = () => ({
      servers: Object.entries(this.store.read().mcpServers).map(
        ([name, raw]) => {
          const config = { ...raw };
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
        },
      ),
      errors: [],
      autoEnableCodemode: false,
    });
    return createMcpExtension({
      loadConfig,
      openUrl: () => {
        throw Error("not_implemented: MCP OAuth");
      },
    });
  }
}
