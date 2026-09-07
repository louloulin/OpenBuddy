/**
 * host-modules/preset-helpers.ts — agent preset 辅助函数 cluster.
 *
 * Phase v4 §L-6: extract agent-host.ts:996-1024 (~25 行) 到独立 host-module.
 * 这一组函数围绕 `state.profileOptions` + `state.presetSessionRuntime`
 * 共同提供:
 *   - selectedProfileDirectory: 给 profile 目录的绝对路径
 *   - createPiToolExtension: 注册 preset 提供的 tool 到 Pi session
 *   - sessionPresetSelection: 从 session JSONL 读出 preset 选择
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 install 注入
 *
 * 设计: 沿用 module-level singleton + install pattern.
 */

import { resolve, join } from "node:path";
import { DefaultResourceLoader, SessionManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { defaultOpenBuddyProfileHome } from "@openbuddy/plugin-host";
import { createTaskAwareTool } from "../../task-aware-tool";
import { resolveAgentPresetSelection } from "../agent-preset-selection";
import { createPiPlanModeExtension } from "../pi-plan-mode";
import { type AgentHostState, type ToolDefinition } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;
// Pi-home helper is read by createPiToolExtension for subagent resource loader.
let piHomeImpl: () => string = () => "";

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallPresetHelpersDeps {
  state: AgentHostState;
  /** _host-paths.piHome */
  piHome: () => string;
}

export function installPresetHelpers(deps: InstallPresetHelpersDeps): void {
  state = deps.state;
  piHomeImpl = deps.piHome;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetPresetHelpersForTest(): void {
  state = null;
  piHomeImpl = () => "";
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 解析当前 profile 目录的绝对路径.
 *   1. 优先使用 state.profileOptions.profileDir (已 resolve 过)
 *   2. fallback 到 `<home>/profiles/<profileName>` (默认 "desktop")
 */
export function selectedProfileDirectory(): string {
  if (!state) throw new Error("preset-helpers: not installed");
  if (state.profileOptions?.profileDir) return resolve(state.profileOptions.profileDir);
  return join(
    state.profileOptions?.home ?? defaultOpenBuddyProfileHome(),
    "profiles",
    state.profileOptions?.profileName ?? "desktop",
  );
}

/**
 * Pi extension factory — 把 preset session runtime 提供的 tools 注册到 Pi session,
 * 包装 createTaskAwareTool 让 tool 调用走 harness 的 task pipeline.
 *
 * Returns a no-op factory if the Pi SDK doesn't expose `registerTool`.
 */
export function createPiToolExtension(): ExtensionFactory {
  if (!state) throw new Error("preset-helpers: not installed");
  return (pi) => {
    if (typeof (pi as any).registerTool !== "function") return;
    const tools: ToolDefinition[] = state!.presetSessionRuntime?.tools ?? state!.toolRegistry.list();
    for (const tool of tools) {
      (pi as any).registerTool(createTaskAwareTool(tool, (toolCallId) => state!.runningTasks.get(toolCallId)?.abortController?.signal));
    }
  };
}

/**
 * 从 session JSONL 文件读出 preset 选择 (openbuddy/agent-preset custom entry).
 * Returns undefined if no preset was stamped or the file is unreadable.
 */
export async function sessionPresetSelection(sessionPath?: string | null): Promise<string | null | undefined> {
  if (!state) throw new Error("preset-helpers: not installed");
  if (!sessionPath) return undefined;
  try {
    const entries = SessionManager.open(sessionPath).getEntries();
    return resolveAgentPresetSelection(entries);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 增量添加: createSubagentResourceLoader + createPiPlanModeFactory (Phase v4 §L-10)
// ---------------------------------------------------------------------------

/**
 * 给 subagent 创建专用的 Pi resource loader.
 * 如果当前 preset 没设 modelFacingSystemPrompt, 返回 undefined (no override).
 *
 * The returned loader has `noExtensions: true` so subagents don't accidentally
 * inherit the parent's plugin set (Cordis / typert / renderer); they get only
 * Pi's core capabilities + the preset's system prompt override.
 */
export async function createSubagentResourceLoader(cwd: string): Promise<DefaultResourceLoader | undefined> {
  if (!state) throw new Error("preset-helpers: not installed");
  const presetPrompt = state!.presetSessionRuntime?.modelFacingSystemPrompt.trim();
  if (!presetPrompt) return undefined;
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: piHomeImpl(),
    noExtensions: true,
    systemPromptOverride: (base) => [base, presetPrompt].filter((value): value is string => Boolean(value?.trim())).join("\n\n") || undefined,
  });
  await loader.reload();
  return loader;
}

/**
 * 给 Pi session 注册 plan-mode extension factory. 通过 `state.context.get("plan")`
 * 拿到 controller (provided by Cordis in initialize()), 注入到 createPiPlanModeExtension.
 */
export function createPiPlanModeFactory(): ExtensionFactory {
  if (!state) throw new Error("preset-helpers: not installed");
  return createPiPlanModeExtension({
    resolveController: () => state!.context?.get("plan") as {
      getPlan: (sessionId: string) => Promise<{ enabled: boolean; state: string; planText: string }>;
      setEnabled: (sessionId: string, enabled: boolean) => Promise<{ enabled: boolean; state: string; planText: string }>;
      requestEnabled: (sessionId: string, enabled: boolean) => Promise<{ enabled: boolean; state: string; planText: string }>;
      commitPending: (sessionId: string) => Promise<{ enabled: boolean; state: string; planText: string }>;
      setPlan: (sessionId: string, planText: string) => Promise<{ enabled: boolean; state: string; planText: string }>;
      approve: (sessionId: string) => Promise<{ enabled: boolean; state: string; planText: string }>;
      reject: (sessionId: string) => Promise<{ enabled: boolean; state: string; planText: string }>;
    } | undefined,
  });
}
