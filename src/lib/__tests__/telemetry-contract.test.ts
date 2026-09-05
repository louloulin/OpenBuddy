import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerTelemetryProvider,
  setMinLevel,
  setSampleRate,
  resetTelemetry,
  listProviderIds,
  shouldReport,
  shouldSample,
  reportEvent,
  reportMetric,
  createConsoleTelemetryProvider,
  type TelemetryProvider,
} from "../telemetry/telemetry-contract";

describe("telemetry-contract — 注册表与配置", () => {
  beforeEach(resetTelemetry);

  const provider = (id: string, enabled = true): TelemetryProvider => ({
    id,
    isEnabled: () => enabled,
    reportEvent: () => {},
    reportMetric: () => {},
  });

  it("注册后可列出 id", () => {
    registerTelemetryProvider(provider("otlp"));
    expect(listProviderIds()).toEqual(["otlp"]);
  });

  it("同 id 不重复注册", () => {
    registerTelemetryProvider(provider("otlp"));
    registerTelemetryProvider(provider("otlp"));
    expect(listProviderIds()).toEqual(["otlp"]);
  });

  it("reset 清空", () => {
    registerTelemetryProvider(provider("a"));
    resetTelemetry();
    expect(listProviderIds()).toEqual([]);
  });

  it("setMinLevel / setSampleRate 可改", () => {
    setMinLevel("error");
    setSampleRate(0.5);
    expect(shouldReport("error", "error")).toBe(true);
    expect(shouldSample(0.3, 0.5)).toBe(true);
  });
});

describe("shouldReport / shouldSample", () => {
  beforeEach(resetTelemetry);

  it("级别过滤:≥ minLevel 通过", () => {
    expect(shouldReport("debug", "info")).toBe(false);
    expect(shouldReport("info", "info")).toBe(true);
    expect(shouldReport("warn", "info")).toBe(true);
    expect(shouldReport("error", "info")).toBe(true);
    expect(shouldReport("error", "error")).toBe(true);
    expect(shouldReport("warn", "error")).toBe(false);
  });

  it("采样:random < rate 通过", () => {
    expect(shouldSample(0.3, 0.5)).toBe(true);
    expect(shouldSample(0.7, 0.5)).toBe(false);
    expect(shouldSample(0.0, 0.0)).toBe(false);
    expect(shouldSample(0.99, 1.0)).toBe(true);
  });
});

describe("reportEvent", () => {
  beforeEach(resetTelemetry);

  it("分发到所有启用 provider,返回分发数", () => {
    const a = provider("a");
    const b = provider("b");
    registerTelemetryProvider(a);
    registerTelemetryProvider(b);
    expect(reportEvent("ev", "info")).toBe(2);
  });

  it("跳过未启用 provider", () => {
    registerTelemetryProvider(provider("disabled", false));
    registerTelemetryProvider(provider("enabled", true));
    expect(reportEvent("ev", "info")).toBe(1);
  });

  it("级别低于 minLevel 不分发", () => {
    setMinLevel("error");
    registerTelemetryProvider(provider("a"));
    expect(reportEvent("ev", "info")).toBe(0);
    expect(reportEvent("ev", "error")).toBe(1);
  });

  it("采样未命中(random ≥ rate)不分发", () => {
    setSampleRate(0.5);
    registerTelemetryProvider(provider("a"));
    expect(reportEvent("ev", "info", {}, { random: 0.7 })).toBe(0);
  });

  it("采样命中(random < rate)分发", () => {
    setSampleRate(0.5);
    registerTelemetryProvider(provider("a"));
    expect(reportEvent("ev", "info", {}, { random: 0.3 })).toBe(1);
  });

  it("provider 抛错不影响其它 provider 与返回计数", () => {
    registerTelemetryProvider({
      id: "bad",
      isEnabled: () => true,
      reportEvent: () => {
        throw new Error("boom");
      },
      reportMetric: () => {},
    });
    registerTelemetryProvider(provider("good"));
    // bad 抛错被吞,good 正常 → 计数 1。
    expect(reportEvent("ev", "info")).toBe(1);
  });

  it("事件带 ts(默认 Date.now)", () => {
    const sink = vi.fn();
    registerTelemetryProvider(createConsoleTelemetryProvider({ sink }));
    reportEvent("ev", "info", { x: 1 }, { ts: 12345 });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ name: "ev", ts: 12345, props: { x: 1 } }));
  });
});

describe("reportMetric", () => {
  beforeEach(resetTelemetry);

  it("分发到启用 provider", () => {
    registerTelemetryProvider(provider("a"));
    expect(reportMetric("latency", 42, "timing")).toBe(1);
  });

  it("无 provider 返回 0", () => {
    expect(reportMetric("latency", 42)).toBe(0);
  });
});

describe("createConsoleTelemetryProvider", () => {
  beforeEach(resetTelemetry);

  it("reportEvent 调用 sink", () => {
    const sink = vi.fn();
    registerTelemetryProvider(createConsoleTelemetryProvider({ sink }));
    reportEvent("login", "info");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].name).toBe("login");
  });

  it("reportMetric 转成 metric:<name> 事件", () => {
    const sink = vi.fn();
    registerTelemetryProvider(createConsoleTelemetryProvider({ sink }));
    reportMetric("cnt", 7, "counter", { tag: "x" });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ name: "metric:cnt", props: expect.objectContaining({ value: 7, kind: "counter" }) }),
    );
  });

  it("isEnabled 透传", () => {
    const p = createConsoleTelemetryProvider({ isEnabled: () => false, sink: () => {} });
    expect(p.isEnabled()).toBe(false);
  });
});

function provider(id: string, enabled = true): TelemetryProvider {
  return {
    id,
    isEnabled: () => enabled,
    reportEvent: () => {},
    reportMetric: () => {},
  };
}
