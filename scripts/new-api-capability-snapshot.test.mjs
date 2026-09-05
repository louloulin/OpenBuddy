import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSnapshot, evaluateExpected, writeSnapshotAtomic } from "./new-api-capability-snapshot.mjs";

describe("New API capability snapshot", () => {
  it("normalizes management responses without exposing secrets", async () => {
    const responses = {
      "/api/status": { data: { version: "v1.0.0-rc.22", quota_per_unit: 500000, oidc_enabled: false, wechat_login: false } },
      "/api/group/": { data: [{ group: "default" }, { name: "enterprise-ai" }] },
      "/api/channel/": { data: { items: [{ id: 2, name: "MiniMax", type: 38, key: "should-not-appear", models: ["MiniMax-M3"], key_value: "secret" }] } },
      "/api/models/": { data: [{ id: "MiniMax-M3" }, { id: "embedding-model" }] },
    };
    const snapshot = await buildSnapshot({
      baseUrl: "https://new-api.test",
      headers: { authorization: "Bearer short-lived" },
      expected: { groups: ["default"], models: ["MiniMax-M3"], channels: ["2"] },
      fetcher: async (url) => responses[new URL(url).pathname],
    });
    expect(snapshot.status).toMatchObject({ version: "v1.0.0-rc.22", quotaPerUnit: 500000 });
    expect(snapshot.groups).toEqual([{ name: "default" }, { name: "enterprise-ai" }]);
    expect(snapshot.channels[0]).toMatchObject({ id: "2", name: "MiniMax", models: ["MiniMax-M3"] });
    expect(snapshot.models).toEqual([{ id: "MiniMax-M3", source: "model-management" }, { id: "embedding-model", source: "model-management" }]);
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    expect(snapshot.checks.every((check) => check.ok)).toBe(true);
  });

  it("derives models from channel comma-separated model lists when model management is empty", async () => {
    const snapshot = await buildSnapshot({
      baseUrl: "https://new-api.test",
      headers: { authorization: "Bearer short-lived" },
      expected: { models: ["MiniMax-M3", "deepseek-v4-flash"] },
      fetcher: async (url) => ({
        "/api/status": { data: { version: "v1.0.0-rc.22", quota_per_unit: 500000 } },
        "/api/group/": { data: ["default"] },
        "/api/channel/": { data: { items: [{ id: 2, name: "MiniMax", models: "MiniMax-M3, deepseek-v4-flash" }] } },
        "/api/models/": { data: { items: [] } },
      }[new URL(url).pathname]),
    });
    expect(snapshot.models).toEqual([{ id: "MiniMax-M3", source: "channel" }, { id: "deepseek-v4-flash", source: "channel" }]);
    expect(snapshot.checks.every((check) => check.ok)).toBe(true);
  });

  it("reports expected capability drift", () => {
    const checks = evaluateExpected({ groups: [{ name: "default" }], models: [], channels: [] }, { groups: ["enterprise-ai"], models: ["MiniMax-M3"], channels: ["2"] });
    expect(checks).toEqual([
      { kind: "group", value: "enterprise-ai", ok: false, reason: "group not found" },
      { kind: "model", value: "MiniMax-M3", ok: false, reason: "model not found" },
      { kind: "channel", value: "2", ok: false, reason: "channel not found" },
    ]);
  });

  it("writes snapshots atomically with restrictive permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-capability-snapshot-"));
    const file = join(directory, "snapshot.json");
    const snapshot = { schema: "openbuddy.new-api-capability-snapshot.v1", generatedAt: "2026-08-30T00:00:00.000Z" };
    await writeSnapshotAtomic(file, snapshot);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(snapshot);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("does not replace a valid snapshot when expected inventory drifts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-capability-snapshot-drift-"));
    const file = join(directory, "snapshot.json");
    const previous = { schema: "openbuddy.new-api-capability-snapshot.v1", generatedAt: "previous" };
    await writeSnapshotAtomic(file, previous);
    const responses = {
      "/api/status": { data: { version: "v1.0.0-rc.22", quota_per_unit: 500000 } },
      "/api/group/": { data: ["default"] },
      "/api/channel/": { data: { items: [{ id: 2, name: "MiniMax", models: ["MiniMax-M3"] }] } },
      "/api/models/": { data: { items: [] } },
    };
    const snapshot = await buildSnapshot({
      baseUrl: "https://new-api.test",
      headers: { authorization: "Bearer short-lived" },
      expected: { models: ["missing-model"] },
      fetcher: async (url) => responses[new URL(url).pathname],
    });
    expect(snapshot.checks[0].ok).toBe(false);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(previous);
  });
});
