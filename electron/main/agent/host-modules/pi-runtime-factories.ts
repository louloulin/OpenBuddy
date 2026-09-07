/**
 * host-modules/pi-runtime-factories.ts — Cordis context 用的 Pi runtime factories.
 *
 * Phase v4 §L-4: extract agent-host.ts:728-797 (~70 行) 到独立 host-module.
 * 这组工厂函数构造 `PiToolRegistry` / `PiAgentRuntime` / `PiSessionFacade` 三个
 * Cordis 提供的服务对象, 让 profile plugins 可以在 Pi 还没创建 session 之前
 * 注入工具. 它们全部闭包 `state`, 所以走 install 模式注入.
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 install + 闭包 state 注入
 *
 * 设计: 沿用 module-level singleton + install pattern.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { OpenBuddyThinkingLevel } from "../../ipc/validation";
import { type AgentHostState, type PiToolRegistry } from "./_state-shape";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;
let piHomeImpl: () => string = () => "";
let getSessionImpl: () => any = () => null;
let getModelImpl: () => any = () => null;
let promptImpl: (text: string, options?: any) => Promise<unknown> = async () => undefined;
let abortImpl: (options?: any) => Promise<unknown> = async () => undefined;
let setModelImpl: (modelId: string, options?: any) => Promise<unknown> = async () => undefined;
let setThinkingLevelImpl: (level: any, options?: any) => Promise<unknown> = async () => undefined;
let promptContentImpl: (content: readonly unknown[], mode?: "queue" | "steer") => Promise<unknown> = async () => undefined;
let onEventImpl: (handler: any) => unknown = () => undefined;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallPiRuntimeFactoriesDeps {
  state: AgentHostState;
  /** _host-paths.piHome */
  piHome: () => string;
  /** host-functions.getSession */
  getSession: () => any;
  /** host-functions.getModel */
  getModel: () => any;
  /** host-functions.prompt */
  prompt: (text: string, options?: any) => Promise<unknown>;
  /** host-functions.abort */
  abort: (options?: any) => Promise<unknown>;
  /** host-functions.setModel */
  setModel: (modelId: string, options?: any) => Promise<unknown>;
  /** host-functions.setThinkingLevel */
  setThinkingLevel: (level: any, options?: any) => Promise<unknown>;
  /** host-functions.promptContent */
  promptContent: (content: readonly unknown[], mode?: "queue" | "steer") => Promise<unknown>;
  /** host-functions.onEvent */
  onEvent: (handler: any) => unknown;
}

export function installPiRuntimeFactories(deps: InstallPiRuntimeFactoriesDeps): void {
  state = deps.state;
  piHomeImpl = deps.piHome;
  getSessionImpl = deps.getSession;
  getModelImpl = deps.getModel;
  promptImpl = deps.prompt;
  abortImpl = deps.abort;
  setModelImpl = deps.setModel;
  setThinkingLevelImpl = deps.setThinkingLevel;
  promptContentImpl = deps.promptContent;
  onEventImpl = deps.onEvent;
}

/** 测试 / 调试: 把 module-level singleton 还原成 stub. */
export function __resetPiRuntimeFactoriesForTest(): void {
  state = null;
  piHomeImpl = () => "";
  getSessionImpl = () => null;
  getModelImpl = () => null;
  promptImpl = async () => undefined;
  abortImpl = async () => undefined;
  setModelImpl = async () => undefined;
  setThinkingLevelImpl = async () => undefined;
  promptContentImpl = async () => undefined;
  onEventImpl = () => undefined;
}

// ---------------------------------------------------------------------------
// 公开 API — Facade 接口
// ---------------------------------------------------------------------------

/**
 * `PiToolRegistry` — 让 profile plugin 可以在 Cordis 启动时注册 tool,
 * 之后 Pi session 创建时通过 `piRuntime.tools` 拿到.
 *
 * 每次 register/unregister 都会 bump `state.toolRegistryRevision`,
 * 并触发 deepseek pi-tool sync (用于 DSH 模式同步).
 */
export function createToolRegistry(onChange?: () => void): PiToolRegistry {
  if (!state) throw new Error("pi-runtime-factories: not installed");
  const tools = new Map<string, ToolDefinition>();
  return {
    registerTool: (tool) => {
      if (!tool?.name) throw new Error("openbuddy-tool: name is required");
      tools.set(tool.name, tool);
      state!.toolRegistryRevision += 1;
      state!.deepSeekPiToolSync?.();
      onChange?.();
      return () => {
        if (tools.get(tool.name) !== tool) return false;
        const deleted = tools.delete(tool.name);
        if (deleted) {
          state!.toolRegistryRevision += 1;
          state!.deepSeekPiToolSync?.();
          onChange?.();
        }
        return deleted;
      };
    },
    list: () => [...tools.values()],
    listLocal: () => [...tools.values()],
  };
}

export interface PiAgentRuntime {
  tools: PiToolRegistry;
  getSession: () => any;
  getModel: () => any;
  prompt: (text: string, options?: any) => Promise<unknown>;
  abort: (options?: any) => Promise<unknown>;
  setModel: (modelId: string, options?: any) => Promise<unknown>;
  onEvent: (handler: any) => unknown;
}

/**
 * `PiAgentRuntime` — Cordis 提供的"运行时" 服务. profile plugin 通过
 * `context.get("runtime")` 拿到这个对象, 它的所有方法都 delegate 到
 * host-functions (getSession / prompt / abort / ...).
 */
export function createPiRuntime(): PiAgentRuntime {
  if (!state) throw new Error("pi-runtime-factories: not installed");
  return {
    tools: state.toolRegistry,
    getSession: getSessionImpl,
    getModel: getModelImpl,
    prompt: promptImpl,
    abort: abortImpl,
    setModel: setModelImpl,
    onEvent: onEventImpl,
  };
}

export interface PiSessionFacade {
  readonly sessionId?: string;
  readonly model?: any;
  readonly thinkingLevel?: OpenBuddyThinkingLevel;
  getSession: () => any;
  subscribe: (handler: any) => unknown;
  prompt: (text: string) => Promise<unknown>;
  promptContent: (content: readonly unknown[], mode?: "queue" | "steer") => Promise<unknown>;
  abort: () => Promise<unknown>;
  setModel: (modelId: string) => Promise<unknown>;
  setThinkingLevel: (level: any) => Promise<unknown>;
}

/**
 * `PiSessionFacade` — 稳定服务, 在第一个 AgentSession 创建前就可以注入.
 * profile plugin 加载早于 Pi session, 此时不能注入 `AgentSession` 本身,
 * 所以这里用 live facade 替代一次性值. 所有方法都解析当前 session,
 * 在 host 处于 "between sessions" 时返回稳定结果.
 */
export function createPiSessionFacade(): PiSessionFacade {
  if (!state) throw new Error("pi-runtime-factories: not installed");
  return {
    get sessionId() { return state!.session?.sessionId; },
    get model() { return state!.session?.model; },
    get thinkingLevel() {
      // Read through the SDK getter so we always surface the clamped level
      // (Pi can downshift e.g. "high" → "medium" if the active model
      // doesn't support the requested tier).
      const session = state!.session;
      return session ? (session.thinkingLevel as OpenBuddyThinkingLevel) : undefined;
    },
    getSession: getSessionImpl,
    subscribe: (handler) => onEventImpl(handler),
    prompt: (text) => promptImpl(text),
    promptContent: (content, mode) => promptContentImpl(content, mode),
    abort: () => abortImpl(),
    setModel: (modelId) => setModelImpl(modelId),
    setThinkingLevel: (level) => setThinkingLevelImpl(level),
  };
}

/**
 * `listAllPiSessions` — 列出 piHome 下所有 session.
 *
 * 扫描 `${piHome}` 和 `${piHome}/sessions/<workspace>/` 三个层级的目录,
 * 用 SessionManager.listAll 去重并按 modified 时间倒序返回.
 */
export async function listAllPiSessions(): Promise<Awaited<ReturnType<typeof SessionManager.listAll>>> {
  const root = piHomeImpl();
  const sessionRoots = [root, join(root, "sessions")];
  try {
    for (const entry of await readdir(join(root, "sessions"), { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink()) sessionRoots.push(join(root, "sessions", entry.name));
    }
  } catch {
    // A first-run agent directory may not have a sessions directory yet.
  }
  const sessions = await Promise.all(sessionRoots.map((directory) => SessionManager.listAll(directory)));
  return [...new Map(sessions.flat().map((session) => [session.path, session])).values()]
    .sort((left, right) => right.modified.getTime() - left.modified.getTime());
}

/**
 * `persistedSessionPath` — 给一个 sessionId, 返回它的 JSONL 文件路径.
 * 优先查 active session 的内存, 否则 fallback 到 listAllPiSessions 全盘扫描.
 */
export async function persistedSessionPath(sessionId: string | undefined): Promise<string | undefined> {
  if (!state) throw new Error("pi-runtime-factories: not installed");
  if (!sessionId) return undefined;
  const active = state.session;
  if (active?.sessionId === sessionId) return active.sessionManager.getSessionFile();
  try {
    return (await listAllPiSessions()).find((session) => session.id === sessionId)?.path;
  } catch {
    return undefined;
  }
}

/**
 * 用于 module-load createDefaultAgentHostState() 阶段的 stub 实现.
 * state 还未 install (installMicrokernelHost 在 initialize() 内被调用),
 * 但 agent-host.ts 的 module-level `export const state` 需要一个占位
 * toolRegistry 才能完成 module 初始化. 真值会在 installMicrokernelHost 后
 * 通过 installPiRuntimeFactories 替换.
 */
export function createToolRegistryStub(): PiToolRegistry {
  const stubTools = new Map<string, ToolDefinition>();
  return {
    registerTool: (tool) => {
      stubTools.set(tool.name, tool);
      return () => stubTools.delete(tool.name);
    },
    list: () => [...stubTools.values()],
    listLocal: () => [...stubTools.values()],
  } as PiToolRegistry;
}
