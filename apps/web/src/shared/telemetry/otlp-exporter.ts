/**
 * OTLP 遥测导出器 —— Aegis 监控 sink 的本地可移植替代。
 *
 * WorkBuddy 用腾讯 Aegis 做应用监控/错误上报(专有 sink);OpenBuddy 用 OTLP
 * (OpenTelemetry Protocol)替代:事件/指标导出到任意自托管 OTLP collector
 * (Jaeger/Tempo/Grafana Alloy 等)。这是 `telemetry-contract.ts` 的一个 provider。
 *
 * 纯函数核心(OTLP 请求体构造 + 批量聚合),HTTP 发送依赖注入便于单测。
 */
import type { TelemetryEvent, TelemetryMetric } from "./telemetry-contract";

/** OTLP exporter 配置。 */
export interface OtlpConfig {
  /** OTLP collector endpoint(如 http://localhost:4318/v1/logs)。 */
  endpoint: string;
  /** 服务名。 */
  serviceName: string;
  /** 请求头(可选,如 Authorization: Bearer <token>)。 */
  headers?: Record<string, string>;
}

/** 把一条 TelemetryEvent 转为 OTLP logs 请求体的 JSON(简化:resource_logs 格式)。 */
export function eventToOtlpLog(event: TelemetryEvent, config: OtlpConfig): Record<string, unknown> {
  const severity = event.level === "error" ? "ERROR" : event.level === "warn" ? "WARN" : "INFO";
  return {
    resourceLogs: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: config.serviceName } }] },
        scopeLogs: [
          {
            scope: { name: "openbuddy" },
            logRecords: [
              {
                timeUnixNano: String((event.ts ?? Date.now()) * 1_000_000),
                severityText: severity,
                body: { stringValue: event.name },
                attributes: Object.entries(event.props ?? {}).map(([k, v]) => ({
                  key: k,
                  value: { stringValue: String(v) },
                })),
              },
            ],
          },
        ],
      },
    ],
  };
}

/** 把一条 TelemetryMetric 转为 OTLP metrics 请求体(简化:sum 数据点)。 */
export function metricToOtlpMetric(metric: TelemetryMetric, config: OtlpConfig): Record<string, unknown> {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: config.serviceName } }] },
        scopeMetrics: [
          {
            scope: { name: "openbuddy" },
            metrics: [
              {
                name: metric.name,
                description: metric.props?.description as string | undefined,
                sum: {
                  dataPoints: [
                    {
                      timeUnixNano: String(Date.now() * 1_000_000),
                      asDouble: metric.value,
                      attributes: Object.entries(metric.props ?? {})
                        .filter(([k]) => k !== "description")
                        .map(([k, v]) => ({ key: k, value: { stringValue: String(v) } })),
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** HTTP 发送器接口(注入:运行时=fetch,测试=mock)。 */
export interface HttpSender {
  post(url: string, body: string, headers?: Record<string, string>): Promise<{ ok: boolean; status: number }>;
}

/**
 * 批量导出:把多条事件聚合成一次 OTLP logs 请求(减少 HTTP 往返)。
 * 返回发送结果。
 */
export async function exportEventsBatch(
  events: TelemetryEvent[],
  config: OtlpConfig,
  sender: HttpSender,
): Promise<{ ok: boolean; status: number; count: number }> {
  if (events.length === 0) return { ok: true, status: 0, count: 0 };
  // 合并所有事件到一个 resourceLogs(共享 resource)。
  const body = {
    resourceLogs: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: config.serviceName } }] },
        scopeLogs: [
          {
            scope: { name: "openbuddy" },
            logRecords: events.map((e) => ({
              timeUnixNano: String((e.ts ?? Date.now()) * 1_000_000),
              severityText: e.level === "error" ? "ERROR" : e.level === "warn" ? "WARN" : "INFO",
              body: { stringValue: e.name },
              attributes: Object.entries(e.props ?? {}).map(([k, v]) => ({
                key: k,
                value: { stringValue: String(v) },
              })),
            })),
          },
        ],
      },
    ],
  };
  const res = await sender.post(config.endpoint, JSON.stringify(body), {
    "Content-Type": "application/json",
    ...config.headers,
  });
  return { ok: res.ok, status: res.status, count: events.length };
}

/** 默认 HTTP 发送器(运行时用 fetch)。 */
export const defaultHttpSender: HttpSender = {
  async post(url, body, headers) {
    if (typeof fetch === "undefined") return { ok: false, status: 0 };
    const res = await fetch(url, { method: "POST", body, headers });
    return { ok: res.ok, status: res.status };
  },
};
