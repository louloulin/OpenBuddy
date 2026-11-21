import { DEFAULT_PROTECTED_PATHS, bool, object, text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `approvals` module. Tool permission and extension UI answers, permission rules and mode, folder trust, protected paths. */
export function approvalsModule(ctx: HostContext): HostModule {
  const { settings, emit, engine, update } = ctx;
  const protectedPaths = () => settings.config.read().protectedPaths ?? [...DEFAULT_PROTECTED_PATHS];
  const commands: Record<string, Handler> = {
    agent_resolve_ui: (p) => engine.ui.resolve(p),
    agent_resolve_permission: (p) =>
      engine.permissions.resolve(text(p.requestId), p.optionId, p.cancelled, p.reason),
    agent_resolve_question: (p) => engine.ui.resolve(p),
    folder_trust_respond: (p) =>
      engine.setFolderTrust(text(p.cwd), bool(p.trusted)),
    permission_list: () => settings.config.read().rules,
    /**
     * 20261117-mobile.md §2.4 path 3: the permission cards still waiting on the user.
     * Isomorphic to `agent://permission`, so a phone that was disconnected when the
     * request was emitted can rebuild the card on resume and answer it by `requestId`.
     */
    permission_pending: (p) => ({
      requests: engine.permissions.pendingRequests(
        typeof p.sessionId === "string" && p.sessionId ? p.sessionId : undefined,
      ),
    }),
    /**
     * The extension UI questions still waiting on the user, isomorphic to
     * `agent://ui-request`. Same recovery role as `permission_pending`: a
     * `select`/`confirm`/`input` blocks the turn just like a tool approval.
     */
    question_pending: (p) => ({
      requests: engine.ui.pendingRequests(
        typeof p.sessionId === "string" && p.sessionId ? p.sessionId : undefined,
      ),
    }),
    /**
     * Untrusted folders a session was opened in, isomorphic to
     * `agent://folder-trust`. The event fires once on open, so a phone that was
     * away could never see it; this replays it until answered.
     */
    trust_pending: (p) => ({
      requests: engine.folderTrust.pending(
        typeof p.sessionId === "string" && p.sessionId ? p.sessionId : undefined,
      ),
    }),
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
    // 受保护路径 (pii W6.2): read/write the hard boundary that even 完全访问 cannot bypass.
    permission_protected_get: () => ({ paths: protectedPaths(), defaults: [...DEFAULT_PROTECTED_PATHS] }),
    permission_protected_set: (p) => {
      if (!Array.isArray(p.paths)) throw Error("invalid_payload: paths");
      const paths = p.paths.map((raw) => text(raw, "path").trim()).filter(Boolean);
      if (paths.length > 64) throw Error("invalid_payload: paths");
      if (paths.some((path) => path.length > 200 || path.includes("\0"))) throw Error("invalid_payload: path");
      update((c) => {
        c.protectedPaths = [...new Set(paths)];
      });
      return { paths: paths.filter((path, i) => paths.indexOf(path) === i) };
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
