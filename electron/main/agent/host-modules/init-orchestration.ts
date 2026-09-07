/**
 * host-modules/init-orchestration.ts — `agentHost.init` 的 lifecycle + telemetry 包装.
 *
 * Phase v4 §L-8: extract agent-host.ts:1406-1422 (~17 行) 到独立 host-module.
 *
 * `init()` 是 `initialize()` 的 IPC facade:
 *   - 生成 traceId (用于 cross-process 日志关联)
 *   - 用 `enqueueLifecycle` 串行化并发的初始化请求
 *   - 跟踪 in-flight promise (`initialisationPromise`), 让 `waitUntilReady()` /
 *     `bindExtensions()` 等协调方法可以 await
 *   - 发 hostReceivedLog / hostDispatchedLog / hostFailedLog 三个事件
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 外部依赖通过 install 注入 (enqueueLifecycle + initialize)
 *
 * 设计: 沿用 module-level singleton + install pattern.
 */

import { generateTraceId } from "@openbuddy/logging-shared";
import {
  hostReceived as hostReceivedLog,
  hostDispatched as hostDispatchedLog,
  hostFailed as hostFailedLog,
} from "../agent-host-log";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let initializeImpl: (opts?: { cwd?: string; sessionPath?: string; force?: boolean; traceId?: string; sessionId?: string }) => Promise<void> = async () => undefined;
let enqueueLifecycleImpl: <T>(operation: () => Promise<T>) => Promise<T> = async (op) => op();
let getCurrentSessionIdImpl: () => string | undefined = () => undefined;

// In-flight promise tracking — readers can wait on `initialisationPromise`.
let initialisationPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallInitOrchestrationDeps {
  /** agent-host.ts:initialize */
  initialize: (opts?: { cwd?: string; sessionPath?: string; force?: boolean; traceId?: string; sessionId?: string }) => Promise<void>;
  /** lifecycle.enqueueLifecycle */
  enqueueLifecycle: <T>(operation: () => Promise<T>) => Promise<T>;
  /** 用于 fallback sessionId: agent-host.ts getSessionImpl */
  getCurrentSessionId?: () => string | undefined;
}

export function installInitOrchestration(deps: InstallInitOrchestrationDeps): void {
  initializeImpl = deps.initialize;
  enqueueLifecycleImpl = deps.enqueueLifecycle;
  getCurrentSessionIdImpl = deps.getCurrentSessionId ?? (() => undefined);
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetInitOrchestrationForTest(): void {
  initializeImpl = async () => undefined;
  enqueueLifecycleImpl = async (op) => op();
  getCurrentSessionIdImpl = () => undefined;
  initialisationPromise = null;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

export interface InitOpts {
  cwd?: string;
  sessionPath?: string;
  force?: boolean;
  traceId?: string;
  sessionId?: string;
}

/**
 * IPC facade over `initialize()` — 同 lifecycle 串行 + telemetry logging.
 * 跟踪 in-flight promise 让 `waitUntilReady()` / `bindExtensions()` 可 await.
 */
export function init(opts?: InitOpts): Promise<void> {
  const traceId = opts?.traceId ?? generateTraceId();
  const sessionId = opts?.sessionId ?? getCurrentSessionIdImpl();
  hostReceivedLog("agent:init", traceId, sessionId);
  const promise = enqueueLifecycleImpl(() => initializeImpl(opts));
  initialisationPromise = promise;
  void promise.then(
    () => {
      if (initialisationPromise === promise) initialisationPromise = null;
      hostDispatchedLog("agent:init", traceId, sessionId);
    },
    (error) => {
      if (initialisationPromise === promise) initialisationPromise = null;
      hostFailedLog("agent:init", traceId, error);
    },
  );
  return promise;
}

/** 当前 in-flight init 的 promise — readers can await this to wait until ready. */
export function getInitialisationPromise(): Promise<void> | null {
  return initialisationPromise;
}

/** Test helper — reset the in-flight promise without firing callbacks. */
export function __resetInitialisationPromiseForTest(): void {
  initialisationPromise = null;
}
