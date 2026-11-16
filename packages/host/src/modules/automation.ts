import { bool, text } from "@openbuddy/services/settings/settings";
import { AutomationService, type AutomationExecutor } from "@openbuddy/services/automation/automation";
import { ExpertStore } from "@openbuddy/services/agents/store";
import { setSessionExpert, type ExpertProfile } from "@openbuddy/engine/features/expert";
import type { Automation, AutomationStatus } from "@openbuddy/protocol/dto";
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
  const executor: AutomationExecutor = async (task) => {
    const cwd = await engine.validCwd(task.cwds.split(",")[0].trim());
    const sessionId = await engine.newSession(cwd, task.modelId, undefined, undefined, true);
    // 后台任务视图 (W4.5): the 运行中 panel labels this session with its automation name.
    const slot = engine.slots.get(sessionId);
    if (slot) slot.automation = { id: task.id, name: task.name };
    // 完全访问: the user opted into unattended runs; deny rules still apply (Permissions.decide).
    if (task.permissionMode === "fullAccess") engine.permissions.grantAll(sessionId);
    engine.emit("agent://automation", { id: task.id, name: task.name, status: "running", sessionId });
    let sendError: unknown;
    try {
      const prompt = await applyTaskConfig(task, sessionId, cwd);
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

  let timer: ReturnType<typeof setInterval> | undefined;
  const tickMs = ctx.options.automationTickMs ?? 30_000;
  if (tickMs > 0) {
    timer = setInterval(() => {
      void automations().tick(executor).catch((error) => {
        engine.emit("agent://error", { message: `自动化调度失败：${error instanceof Error ? error.message : String(error)}` });
      });
    }, tickMs);
    // Never keep the process alive just for the scheduler (Electron keeps its own loop).
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  const commands: Record<string, Handler> = {
    automations_snapshot: () => automations().snapshot(),
    automations_save: (p) => automations().save((p.automation ?? {}) as Partial<Automation>),
    automations_delete: (p) => automations().delete(text(p.id)),
    automations_set_status: (p) => automations().setStatus(text(p.id), text(p.status) === "PAUSED" ? "PAUSED" : "ACTIVE"),
    automations_run: async (p) => {
      const task = automations().get(text(p.id));
      if (!task) throw Error("automation_not_found: 找不到这个自动化");
      automations().markRun(task.id);
      const record = automations().startRecord(task);
      const result = await executor(task);
      automations().finishRecord(record.id, {
        status: result.ok ? "success" : "failed",
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        ...(result.error ? { error: result.error } : {}),
      });
      return { recordId: record.id, ...result };
    },
    /** One scheduler pass now (tests; also the 运行记录 refresh path). */
    automation_tick: async () => ({ fired: await automations().tick(executor) }),
    automation_records_archive: (p) => automations().archiveRecord(text(p.id), bool(p.archived)),
    automation_records_delete: (p) => automations().deleteRecord(text(p.id)),
  };
  return { id: "automation", commands };
}
