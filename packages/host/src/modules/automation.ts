import { bool, text } from "@openbuddy/services/settings/settings";
import { AutomationService, type AutomationExecutor } from "@openbuddy/services/automation/automation";
import { FileTriggerWatcher, readTriggerContent } from "@openbuddy/services/automation/triggers";
import { ExpertStore } from "@openbuddy/services/agents/store";
import { setSessionExpert, type ExpertProfile } from "@openbuddy/engine/features/expert";
import type { Automation, AutomationRunRecord, AutomationStatus } from "@openbuddy/protocol/dto";
import type { Handler, HostContext, HostModule } from "../module.js";

/**
 * 自动化 (20261116-pii W4.1–W4.3): the local scheduler.
 *
 * - Tasks and run history live in `automations.json` / `automation-records.json`.
 * - Every `intervalMs` (default 30s) due tasks open a **background session** in their first cwd
 *   and send the prompt; the run record keeps the session id so 运行记录 can open it.
 * - `automation_tick` runs one pass synchronously (tests, and the manual 立即运行 path).
 * - The interval is `options.automationTickMs`; 0 disables it (tests, headless commands).
 */
export function automationModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  let service: AutomationService | undefined;
  const automations = () => (service ??= new AutomationService(ctx.settings));
  // Built on first use: module factories must not touch the context (modules.test.ts).
  let expertStore: ExpertStore | undefined;
  const experts = () => (expertStore ??= new ExpertStore({ dir: ctx.settings.dir, trusted: (cwd) => engine.trusted(cwd) }));

  /**
   * Apply the task's expert / skills / connectors to the background session (W4.2). The expert's
   * model may win over `task.modelId`; an explicit task model is re-applied afterwards, then the
   * first skill/connector names only guide the prompt when no expert is bound.
   */
  const applyTaskConfig = async (task: Automation, sessionId: string, cwd: string) => {
    const skills = [...(task.skills ?? [])];
    const connectors = [...(task.connectorIds ?? [])];
    let profile: ExpertProfile | undefined;
    if (task.expertId) {
      try {
        const expert = experts().get(task.expertId, cwd);
        profile = {
          id: expert.id, name: expert.name, avatar: expert.image ?? expert.emoji, scope: expert.scope, prompt: expert.prompt,
          model: expert.model, thinking: expert.thinking, tools: expert.tools,
          skills: [...(expert.skills ?? []), ...skills],
          connectors: [...(expert.connectors ?? []), ...connectors],
        };
      } catch (error) {
        engine.emit("agent://error", {
          message: `自动化「${task.name}」的专家不可用：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    if (profile) await setSessionExpert(engine, sessionId, profile);
    if (task.modelId) await engine.setModel(sessionId, task.modelId).catch(() => undefined);
    const hints = [
      !profile && skills.length ? `优先使用的技能：${skills.join("、")}` : "",
      !profile && connectors.length ? `优先使用的连接器：${connectors.join("、")}` : "",
    ].filter(Boolean);
    return hints.length ? `（本次自动化任务：${hints.join("；")}）\n\n${task.prompt}` : task.prompt;
  };

  /** Open a background session, send the prompt, and wait for the turn to settle. */
  const executor: AutomationExecutor = async (task, extraPrompt?: string) => {
    // 交付目标校验 (B3c): a missing workspace fails the record with a readable reason instead of
    // leaving it stuck in `running` (automations_run used to throw before finishRecord).
    const target = task.cwds.split(",")[0].trim();
    let cwd: string;
    try {
      cwd = await engine.validCwd(target);
    } catch (error) {
      const reason = `交付目标不可用（${target || "未设置"}）：${error instanceof Error ? error.message : String(error)}`;
      engine.emit("agent://automation", { id: task.id, name: task.name, status: "failed" });
      return { ok: false, error: reason };
    }
    const sessionId = await engine.newSession(cwd, task.modelId, undefined, undefined, true);
    // 后台任务视图 (W4.5): the 运行中 panel labels this session with its automation name.
    const slot = engine.slots.get(sessionId);
    if (slot) slot.automation = { id: task.id, name: task.name };
    // 完全访问: the user opted into unattended runs; deny rules still apply (Permissions.decide).
    if (task.permissionMode === "fullAccess") engine.permissions.grantAll(sessionId);
    engine.emit("agent://automation", { id: task.id, name: task.name, status: "running", sessionId });
    let sendError: unknown;
    try {
      const base = await applyTaskConfig(task, sessionId, cwd);
      // 文件触发 (W4.7): the changed content is injected, like Pi's file-trigger example.
      const prompt = extraPrompt ? `${base}\n\n${extraPrompt}` : base;
      engine.send(sessionId, prompt).catch((error) => { sendError = error; });
    } catch (error) {
      sendError = error;
    }
    try {
      // The record is finished by settled; wait for the slot to stop running (bounded).
      const deadline = Date.now() + 30 * 60_000;
      while (Date.now() < deadline) {
        if (sendError) {
          engine.emit("agent://automation", { id: task.id, name: task.name, status: "failed", sessionId });
          return { sessionId, ok: false, error: String(sendError) };
        }
        const slot = engine.slots.get(sessionId);
        if (!slot || (!slot.busy && !slot.userBash)) {
          const ok = !slot?.failed;
          engine.emit("agent://automation", { id: task.id, name: task.name, status: ok ? "success" : "failed", sessionId });
          return { sessionId, ok };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      engine.cancel(sessionId).catch(() => {});
      engine.emit("agent://automation", { id: task.id, name: task.name, status: "timeout", sessionId });
      return { sessionId, ok: false, error: "automation_timeout" };
    } finally {
      if (task.permissionMode === "fullAccess") engine.permissions.revokeAll(sessionId);
    }
  };

  let timer: ReturnType<typeof setInterval> | undefined;  const tickMs = ctx.options.automationTickMs ?? 30_000;
  if (tickMs > 0) {
    timer = setInterval(() => {
      syncWatchers();
      void automations().tick(executor).catch((error) => {
        engine.emit("agent://error", { message: `自动化调度失败：${error instanceof Error ? error.message : String(error)}` });
      });
    }, tickMs);
    // Never keep the process alive just for the scheduler (Electron keeps its own loop).
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  // ---------- 文件触发 (W4.7) ----------
  // 每个启用中的文件触发任务一个 watcher；文件变化（防抖 5 秒）后立刻跑一次任务。
  const watcher = new FileTriggerWatcher((change) => {
    const taskId = typeof change.meta === "string" ? change.meta : undefined;
    const task = taskId ? automations().get(taskId) : undefined;
    if (!task || task.status !== "ACTIVE") return;
    const content = readTriggerContent(change.path);
    const record = automations().startRecord(task);
    automations().markRun(task.id);
    engine.emit("agent://automation", { id: task.id, name: task.name, status: "running" });
    void executor(task, content ? `文件 ${change.path} 发生变化，内容如下：\n\n${content}` : `文件 ${change.path} 发生变化。`)
      .then((result) => {
        automations().finishRecord(record.id, {
          status: result.ok ? "success" : "failed",
          ...(result.sessionId ? { sessionId: result.sessionId } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
      })
      .catch((error) => {
        automations().finishRecord(record.id, { status: "failed", error: String(error) });
      });
  });
  /** Keep the watchers in sync with the saved tasks (added / removed / paused / path changed). */
  const syncWatchers = () => {
    const wanted = new Map<string, Automation>();
    for (const task of automations().snapshot().automations) {
      if (task.status === "ACTIVE" && task.fileTrigger?.path) wanted.set(task.fileTrigger.path, task);
    }
    for (const path of watcher.watching) if (!wanted.has(path)) watcher.unwatch(path);
    for (const [path, task] of wanted)
      watcher.watch(path, { meta: task.id, ...(task.fileTrigger?.debounceMs ? { debounceMs: task.fileTrigger.debounceMs } : {}) });
  };

  /**
   * 运行一次并记录 (B3c). The task is cloned first: the executor sees the revision that was
   * current when the run started, even if the user saves an edit while it is in flight.
   */
  const runTask = async (
    task: Automation,
    extraPrompt?: string,
    meta: Partial<AutomationRunRecord> = {},
  ) => {
    const snapshot = structuredClone(task);
    automations().markRun(snapshot.id);
    const record = automations().startRecord(snapshot, new Date(), meta);
    try {
      const result = await executor(snapshot, extraPrompt);
      automations().finishRecord(record.id, {
        status: result.ok ? "success" : "failed",
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        ...(result.error ? { error: result.error } : {}),
      });
      return { recordId: record.id, ...result };
    } catch (error) {
      // Keep the record even when the executor itself throws (delivery target, session failure).
      const message = error instanceof Error ? error.message : String(error);
      automations().finishRecord(record.id, { status: "failed", error: message });
      return { recordId: record.id, ok: false, error: message };
    }
  };

  const commands: Record<string, Handler> = {
    automations_snapshot: () => automations().snapshot(),
    automations_save: (p) => {
      const saved = automations().save((p.automation ?? {}) as Partial<Automation>);
      syncWatchers();
      return saved;
    },
    automations_delete: (p) => {
      automations().delete(text(p.id));
      syncWatchers();
    },
    automations_set_status: (p) => {
      automations().setStatus(text(p.id), text(p.status) === "PAUSED" ? "PAUSED" : "ACTIVE");
      syncWatchers();
    },
    automations_run: async (p) => {
      const task = automations().get(text(p.id));
      if (!task) throw Error("automation_not_found: 找不到这个自动化");
      return runTask(task);
    },
    /** 重试一条失败记录 (B3c): a new record links back via `retryOf`; history is never rewritten. */
    automation_retry: async (p) => {
      const record = automations().record(text(p.recordId));
      if (!record) throw Error("record_not_found: 找不到这条运行记录");
      if (record.status !== "failed") throw Error("invalid_state: 只能重试失败的运行记录");
      const task = automations().get(record.automationId);
      if (!task) throw Error("automation_not_found: 自动化任务已被删除，无法重试");
      return runTask(task, undefined, { retryOf: record.id });
    },
    /** One scheduler pass now (tests; also the 运行记录 refresh path). */
    automation_tick: async () => ({ fired: await automations().tick(executor) }),
    automation_records_archive: (p) => automations().archiveRecord(text(p.id), bool(p.archived)),
    automation_records_delete: (p) => automations().deleteRecord(text(p.id)),
  };
  return { id: "automation", commands };
}
