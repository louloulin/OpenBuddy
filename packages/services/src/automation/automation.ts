import { join } from "node:path";
import { JsonStore, text, type Settings } from "../settings/settings.js";
import type { Automation, AutomationRunRecord, AutomationSchedule, AutomationSnapshot, AutomationStatus } from "@openbuddy/protocol/dto";

/**
 * 自动化 (20261116-pii W4.1): local scheduler state, ported from the Rust `automations.rs` shape.
 *
 * - `automations.json` holds the tasks; `automation-records.json` the run history.
 * - `nextRun` is recomputed on every read, so a paused / edited task never carries a stale time.
 * - Frequencies: DAILY / WEEKLY (with weekdays, 双周 = interval 2) / MONTHLY / YEARLY / HOURLY
 *   (intervalHours); `once` uses `scheduledDate` + `scheduledTime`; `validFrom/Until` bound it.
 * - The service is pure state + time math. The host module owns the 30s tick and the executor
 *   that opens a background session; tests drive `due()` and `mark*()` directly.
 */

const MAX_SCAN_DAYS = 366 * 5;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export interface AutomationExecutorResult {
  sessionId?: string;
  ok: boolean;
  error?: string;
}

/** Runs one automation (host: open a background session and send the prompt). */
export type AutomationExecutor = (automation: Automation, extraPrompt?: string) => Promise<AutomationExecutorResult>;

interface AutomationFile {
  automations: Automation[];
}
interface RecordFile {
  records: AutomationRunRecord[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDay = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
};
const parseTime = (value: string | undefined): { hour: number; minute: number } | undefined => {
  if (!value) return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  return match ? { hour: Math.min(23, Number(match[1])), minute: Math.min(59, Number(match[2])) } : undefined;
};

/** Next wall-clock run strictly after `after` (undefined when the schedule is exhausted). */
export function nextRunAt(automation: Pick<Automation, "scheduleType" | "schedule" | "scheduledDate" | "scheduledTime" | "validFromDate" | "validUntilDate"> & { fileTrigger?: Automation["fileTrigger"] }, after = new Date()): string | undefined {
  // 文件触发 (W4.7): the task runs when the file changes, not on a clock.
  if (automation.fileTrigger) return undefined;
  const { schedule } = automation;
  const until = parseDay(automation.validUntilDate);
  if (until) until.setHours(23, 59, 59, 999);
  const from = parseDay(automation.validFromDate);
  const start = new Date(Math.max(after.getTime(), from ? from.getTime() : 0));
  const atTime = (day: Date, hour: number, minute: number) => {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
    return next;
  };
  const within = (candidate: Date) => (!until || candidate <= until) && (!from || candidate >= from);

  if (automation.scheduleType === "once") {
    const day = parseDay(automation.scheduledDate);
    const time = parseTime(automation.scheduledTime) ?? { hour: 9, minute: 0 };
    if (!day) return undefined;
    const candidate = atTime(day, time.hour, time.minute);
    return candidate > after && within(candidate) ? candidate.toISOString() : undefined;
  }

  const interval = Math.max(1, schedule.interval || 1);
  const hour = Math.min(23, schedule.byhour ?? 9);
  const minute = Math.min(59, schedule.byminute ?? 0);

  if (schedule.freq === "HOURLY") {
    const step = Math.max(1, schedule.intervalHours || 1) * 60 * 60_000;
    const candidate = new Date(Math.ceil((after.getTime() + 1) / step) * step);
    return candidate <= (until ?? candidate) ? candidate.toISOString() : undefined;
  }
  for (let offset = 0; offset <= MAX_SCAN_DAYS; offset += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    if (until && day > until) return undefined;
    if (from && day < from) continue;
    let matches = false;
    if (schedule.freq === "DAILY") {
      const days = Math.floor((day.getTime() - new Date(from ?? after).setHours(0, 0, 0, 0)) / 86_400_000);
      matches = days % interval === 0;
    } else if (schedule.freq === "WEEKLY") {
      const wanted = (schedule.byday?.length ? schedule.byday : ["MO"]).map((code) => code.toUpperCase());
      if (!wanted.includes(WEEKDAYS[day.getDay()] as string)) continue;
      const week = Math.floor((day.getTime() - new Date(from ?? after).setHours(0, 0, 0, 0)) / (7 * 86_400_000));
      matches = week % interval === 0;
    } else if (schedule.freq === "MONTHLY") {
      const days = schedule.bymonthday?.length ? schedule.bymonthday : [1];
      matches = days.includes(day.getDate()) && (day.getMonth() % interval === 0);
    } else if (schedule.freq === "YEARLY") {
      const months = schedule.bymonth?.length ? schedule.bymonth : [1];
      const days = schedule.bymonthday?.length ? schedule.bymonthday : [1];
      matches = months.includes(day.getMonth() + 1) && days.includes(day.getDate()) && (day.getFullYear() % interval === 0);
    }
    if (!matches) continue;
    const candidate = atTime(day, hour, minute);
    if (candidate > after && within(candidate)) return candidate.toISOString();
  }
  return undefined;
}

export class AutomationService {
  private tasks: JsonStore<AutomationFile>;
  private history: JsonStore<RecordFile>;
  constructor(private settings: Settings) {
    this.tasks = new JsonStore(join(settings.dir, "automations.json"), () => ({ automations: [] }), { versioned: true, snapshots: settings.snapshots });
    this.history = new JsonStore(join(settings.dir, "automation-records.json"), () => ({ records: [] }), { versioned: true, snapshots: settings.snapshots });
  }
  snapshot(now = new Date()): AutomationSnapshot {
    const automations = this.tasks.read().automations.map((task) => ({
      ...task,
      nextRunAt: task.status === "ACTIVE" ? nextRunAt(task, now) : undefined,
    }));
    const records = this.history.read().records;
    return { automations, records };
  }
  get(id: string): Automation | undefined {
    return this.tasks.read().automations.find((task) => task.id === id);
  }
  save(input: Partial<Automation>): Automation {
    const file = this.tasks.read();
    // The renderer's create draft carries `id: ""`; only a non-empty id selects an existing task.
    const providedId = typeof input.id === "string" && input.id ? input.id : undefined;
    const existing = providedId ? file.automations.find((task) => task.id === providedId) : undefined;
    const now = new Date();
    const base: Automation = existing ?? {
      id: providedId ?? `auto-${now.getTime().toString(36)}`,
      name: "",
      prompt: "",
      cwds: "",
      status: "ACTIVE",
      skills: [],
      connectorIds: [],
      permissionMode: "default",
      scheduleType: "recurring",
      schedule: { freq: "DAILY", interval: 1, byday: [], bymonthday: [], bymonth: [], byhour: 9, byminute: 0, intervalHours: 1 },
      pushToWeChat: false,
      revision: 0,
      createdAt: now.toISOString(),
    };
    const merged: Automation = { ...base, ...input, id: base.id, createdAt: base.createdAt };
    // 修订语义 (B3c): every save is a new revision. A running executor keeps the object it
    // started with, so an edit can never rewrite the prompt/cwd of an in-flight run.
    merged.revision = (existing?.revision ?? 0) + 1;
    merged.name = text(merged.name, "name").slice(0, 120);
    merged.prompt = text(merged.prompt, "prompt");
    if (!merged.cwds.trim()) throw Error("invalid_payload: cwds");
    // 文件触发 (W4.7): the trigger path is required and absolute.
    if (merged.fileTrigger) {
      const path = text(merged.fileTrigger.path, "fileTrigger.path").trim();
      if (!path || !path.startsWith("/") || path.includes("\0"))
        throw Error("invalid_payload: fileTrigger.path");
      merged.fileTrigger = {
        path,
        ...(merged.fileTrigger.debounceMs ? { debounceMs: Math.max(0, Math.min(60000, merged.fileTrigger.debounceMs)) } : {}),
      };
    }
    merged.nextRunAt = merged.status === "ACTIVE" ? nextRunAt(merged, now) : undefined;
    const index = file.automations.findIndex((task) => task.id === merged.id);
    if (index >= 0) file.automations[index] = merged;
    else file.automations.push(merged);
    this.tasks.write(file);
    return merged;
  }
  delete(id: string) {
    const file = this.tasks.read();
    const next = file.automations.filter((task) => task.id !== id);
    if (next.length === file.automations.length) throw Error("automation_not_found: 找不到这个自动化");
    this.tasks.write({ automations: next });
  }
  setStatus(id: string, status: AutomationStatus) {
    const file = this.tasks.read();
    const task = file.automations.find((entry) => entry.id === id);
    if (!task) throw Error("automation_not_found: 找不到这个自动化");
    task.status = status;
    task.nextRunAt = status === "ACTIVE" ? nextRunAt(task, new Date()) : undefined;
    this.tasks.write(file);
  }
  /** Tasks whose next run has arrived (up to `limit`), each with the scheduled time. */
  due(now = new Date(), limit = 3): Automation[] {
    return this.tasks.read().automations
      .filter((task) => task.status === "ACTIVE" && task.nextRunAt && new Date(task.nextRunAt) <= now)
      .slice(0, limit);
  }
  /** Remember when a task last fired and compute its following run. */
  markRun(id: string, at = new Date()) {
    const file = this.tasks.read();
    const task = file.automations.find((entry) => entry.id === id);
    if (!task) return;
    task.lastRunAt = at.toISOString();
    task.nextRunAt = task.status === "ACTIVE" ? nextRunAt(task, at) : undefined;
    this.tasks.write(file);
  }
  startRecord(automation: Automation, at = new Date(), extra: Partial<AutomationRunRecord> = {}): AutomationRunRecord {
    const record: AutomationRunRecord = {
      id: `run-${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      automationId: automation.id,
      automationName: automation.name,
      status: "running",
      startedAt: at.toISOString(),
      automationRevision: automation.revision ?? 1,
      archived: false,
      ...extra,
    };
    const file = this.history.read();
    file.records.unshift(record);
    this.history.write(file);
    return record;
  }
  record(id: string): AutomationRunRecord | undefined {
    return this.history.read().records.find((entry) => entry.id === id);
  }
  finishRecord(id: string, patch: Partial<AutomationRunRecord>) {
    const file = this.history.read();
    const record = file.records.find((entry) => entry.id === id);
    if (!record) return;
    Object.assign(record, patch, { finishedAt: new Date().toISOString() });
    this.history.write(file);
  }
  archiveRecord(id: string, archived: boolean) {
    const file = this.history.read();
    const record = file.records.find((entry) => entry.id === id);
    if (!record) throw Error("record_not_found: 找不到这条运行记录");
    record.archived = archived;
    this.history.write(file);
  }
  deleteRecord(id: string) {
    const file = this.history.read();
    const next = file.records.filter((entry) => entry.id !== id);
    if (next.length === file.records.length) throw Error("record_not_found: 找不到这条运行记录");
    this.history.write({ records: next });
  }
  /** Run every due task through `executor`; returns how many fired. Used by the 30s tick. */
  async tick(executor: AutomationExecutor, now = new Date()): Promise<number> {
    const tasks = this.due(now);
    for (const task of tasks) {
      this.markRun(task.id, now);
      const record = this.startRecord(task, now);
      try {
        const result = await executor(task);
        this.finishRecord(record.id, {
          status: result.ok ? "success" : "failed",
          ...(result.sessionId ? { sessionId: result.sessionId } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
      } catch (error) {
        this.finishRecord(record.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
    return tasks.length;
  }
}

export { dayKey };
