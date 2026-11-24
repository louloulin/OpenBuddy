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
        { cwd: string; sessionCount: number; lastTitle?: string; isHome?: boolean }
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
      // 默认空间（收件箱）永远在列表里，即使还没有会话：它是新任务的落点，
      // 自动化等入口要拿它当交付目标。`isHome` 让界面能把它显示成「默认空间」。
      const home = map.get(engine.inbox) ?? { cwd: engine.inbox, sessionCount: 0 };
      map.set(engine.inbox, { ...home, isHome: true });
      return [...map.values()];
    },
    // pii W1.4: full-text search over saved sessions (payload bounded in protocol validate.ts).
    session_search: (p) =>
      engine.searchSessions(text(p.query, "query"), {
        cwd: typeof p.cwd === "string" ? p.cwd : undefined,
        limit: typeof p.limit === "number" ? p.limit : undefined,
      }),
    agent_fork_session: (p) => engine.fork(text(p.sessionId)),
    // 交接到新任务 (W1.7): creates a session and returns the draft; never sends.
    agent_handoff: (p) => engine.handoff(text(p.sessionId), text(p.goal, "goal")),
    agent_shutdown: () => engine.shutdown(),
    agent_delete_session: async (p) => {
      const id = text(p.sessionId);
      await engine.delete(id);
      engine.permissions.forget(id);
    },
    tasks_list: () => engine.running(),
    rewind_points: (p) => engine.rewindPoints(text(p.sessionId)),
    rewind_execute: (p) => engine.rewind(text(p.sessionId), text(p.entryId)),
    agent_regenerate: (p) =>
      engine.regenerate(
        text(p.sessionId),
        typeof p.modelId === "string" && p.modelId ? p.modelId : undefined,
        typeof p.providerId === "string" && p.providerId ? p.providerId : undefined,
      ),
    // G1-27 消息级操作: 删除该消息（Pi 的 context_edit）/ 继续生成（回答被截断时）。
    agent_delete_message: (p) => engine.deleteMessage(text(p.sessionId), text(p.entryId, "entryId")),
    agent_continue: (p) => engine.continueAnswer(text(p.sessionId)),
    // G1-30: 清空上下文并新开（任务本身留着）。
    agent_clear_context: (p) => engine.clearContext(text(p.sessionId)),
    // G1-31: 快速问答（一次性会话，不动当前任务的上下文）。
    agent_quick_answer: (p) =>
      engine.quickAnswer({
        prompt: text(p.prompt, "prompt"),
        context: typeof p.context === "string" ? p.context : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : undefined,
        modelId: typeof p.modelId === "string" && p.modelId ? p.modelId : undefined,
        providerId: typeof p.providerId === "string" && p.providerId ? p.providerId : undefined,
      }),
    // 20261116-pii W1.1: versions ‹1/2› of each user turn (null while the session is not loaded, like agent_session_info).
    agent_tree: (p) => (engine.has(text(p.sessionId)) ? engine.tree(text(p.sessionId)) : null),
    agent_navigate: (p) =>
      engine.navigate(text(p.sessionId), text(p.entryId), {
        summarize: p.summarize === true,
        restoreFiles: restoreOption(p.restoreFiles),
      }),
    agent_compact: (p) => engine.compact(text(p.sessionId), typeof p.instructions === "string" ? p.instructions : undefined),
    // 会话 JSONL 导出 / 导入 (W6.5): the renderer picks the path with the native save dialog.
    agent_export_jsonl: (p) =>
      engine.exportJsonl(
        text(p.sessionId),
        typeof p.outputPath === "string" && p.outputPath ? p.outputPath : undefined,
      ),
    agent_import_jsonl: (p) => engine.importJsonl(text(p.path)),
    agent_set_mode: (p) => engine.setMode(text(p.sessionId), p.mode as "craft" | "plan" | "ask"),
    agent_abort_retry: (p) => engine.abortRetry(text(p.sessionId)),
    // 后台任务视图 (W4.5): a `!command` row stops via bash abort; everything else cancels the turn.
    task_kill: (p) => {
      const id = text(p.taskId);
      const slot = engine.slots.get(id);
      return slot?.userBash && !slot.busy ? engine.abortBash(id) : engine.cancel(id);
    },
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
