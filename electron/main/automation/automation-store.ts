/**
 * automation-store —— 定时自动化(计划 1.4)的持久化与调度。
 *
 * 存储模型直接采用 UI 契约类型(`@openbuddy/shared-types` 的 Automation /
 * AutomationRunRecord),主进程与渲染端共用一份模型,不做形状映射——否则
 * 任何一端加字段都会漂移。
 *
 * 调度(shared 契约是 RRULE 风格):
 *   scheduleType=once   → scheduledDate(YYYY-MM-DD) + scheduledTime(HH:MM)
 *   recurring+DAILY     → byhour:byminute,interval=N → 每 N 天
 *   recurring+WEEKLY    → byday("MO".."SU"),interval=2 → 双周(按 epoch 周奇偶)
 *   recurring+MONTHLY   → bymonthday,interval=N → 每 N 月
 *   recurring+YEARLY    → bymonth+bymonthday,interval=N → 每 N 年
 *   recurring+HOURLY    → intervalHours
 * validFromDate / validUntilDate 为闭区间有效期窗口,窗口外不再排程。
 *
 * 持久化:`<agentHome>/openbuddy-automations.json`(原子写,与 email/memory
 * store 同套路)。调度:30s 扫描 due → 回调执行 → 推进 nextRunAt。
 *
 * 执行回调由 IPC 层注入(创建会话 + prompt + 完成后回填记录),本模块只管
 * 状态机与时间数学,不 import agent-host(防环形依赖)。
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { agentHome } from "@openbuddy/storage";
import type { Automation, AutomationRunRecord, AutomationSchedule } from "@openbuddy/shared-types";

export type { Automation, AutomationRunRecord, AutomationSchedule };

interface AutomationFile {
  version: 1;
  automations: Automation[];
  records: AutomationRunRecord[];
}

const WEEKDAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function emptyFile(): AutomationFile {
  return { version: 1, automations: [], records: [] };
}

function storePath(): string {
  return join(agentHome(), "openbuddy-automations.json");
}

/** 旧版(lean 模型)文件遗留时按空处理——字段全不兼容,不做迁移猜测。 */
function coerceFile(parsed: unknown): AutomationFile {
  // 旧文件(runs 键 / lean 模型)字段不兼容,按不可用处理而不是猜测迁移。
  const raw = (parsed ?? {}) as Partial<AutomationFile> & { runs?: unknown };
  const automations = Array.isArray(raw.automations)
    ? raw.automations.filter((item): item is Automation => Boolean(item && typeof item.id === "string" && item.schedule))
    : [];
  const records = Array.isArray(raw.records)
    ? raw.records.filter((item): item is AutomationRunRecord => Boolean(item && typeof item.id === "string"))
    : Array.isArray(raw.runs)
      ? []
      : [];
  return { version: 1, automations, records };
}

async function readFile_(): Promise<AutomationFile> {
  let raw: string | undefined;
  try {
    raw = await readFile(storePath(), "utf8");
    return coerceFile(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    const backup = `${storePath()}.corrupt-${Date.now()}`;
    await writeFile(backup, raw ?? "", { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
    throw new Error(`automation store is corrupt; a copy was preserved at ${backup} (${String(error)})`);
  }
}

async function writeFileNow(file: AutomationFile): Promise<void> {
  await mkdir(agentHome(), { recursive: true });
  const temporary = `${storePath()}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, storePath());
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

let writeQueue: Promise<void> = Promise.resolve();

/** 读-改-写临界区(与 writeQueue 同一串行域,防并发互相覆盖)。 */
export async function mutateAutomations<T>(mutator: (file: AutomationFile) => T | Promise<T>): Promise<T> {
  const operation = writeQueue.then(async () => {
    const file = await readFile_();
    const result = await mutator(file);
    await writeFileNow(file);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function listAutomations(): Promise<Automation[]> {
  return (await readFile_()).automations;
}

export async function listRunRecords(limit = 200): Promise<AutomationRunRecord[]> {
  return (await readFile_()).records
    .filter((item) => !item.archived)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, Math.max(1, Math.min(500, limit)));
}

// ---------- 时间数学 ----------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function atTime(base: Date, hour: number, minute: number): number {
  const next = new Date(base);
  next.setHours(hour, minute, 0, 0);
  return next.getTime();
}

function startOfLocalDate(value: string, fallback: Date): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return new Date(fallback);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}

/**
 * 计算下一次触发(epoch ms)。窗口外/已失效返回 undefined。
 * @param from 计算基准(现在)。
 */
export function computeNextRunAt(automation: Pick<Automation, "scheduleType" | "schedule" | "scheduledDate" | "scheduledTime" | "validFromDate" | "validUntilDate">, from: number): number | undefined {
  const schedule = automation.schedule;
  const hour = Number.isFinite(schedule?.byhour) ? schedule.byhour : 9;
  const minute = Number.isFinite(schedule?.byminute) ? schedule.byminute : 0;
  let candidate: number | undefined;

  if (automation.scheduleType === "once") {
    const [sh, sm] = String(automation.scheduledTime ?? "09:00").split(":");
    const day = startOfLocalDate(automation.scheduledDate ?? "", new Date(from));
    candidate = atTime(day, Number(sh) || 0, Number(sm) || 0);
    if (candidate <= from) return undefined; // 单次已过期
  } else {
    const interval = Math.max(1, Math.trunc(schedule?.interval ?? 1));
    switch (schedule?.freq) {
      case "HOURLY": {
        const hours = Math.max(1, Math.trunc(schedule.intervalHours ?? 1));
        candidate = from + hours * 3_600_000;
        break;
      }
      case "WEEKLY": {
        const days = (schedule.byday ?? []).map((code) => WEEKDAY_INDEX[code]).filter((n) => n !== undefined);
        const wanted = days.length > 0 ? days : [1];
        // 多周模式(双周/三周)要往后看超过一周才能命中同余的星期几。
        for (let offset = 0; offset <= 7 * interval; offset += 1) {
          const day = new Date(atTime(new Date(from), hour, minute) + offset * 86_400_000);
          if (day.getTime() <= from) continue;
          if (!wanted.includes(day.getDay())) continue;
          if (interval > 1) {
            // 双周:以 1970-01-05(周一)所在周为偶数周锚点。
            const week = Math.floor((day.getTime() - 345_600_000) / 604_800_000);
            if (week % interval !== 0) continue;
          }
          candidate = day.getTime();
          break;
        }
        break;
      }
      case "MONTHLY": {
        const wanted = (schedule.bymonthday ?? []).filter((n) => n >= 1 && n <= 31);
        for (let step = 0; step <= interval * 2; step += 1) {
          const base = new Date(from);
          base.setDate(1);
          base.setMonth(base.getMonth() + step);
          const days = wanted.length > 0 ? wanted : [base.getDate()];
          for (const wantedDay of days) {
            const probe = new Date(base);
            probe.setDate(Math.min(wantedDay, daysInMonth(probe.getFullYear(), probe.getMonth())));
            const at = atTime(probe, hour, minute);
            if (at > from) return clampWindow(at, automation);
          }
        }
        break;
      }
      case "YEARLY": {
        const months = (schedule.bymonth ?? []).filter((n) => n >= 1 && n <= 12);
        const wanted = (schedule.bymonthday ?? []).filter((n) => n >= 1 && n <= 31);
        const month = months[0] ?? (new Date(from).getMonth() + 1);
        const base = new Date(from);
        base.setDate(1);
        base.setMonth(month - 1);
        for (let yearStep = 0; yearStep <= interval * 2; yearStep += 1) {
          const probe = new Date(base);
          probe.setFullYear(base.getFullYear() + yearStep * interval);
          for (const wantedDay of wanted.length > 0 ? wanted : [1]) {
            const at = atTime(
              new Date(probe.getFullYear(), probe.getMonth(), Math.min(wantedDay, daysInMonth(probe.getFullYear(), probe.getMonth())), hour, minute),
              hour,
              minute,
            );
            if (at > from) return clampWindow(at, automation);
          }
        }
        break;
      }
      case "DAILY":
      default: {
        const today = atTime(new Date(from), hour, minute);
        if (today > from) {
          candidate = today;
        } else {
          const next = new Date(today);
          next.setDate(next.getDate() + interval);
          candidate = next.getTime();
        }
        break;
      }
    }
  }

  if (candidate === undefined) return undefined;
  return clampWindow(candidate, automation);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** 有效期窗口(闭区间)裁剪;落在窗口外返回 undefined(不再排程)。 */
function clampWindow(candidate: number, automation: { validFromDate?: string; validUntilDate?: string }): number | undefined {
  if (automation.validFromDate) {
    const from = startOfLocalDate(automation.validFromDate, new Date(candidate)).getTime();
    if (candidate < from) {
      const moved = startOfLocalDate(automation.validFromDate, new Date(candidate));
      return atTime(moved, new Date(candidate).getHours(), new Date(candidate).getMinutes());
    }
  }
  if (automation.validUntilDate) {
    const until = startOfLocalDate(automation.validUntilDate, new Date(candidate));
    until.setHours(23, 59, 59, 999);
    if (candidate > until.getTime()) return undefined;
  }
  return candidate;
}

/** ISO 串(UI 用 startsInLabel 等按字符串解析)。 */
export function toIso(epoch: number | undefined): string | undefined {
  return epoch === undefined ? undefined : new Date(epoch).toISOString();
}

/** 保存/启停后重算 nextRunAt(写回 ISO 串,UI 直接展示)。 */
export function refreshNextRun(automation: Automation, from = Date.now()): Automation {
  const next = automation.status === "ACTIVE" ? computeNextRunAt(automation, from) : undefined;
  return { ...automation, nextRunAt: toIso(next) };
}

// ---------- 调度器 ----------

/** 到期扫描回调(IPC 层注入执行器)。 */
export type AutomationExecutor = (automation: Automation, runId: string) => Promise<void>;

let executor: AutomationExecutor | null = null;
let isAgentBusy: () => boolean = () => false;
let scanTimer: ReturnType<typeof setInterval> | null = null;
const executing = new Set<string>();

/**
 * 注入执行器并启动 30s 到期扫描(email 同款节奏)。
 *
 * 宿主只有一个活动会话:执行器新建会话会替换(并中止)当前会话。所以
 * `isBusy()` 为真(用户的回合正在运行)时本轮扫描跳过,到期任务留到下一轮;
 * 同一时刻也只跑一个自动化,避免几个到期任务互相替换会话。
 */
export function startAutomationScheduler(run: AutomationExecutor, options: { isBusy?: () => boolean } = {}): void {
  executor = run;
  if (options.isBusy) isAgentBusy = options.isBusy;
  if (scanTimer) return;
  scanTimer = setInterval(() => void scanDue(), 30_000);
  scanTimer.unref?.();
  void scanDue();
}

export function stopAutomationScheduler(): void {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
}

async function scanDue(): Promise<void> {
  if (!executor) return;
  if (executing.size > 0 || isAgentBusy()) return;
  const now = Date.now();
  const due = (await listAutomations()).filter(
    (a) =>
      a.status === "ACTIVE" &&
      Boolean(a.nextRunAt) &&
      Date.parse(a.nextRunAt as string) <= now &&
      !executing.has(a.id),
  );
  for (const automation of due.slice(0, 1)) {
    executing.add(automation.id);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const record: AutomationRunRecord = {
      id: runId,
      automationId: automation.id,
      automationName: automation.name,
      status: "running",
      startedAt: new Date(now).toISOString(),
      archived: false,
    };
    await mutateAutomations((file) => {
      file.records.unshift(record);
      const target = file.automations.find((item) => item.id === automation.id);
      if (target) {
        // 单次任务执行后自动停用;周期任务推进到下一次。
        if (target.scheduleType === "once") {
          target.status = "PAUSED";
          target.nextRunAt = undefined;
        } else {
          target.lastRunAt = record.startedAt;
          target.nextRunAt = toIso(computeNextRunAt(target, now));
        }
      }
    });
    void executor(automation, runId)
      .catch(async (error) => {
        await markRun(runId, "failed", String(error).slice(0, 500));
      })
      .finally(() => executing.delete(automation.id));
  }
}

/** 执行器回填运行记录(完成/失败 + 摘要)。 */
export async function markRun(runId: string, status: "success" | "failed", resultSummary?: string): Promise<void> {
  await mutateAutomations((file) => {
    const record = file.records.find((item) => item.id === runId);
    if (!record || record.status !== "running") return;
    record.status = status;
    record.finishedAt = new Date().toISOString();
    if (resultSummary) record.summary = resultSummary.slice(0, 500);
  });
}