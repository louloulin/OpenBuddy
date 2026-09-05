/**
 * host-modules/deepseek/agent-runtime.ts — DeepSeek Pi agent lifecycle.
 *
 * Phase 8.3 Batch G: 从 agent-host.ts 抽出 DeepSeek agent runtime 的写路径
 * (~230 行, lines 1024-1139 + 2215-2262 + 3917-4038):
 *   - AGENT_RESERVATION_TTL_MS 常量 (line 1024)
 *   - reserveDeepSeekAgent (line 1026) — agent-loop session 租约文件
 *   - reserveDeepSeekPreparation (line 1089) — session-persistence 准备租约
 *   - createDeepSeekHookedTool (line 2215) — deepseek hooks 包装器
 *   - deepSeekAgentOptionsModel (line 3917) — provider/model 解析
 *   - deepSeekAgentModel (line 3925) — maxTokens 限制
 *   - createDeepSeekAgentRuntime (line 3933) — 核心 runtime 工厂
 *   - createDeepSeekAgent (line 4032) — runtime 工厂的 create 分支
 *   - resumeDeepSeekAgent (line 4036) — runtime 工厂的 resume 分支
 *
 * 设计:
 *   - state / listAllPiSessions / piHome / piSessionDir 通过环形 import 自
 *     ../agent-host 注入 (经 Batch A 验证可行的模式)
 *   - modelFacingPresetTools / createSubagentResourceLoader 从 agent-host
 *     显式 export (本模块外其它子路径仍需用到)
 *   - SessionManager / createAgentSession 直接 from @earendil-works/pi-coding-agent
 *   - DeepSeekPiAgentRuntime / DeepSeekPiToolHooks / DeepSeekToolDecision /
 *     DeepSeekToolExecution 类型 from ../deepseek/deepseek-runtime
 *   - createTaskAwareTool / harnessToolErrorResult / harnessToolFailureResult /
 *     normalizeHarnessPostResult from ../../task-aware-tool
 *
 * agent-host.ts 中保留 0-arg wrapper:
 *   - reserveDeepSeekAgent → reserveDeepSeekAgentImpl()
 *   - reserveDeepSeekPreparation → reserveDeepSeekPreparationImpl()
 *   - createDeepSeekAgent / resumeDeepSeekAgent → createDeepSeekAgentImpl / resumeDeepSeekAgentImpl
 *
 * createDeepSeekHookedTool 不导出 — 只在本模块内被 createDeepSeekAgentRuntime 调用
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { SessionManager, createAgentSession, type DefaultResourceLoader, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

import type { AgentHostState } from "../_state-shape";

/**
 * Phase 8.3 Architectural Refactor: 顶部 from "../../agent-host" 反向依赖消除。
 * 所有运行时依赖通过 installDeepSeekAgentRuntime() 注入。
 *
 * 修复前: state / listAllPiSessions / piHome / piSessionDir /
 *         createSubagentResourceLoader / modelFacingPresetTools 都 import 自
 *         agent-host.ts,测试本模块需要 mock agent-host 完整副作用链。
 * 修复后: 只 import 类型,运行时依赖经 DI 注入,可独立单测。
 */

let listAllPiSessions: <T = unknown>() => any;
let persistedSessionPath: (id: string | undefined) => Promise<string | undefined>;
let piHome: () => string;
let piSessionDir: (cwd: string) => string;
let state: AgentHostState;
let createSubagentResourceLoader:
	(cwd: string) => Promise<{ getSystemPrompt(): string } | undefined>;
let modelFacingPresetTools: () => unknown[];

export function installDeepSeekAgentRuntime(deps: {
	listAllPiSessions: <T = unknown>() => any;
	persistedSessionPath: (id: string | undefined) => Promise<string | undefined>;
	piHome: () => string;
	piSessionDir: (cwd: string) => string;
	state: AgentHostState;
	createSubagentResourceLoader: (
		cwd: string,
	) => Promise<{ getSystemPrompt(): string } | undefined>;
	modelFacingPresetTools: () => unknown[];
}): void {
	listAllPiSessions = deps.listAllPiSessions as any;
	persistedSessionPath = deps.persistedSessionPath;
	piHome = deps.piHome;
	piSessionDir = deps.piSessionDir;
	state = deps.state;
	createSubagentResourceLoader = deps.createSubagentResourceLoader;
	modelFacingPresetTools = deps.modelFacingPresetTools;
}
import { createTaskAwareTool, harnessToolErrorResult, harnessToolFailureResult, normalizeHarnessPostResult } from "../../../task-aware-tool";
import type { DeepSeekPiAgentRuntime, DeepSeekPiToolHooks, DeepSeekToolDecision, DeepSeekToolExecution } from "../../../deepseek/deepseek-runtime";

const AGENT_RESERVATION_TTL_MS = 120_000;

async function reserveDeepSeekAgent(sessionId: string, operation: "create" | "resume"): Promise<{ token: string; heartbeatMs: number; renew: () => Promise<void>; release: () => Promise<void> }> {
  if (!sessionId || !/^[A-Za-z0-9._:-]+$/u.test(sessionId)) throw new Error("dsh-agent-loop: invalid session id for reservation");
  const root = join(piHome(), "openbuddy-agent-reservations");
  await mkdir(root, { recursive: true });
  const path = join(root, `${encodeURIComponent(sessionId)}.lease`);
  const token = randomUUID();
  const now = Date.now();
  const lease = { version: 1, sessionId, operation, token, pid: process.pid, createdAt: now, expiresAt: now + AGENT_RESERVATION_TTL_MS };
  try {
    await writeFile(path, JSON.stringify(lease), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as { expiresAt?: unknown };
      if (typeof raw.expiresAt === "number" && raw.expiresAt <= now) await rm(path, { force: true });
    } catch {
      await rm(path, { force: true }).catch(() => undefined);
    }
    try {
      await writeFile(path, JSON.stringify(lease), { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch {
      throw Object.assign(new Error(`dsh-agent-loop: session "${sessionId}" is reserved by another process`), { code: "agent-reservation-conflict", sessionId, operation });
    }
  }
  let released = false;
  const renew = async (): Promise<void> => {
    if (released) throw new Error("agent reservation is released");
    let raw: { token?: unknown; expiresAt?: unknown };
    try {
      raw = JSON.parse(await readFile(path, "utf8")) as { token?: unknown; expiresAt?: unknown };
    } catch {
      throw new Error(`agent reservation for "${sessionId}" is missing`);
    }
    if (raw.token !== token || (typeof raw.expiresAt === "number" && raw.expiresAt <= Date.now())) {
      throw new Error(`agent reservation for "${sessionId}" is owned by another process`);
    }
    const temporary = `${path}.${process.pid}.${token}.tmp`;
    await writeFile(temporary, JSON.stringify({ ...lease, expiresAt: Date.now() + AGENT_RESERVATION_TTL_MS }), { encoding: "utf8", mode: 0o600 });
    try {
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  };
  return {
    token,
    heartbeatMs: Math.floor(AGENT_RESERVATION_TTL_MS / 3),
    renew,
    release: async () => {
      if (released) return;
      released = true;
      try {
        const raw = JSON.parse(await readFile(path, "utf8")) as { token?: unknown };
        if (raw.token !== token) return;
      } catch {
        return;
      }
      await rm(path, { force: true });
    },
  };
}

async function reserveDeepSeekPreparation(sessionId: string): Promise<{ token: string; heartbeatMs: number; renew: () => Promise<void>; release: () => Promise<void> }> {
	if (!sessionId || !/^[A-Za-z0-9._:-]+$/u.test(sessionId)) throw new Error("dsh-session-persistence: invalid session id for preparation reservation");
	const path = await persistedSessionPath(sessionId);
	if (!path) return {
		token: `memory:${randomUUID()}`,
		heartbeatMs: Math.floor(AGENT_RESERVATION_TTL_MS / 3),
		renew: async () => undefined,
		release: async () => undefined,
	};
	const leasePath = `${path}.openbuddy-preparation.lease`;
	const token = randomUUID();
	const lease = { version: 1, sessionId, token, pid: process.pid, createdAt: Date.now(), expiresAt: Date.now() + AGENT_RESERVATION_TTL_MS };
	try {
		await writeFile(leasePath, JSON.stringify(lease), { encoding: "utf8", mode: 0o600, flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		let reclaim = false;
		try {
			const current = JSON.parse(await readFile(leasePath, "utf8")) as { pid?: unknown; expiresAt?: unknown };
			if (typeof current.expiresAt === "number" && current.expiresAt <= Date.now()) {
				if (typeof current.pid !== "number" || current.pid === process.pid) reclaim = true;
				else { try { process.kill(current.pid, 0); } catch (probeError) { reclaim = (probeError as NodeJS.ErrnoException).code !== "EPERM"; } }
			}
		} catch { reclaim = true; }
		if (reclaim) await rm(leasePath, { force: true });
		try {
			await writeFile(leasePath, JSON.stringify(lease), { encoding: "utf8", mode: 0o600, flag: "wx" });
		} catch {
			throw Object.assign(new Error(`dsh-session-persistence: session "${sessionId}" is being prepared by another process`), { code: "preparation-conflict", sessionId });
		}
	}
	let released = false;
	const renew = async (): Promise<void> => {
		if (released) throw new Error("preparation reservation is released");
		const current = JSON.parse(await readFile(leasePath, "utf8")) as { token?: unknown; expiresAt?: unknown };
		if (current.token !== token || (typeof current.expiresAt === "number" && current.expiresAt <= Date.now())) throw new Error(`dsh-session-persistence: preparation reservation for "${sessionId}" was lost`);
		const temporary = `${leasePath}.${process.pid}.${token}.tmp`;
		await writeFile(temporary, JSON.stringify({ ...lease, expiresAt: Date.now() + AGENT_RESERVATION_TTL_MS }), { encoding: "utf8", mode: 0o600 });
		try { await rename(temporary, leasePath); } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
	};
	return {
		token,
		heartbeatMs: Math.floor(AGENT_RESERVATION_TTL_MS / 3),
		renew,
		release: async () => {
			if (released) return;
			released = true;
			try { const current = JSON.parse(await readFile(leasePath, "utf8")) as { token?: unknown }; if (current.token === token) await rm(leasePath, { force: true }); } catch { /* already released or reclaimed */ }
		},
	};
}

function createDeepSeekHookedTool(tool: ToolDefinition, getHooks?: () => DeepSeekPiToolHooks | undefined, getAgent?: () => unknown): ToolDefinition {
  if (!getHooks) return tool;
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, extensionContext) {
      const hooks = getHooks();
      if (!hooks) return tool.execute(toolCallId, params, signal, onUpdate, extensionContext);
      const execution: DeepSeekToolExecution = {
        agent: getAgent?.(),
        toolCallId,
        toolName: tool.name,
        args: params,
        signal,
      };
      let decision: DeepSeekToolDecision;
      try {
        decision = await hooks.preExecute?.(execution) ?? { kind: "allow" } satisfies DeepSeekToolDecision;
      } catch (error) {
        return harnessToolFailureResult(error, signal?.aborted ? "ABORTED_BEFORE_DISPATCH" : "TOOL_MIDDLEWARE_FAILURE");
      }
      let result: unknown;
      if (decision.kind === "reject") {
        result = harnessToolErrorResult("TOOL_REJECTED", decision.message ?? "tool call rejected by plugin");
      } else {
        try {
          const next = () => tool.execute(toolCallId, params, signal, onUpdate, extensionContext);
          result = await (hooks.execute ? hooks.execute(execution, next) : next());
        } catch (error) {
          result = harnessToolFailureResult(error, signal?.aborted ? "ABORTED" : "TOOL_MIDDLEWARE_FAILURE");
        }
      }
      let postResult = result;
      if (hooks.postExecute) {
        try {
          postResult = normalizeHarnessPostResult(await hooks.postExecute(execution, result), result);
        } catch (error) {
          postResult = harnessToolFailureResult(error, signal?.aborted ? "ABORTED" : "TOOL_MIDDLEWARE_FAILURE");
        }
      }
      try {
        await hooks.result?.(execution, postResult);
      } catch {
        // Result observers must not alter the authoritative Pi outcome.
      }
      return postResult as Awaited<ReturnType<ToolDefinition["execute"]>>;
    },
  };
}

function deepSeekAgentOptionsModel(provider?: string, modelId?: string): Model<any> | undefined {
  if (!provider && !modelId) return state.model;
  const resolvedProvider = provider ?? state.model?.provider;
  const resolvedModel = modelId ?? state.model?.id;
  if (!resolvedProvider || !resolvedModel) return undefined;
  return state.modelRuntime?.getModel(resolvedProvider, resolvedModel);
}

function deepSeekAgentModel(model: Model<any>, maxTokens?: number): Model<any> {
  if (maxTokens === undefined) return model;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new Error("dsh-agent-loop: maxTokens must be a positive safe integer");
  }
  return maxTokens === model.maxTokens ? model : { ...model, maxTokens: Math.min(maxTokens, model.maxTokens) };
}

async function createDeepSeekAgentRuntime(options: {
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
}): Promise<DeepSeekPiAgentRuntime> {
  if (state.deepSeekAgents.has(options.sessionId)) throw new Error(`dsh-agent-loop: agent "${options.sessionId}" is already live`);
  const modelRuntime = state.modelRuntime;
  const selectedModel = deepSeekAgentOptionsModel(options.provider, options.model);
  if (!modelRuntime || !selectedModel) throw new Error("dsh-agent-loop: Pi model runtime is unavailable");
  const model = deepSeekAgentModel(selectedModel, options.maxTokens);
  let currentAgent: unknown;
  const toolHooksRef: { current?: DeepSeekPiToolHooks } = {};
  options.signal?.throwIfAborted();
  const cwd = options.cwd ?? state.cwd ?? process.cwd();
  const sessions = await listAllPiSessions();
  const persisted = sessions.find((entry: any) => entry.id === options.sessionId);
  if (options.resume && !persisted) throw new Error(`dsh-agent-loop: persisted session not found: ${options.sessionId}`);
  const sessionManager = persisted
    ? SessionManager.open(persisted.path, undefined, cwd)
    : SessionManager.create(cwd, piSessionDir(cwd), {
        id: options.sessionId,
        ...(options.parentSession ? { parentSession: options.parentSession } : {}),
      });
  const customTools: any[] = modelFacingPresetTools().map((tool: any) => createDeepSeekHookedTool(createTaskAwareTool(
    tool,
    (toolCallId) => state.runningTasks.get(toolCallId)?.abortController?.signal,
  ), () => toolHooksRef.current, () => currentAgent));
  const resourceLoader = await createSubagentResourceLoader(cwd);
  const customToolNames = customTools.map((tool: any) => tool.name);
  const created = await (createAgentSession as any)({
    cwd,
    agentDir: piHome(),
    model,
    modelRuntime,
    sessionManager,
    tools: customToolNames,
    customTools,
    ...(resourceLoader ? { resourceLoader } : {}),
  });
  const session = created.session;
  const listeners = new Set<(event: unknown) => void>();
  const unsubscribe = session.subscribe((event: any) => {
    for (const listener of [...listeners]) listener(event);
  });
  if (options.seed && options.seed.length > 0 && !persisted) {
    session.sessionManager.appendCustomEntry("deepseek/seed", options.seed);
  }
  session.sessionManager.appendCustomEntry("deepseek/agent", {
    version: 1,
    sessionId: options.sessionId,
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
  });
  const runtime: DeepSeekPiAgentRuntime = {
    sessionId: session.sessionId,
    cwd,
    get modelId() { return `${session.model?.provider ?? model.provider}/${session.model?.id ?? model.id}`; },
    get messages() { return session.state.messages as unknown[]; },
    get isStreaming() { return session.isStreaming; },
    setModel: async (provider, modelId) => {
      const next = modelRuntime.getModel(provider, modelId);
      if (!next) throw new Error(`dsh-agent-loop: model not found: ${provider}/${modelId}`);
      await session.setModel(next);
    },
    setToolAgent: (agent) => { currentAgent = agent; },
    setToolHooks: (hooks) => { toolHooksRef.current = hooks; },
    prompt: (text) => session.prompt(text),
    steer: (text) => session.steer(text),
    followUp: (text) => session.followUp(text),
    inject: async (text) => { await session.sendCustomMessage({ customType: "deepseek/inject", content: text, display: false }); },
    abort: () => session.abort(),
    waitForIdle: () => session.waitForIdle(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getEntries: () => session.sessionManager.getEntries(),
    appendCustomEntry: (customType, data) => session.sessionManager.appendCustomEntry(customType, data),
    async dispose() {
      const current = state.deepSeekAgents.get(options.sessionId);
      if (current !== runtime) return;
      await session.abort().catch(() => undefined);
      await session.waitForIdle().catch(() => undefined);
      unsubscribe();
      session.dispose();
      state.deepSeekAgents.delete(options.sessionId);
    },
  };
  state.deepSeekAgents.set(options.sessionId, runtime);
  return runtime;
}

async function createDeepSeekAgent(options: Parameters<typeof createDeepSeekAgentRuntime>[0]): Promise<DeepSeekPiAgentRuntime> {
  return createDeepSeekAgentRuntime({ ...options, resume: false });
}

async function resumeDeepSeekAgent(options: Parameters<typeof createDeepSeekAgentRuntime>[0]): Promise<DeepSeekPiAgentRuntime> {
  return createDeepSeekAgentRuntime({ ...options, resume: true });
}

export {
  reserveDeepSeekAgent,
  reserveDeepSeekPreparation,
  createDeepSeekAgent,
  resumeDeepSeekAgent,
};
