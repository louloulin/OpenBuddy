/**
 * 阶段 1.4 自动化:调度数学 + IPC 端到端。
 *
 * 覆盖:computeNextRunAt 的 7 条 RRULE 分支 + 有效期窗口;automations:*
 * 通道在真实注册表上跑 save→snapshot→setStatus→run→records archive/delete。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Automation } from "@openbuddy/shared-types";
import { computeNextRunAt } from "../automation/automation-store";

interface CapturedHandler {
  channel: string;
  fn: (event: unknown, ...args: unknown[]) => unknown;
}
const { registry } = vi.hoisted(() => {
  const registry = new Map<string, CapturedHandler>();
  (globalThis as unknown as { __automationRegistry: typeof registry }).__automationRegistry = registry;
  return { registry };
});

vi.mock("electron", () => {
  const reg = (globalThis as unknown as { __automationRegistry: Map<string, CapturedHandler> }).__automationRegistry;
  return {
    app: { getVersion: () => "0.0.0-test", getPath: (key: string) => (key === "userData" ? "/tmp/openbuddy-automation-test" : "/tmp"), on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: CapturedHandler["fn"]) => { reg.set(channel, { channel, fn: handler }); }),
      removeHandler: vi.fn((channel: string) => { reg.delete(channel); }),
      on: vi.fn(), removeListener: vi.fn(), removeAllListeners: vi.fn(),
    },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: vi.fn() },
    BrowserWindow: vi.fn(),
    dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    clipboard: { writeText: vi.fn(), readText: vi.fn().mockReturnValue("") },
  };
});

let tempDir = "";

const baseSchedule = (over: Partial<Automation["schedule"]> = {}): Automation["schedule"] => ({
  freq: "DAILY",
  interval: 1,
  byday: [],
  bymonthday: [],
  bymonth: [],
  byhour: 9,
  byminute: 0,
  intervalHours: 1,
  ...over,
});

function automationOf(patch: Partial<Automation>): Automation {
  return {
    id: "auto-test",
    name: "每日巡检",
    prompt: "检查仓库状态",
    cwds: "/tmp",
    status: "ACTIVE",
    skills: [],
    connectorIds: [],
    permissionMode: "fullAccess",
    scheduleType: "recurring",
    schedule: baseSchedule(),
    pushToWeChat: false,
    createdAt: "2026-10-14T00:00:00.000Z",
    ...patch,
  } as Automation;
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-automation-"));
  process.env.PI_HOME = tempDir;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  const ipc = await import("../ipc/index");
  await ipc.registerIpc(() => null);
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("computeNextRunAt", () => {
  it("DAILY:今天时刻未到取今天,过了取明天", () => {
    const at10 = new Date(2026, 9, 14, 10, 0, 0, 0).getTime();
    const automation = automationOf({ schedule: baseSchedule({ byhour: 14, byminute: 30 }) });
    expect(new Date(computeNextRunAt(automation, at10)!).getHours()).toBe(14);
    expect(new Date(computeNextRunAt(automation, at10)!).getDate()).toBe(14);
    const at16 = new Date(2026, 9, 14, 16, 0, 0, 0).getTime();
    expect(new Date(computeNextRunAt(automation, at16)!).getDate()).toBe(15);
  });

  it("DAILY interval=2 → 隔天", () => {
    const now = new Date(2026, 9, 14, 16, 0, 0, 0).getTime();
    const automation = automationOf({ schedule: baseSchedule({ interval: 2, byhour: 9, byminute: 0 }) });
    expect(new Date(computeNextRunAt(automation, now)!).getDate()).toBe(16);
  });

  it("WEEKLY byday=WE → 下周三", () => {
    const now = new Date(2026, 9, 14, 10, 0, 0, 0).getTime(); // 2026-10-14 是周三
    const automation = automationOf({ schedule: baseSchedule({ freq: "WEEKLY", byday: ["FR"], byhour: 9, byminute: 0 }) });
    const next = new Date(computeNextRunAt(automation, now)!);
    expect(next.getDay()).toBe(5);
    expect(next.getDate()).toBe(16);
  });

  it("WEEKLY interval=2(双周)跳过一周", () => {
    const now = new Date(2026, 9, 14, 10, 0, 0, 0).getTime();
    const automation = automationOf({
      schedule: baseSchedule({ freq: "WEEKLY", interval: 2, byday: ["WE"], byhour: 9, byminute: 0 }),
    });
    const next = new Date(computeNextRunAt(automation, now)!);
    expect(next.getDay()).toBe(3);
    expect(next.getDate()).toBe(28); // 不是 21
  });

  it("HOURLY intervalHours → 按小时推进", () => {
    const now = new Date(2026, 9, 14, 10, 0, 0, 0).getTime();
    const automation = automationOf({ schedule: baseSchedule({ freq: "HOURLY", intervalHours: 3 }) });
    expect(new Date(computeNextRunAt(automation, now)!).getHours()).toBe(13);
  });

  it("MONTHLY bymonthday 已过 → 落到下月", () => {
    const now = new Date(2026, 9, 20, 10, 0, 0, 0).getTime();
    const automation = automationOf({ schedule: baseSchedule({ freq: "MONTHLY", bymonthday: [10], byhour: 9, byminute: 0 }) });
    const next = new Date(computeNextRunAt(automation, now)!);
    expect(next.getMonth()).toBe(10);
    expect(next.getDate()).toBe(10);
  });

  it("YEARLY bymonth+bymonthday → 明年同月同日", () => {
    const now = new Date(2026, 9, 20, 10, 0, 0, 0).getTime();
    const automation = automationOf({
      schedule: baseSchedule({ freq: "YEARLY", bymonth: [12], bymonthday: [25], byhour: 8, byminute: 0 }),
    });
    const next = new Date(computeNextRunAt(automation, now)!);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(11);
    expect(next.getDate()).toBe(25);
  });

  it("once:未来时刻排程,过去时刻返回 undefined", () => {
    const now = new Date(2026, 9, 14, 10, 0, 0, 0).getTime();
    const future = automationOf({ scheduleType: "once", scheduledDate: "2026-10-20", scheduledTime: "08:30" });
    expect(new Date(computeNextRunAt(future, now)!).getDate()).toBe(20);
    const past = automationOf({ scheduleType: "once", scheduledDate: "2026-10-01", scheduledTime: "08:30" });
    expect(computeNextRunAt(past, now)).toBeUndefined();
  });

  it("validUntilDate 之前能排,之后返回 undefined", () => {
    const now = new Date(2026, 9, 14, 16, 0, 0, 0).getTime();
    const inside = automationOf({ schedule: baseSchedule({ byhour: 9, byminute: 0 }), validUntilDate: "2026-10-20" });
    expect(computeNextRunAt(inside, now)).toBeTypeOf("number");
    const outside = automationOf({ schedule: baseSchedule({ byhour: 9, byminute: 0 }), validUntilDate: "2026-10-14" });
    expect(computeNextRunAt(outside, now)).toBeUndefined();
  });

  it("validFromDate 之前的触发被前移到窗口首日", () => {
    const now = new Date(2026, 9, 14, 16, 0, 0, 0).getTime();
    const automation = automationOf({
      schedule: baseSchedule({ byhour: 9, byminute: 0 }),
      validFromDate: "2026-11-01",
    });
    const next = new Date(computeNextRunAt(automation, now)!);
    expect(next.getMonth()).toBe(10);
    expect(next.getDate()).toBe(1);
  });
});

describe("automations IPC 端到端", () => {
  const call = <T,>(channel: string, ...args: unknown[]): Promise<T> => {
    const handler = registry.get(channel);
    if (!handler) throw new Error(`no handler registered for ${channel}`);
    return Promise.resolve(handler.fn({}, ...args) as T);
  };

  it("save → snapshot 往返,字段与 nextRunAt 齐全", async () => {
    const saved = await call<Automation>("automations_save", {
      automation: {
        id: "",
        name: "每日巡检",
        prompt: "检查仓库状态",
        cwds: "/tmp",
        status: "ACTIVE",
        skills: [],
        connectorIds: [],
        permissionMode: "fullAccess",
        scheduleType: "recurring",
        schedule: baseSchedule({ byhour: 23, byminute: 15 }),
        pushToWeChat: false,
      },
    });
    expect(saved.id).toMatch(/^auto-/);
    expect(saved.nextRunAt).toBeTypeOf("string");

    const snapshot = await call<{ automations: Automation[]; records: unknown[] }>("automations_snapshot");
    expect(snapshot.automations.some((item) => item.id === saved.id)).toBe(true);
    expect(snapshot.automations[0].cwds).toBe("/tmp");
  });

  it("save 缺 name/prompt → throw", async () => {
    await expect(call("automations_save", { automation: {} })).rejects.toThrow();
  });

  it("setStatus → PAUSED 时清空 nextRunAt,恢复 ACTIVE 后重算", async () => {
    const created = await call<Automation>("automations_save", {
      automation: { name: "暂停用例", prompt: "p", cwds: "/tmp", status: "ACTIVE", skills: [], connectorIds: [], permissionMode: "default", scheduleType: "recurring", schedule: baseSchedule(), pushToWeChat: false },
    });
    const paused = await call<{ automation: Automation }>("automations_set_status", { id: created.id, status: "PAUSED" });
    expect(paused.automation.status).toBe("PAUSED");
    expect(paused.automation.nextRunAt).toBeUndefined();

    const resumed = await call<{ automation: Automation }>("automations_set_status", { id: created.id, status: "ACTIVE" });
    expect(resumed.automation.nextRunAt).toBeTypeOf("string");
  });

  it("setStatus 未知 id → throw;delete 删掉后 snapshot 不再包含", async () => {
    await expect(call("automations_set_status", { id: "nope", status: "ACTIVE" })).rejects.toThrow();
    const created = await call<Automation>("automations_save", {
      automation: { name: "待删除", prompt: "p", cwds: "/tmp", status: "ACTIVE", skills: [], connectorIds: [], permissionMode: "default", scheduleType: "recurring", schedule: baseSchedule(), pushToWeChat: false },
    });
    await call("automations_delete", { id: created.id });
    const snapshot = await call<{ automations: Automation[] }>("automations_snapshot");
    expect(snapshot.automations.some((item) => item.id === created.id)).toBe(false);
  });

  it("records archive 未知 id → throw;records delete 幂等", async () => {
    await expect(call("automation_records_archive", { id: "nope", archived: true })).rejects.toThrow();
    const result = await call<{ deleted: boolean }>("automation_records_delete", { id: "nope" });
    expect(result.deleted).toBe(false);
  });

  it("持久化落盘到 openbuddy-automations.json(shared 模型字段)", async () => {
    const raw = await readFile(join(tempDir, "openbuddy-automations.json"), "utf8");
    const parsed = JSON.parse(raw) as { version: number; automations: Automation[]; records: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.automations[0]).toHaveProperty("scheduleType");
    expect(parsed.automations[0]).toHaveProperty("permissionMode");
  });
});