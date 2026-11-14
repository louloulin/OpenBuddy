/**
 * 遥测 provider-agnostic 契约 —— 对齐 WorkBuddy `telemetry:*` /
 * `perf:*` / `feedback:*` RPC 的抽象层。
 *
 * WorkBuddy 的遥测 sink 是腾讯 Aegis(不可移植),但「遥测抽象」本身 provider 无关。
 * OpenBuddy 是 BYOK 桌面应用,默认用 console 作为内建 provider,同时允许注册外部
 * provider(自托管 OTLP / 自建后端)。本模块是纯注册表 + 级别过滤 + 事件/指标抽象,
 * 无副作用核心逻辑可单测(注册/过滤/采样)。
 */

/** 遥测级别(由低到高)。 */
export type TelemetryLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<TelemetryLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** 一个遥测事件(log/事件上报)。 */
export interface TelemetryEvent {
  /** 事件名(如 `session_complete`、`permission_granted`)。 */
  name: string;
  /** 级别。 */
  level: TelemetryLevel;
  /** 结构化属性。 */
  props?: Record<string, unknown>;
  /** 时间戳(ms);缺省由 provider/report 填充。 */
  ts?: number;
}

/** 一个指标(计数/计时)。 */
export interface TelemetryMetric {
  name: string;
  /** 数值(计数或毫秒)。 */
  value: number;
  /** "counter" | "timing" | "gauge"。 */
  kind: "counter" | "timing" | "gauge";
  props?: Record<string, unknown>;
}

/** 遥测 provider 接口(任意实现:console、Aegis、OTLP、自建后端)。 */
export interface TelemetryProvider {
  id: string;
  /** 是否启用(env 不支持时可返回 false)。 */
  isEnabled(): boolean;
  /** 上报事件。 */
  reportEvent(event: TelemetryEvent): void;
  /** 上报指标。 */
  reportMetric(metric: TelemetryMetric): void;
}

interface TelemetryState {
  providers: TelemetryProvider[];
  /** 最小上报级别(低于此级别的事件被丢弃)。 */
  minLevel: TelemetryLevel;
  /** 采样率 0–1(默认 1 = 全采样)。 */
  sampleRate: number;
}

const state: TelemetryState = {
  providers: [],
  minLevel: "info",
  sampleRate: 1,
};

/** 注册一个 provider(去重 by id)。 */
export function registerTelemetryProvider(p: TelemetryProvider): void {
  if (state.providers.some((x) => x.id === p.id)) return;
  state.providers.push(p);
}

/** 设置最小上报级别。 */
export function setMinLevel(level: TelemetryLevel): void {
  state.minLevel = level;
}

/** 设置采样率(0–1,越界 clamp)。 */
export function setSampleRate(rate: number): void {
  state.sampleRate = Math.max(0, Math.min(1, rate));
}

/** 清空所有 provider + 重置配置(测试用)。 */
export function resetTelemetry(): void {
  state.providers = [];
  state.minLevel = "info";
  state.sampleRate = 1;
}

/** 列出已注册 provider 的 id。 */
export function listProviderIds(): string[] {
  return state.providers.map((p) => p.id);
}

/** 级别过滤:level 是否 ≥ minLevel。 */
export function shouldReport(level: TelemetryLevel, minLevel: TelemetryLevel = state.minLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

/** 采样判定:按 sampleRate 与一个 0–1 随机值决定是否上报。 */
export function shouldSample(random: number, rate: number = state.sampleRate): boolean {
  return random < rate;
}

/**
 * 上报一个事件:级别过滤 + 采样,通过后分发给所有启用 provider。
 * 返回实际分发的 provider 数(便于测试断言)。
 */
export function reportEvent(
  name: string,
  level: TelemetryLevel,
  props?: Record<string, unknown>,
  opts?: { random?: number; ts?: number },
): number {
  if (!shouldReport(level)) return 0;
  if (opts?.random !== undefined && !shouldSample(opts.random)) return 0;
  const event: TelemetryEvent = { name, level, props, ts: opts?.ts ?? Date.now() };
  let n = 0;
  for (const p of state.providers) {
    if (!p.isEnabled()) continue;
    try {
      p.reportEvent(event);
      n += 1;
    } catch {
      /* provider 故障不影响其它 provider / 主流程 */
    }
  }
  return n;
}

/** 上报一个指标:分发给所有启用 provider。返回实际分发数。 */
export function reportMetric(
  name: string,
  value: number,
  kind: TelemetryMetric["kind"] = "counter",
  props?: Record<string, unknown>,
): number {
  const metric: TelemetryMetric = { name, value, kind, props };
  let n = 0;
  for (const p of state.providers) {
    if (!p.isEnabled()) continue;
    try {
      p.reportMetric(metric);
      n += 1;
    } catch {
      /* noop */
    }
  }
  return n;
}

// ---------- 内建 console provider(默认)----------

/**
 * 创建内建 console 遥测 provider。依赖注入 record 数组以保持可测。
 */
export function createConsoleTelemetryProvider(deps: {
  isEnabled?: () => boolean;
  sink: (event: TelemetryEvent) => void;
}): TelemetryProvider {
  return {
    id: "console",
    isEnabled: deps.isEnabled ?? (() => true),
    reportEvent: (e) => deps.sink(e),
    reportMetric: (m) =>
      deps.sink({ name: `metric:${m.name}`, level: "info", props: { ...m.props, value: m.value, kind: m.kind } }),
  };
}
