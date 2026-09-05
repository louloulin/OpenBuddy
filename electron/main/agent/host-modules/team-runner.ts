type HookShellRunner = any;
/**
 * host-modules/team-runner.ts — openbuddy team runner factory.
 *
 * Phase 8.3 Architectural Refactor: 从 agent-host.ts 抽出的子代理团队运行器。
 *
 * 修复前:
 *   - assistantMessageText (line 2905) + createTeamRunner (line 2920-3087, ~167 行)
 *     嵌入 agent-host.ts,后者 import 一大堆 state/工具函数。
 *   - 模块顶部 `import { ... } from "../agent-host"`,产生反向依赖,
 *     阻止 host-modules 单独测试。
 *
 * 修复后:
 *   - 用 Install Pattern,所有外部依赖通过 `installTeamRunner(deps)` 注入。
 *   - 模块只 import 纯类型(`@earendil-works/pi-ai`/`@openbuddy/team-team`/`@openbuddy/plugin-host`),
 *     没有对 agent-host.ts 的反向依赖。
 *   - agent-host.ts 仍保留 0-arg wrapper(createTeamRunnerImpl/assistantMessageTextImpl),
 *     调用方代码零改动。
 */
import {
  SessionManager,
  createAgentSession,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

import type { TeamMemberInput, TeamRunner } from "@openbuddy/team-team";

import type { AgentHostState } from "./_state-shape";

/* ---------- Install Pattern: module-level lets + DI ---------- */
let _state: AgentHostState | null = null;
let _emitPluginEvent: ((type: string, payload: unknown) => void) | null = null;
let _canonicalEventNamespace: ((t: string) => string | undefined) | null = null;
let _createSubagentResourceLoader:
  | ((cwd: string) => Promise<{ getSystemPrompt(): string } | undefined>)
  | null = null;
let _createTaskAwareTool: ((...args: unknown[]) => unknown) | null = null;
let _eventNamespace: ((t: string) => string) | null = null;
let _modelFacingPresetTools: (() => unknown[]) | null = null;
let _persistedSessionPath:
  | ((id: string | undefined) => Promise<string | undefined>)
  | null = null;
let _piHome: (() => string) | null = null;
let _piSessionDir: ((cwd: string) => string) | null = null;
let _runHookPoint:
  | ((
      configs: unknown,
      point: string,
      role: string,
      payload: unknown,
      context: unknown,
      emit: (...args: unknown[]) => unknown,
      shell: any | undefined,
    ) => Promise<{ decision: string; reason?: string; additionalContext: string[] }>)
  | null = null;

export function installTeamRunner(deps: {
  state: AgentHostState;
  emitPluginEvent: (type: string, payload: unknown) => void;
  canonicalEventNamespace: (t: string) => string | undefined;
  createSubagentResourceLoader: (
    cwd: string,
  ) => Promise<{ getSystemPrompt(): string } | undefined>;
  createTaskAwareTool: (...args: unknown[]) => unknown;
  eventNamespace: (t: string) => string;
  modelFacingPresetTools: () => unknown[];
  persistedSessionPath: (id: string | undefined) => Promise<string | undefined>;
  piHome: () => string;
  piSessionDir: (cwd: string) => string;
  runHookPoint: (
    configs: unknown,
    point: string,
    role: string,
    payload: unknown,
    context: unknown,
    emit: (...args: unknown[]) => unknown,
    shell: any | undefined,
  ) => Promise<{ decision: string; reason?: string; additionalContext: string[] }>;
}): void {
  _state = deps.state;
  _emitPluginEvent = deps.emitPluginEvent;
  _canonicalEventNamespace = deps.canonicalEventNamespace;
  _createSubagentResourceLoader = deps.createSubagentResourceLoader;
  _createTaskAwareTool = deps.createTaskAwareTool;
  _eventNamespace = deps.eventNamespace;
  _modelFacingPresetTools = deps.modelFacingPresetTools;
  _persistedSessionPath = deps.persistedSessionPath;
  _piHome = deps.piHome;
  _piSessionDir = deps.piSessionDir;
  _runHookPoint = deps.runHookPoint;
}

/* ---------- Helpers: throw cleanly if called before install ---------- */
function requireState(): AgentHostState {
  if (!_state) throw new Error("team-runner: installTeamRunner() not called");
  return _state;
}
function requireFn<T>(name: string, fn: T | null): T {
  if (!fn) throw new Error(`team-runner: ${name} not provided`);
  return fn;
}

/* ---------- Original implementation (signatures unchanged) ---------- */

function assistantMessageText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const assistant = [...messages].reverse().find((message) => (
    message && typeof message === "object" && (message as { role?: unknown }).role === "assistant"
  )) as { content?: unknown } | undefined;
  if (!assistant) return "";
  if (typeof assistant.content === "string") return assistant.content;
  if (!Array.isArray(assistant.content)) return "";
  return assistant.content
    .filter((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text")
    .map((part) => (part as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string")
    .join("");
}

function createTeamRunner(modelRuntime: ModelRuntime, cwd: string, getModel: () => Model<any> | undefined): TeamRunner {
  return {
    async runMember(input: TeamMemberInput, signal: AbortSignal): Promise<string | { text: string; sessionId?: string }> {
      const state = requireState();
      const emitPluginEvent = requireFn("emitPluginEvent", _emitPluginEvent);
      const canonicalEventNamespace = requireFn("canonicalEventNamespace", _canonicalEventNamespace);
      const createSubagentResourceLoader = requireFn("createSubagentResourceLoader", _createSubagentResourceLoader);
      const createTaskAwareToolRaw = requireFn<(...args: unknown[]) => unknown>("createTaskAwareTool", _createTaskAwareTool);
      const eventNamespace = requireFn("eventNamespace", _eventNamespace);
      const modelFacingPresetTools = requireFn("modelFacingPresetTools", _modelFacingPresetTools);
      const persistedSessionPath = requireFn("persistedSessionPath", _persistedSessionPath);
      const piHome = requireFn("piHome", _piHome);
      const piSessionDir = requireFn("piSessionDir", _piSessionDir);
      const runHookPoint = requireFn("runHookPoint", _runHookPoint);

      let model = getModel();
      if (input.provider || input.model) {
        const provider = input.provider ?? (model as { provider?: string } | undefined)?.provider;
        const modelId = input.model ?? (model as { id?: string } | undefined)?.id;
        if (!provider || !modelId) throw new Error("team member model selection requires a provider and model");
        model = modelRuntime.getModel(provider, modelId);
        if (!model) throw new Error(`team member model not found: ${provider}/${modelId}`);
      }
      if (!model) throw new Error("no active Pi model for team member");
      if (signal.aborted) throw new Error("team member cancelled");
      const customTools = (modelFacingPresetTools() as unknown[]).map((tool) =>
        (createTaskAwareToolRaw as unknown as (tool: unknown, signalProvider: unknown) => unknown)(
          tool,
          (toolCallId: string) => state.runningTasks.get(toolCallId)?.abortController?.signal,
        ),
      );
      const resourceLoader = await createSubagentResourceLoader(cwd);
      const presetPrompt = state.presetSessionRuntime?.modelFacingSystemPrompt.trim();
      const customToolNames = (customTools as { name: string }[]).map((tool: any) => tool.name);
      const parentSessionId = state.session?.sessionId;
      const parentSessionPath = await persistedSessionPath(parentSessionId);
      const { session } = await (createAgentSession as any)({
        cwd,
        agentDir: piHome(),
        model,
        modelRuntime,
        sessionManager: SessionManager.create(cwd, piSessionDir(cwd), {
          ...(parentSessionPath ? { parentSession: parentSessionPath } : {}),
        }),
        tools: customToolNames,
        customTools: customTools as any,
        ...(resourceLoader ? { resourceLoader } : {}),
      });
      const presetToolNames = session.getAllTools().map((tool: any) => tool.name);
      const registeredCustomToolNames = customToolNames.filter((name) => session.getToolDefinition(name) as any !== undefined);
      const presetPromptIncluded = Boolean(presetPrompt && resourceLoader?.getSystemPrompt()?.includes(presetPrompt));
      session.sessionManager.appendCustomEntry("openbuddy/subagent", {
          mode: input.persist ? "continuable" : "one-shot",
          role: input.role,
          ...(input.buddyTaskId ? { buddyTaskId: input.buddyTaskId } : {}),
          ...(input.executionId ? { executionId: input.executionId } : {}),
          ...(input.workflowId ? { workflowId: input.workflowId } : {}),
          ...(input.stepId ? { stepId: input.stepId } : {}),
          ...(state.presetSessionRuntime?.id ? { presetId: state.presetSessionRuntime.id } : {}),
        });
      const childController = new AbortController();
      state.continuableSubagents.set(session.sessionId, {
        id: session.sessionId,
        parentSessionId: parentSessionId ?? "",
        session,
        role: input.role,
        mode: input.persist ? "continuable" : "one-shot",
        startedAt: Date.now(),
        controller: childController,
        unsubscribe: () => undefined,
      });
      const runId = `${state.session?.sessionId ?? "root"}:${input.executionId ?? input.teamId}:${input.memberId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
      const childContext = {
        cwd,
        signal,
        sessionId: session.sessionId,
        transcriptPath: session.sessionManager.getSessionFile(),
      };
      const childPayload = {
        runId,
        id: session.sessionId,
        agentId: session.sessionId,
        sessionId: parentSessionId ?? "",
        agentType: "general-purpose",
        provider: (model as { provider?: string }).provider,
        model: (model as { id?: string }).id,
        api: (model as { api?: string }).api,
        ...(state.presetSessionRuntime?.id ? { presetId: state.presetSessionRuntime.id } : {}),
        modelFacingToolNames: presetToolNames,
        customToolNames,
        registeredCustomToolNames,
        presetPromptIncluded,
        local: true,
        parentSessionId: parentSessionId ?? "",
        teamId: input.teamId,
        memberId: input.memberId,
        role: input.role,
        ...(input.buddyTaskId ? { buddyTaskId: input.buddyTaskId } : {}),
        ...(input.executionId ? { executionId: input.executionId } : {}),
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
        ...(input.stepId ? { stepId: input.stepId } : {}),
      };
      emitPluginEvent("subagent/start", childPayload);
      let startHookContext = "";
      const chunks: string[] = [];
      const unsubscribe = session.subscribe((event: any) => {
        const payload = event as unknown as Record<string, any>;
        if (payload.type === "message_update" && payload.assistantMessageEvent?.type === "text_delta") chunks.push(String(payload.assistantMessageEvent.delta ?? ""));
        const childEvent = { ...payload, sessionId: session.sessionId, parentSessionId: parentSessionId ?? "", teamId: input.teamId, memberId: input.memberId };
        const eventRecord = emitPluginEvent(eventNamespace(payload.type), childEvent);
        const canonicalType = canonicalEventNamespace(payload.type);
        if (canonicalType) emitPluginEvent(canonicalType, childEvent);
        void eventRecord;
      });
      const abort = () => { void session.abort(); };
      const childRecord = state.continuableSubagents.get(session.sessionId);
      if (childRecord) childRecord.unsubscribe = () => unsubscribe();
      signal.addEventListener("abort", abort, { once: true });
      try {
        const startOutcome = await runHookPoint(
          state.hookConfigs,
          "agent/start",
          "general-purpose",
          childPayload,
          childContext,
          emitPluginEvent as unknown as (...args: unknown[]) => unknown,
          state.context?.get("hookShell") as any | undefined,
        );
        if (startOutcome.decision === "deny") throw new Error(startOutcome.reason ?? "subagent start blocked by hook");
        startHookContext = startOutcome.additionalContext.join("\n\n");
        const schemaInstruction = input.schema === undefined
          ? "Return a concise plain-text result."
          : `Return only valid JSON matching this schema; do not wrap it in markdown:\n${JSON.stringify(input.schema)}`;
        const hookInstruction = startHookContext ? `\n\nAdditional instructions from SubagentStart hooks:\n${startHookContext}` : "";
        const childPrompt = `You are the ${input.role} member of team ${input.teamId}. Work independently on this goal. ${schemaInstruction}${hookInstruction}\n\n${input.goal}`;
        emitPluginEvent("session/input", {
          sessionId: session.sessionId,
        parentSessionId: parentSessionId ?? "",
          teamId: input.teamId,
          memberId: input.memberId,
          provider: childPayload.provider,
          model: childPayload.model,
          api: childPayload.api,
          modelFacingToolNames: presetToolNames,
          customToolNames,
          registeredCustomToolNames,
          presetPromptIncluded,
          text: childPrompt,
        });
        await session.prompt(childPrompt);
        const streamedText = chunks.join("").trim();
        const persistedText = assistantMessageText((session as unknown as { state?: { messages?: unknown } }).state?.messages);
        return { text: streamedText || persistedText.trim(), sessionId: session.sessionId };
      } finally {
        const stopReason = signal.aborted ? "cancelled" : "completed";
        const stopPayload = { ...childPayload, stopReason };
        await runHookPoint(
          state.hookConfigs,
          "agent/end",
          "general-purpose",
          stopPayload,
          childContext,
          emitPluginEvent as unknown as (...args: unknown[]) => unknown,
          state.context?.get("hookShell") as any | undefined,
        ).catch((error: unknown) => console.warn("[openbuddy] subagent stop hook failed", error));
        emitPluginEvent("subagent/end", stopPayload);
        signal.removeEventListener("abort", abort);
        unsubscribe();
        if (!input.persist) {
          state.continuableSubagents.delete(session.sessionId);
          session.dispose();
        }
      }
    },
  };
}

export {
  assistantMessageText,
  createTeamRunner,
};
