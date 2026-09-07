/**
 * host-modules/deepseek-agent-factory.ts — DeepSeek agent runtime 工厂 cluster.
 *
 * Phase v4 §L-19: 抽取 agent-host.ts:1368-1383 (~16 行) 到独立 host-module.
 *
 * 这一组函数给 DSH (DeepSeek Host) 提供 agent runtime 创建/恢复的 IPC facade:
 *   - createDeepSeekAgentRuntime: 根据 options.resume 选择 create / resume
 *   - createDeepSeekAgent: 强制 create 路径
 *   - resumeDeepSeekAgent: 强制 resume 路径
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 外部依赖通过 install 注入 (createDeepSeekAgent + resumeDeepSeekAgent)
 *
 * 设计: 沿用 module-level singleton + install pattern.
 */

import type { DeepSeekPiAgentRuntime, DeepSeekPiToolHooks } from "../../deepseek/deepseek-runtime";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let createDeepSeekAgentImpl: (options: CreateDeepSeekAgentOptions) => Promise<DeepSeekPiAgentRuntime> = async () => ({} as any);
let resumeDeepSeekAgentImpl: (options: CreateDeepSeekAgentOptions) => Promise<DeepSeekPiAgentRuntime> = async () => ({} as any);

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

export interface CreateDeepSeekAgentOptions {
  sessionId: string;
  cwd?: string;
  parentSession?: string;
  provider?: string;
  model?: string;
  maxTokens?: number;
  seed?: readonly unknown[];
  toolHooks?: DeepSeekPiToolHooks;
  signal?: AbortSignal;
  resume?: boolean;
}

/**
 * 创建/恢复 DeepSeek agent runtime.
 * 根据 `options.resume` 字段选择 create 或 resume 路径.
 */
export async function createDeepSeekAgentRuntime(options: CreateDeepSeekAgentOptions): Promise<DeepSeekPiAgentRuntime> {
  return (options.resume ? resumeDeepSeekAgentImpl : createDeepSeekAgentImpl)(options);
}

/**
 * 强制 create 路径 (忽略 options.resume).
 */
export async function createDeepSeekAgent(options: CreateDeepSeekAgentOptions): Promise<DeepSeekPiAgentRuntime> {
  return createDeepSeekAgentImpl(options);
}

/**
 * 强制 resume 路径.
 */
export async function resumeDeepSeekAgent(options: CreateDeepSeekAgentOptions): Promise<DeepSeekPiAgentRuntime> {
  return resumeDeepSeekAgentImpl(options);
}

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallDeepSeekAgentFactoryDeps {
  createDeepSeekAgent: (options: CreateDeepSeekAgentOptions) => Promise<DeepSeekPiAgentRuntime>;
  resumeDeepSeekAgent: (options: CreateDeepSeekAgentOptions) => Promise<DeepSeekPiAgentRuntime>;
}

export function installDeepSeekAgentFactory(deps: InstallDeepSeekAgentFactoryDeps): void {
  createDeepSeekAgentImpl = deps.createDeepSeekAgent;
  resumeDeepSeekAgentImpl = deps.resumeDeepSeekAgent;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetDeepSeekAgentFactoryForTest(): void {
  createDeepSeekAgentImpl = async () => ({} as any);
  resumeDeepSeekAgentImpl = async () => ({} as any);
}
