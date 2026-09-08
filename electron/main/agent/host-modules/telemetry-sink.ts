/**
 * host-modules/telemetry-sink.ts — 主进程 OpenBuddyTelemetrySink 工厂.
 *
 * Phase v4 §L-9: extract agent-host.ts:1458-1482 (~17 行) 到独立 host-module.
 *
 * `telemetrySink()` 根据 `rendererEventEmitter` / `OPENBUDDY_AEGIS_MODE` /
 * `OPENBUDDY_SPAN_TREE_EXPORTER` 三个开关, 决定 sink 是否激活以及是否透传到
 * WorkBuddy Aegis 收集器 / span-tree.jsonl.
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 外部依赖通过 install 注入 (rendererEventEmitter 检测 + emitRendererEvent)
 *
 * 设计: 沿用 module-level singleton + install pattern.
 */

import { createMainTelemetrySink, type OpenBuddyTelemetrySink } from "../pi-telemetry-bridge";
import { createStdoutSpanExporter } from "../pi-telemetry-span-tree";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let hasRendererEventEmitter: () => boolean = () => false;
let emitRendererEventImpl: (channel: string, payload: unknown) => void = () => undefined;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallTelemetrySinkDeps {
  /** agent-host.ts:bindRendererEventEmitter 之后的 `rendererEventEmitter` 是否绑定 */
  hasRendererEventEmitter: () => boolean;
  /** agent-host.ts:emitRendererEvent */
  emitRendererEvent: (channel: string, payload: unknown) => void;
}

export function installTelemetrySink(deps: InstallTelemetrySinkDeps): void {
  if (deps.hasRendererEventEmitter) hasRendererEventEmitter = deps.hasRendererEventEmitter;
  if (deps.emitRendererEvent) emitRendererEventImpl = deps.emitRendererEvent;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetTelemetrySinkForTest(): void {
  hasRendererEventEmitter = () => false;
  emitRendererEventImpl = () => undefined;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 构建主进程的 OpenBuddy telemetry sink. 行为:
 *   - 没有 renderer emitter → 返回 undefined (sink 不工作)
 *   - OPENBUDDY_AEGIS_MODE=1 → 透传到 WorkBuddy Aegis 收集器 (wb.telemetry.*)
 *   - OPENBUDDY_SPAN_TREE_EXPORTER=1 → 同时镜像到 ~/.pi/openbuddy/span-tree.jsonl
 *
 * 默认 boot 路径两个 flag 都未设,  返回无 side-effect 的 span exporter passthrough.
 */
export function telemetrySink(): OpenBuddyTelemetrySink | undefined {
  if (!hasRendererEventEmitter()) return undefined;
  // Aegis mode forwards span events under the `wb.telemetry.*` namespace
  // so external WorkBuddy Aegis collectors consume the same span tree
  // without any additional schema translation. Off by default.
  const aegisMode = process.env.OPENBUDDY_AEGIS_MODE === "1";
  const inner = createMainTelemetrySink(
    (channel, payload) => emitRendererEventImpl(channel, payload),
    aegisMode ? { aegisMode: true } : {},
  );
  // When `OPENBUDDY_SPAN_TREE_EXPORTER=1` is set, mirror every event
  // into `~/.pi/openbuddy/span-tree.jsonl`. The exporter is a no-op
  // identity passthrough when the flag is unset, so the default
  // boot path is unchanged. This is the local stand-in for
  // `@braintrust/pi-extension` / `@raindrop-ai/pi-agent` per the
  // pi-plugin-reuse-batch decision table.
  return createStdoutSpanExporter(inner);
}
