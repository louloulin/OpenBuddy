/**
 * host-modules/session-swap.ts — `agentHost.newSession` warm-host fast path.
 *
 * Phase v4 §L-3: extract agent-host.ts:2018-2108 (~91 行) into a dedicated
 * host-module so the composition root only retains the facade assembly.
 *
 * 这是 "新建会话" 按钮的 IPC handler. 之前的实现每次都 dispose 全 host +
 * 跑 `initialize({ force: true })` (~2-5s wall-clock). warm-host 路径:
 *
 *   1. `init({ cwd })` 短路 (no-op) 当 warm host 的 cwd 已匹配;
 *      cold-start 仍然做完整 init 一次.
 *   2. `SessionManager.create(cwd, piSessionDir(cwd))` 建一个空 JSONL 文件.
 *   3. `rebindSession(path, cwd)` 调用 `piSessionRuntime.replace` (~50ms).
 *      若 cwd / agent-preset scope 实际不一致, 降级到 `initialize()` 完整路径.
 *   4. stamp preset + persist header + 可选 setModel.
 *
 * `ensureNewSession` 在并发场景下按 `${cwd}\0${modelId}` coalescing,
 * 等价于 `pi-web/lib/rpc-manager.ts:startRpcSession` 的并发合并语义.
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 `installSessionSwap(deps)` 注入
 */

import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { generateTraceId } from "@openbuddy/logging-shared";
import {
  hostReceived as hostReceivedLog,
  hostDispatched as hostDispatchedLog,
  hostFailed as hostFailedLog,
} from "../agent-host-log";
import { type AgentHostState } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

let initializeImpl: (opts?: { cwd?: string; sessionPath?: string; force?: boolean }) => Promise<void> = async () => undefined;
let rebindSessionImpl: (sessionPath: string, cwd: string) => Promise<void> = async () => undefined;
let persistPiSessionHeaderImpl: (session: AgentSession) => Promise<void> = async () => undefined;
let setModelImpl: (modelId: string) => Promise<unknown> = async () => undefined;
let piSessionDirImpl: (cwd: string) => string = () => "";

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallSessionSwapDeps {
  state: AgentHostState;
  /** `agentHost.init` 自身 (warm-host guard) */
  initialize: (opts?: { cwd?: string; sessionPath?: string; force?: boolean }) => Promise<void>;
  /** `session-rebind.rebindSession` */
  rebindSession: (sessionPath: string, cwd: string) => Promise<void>;
  /** `session-store.persistPiSessionHeader` */
  persistPiSessionHeader: (session: AgentSession) => Promise<void>;
  /** `setModel` 实现 (host-functions) */
  setModel: (modelId: string) => Promise<unknown>;
  /** `_host-paths.piSessionDir` */
  piSessionDir: (cwd: string) => string;
}

export function installSessionSwap(deps: InstallSessionSwapDeps): void {
  if (deps.state) state = deps.state;
  if (deps.initialize) initializeImpl = deps.initialize;
  if (deps.rebindSession) rebindSessionImpl = deps.rebindSession;
  if (deps.persistPiSessionHeader) persistPiSessionHeaderImpl = deps.persistPiSessionHeader;
  if (deps.setModel) setModelImpl = deps.setModel;
  if (deps.piSessionDir) piSessionDirImpl = deps.piSessionDir;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetSessionSwapForTest(): void {
  state = null;
  initializeImpl = async () => undefined;
  rebindSessionImpl = async () => undefined;
  persistPiSessionHeaderImpl = async () => undefined;
  setModelImpl = async () => undefined;
  piSessionDirImpl = () => "";
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

export interface NewSessionResult {
  sessionId?: string;
  sessionFile?: string;
  cwd: string;
  model?: { provider?: string; id?: string };
}

/**
 * warm-host 路径的 "新建会话".
 *
 * 与 `initialize()` 的差异见本文件顶部注释.
 */
export async function newSession(
  cwd: string,
  modelId?: string,
  options?: { traceId?: string; sessionId?: string },
): Promise<NewSessionResult> {
  if (!state) throw new Error("session-swap: not installed");

  const traceId = options?.traceId ?? generateTraceId();
  const sessionId = options?.sessionId;
  hostReceivedLog("agent:new-session", traceId, sessionId);
  try {
    // 1. warm-host guard: 复用现有 host if cwd 匹配; cold-start 则完整 init 一次.
    await initializeImpl({ cwd });
    // 2. 新建空 JSONL session 文件.
    const newManager = SessionManager.create(cwd, piSessionDirImpl(cwd));
    const newSessionPath = newManager.getSessionFile();
    if (!newSessionPath) {
      throw new Error("SessionManager.create did not return a session file path");
    }
    // 3. 热替换 session (~50ms). 不匹配时降级到 init 完整路径.
    await rebindSessionImpl(newSessionPath, cwd);
    // 4. mirror 原 initialize() "fresh session" tail:
    //    - persist header so next listAllPiSessions() sees the new file
    //    - stamp 当前的 preset
    const session = state.session;
    if (session) {
      await persistPiSessionHeaderImpl(session);
      const mountedPresetId = state.presetSessionRuntime?.id;
      if (mountedPresetId) {
        try {
          session.sessionManager.appendCustomEntry("openbuddy/agent-preset", {
            id: mountedPresetId,
            version: 1,
          });
        } catch (error) {
          console.warn("[openbuddy] failed to stamp preset on new session", error);
        }
      }
    }
    if (modelId?.trim()) await setModelImpl(modelId.trim());
    const result: NewSessionResult = {
      sessionId: session?.sessionId,
      sessionFile: session?.sessionFile,
      cwd,
      model: session?.model ? { provider: session.model.provider, id: session.model.id } : undefined,
    };
    hostDispatchedLog("agent:new-session", traceId, result.sessionId ?? sessionId);
    return result;
  } catch (error) {
    hostFailedLog("agent:new-session", traceId, error);
    throw error;
  }
}

/**
 * 并发 coalescing 版的 `newSession`.
 *
 * 多个并发调用 (e.g. 用户双击 "新建任务", 或 HomePage + extension 同时申请)
 * 共享同一个 in-flight Promise, 避免重复 JSONL write + rebind.
 *
 * 等价于 `pi-web/lib/rpc-manager.ts:startRpcSession` 的并发合并语义.
 */
const inFlightEnsureNewSession = new Map<string, Promise<NewSessionResult>>();

export async function ensureNewSession(
  cwd: string,
  modelId?: string,
  options?: { traceId?: string },
): Promise<NewSessionResult> {
  const key = `${cwd}\0${modelId ?? ""}`;
  const existing = inFlightEnsureNewSession.get(key);
  if (existing) return existing;

  const traceId = options?.traceId ?? generateTraceId();
  const promise = newSession(cwd, modelId, { traceId }).finally(() => {
    inFlightEnsureNewSession.delete(key);
  });
  inFlightEnsureNewSession.set(key, promise);
  return promise;
}

/** 测试 helper: 清空并发合并 map (避免 test 之间状态泄漏). */
export function __resetInFlightEnsureNewSessionForTest(): void {
  inFlightEnsureNewSession.clear();
}
