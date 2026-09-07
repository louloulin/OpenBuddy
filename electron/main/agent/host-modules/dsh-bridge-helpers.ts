/**
 * host-modules/dsh-bridge-helpers.ts — DSH bridge 辅助函数 cluster.
 *
 * Phase v4 §L-16: extract agent-host.ts:234-242, 349-369 (~25 行) 到独立 host-module.
 *
 * 这一组函数给 DSH (DeepSeek Host) 提供 Cordis remote dispatch 的辅助:
 *   - questionAnswer: 从 UiRequestValue 提取 string answer (renderer 用)
 *   - deepSeekCordisSnapshot: 返回 DSH Cordis runtime snapshot
 *   - deepSeekPiBridgeDescription: 返回 Pi bridge 协议/能力描述
 *   - invokeDeepSeekCordis: 调用 DSH Cordis plugin entry
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 大多数函数是纯函数或 read-only state accessor, 不需要 install
 *
 * 设计: 模块级 singleton + install pattern (与同代 host-modules 一致).
 */

import type { DeepSeekCordisInvocation, DeepSeekCordisRuntimeSnapshot } from "@openbuddy/plugin-host";
import { DEEPSEEK_PI_BRIDGE_PROTOCOL, DEEPSEEK_PI_CAPABILITIES } from "../../deepseek/deepseek-pi-bridge";
import { type AgentHostState } from "./_state-shape";
import type { UiRequestValue } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallDshBridgeHelpersDeps {
  state: AgentHostState;
}

export function installDshBridgeHelpers(deps: InstallDshBridgeHelpersDeps): void {
  state = deps.state;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetDshBridgeHelpersForTest(): void {
  state = null;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 从 UiRequestValue 中提取 string answer (renderer 用).
 * - string value: 原样返回
 * - { answers: {...} }: 按 questionKey 取,  else 取第一个
 * - annotations: 备用路径
 * - undefined: 没有任何 answer
 */
export function questionAnswer(value: UiRequestValue, questionKey?: string): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || !("answers" in value)) return undefined;
  const answer = (questionKey ? value.answers[questionKey] : undefined) ?? Object.values(value.answers)[0];
  if (Array.isArray(answer)) return answer[0];
  const note = (questionKey ? value.annotations?.[questionKey]?.notes : undefined)
    ?? Object.values(value.annotations).map((entry) => entry.notes).find((entry): entry is string => Boolean(entry));
  return note || answer;
}

/**
 * 返回 DSH Cordis runtime snapshot (Cordis context 上所有 plugin 的状态).
 * 用于 IPC `deepSeekCordisSnapshot` 让 renderer 展示 plugin 健康状态.
 */
export function deepSeekCordisSnapshot(): DeepSeekCordisRuntimeSnapshot | null {
  if (!state) throw new Error("dsh-bridge-helpers: not installed");
  return state.deepSeekCordisSnapshot;
}

/**
 * 返回 Pi bridge 协议 + capabilities 描述.
 * 用于 IPC `deepSeekPiBridgeDescription` 让 renderer 知道 DSH 模式支持的协议.
 */
export function deepSeekPiBridgeDescription(): {
  protocol: typeof DEEPSEEK_PI_BRIDGE_PROTOCOL;
  runtime: "pi";
  capabilities: typeof DEEPSEEK_PI_CAPABILITIES;
} {
  return {
    protocol: DEEPSEEK_PI_BRIDGE_PROTOCOL,
    runtime: "pi" as const,
    capabilities: DEEPSEEK_PI_CAPABILITIES,
  };
}

/**
 * 调用 DSH Cordis plugin entry.
 * 用于 IPC `invokeDeepSeekCordis` 让 renderer 触发 plugin 执行.
 */
export async function invokeDeepSeekCordis(invocation: DeepSeekCordisInvocation): Promise<unknown> {
  if (!state) throw new Error("dsh-bridge-helpers: not installed");
  if (!state.deepSeekCordisRuntime) throw new Error("dsh-bridge-helpers: deepSeekCordisRuntime not initialized");
  return state.deepSeekCordisRuntime.invoke(invocation);
}
