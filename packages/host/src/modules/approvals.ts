import { bool, object, text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `approvals` module. Tool permission and extension UI answers, permission rules and mode, folder trust. */
export function approvalsModule(ctx: HostContext): HostModule {
  const { settings, emit, engine, update } = ctx;
  const commands: Record<string, Handler> = {
    agent_resolve_ui: (p) => engine.ui.resolve(p),
    agent_resolve_permission: (p) =>
      engine.permissions.resolve(text(p.requestId), p.optionId, p.cancelled, p.reason),
    agent_resolve_question: (p) => engine.ui.resolve(p),
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
  };
  return { id: "approvals", commands };
}
