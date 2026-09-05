import { describe, it, expect, vi } from "vitest";
import {
  eventToOtlpLog,
  metricToOtlpMetric,
  exportEventsBatch,
  defaultHttpSender,
  type OtlpConfig,
  type HttpSender,
} from "../telemetry/otlp-exporter";
import type { TelemetryEvent, TelemetryMetric } from "../telemetry/telemetry-contract";

const config: OtlpConfig = { endpoint: "http://localhost:4318/v1/logs", serviceName: "openbuddy" };

describe("eventToOtlpLog", () => {
  it("构造 OTLP logs 请求体", () => {
    const e: TelemetryEvent = { name: "login", level: "info", props: { user: "x" }, ts: 1000 };
    const body = eventToOtlpLog(e, config);
    expect(body.resourceLogs).toBeDefined();
    const log = (body.resourceLogs as Array<{ scopeLogs: Array<{ logRecords: Array<{ severityText: string; body: { stringValue: string } }> }> }>)[0].scopeLogs[0].logRecords[0];
    expect(log.severityText).toBe("INFO");
    expect(log.body.stringValue).toBe("login");
  });
  it("error 级别 → ERROR", () => {
    const body = eventToOtlpLog({ name: "x", level: "error" }, config);
    const log = (body.resourceLogs as Array<{ scopeLogs: Array<{ logRecords: Array<{ severityText: string }> }> }>)[0].scopeLogs[0].logRecords[0];
    expect(log.severityText).toBe("ERROR");
  });
});

describe("metricToOtlpMetric", () => {
  it("构造 OTLP metrics 请求体", () => {
    const m: TelemetryMetric = { name: "latency", value: 42, kind: "timing" };
    const body = metricToOtlpMetric(m, config);
    expect(body.resourceMetrics).toBeDefined();
  });
});

describe("exportEventsBatch", () => {
  it("空数组 → 不发送", async () => {
    const sender = vi.fn();
    const res = await exportEventsBatch([], config, sender as unknown as HttpSender);
    expect(res.count).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });
  it("多条 → 合并发送", async () => {
    const post = vi.fn(async () => ({ ok: true, status: 200 }));
    const sender: HttpSender = { post };
    const events: TelemetryEvent[] = [
      { name: "a", level: "info" },
      { name: "b", level: "warn" },
    ];
    const res = await exportEventsBatch(events, config, sender);
    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("发送失败 → ok=false", async () => {
    const post = vi.fn(async () => ({ ok: false, status: 500 }));
    const sender: HttpSender = { post };
    const res = await exportEventsBatch([{ name: "x", level: "info" }], config, sender);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });
});

describe("defaultHttpSender", () => {
  it("无 fetch → ok=false(不抛错)", async () => {
    // 临时 mock fetch 为 undefined 模拟无网络环境。
    const origFetch = globalThis.fetch;
    // @ts-expect-error — 故意置 undefined 测试降级。
    globalThis.fetch = undefined;
    try {
      const res = await defaultHttpSender.post("http://localhost:1", "{}");
      expect(res.ok).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
