import { bool, text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `mcp` module. MCP servers, config file, test-connect and OAuth sign-in (pii W2.4). */
export function mcpModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  const commands: Record<string, Handler> = {
    mcp_list: () => engine.mcp.list(),
    mcp_config_path: () => engine.mcp.path,
    mcp_config_read: () => engine.mcp.read(),
    mcp_config_save: async (p) => {
      engine.mcp.save(text(p.content));
      await engine.reload();
    },
    mcp_upsert: async (p) => {
      engine.mcp.upsert(p.server);
      await engine.reload();
    },
    mcp_delete: async (p) => {
      engine.mcp.delete(text(p.name));
      await engine.reload();
    },
    mcp_toggle: async (p) => {
      engine.mcp.toggle(text(p.name), bool(p.enabled));
      await engine.reload();
    },
    /** 测试连接 (W2.4): one real connect + tool listing; no session needed. */
    mcp_test: (p) => engine.mcp.testConnect(text(p.name)),
    // Sign-in no longer requires an open task (W2.4): the session id only tags the request so a
    // closing session can cancel its own pending sign-in.
    mcp_auth_trigger: async (p) => {
      const id = typeof p.sessionId === "string" ? p.sessionId : "";
      const result = await engine.mcp.signIn(id, text(p.serverName));
      if (result.status === "authenticated") await engine.reload();
      return result;
    },
    mcp_auth_status: (p) => {
      const id = typeof p.sessionId === "string" ? p.sessionId : "";
      if (id && !engine.has(id)) throw Error("会话未加载");
      return engine.mcp.authStatus();
    },
  };
  return { id: "mcp", commands };
}
