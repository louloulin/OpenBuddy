// @vitest-environment node
// pii W4.1: frequency math, persistence and the tick loop.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationService, nextRunAt } from "../src/automation/automation";
import { createSettings } from "../src/settings/settings";
import type { Automation, AutomationSchedule } from "@openbuddy/protocol/dto";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const settingsFor = () => {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-automation-"));
  dirs.push(root);
  return createSettings(root, { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
};
const schedule = (patch: Partial<AutomationSchedule> = {}): AutomationSchedule => ({
  freq: "DAILY", interval: 1, byday: [], bymonthday: [], bymonth: [], byhour: 9, byminute: 30, intervalHours: 1, ...patch,
});
const base = (patch: Partial<Automation> = {}): Automation => ({
  id: "a1", name: "每日周报", prompt: "写周报", cwds: "/ws", status: "ACTIVE", skills: [], connectorIds: [],
  permissionMode: "default", scheduleType: "recurring", schedule: schedule(), pushToWeChat: false,
  createdAt: "2026-11-16T00:00:00.000Z", ...patch,
});

describe("自动化频率计算 (pii W4.1)", () => {
  it("DAILY: next occurrence at byhour:byminute, today or tomorrow", () => {
    const at = new Date(2026, 10, 16, 8, 0); // 2026-11-16 08:00
    const next = nextRunAt(base(), at)!;
    expect(new Date(next).getDate()).toBe(16);
    expect(new Date(next).getHours()).toBe(9);
    const after = nextRunAt(base(), new Date(2026, 10, 16, 10, 0))!;
    expect(new Date(after).getDate()).toBe(17);
  });

  it("DAILY interval 2 skips a day; WEEKLY honours byday and a 2-week interval", () => {
    const everyTwo = nextRunAt(base({ schedule: schedule({ interval: 2 }) }), new Date(2026, 10, 16, 10, 0))!;
    expect(new Date(everyTwo).getDate()).toBe(18);

    const weekly = base({ schedule: schedule({ freq: "WEEKLY", byday: ["MO", "FR"], interval: 1 }) });
    // 2026-11-16 is a Monday; after 10:00 → Friday the 20th (Monday's 09:30 has passed).
    const fri = nextRunAt(weekly, new Date(2026, 10, 16, 10, 0))!;
    expect(new Date(fri).getDate()).toBe(20);
    const biweekly = nextRunAt(base({ schedule: schedule({ freq: "WEEKLY", byday: ["MO"], interval: 2 }) }), new Date(2026, 10, 16, 10, 0))!;
    expect(new Date(biweekly).getDate()).toBe(30);
  });

  it("MONTHLY / YEARLY / HOURLY and once schedules", () => {
    const monthly = nextRunAt(base({ schedule: schedule({ freq: "MONTHLY", bymonthday: [1, 15] }) }), new Date(2026, 10, 16, 10, 0))!;
    expect(new Date(monthly).getDate()).toBe(1);
    expect(new Date(monthly).getMonth()).toBe(11);
    // bymonth 为 1 基月份（与 UI 的 MONTHS 1..12 一致）：12 月 25 日 → 2026-12-25。
    const yearly = nextRunAt(base({ schedule: schedule({ freq: "YEARLY", bymonth: [12], bymonthday: [25] }) }), new Date(2026, 10, 16))!;
    expect(new Date(yearly).getFullYear()).toBe(2026);
    expect(new Date(yearly).getMonth()).toBe(11);
    expect(new Date(yearly).getDate()).toBe(25);
    const hourly = nextRunAt(base({ schedule: schedule({ freq: "HOURLY", intervalHours: 2 }) }), new Date(2026, 10, 16, 9, 10))!;
    expect(new Date(hourly).getHours()).toBe(10);
    const once = nextRunAt(base({ scheduleType: "once", scheduledDate: "2026-11-20", scheduledTime: "14:05" }), new Date(2026, 10, 16))!;
    expect(new Date(once).getDate()).toBe(20);
    expect(new Date(once).getHours()).toBe(14);
    expect(nextRunAt(base({ scheduleType: "once", scheduledDate: "2026-11-01", scheduledTime: "14:05" }), new Date(2026, 10, 16))).toBeUndefined();
  });

  it("validUntil bounds recurring schedules", () => {
    const bounded = base({ validUntilDate: "2026-11-16" });
    expect(nextRunAt(bounded, new Date(2026, 10, 16, 10, 0))).toBeUndefined();
  });
});

describe("自动化服务 (pii W4.1 / W4.2)", () => {
  it("assigns an id when the create draft carries an empty one, then updates in place", () => {
    const service = new AutomationService(settingsFor());
    const created = service.save(base({ id: "" }));
    expect(created.id).toBeTruthy();
    expect(service.snapshot().automations).toHaveLength(1);
    const updated = service.save({ ...created, name: "改名后" });
    expect(updated.id).toBe(created.id);
    expect(service.snapshot().automations).toMatchObject([{ id: created.id, name: "改名后" }]);
  });

  it("saves, recomputes next run, pauses and deletes", () => {
    const service = new AutomationService(settingsFor());
    const saved = service.save(base());
    expect(saved.nextRunAt).toBeTruthy();
    service.setStatus("a1", "PAUSED");
    expect(service.snapshot().automations[0]).toMatchObject({ status: "PAUSED", nextRunAt: undefined });
    service.setStatus("a1", "ACTIVE");
    expect(service.snapshot().automations[0].nextRunAt).toBeTruthy();
    service.delete("a1");
    expect(service.snapshot().automations).toEqual([]);
    expect(() => service.delete("a1")).toThrow("automation_not_found");
  });

  it("tick runs due tasks once, records the result and advances the schedule", async () => {
    const service = new AutomationService(settingsFor());
    service.save(base({ schedule: schedule({ byhour: 9, byminute: 0 }) }));
    // `save()` recomputes nextRunAt from the real clock; pick a `now` beyond that run so the task
    // is due without touching the stored file.
    const at = new Date(Date.now() + 2 * 86_400_000);
    const run = vi.fn(async () => ({ sessionId: "s1", ok: true }));
    expect(await service.tick(run, at)).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    const snapshot = service.snapshot(at);
    expect(snapshot.records[0]).toMatchObject({ automationId: "a1", status: "success", sessionId: "s1" });
    expect(new Date(snapshot.automations[0].lastRunAt!).getTime()).toBe(at.getTime());
    expect(new Date(snapshot.automations[0].nextRunAt!).getTime()).toBeGreaterThan(at.getTime());
    // Not due again.
    expect(await service.tick(run, at)).toBe(0);
    // A failing executor is recorded as failed.
    run.mockRejectedValueOnce(new Error("boom"));
    expect(await service.tick(run, new Date(at.getTime() + 86_400_000))).toBe(1);
    expect(service.snapshot().records[0].status).toBe("failed");
  });
});
