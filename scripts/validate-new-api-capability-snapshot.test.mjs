import { describe, expect, it } from "vitest";
import { validateCapabilityDirectory, validateCapabilitySnapshot } from "./validate-new-api-capability-snapshot.mjs";

const snapshot = {
  schema: "openbuddy.new-api-capability-snapshot.v1",
  generatedAt: "2026-08-30T00:00:00.000Z",
  status: { quotaPerUnit: 500000 },
  groups: [{ name: "default" }, { name: "vip" }],
  models: [{ id: "MiniMax-M3", source: "channel" }],
  channels: [{ id: "2", name: "OpenBuddy MiniMax M3" }],
};

describe("New API capability snapshot validator", () => {
  it("accepts a fresh snapshot with expected execution inventory", () => {
    expect(validateCapabilitySnapshot(snapshot, { now: Date.parse("2026-08-30T06:00:00.000Z"), maxAgeHours: 24, groups: ["default", "vip"], models: ["MiniMax-M3"], channels: ["2"] })).toMatchObject({ quotaPerUnit: 500000, groups: 2, models: 1, channels: 1 });
  });

  it("rejects stale snapshots and inventory drift", () => {
    expect(() => validateCapabilitySnapshot(snapshot, { now: Date.parse("2026-09-01T00:00:00.000Z"), maxAgeHours: 24 })).toThrow("older");
    expect(() => validateCapabilitySnapshot(snapshot, { now: Date.parse("2026-08-30T06:00:00.000Z"), maxAgeHours: 24, models: ["missing-model"] })).toThrow("model=missing-model");
  });

  it("rejects missing or invalid quota units", () => {
    expect(() => validateCapabilitySnapshot({ ...snapshot, status: { quotaPerUnit: 0 } }, { now: Date.parse("2026-08-30T06:00:00.000Z") })).toThrow("quotaPerUnit");
  });

  it("binds supported capabilities to real snapshot routes and usage evidence", () => {
    const routedSnapshot = { ...snapshot, channels: [{ id: "2", group: "default", models: ["MiniMax-M3"] }] };
    expect(validateCapabilityDirectory({ default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "required", verifiedAt: "2026-08-30" } } } }, routedSnapshot)).toMatchObject({ groups: 1, supported: 1 });
    expect(() => validateCapabilityDirectory({ missing: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "required", verifiedAt: "2026-08-30" } } } }, routedSnapshot)).toThrow("group=missing");
    expect(() => validateCapabilityDirectory({ default: { "MiniMax-M3": { responses: { supported: true, usage: "optional", verifiedAt: "2026-08-30" } } } }, routedSnapshot)).toThrow("usage=required");
  });
});
