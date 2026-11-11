import {
  createSettings,
  bool,
  object,
  text,
  unsupported,
  type SafeStorage,
} from "../../services/settings.js";
import { fileHandlers, type DesktopShell } from "../../services/files.js";
import { PiEngine } from "../../agent/pi.js";
import type { Emit } from "../../agent/permissions.js";
export interface EngineOptions {
  userDataDir: string;
  emit: Emit;
  safeStorage: SafeStorage;
  shell: DesktopShell;
}
export type Handler = (
  payload: Record<string, unknown>,
) => unknown | Promise<unknown>;
export async function createEngineHandlers(options: EngineOptions) {
  const settings = createSettings(options.userDataDir, options.safeStorage);
  const emit: Emit = (event, payload) =>
    options.emit(event, settings.secrets.redact(payload));
  const engine = new PiEngine(settings, emit);
  await engine.initialize();
  const update = (fn: (c: ReturnType<typeof settings.config.read>) => void) => {
    const c = settings.config.read();
    fn(c);
    settings.config.write(c);
  };
  const handlers: Record<string, Handler> = {
    agent_init: (p) =>
      engine.init(typeof p.cwd === "string" ? p.cwd : undefined),
    agent_auth_status: () => engine.providers.authStatus(),
    agent_new_session: (p) =>
      engine.newSession(
        text(p.cwd),
        typeof p.modelId === "string" ? p.modelId : undefined,
      ),
    agent_load_session: (p) =>
      engine.load(
        text(p.sessionId),
        typeof p.cwd === "string" ? p.cwd : undefined,
      ),
    agent_list_sessions: (p) => engine.list(text(p.cwd)),
    agent_list_workspaces: async () => {
      const map = new Map<
        string,
        { cwd: string; sessionCount: number; lastTitle?: string }
      >();
      for (const s of await engine.all()) {
        const e = map.get(s.cwd) ?? {
          cwd: s.cwd,
          sessionCount: 0,
          lastTitle: s.name ?? s.firstMessage,
        };
        e.sessionCount++;
        map.set(s.cwd, e);
      }
      return [...map.values()];
    },
    agent_send: (p) => engine.send(text(p.sessionId), text(p.text)),
    agent_cancel: (p) => engine.cancel(text(p.sessionId)),
    agent_shutdown: () => engine.shutdown(),
    agent_delete_session: (p) => engine.delete(text(p.sessionId)),
    agent_rename_session: (p) =>
      engine.rename(text(p.sessionId), text(p.title)),
    agent_set_session_pinned: async (p) => {
      const id = text(p.sessionId);
      if (engine.currentSessionId !== id) await engine.resolve(id);
      const pinned = bool(p.pinned);
      engine.metadata(id, { pinned });
      return pinned;
    },
    agent_set_session_archived: async (p) => {
      const id = text(p.sessionId);
      if (engine.currentSessionId !== id) await engine.resolve(id);
      const archived = bool(p.archived);
      engine.metadata(id, { archived });
      return archived;
    },
    agent_session_info: (p) => engine.info(text(p.sessionId)),
    agent_session_usage: (p) => engine.usage(text(p.sessionId)),
    agent_set_model: (p) => engine.setModel(text(p.sessionId), text(p.modelId)),
    agent_resolve_permission: (p) =>
      engine.permissions.resolve(text(p.requestId), p.optionId, p.cancelled),
    agent_resolve_question: () => unsupported("questions"),
    folder_trust_respond: (p) =>
      engine.setFolderTrust(text(p.cwd), bool(p.trusted)),
    permission_list: () => settings.config.read().rules,
    permission_save: (p) => {
      if (!Array.isArray(p.rules)) throw Error("rules必须为数组");
      const rules = p.rules.map((raw) => {
        const r = object(raw),
          action = text(r.action),
          tool = text(r.tool);
        if (!["allow", "deny", "ask"].includes(action)) throw Error("无效规则");
        return {
          action,
          tool,
          pattern: typeof r.pattern === "string" ? r.pattern : undefined,
        };
      });
      update((c) => {
        c.rules = rules;
      });
    },
    permission_mode_get: () => settings.config.read().permissionMode,
    permission_mode_set: (p) => {
      if (!["ask", "auto", "always-approve"].includes(String(p.mode)))
        throw Error("无效权限模式");
      update((c) => {
        c.permissionMode = p.mode as "ask";
      });
      emit("agent://permission-mode", { mode: p.mode });
    },
    providers_list: () => engine.providers.list(),
    providers_save_provider: async (p) => {
      await engine.providers.saveProvider(p.provider);
      emit("agent://models-update", {});
    },
    providers_save_model: async (p) => {
      await engine.providers.saveModel(p.model);
      emit("agent://models-update", {});
    },
    providers_delete_provider: (p) =>
      engine.providers.deleteProvider(text(p.id)),
    providers_delete_model: (p) =>
      engine.providers.deleteModel(text(p.modelId)),
    providers_fetch_models: (p) => engine.providers.fetchModels(p),
    account_get_api_key: () =>
      settings.secrets.has("provider:grok") ? "••••" : null,
    account_set_api_key: async (p) => {
      if (p.key !== null && typeof p.key !== "string")
        throw Error("key必须为字符串或null");
      if (p.key !== "••••")
        settings.secrets.set("provider:grok", p.key as string | undefined);
      await engine.providers.sync();
    },
    agents_defaults_get: () => settings.config.read().defaults,
    agents_defaults_save: (p) => {
      const d = object(p.defaults);
      if (d.rememberToolApprovals === true) unsupported("remember tool approvals");
      if (
        typeof d.defaultModel !== "string" ||
        !["ask", "auto", "always-approve"].includes(String(d.defaultPermission))
      )
        throw Error("无效的默认设置");
      update((c) => {
        c.defaults = {
          defaultModel: d.defaultModel as string,
          defaultPermission: String(d.defaultPermission),
          rememberToolApprovals: !!d.rememberToolApprovals,
        };
        c.permissionMode = d.defaultPermission as "ask";
      });
    },
    skills_list: (p) =>
      engine.skills.list(typeof p.cwd === "string" ? p.cwd : engine.currentCwd),
    skills_add: async (p) => {
      await engine.skills.add(text(p.path));
      await engine.reload();
    },
    skills_remove: async (p) => {
      await engine.skills.remove(text(p.path));
      await engine.reload();
    },
    skills_toggle: async (p) => {
      engine.skills.toggle(text(p.name), bool(p.enabled));
      await engine.reload();
    },
    commands_list: () => engine.commands(),
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
    mcp_auth_trigger: () => unsupported("MCP OAuth"),
    mcp_auth_status: () => unsupported("MCP OAuth status"),
    notification_list: () =>
      settings.config.read().notifications.slice().reverse(),
    notification_append: (p) => {
      update((c) => {
        const last = c.notifications.at(-1)?.id ?? 0;
        c.notifications.push({
          id: Math.max(Date.now(), last + 1),
          kind: text(p.kind),
          at: new Date().toISOString(),
          title: text(p.title),
          body: typeof p.body === "string" ? p.body : undefined,
          sessionId: typeof p.sessionId === "string" ? p.sessionId : undefined,
          severity: typeof p.severity === "string" ? p.severity : "info",
          read: false,
        });
        c.notifications = c.notifications.slice(-200);
      });
    },
    notification_mark_read: (p) => {
      if (typeof p.id !== "number") throw Error("id必须为数字");
      update((c) => {
        const item = c.notifications.find((n) => n.id === p.id);
        if (!item) throw Error("通知不存在");
        item.read = true;
      });
    },
    notification_mark_all_read: () =>
      update((c) => {
        for (const n of c.notifications) n.read = true;
      }),
    notification_clear: () =>
      update((c) => {
        c.notifications = [];
      }),
    ...fileHandlers(options.shell, () => engine.currentCwd),
  };
  // Redact every successful IPC return; failures never include provider response bodies or keys.
  for (const [name, handler] of Object.entries(handlers))
    handlers[name] = async (p) => {
      try {
        return settings.secrets.redact(await handler(p));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw Error(String(settings.secrets.redact(message)));
      }
    };
  return { handlers, dispose: () => engine.shutdown() };
}
