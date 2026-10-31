/**
 * IPC surface — 自动化(阶段 1.4)。
 *
 * 通道沿用渲染端既有契约(pi-client.ts + preload 允许清单已包含),在
 * misc.ts 的 throw 桩位置接回真实实现:
 *   automations_snapshot / automations_save / automations_delete /
 *   automations_set_status / automations_run /
 *   automation_records_archive / automation_records_delete
 *
 * 载荷形状直接用 `@openbuddy/shared-types` 的 Automation /
 * AutomationRunRecord(与 automation-store 共用同一模型,零映射)。
 *
 * 执行:每次运行在**后台独立会话**里跑(计划 0.3,`runBackgroundSession`),
 * 不替换用户正在看的前台会话,用户回合进行中也可以运行;完成后回填运行记录
 * (含回答摘要)并写入 workspace 记忆。
 */
import { ipcMain } from "electron";

import { wrapIpcHandler } from "./_wrap";
import { recordValue, requiredString } from "./validation";
import {
  computeNextRunAt,
  listAutomations,
  listRunRecords,
  markRun,
  mutateAutomations,
  refreshNextRun,
  startAutomationScheduler,
  type Automation,
} from "../automation/automation-store";
import { addMemory } from "../memory/memory-store";
import { runBackgroundSession } from "../agent/host-modules/team-runner";
import type { AutomationRunRecord } from "@openbuddy/shared-types";

interface AutomationIpcDeps {
  ensureAgentHost: () => Promise<void>;
  agentHost: {
    getCwd: () => string | null | undefined;
  };
  /** 测试注入点;缺省为真实的后台会话运行器。 */
  runBackground?: typeof runBackgroundSession;
}

const DEFAULT_SCHEDULE = {
  freq: "DAILY",
  interval: 1,
  byday: [],
  bymonthday: [],
  bymonth: [],
  byhour: 9,
  byminute: 0,
  intervalHours: 1,
} as const;

/** 校验并补齐 UI 契约的 Automation(字段全必填,渲染端表单已保证,此处兜底)。 */
function normalizeAutomation(input: Record<string, unknown>, fallbackCwd: string): Automation {
  const scheduleInput = (input.schedule ?? {}) as Record<string, unknown>;
  const freq = String(scheduleInput.freq ?? "DAILY");
  const rawCwds = typeof input.cwds === "string" ? input.cwds : "";
  const cwds = rawCwds
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
  const schedule = {
    freq: (["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "HOURLY"] as const).includes(freq as never)
      ? (freq as (typeof DEFAULT_SCHEDULE)["freq"])
      : "DAILY",
    interval: Math.max(1, Math.trunc(Number(scheduleInput.interval) || 1)),
    byday: Array.isArray(scheduleInput.byday) ? scheduleInput.byday.map(String) : [],
    bymonthday: Array.isArray(scheduleInput.bymonthday) ? scheduleInput.bymonthday.map((n) => Number(n)) : [],
    bymonth: Array.isArray(scheduleInput.bymonth) ? scheduleInput.bymonth.map((n) => Number(n)) : [],
    byhour: Number.isFinite(Number(scheduleInput.byhour)) ? Number(scheduleInput.byhour) : DEFAULT_SCHEDULE.byhour,
    byminute: Number.isFinite(Number(scheduleInput.byminute)) ? Number(scheduleInput.byminute) : DEFAULT_SCHEDULE.byminute,
    intervalHours: Math.max(1, Math.trunc(Number(scheduleInput.intervalHours) || 1)),
  };
  const createdAt = typeof input.createdAt === "string" && input.createdAt ? input.createdAt : new Date().toISOString();
  const automation: Automation = {
    id: typeof input.id === "string" && input.id ? input.id : `auto-${randomId()}`,
    name: typeof input.name === "string" ? input.name : "",
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    cwds: cwds || fallbackCwd,
    status: input.status === "PAUSED" ? "PAUSED" : "ACTIVE",
    skills: Array.isArray(input.skills) ? input.skills.map(String) : [],
    connectorIds: Array.isArray(input.connectorIds) ? input.connectorIds.map(String) : [],
    permissionMode: input.permissionMode === "default" ? "default" : "fullAccess",
    scheduleType: input.scheduleType === "once" ? "once" : "recurring",
    schedule,
    pushToWeChat: input.pushToWeChat === true,
    createdAt,
  };
  // 可选字段仅在 UI 明确给出时透传(避免写 null 进 JSON)。
  for (const key of ["modelId", "expertId", "expertName", "scheduledDate", "scheduledTime", "validFromDate", "validUntilDate"] as const) {
    const value = input[key];
    if (typeof value === "string" && value) (automation as unknown as Record<string, unknown>)[key] = value;
  }
  if (input.modelIsThinking === true) automation.modelIsThinking = true;
  return refreshNextRun(automation);
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** agentHost 未加载时取 cwd 会抛(load in flight);这里退到进程 cwd。 */
function currentCwd(agentHost: AutomationIpcDeps["agentHost"]): string {
  try {
    return agentHost.getCwd() || process.cwd();
  } catch {
    return process.cwd();
  }
}

export function registerAutomationIpc(deps: AutomationIpcDeps): void {
  const { ensureAgentHost, agentHost } = deps;
  const runBackground = deps.runBackground ?? runBackgroundSession;

  // 快照是纯存储读,不拉起 agent host(面板打开时 agent 可能还没就绪)。
  wrapIpcHandler("automations_snapshot", async () => ({
    automations: await listAutomations(),
    records: await listRunRecords(),
  }));

  wrapIpcHandler("automations_save", async (_e, args: unknown) => {
    const input = recordValue(args, "automations_save payload");
    const source = recordValue(input.automation, "automation");
    requiredString(source.name, "automation.name");
    requiredString(source.prompt, "automation.prompt");
    const automation = normalizeAutomation(source, currentCwd(agentHost));
    const saved = await mutateAutomations((file) => {
      const index = file.automations.findIndex((item) => item.id === automation.id);
      if (index >= 0) {
        // 编辑:保留创建时间与上次运行时间。
        const previous = file.automations[index];
        file.automations[index] = {
          ...automation,
          createdAt: previous.createdAt,
          ...(previous.lastRunAt ? { lastRunAt: previous.lastRunAt } : {}),
        };
        return file.automations[index];
      }
      file.automations.push(automation);
      return automation;
    });
    return saved;
  });

  wrapIpcHandler("automations_delete", async (_e, args: unknown) => {
    const input = recordValue(args, "automations_delete payload");
    const id = requiredString(input.id, "id");
    const deleted = await mutateAutomations((file) => {
      const before = file.automations.length;
      file.automations = file.automations.filter((item) => item.id !== id);
      return file.automations.length !== before;
    });
    return { deleted };
  });

  wrapIpcHandler("automations_set_status", async (_e, args: unknown) => {
    const input = recordValue(args, "automations_set_status payload");
    const id = requiredString(input.id, "id");
    const status = input.status === "PAUSED" ? "PAUSED" : "ACTIVE";
    const updated = await mutateAutomations((file) => {
      const target = file.automations.find((item) => item.id === id);
      if (!target) throw new Error(`automation not found: ${id}`);
      const next = refreshNextRun({ ...target, status });
      Object.assign(target, next);
      return target;
    });
    return { ok: true, automation: updated };
  });

  // 立即执行一次(手动触发):与调度器同一条执行路径。
  wrapIpcHandler("automations_run", async (_e, args: unknown) => {
    const input = recordValue(args, "automations_run payload");
    const id = requiredString(input.id, "id");
    const automation = (await listAutomations()).find((item) => item.id === id);
    if (!automation) throw new Error(`automation not found: ${id}`);
    await ensureAgentHost();
    // 后台独立会话:不替换前台会话,用户正在生成时也能运行。等它跑完再返回,
    // 与以前的语义一致(面板据此刷新运行记录)。
    const runId = await executeAutomation(automation);
    return { ok: true, runId };
  });

  wrapIpcHandler("automation_records_archive", async (_e, args: unknown) => {
    const input = recordValue(args, "automation_records_archive payload");
    const id = requiredString(input.id, "id");
    await mutateAutomations((file) => {
      const record = file.records.find((item) => item.id === id);
      if (!record) throw new Error(`automation run record not found: ${id}`);
      record.archived = input.archived !== false;
    });
    return { ok: true };
  });

  wrapIpcHandler("automation_records_delete", async (_e, args: unknown) => {
    const input = recordValue(args, "automation_records_delete payload");
    const id = requiredString(input.id, "id");
    const deleted = await mutateAutomations((file) => {
      const before = file.records.length;
      file.records = file.records.filter((item) => item.id !== id);
      return file.records.length !== before;
    });
    return { deleted };
  });

  /**
   * 执行器:后台独立会话 + prompt + 完成回填(含回答摘要)+ 工作区记忆。
   * 返回 runId 供手动触发路径直接用(调度器路径自己建记录,这里只补会话 id)。
   */
  async function executeAutomation(automation: Automation, existingRunId?: string): Promise<string> {
    await ensureAgentHost();
    const cwd = automation.cwds.split(",").map((item) => item.trim()).find(Boolean) || currentCwd(agentHost);
    const runId = existingRunId ?? `run-${randomId()}`;
    if (!existingRunId) {
      await mutateAutomations((file) => {
        const record: AutomationRunRecord = {
          id: runId,
          automationId: automation.id,
          automationName: automation.name,
          status: "running",
          startedAt: new Date().toISOString(),
          archived: false,
        };
        file.records.unshift(record);
        const target = file.automations.find((item) => item.id === automation.id);
        if (target) target.lastRunAt = record.startedAt;
      });
    }
    try {
      const result = await runBackground({
        cwd,
        name: `自动化：${automation.name}`,
        ...(automation.modelId ? { modelId: automation.modelId } : {}),
        prompt: `${automation.prompt}\n\n(本任务由定时自动化「${automation.name}」触发,完成后请用两三句话总结你做了什么。)`,
        // 会话一建好就关联到运行记录(调度器路径的记录此前一直缺 sessionId,
        // 运行历史点不进对应会话)。
        onSession: (sessionId) => mutateAutomations((file) => {
          const record = file.records.find((item) => item.id === runId);
          if (record) record.sessionId = sessionId;
        }),
      });
      const summary = result.text ? result.text.slice(-300) : "已完成(模型没有输出文字)";
      await markRun(runId, "success", summary);
      // 每次运行的 memory:把执行摘要写入 workspace 记忆。
      await addMemory({
        scope: "workspace",
        cwd,
        title: `自动化运行:${automation.name}`,
        body: `${summary}(${new Date().toLocaleString()})`,
        tags: ["自动化"],
      }).catch(() => undefined);
    } catch (error) {
      await markRun(runId, "failed", String(error).replace(/^Error:\s*/, "").slice(0, 500));
      throw error;
    }
    return runId;
  }

  // 后台会话不占前台,调度器不再等用户空闲;同一时刻仍只跑一个自动化。
  startAutomationScheduler(async (automation, runId) => {
    await executeAutomation(automation, runId);
  });
}
