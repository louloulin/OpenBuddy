import { bool, text } from "@openbuddy/services/settings/settings";
import { validateThinkingLevel } from "@openbuddy/engine/pi-engine";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `session` module. Session lifecycle: create/load/list/search/fork/delete, metadata, background tasks, rewind, compaction, mode. */
export function sessionModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  const commands: Record<string, Handler> = {
    agent_init: (p) =>
      engine.init(typeof p.cwd === "string" ? p.cwd : undefined),
    agent_new_session: (p) =>
      engine.newSession(
        text(p.cwd),
        typeof p.modelId === "string" ? p.modelId : undefined,
        typeof p.providerId === "string" ? p.providerId : undefined,
        p.thinkingLevel === undefined
          ? undefined
          : validateThinkingLevel(p.thinkingLevel),
      ),
    agent_load_session: (p) =>
      engine.load(
        text(p.sessionId),
        typeof p.cwd === "string" ? p.cwd : undefined,
      ),
    agent_list_sessions: (p) => engine.list(text(p.cwd), p.includeArchived === true),
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
    // pii W1.4: full-text search over saved sessions (payload bounded in protocol validate.ts).
    session_search: (p) =>
      engine.searchSessions(text(p.query, "query"), {
        cwd: typeof p.cwd === "string" ? p.cwd : undefined,
        limit: typeof p.limit === "number" ? p.limit : undefined,
      }),
    agent_fork_session: (p) => engine.fork(text(p.sessionId)),
    agent_shutdown: () => engine.shutdown(),
    agent_delete_session: async (p) => {
      const id = text(p.sessionId);
      await engine.delete(id);
      engine.permissions.forget(id);
    },
    tasks_list: () => engine.running(),
    rewind_points: (p) => engine.rewindPoints(text(p.sessionId)),
    rewind_execute: (p) => engine.rewind(text(p.sessionId), text(p.entryId)),
    agent_regenerate: (p) => engine.regenerate(text(p.sessionId)),
    // 20261116-pii W1.1: versions ‹1/2› of each user turn (null while the session is not loaded, like agent_session_info).
    agent_tree: (p) => (engine.has(text(p.sessionId)) ? engine.tree(text(p.sessionId)) : null),
    agent_navigate: (p) =>
      engine.navigate(text(p.sessionId), text(p.entryId), {
        summarize: p.summarize === true,
        restoreFiles: restoreOption(p.restoreFiles),
      }),
    agent_compact: (p) => engine.compact(text(p.sessionId), typeof p.instructions === "string" ? p.instructions : undefined),
    agent_set_mode: (p) => engine.setMode(text(p.sessionId), p.mode as "craft" | "plan" | "ask"),
    agent_abort_retry: (p) => engine.abortRetry(text(p.sessionId)),
    task_kill: (p) => engine.cancel(text(p.taskId)),
    agent_rename_session: (p) =>
      engine.rename(text(p.sessionId), text(p.title)),
    agent_set_session_pinned: async (p) => {
      const id = text(p.sessionId);
      if (!engine.has(id)) await engine.resolve(id);
      const pinned = bool(p.pinned);
      engine.metadata(id, { pinned });
      return pinned;
    },
    agent_set_session_archived: async (p) => {
      const id = text(p.sessionId);
      if (!engine.has(id)) await engine.resolve(id);
      const archived = bool(p.archived);
      engine.metadata(id, { archived });
      return archived;
    },
    // A session that is not loaded yet (just picked in the sidebar) has nothing to report: null,
    // not an error, so opening a task does not leave failed calls behind.
    agent_session_info: (p) => (engine.has(text(p.sessionId)) ? engine.info(text(p.sessionId)) : null),
    agent_session_usage: (p) => (engine.has(text(p.sessionId)) ? engine.usage(text(p.sessionId)) : null),
  };
  return { id: "session", commands };
}
/** `agent_navigate`'s `restoreFiles` (shape checked by validateCommandPayload). */
function restoreOption(value: unknown): boolean | { force?: boolean; skip?: string[] } | undefined {
  if (value === true) return true;
  if (!value || typeof value !== "object") return undefined;
  const { force, skip } = value as { force?: unknown; skip?: unknown };
  return { ...(force === true ? { force: true } : {}), ...(Array.isArray(skip) ? { skip: skip.filter((p): p is string => typeof p === "string") } : {}) };
}
