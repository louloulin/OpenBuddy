import { readFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  decodeHookOutput,
  matchesHookMatcher,
  mergeHookOutputs,
  parseHookConfig,
  type HookConfig,
  type HookDiagnostic,
  type HookDialect,
  type HookMatcherGroup,
  type HookPoint,
  type HookOutput,
} from "@openbuddy/plugin-host";

export interface HookRuntimeConfig {
  packageName: string;
  packageRoot: string;
  dialect: HookDialect;
  configPath?: string;
  defaultTimeoutMs: number;
  stderrSummaryMaxChars: number;
  model?: string;
  config: HookConfig;
  diagnostics: HookDiagnostic[];
}

export interface HookRuntimeEvent {
  type: string;
  payload: unknown;
}

export type HookRuntimeEmitter = (type: string, payload: unknown) => void;

export interface HookShellRunRequest {
  command: string;
  stdin: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface HookShellRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface HookShellRunner {
  run(request: HookShellRunRequest): Promise<HookShellRunResult>;
}

export interface HookRuntimeOptions {
	confirm?: (title: string, message: string, request?: HookPermissionRequest) => Promise<HookPermissionDecision | boolean>;
	shellRunner?: HookShellRunner;
	resolveShellRunner?: () => HookShellRunner | undefined;
}

export type HookPermissionDecision = "allow" | "deny" | "allow_always";

export interface HookPermissionRequest {
	toolName: string;
	pattern?: string;
}

interface HookExecutionContext {
  cwd: string;
  signal: AbortSignal | undefined;
  sessionId?: string;
  transcriptPath?: string;
}

export interface HookInvocationContext {
  cwd: string;
  signal?: AbortSignal;
  sessionId?: string;
  transcriptPath?: string;
}

export interface HookRuntimeRegistration {
  packageName: string;
  packageRoot: string;
  dialect: HookDialect;
  configPath?: string;
  config?: unknown;
  defaultTimeoutMs?: number;
  stderrSummaryMaxChars?: number;
  model?: string;
}

const registeredHookConfigs = new Map<symbol, HookRuntimeRegistration>();
const activeHookProcesses = new Set<ChildProcess>();
const activeHookRuns = new Set<Promise<void>>();

export function registerHookConfig(registration: HookRuntimeRegistration): () => void {
  const token = Symbol(registration.packageName);
  registeredHookConfigs.set(token, { ...registration, packageRoot: resolve(registration.packageRoot) });
  return () => { registeredHookConfigs.delete(token); };
}

export function listRegisteredHookConfigs(): HookRuntimeRegistration[] {
  return [...registeredHookConfigs.values()].map((registration) => ({ ...registration }));
}

function terminateHookProcess(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (child.killed) return;
  if (process.platform !== "win32" && child.pid) {
    try { process.kill(-child.pid, signal); return; } catch {}
  }
  child.kill(signal);
}

export function disposeActiveHookProcesses(): void {
  for (const child of [...activeHookProcesses]) terminateHookProcess(child);
}

export async function drainActiveHookProcesses(timeoutMs = 2_000): Promise<void> {
  disposeActiveHookProcesses();
  const pending = [...activeHookRuns];
  if (pending.length === 0) return;
  await Promise.race([
    Promise.allSettled(pending).then(() => undefined),
    new Promise<void>((resolvePromise) => {
      const timer = setTimeout(resolvePromise, timeoutMs);
      timer.unref?.();
    }),
  ]);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 10 * 60 * 1000) : fallback;
}

function resolveConfigPath(root: string, value: string): string {
  const resolvedRoot = resolve(root);
  const candidate = isAbsolute(value) ? resolve(value) : resolve(resolvedRoot, value);
  const pathRelative = relative(resolvedRoot, candidate);
  if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) throw new Error(`hook config path escapes package root: ${value}`);
  return candidate;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function declarations(manifest: Record<string, unknown>): Array<{ dialect: HookDialect; value: unknown }> {
  const result: Array<{ dialect: HookDialect; value: unknown }> = [];
  for (const [key, dialect] of [["openbuddy", "openbuddy"] as const, ["dsh", "openbuddy"] as const]) {
    const namespace = record(manifest[key]);
    if (namespace?.hooks !== undefined) result.push({ dialect, value: namespace.hooks });
  }
  return result;
}

async function materializeHookConfig(declaration: HookRuntimeRegistration): Promise<HookRuntimeConfig> {
  const value = record(declaration.config);
  const configPathValue = declaration.configPath ?? (typeof declaration.config === "string" ? declaration.config : typeof value?.configPath === "string" ? value.configPath : undefined);
  const defaultTimeoutMs = asPositiveInteger(value?.defaultTimeoutMs ?? declaration.defaultTimeoutMs, 600_000);
  const stderrSummaryMaxChars = asPositiveInteger(value?.stderrSummaryMaxChars ?? declaration.stderrSummaryMaxChars, 500);
  const model = typeof value?.model === "string" ? value.model : declaration.model;
  let raw: unknown = declaration.config;
  let configPath: string | undefined;
  const diagnostics: HookDiagnostic[] = [];
  try {
    if (configPathValue !== undefined) {
      configPath = resolveConfigPath(declaration.packageRoot, configPathValue);
      raw = await readJson(configPath);
    }
    const parsed = parseHookConfig(raw, declaration.dialect);
    diagnostics.push(...parsed.diagnostics);
    return { packageName: declaration.packageName, packageRoot: declaration.packageRoot, dialect: declaration.dialect, ...(configPath ? { configPath } : {}), defaultTimeoutMs, stderrSummaryMaxChars, ...(model ? { model } : {}), config: parsed.config, diagnostics };
  } catch (error) {
    return { packageName: declaration.packageName, packageRoot: declaration.packageRoot, dialect: declaration.dialect, ...(configPath ? { configPath } : {}), defaultTimeoutMs, stderrSummaryMaxChars, ...(model ? { model } : {}), config: { dialect: declaration.dialect, events: {} }, diagnostics: [{ level: "error", message: String(error) }] };
  }
}

export async function discoverHookConfigs(packageRoots: readonly string[]): Promise<HookRuntimeConfig[]> {
  const result: HookRuntimeConfig[] = [];
  for (const packageRoot of [...new Set(packageRoots.map((path) => resolve(path)))]) {
    let manifest: Record<string, unknown>;
    try { manifest = await readJson(join(packageRoot, "package.json")) as Record<string, unknown>; } catch { continue; }
    const packageName = typeof manifest.name === "string" ? manifest.name : packageRoot;
    for (const declaration of declarations(manifest)) {
      const value = record(declaration.value);
      const dialect = value?.dialect === "claude-code" || value?.dialect === "codex" ? value.dialect : declaration.dialect;
      result.push(await materializeHookConfig({ packageName, packageRoot, dialect, config: declaration.value, ...(value?.configPath ? { configPath: value.configPath as string } : {}) }));
    }
  }
  for (const registration of listRegisteredHookConfigs()) result.push(await materializeHookConfig(registration));
  return result;
}

function shellCommand(command: string): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", command] };
  return { file: process.env.SHELL ?? "/bin/sh", args: ["-lc", command] };
}

export class DefaultHookShellRunner implements HookShellRunner {
  run(request: HookShellRunRequest): Promise<HookShellRunResult> {
    let resolveDrain: (() => void) | undefined;
    const drain = new Promise<void>((resolvePromise) => { resolveDrain = resolvePromise; });
    activeHookRuns.add(drain);
    return new Promise<HookShellRunResult>((resolvePromise) => {
      const shell = shellCommand(request.command);
      const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL)/iu.test(key))) as Record<string, string>;
      let child: ChildProcess;
      try {
        child = spawn(shell.file, shell.args, { cwd: request.cwd, env: { ...env, ...request.env }, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
      } catch (error) {
        activeHookRuns.delete(drain);
        resolveDrain?.();
        resolvePromise({ exitCode: null, stdout: "", stderr: String(error) });
        return;
      }
      activeHookProcesses.add(child);
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        activeHookProcesses.delete(child);
        activeHookRuns.delete(drain);
        resolveDrain?.();
        resolvePromise({ exitCode, stdout, stderr });
      };
      const timer = setTimeout(() => terminateHookProcess(child), request.timeoutMs);
      timer.unref?.();
      const abort = () => terminateHookProcess(child);
      request.signal?.addEventListener("abort", abort, { once: true });
      child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (error) => { stderr += String(error); finish(null); });
      child.on("close", (code) => {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        finish(code);
      });
      child.stdin?.end(request.stdin);
    });
  }
}

const defaultHookShellRunner = new DefaultHookShellRunner();

async function runHookCommand(runner: HookShellRunner, command: string, input: unknown, options: { cwd: string; env: Record<string, string>; timeoutMs: number; signal?: AbortSignal; trailingNewline: boolean }): Promise<{ exitCode?: number; stdout: string; stderr: string }> {
  try {
    const result = await runner.run({ command, cwd: options.cwd, env: options.env, timeoutMs: options.timeoutMs, signal: options.signal, stdin: `${JSON.stringify(input)}${options.trailingNewline ? "\n" : ""}` });
    return { exitCode: result.exitCode ?? undefined, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { stdout: "", stderr: String(error) };
  }
}

function hookEventName(point: HookPoint): string {
  switch (point) {
    case "prompt/submit": return "UserPromptSubmit";
    case "tool/start": return "PreToolUse";
    case "tool/end": return "PostToolUse";
    case "session/start": return "SessionStart";
    case "session/end": return "SessionEnd";
    case "agent/start": return "SubagentStart";
    case "agent/end": return "SubagentStop";
    case "turn/end": return "Stop";
    default: return point;
  }
}

function hookPayload(config: HookRuntimeConfig, point: HookPoint, query: string, payload: unknown, context: HookExecutionContext): unknown {
  if (config.dialect === "openbuddy") return payload;
  const source: Record<string, unknown> = { ...(record(payload) ?? {}), ...(context.sessionId ? { sessionId: context.sessionId } : {}) };
  const eventName = hookEventName(point);
  const sessionId = typeof source.sessionId === "string" ? source.sessionId : "";
  const base = {
    session_id: sessionId,
    transcript_path: context.transcriptPath ?? "",
    cwd: context.cwd,
    hook_event_name: eventName,
    ...(config.dialect === "codex" ? { model: config.model ?? "", permission_mode: "default" } : {}),
  };
  if (point === "prompt/submit") return { ...base, prompt: typeof source.prompt === "string" ? source.prompt : "" };
  if (point === "tool/start" || point === "tool/end") {
    const input = record(source.input) ?? {};
    const result = point === "tool/end" ? { tool_response: typeof source.content === "string" ? source.content : JSON.stringify(source.content ?? "") } : {};
    return { ...base, ...(config.dialect === "codex" ? { turn_id: String(source.turnIndex ?? 0), tool_input: { command: typeof input.command === "string" ? input.command : "" } } : { tool_input: input }), tool_name: query, tool_use_id: typeof source.toolCallId === "string" ? source.toolCallId : "", ...result };
  }
  if (point === "agent/start" || point === "agent/end") {
    const agentId = typeof source.agentId === "string" ? source.agentId : typeof source.agent_id === "string" ? source.agent_id : "";
    const agentType = typeof source.agentType === "string" ? source.agentType : typeof source.agent_type === "string" ? source.agent_type : "general-purpose";
    return {
      ...base,
      agent_id: agentId,
      agent_type: agentType,
      ...(point === "agent/end" ? { stop_hook_active: false, ...(typeof source.stopReason === "string" ? { stop_reason: source.stopReason } : {}) } : {}),
    };
  }
  return { ...base, ...(config.dialect === "codex" ? { turn_id: String(source.turnIndex ?? 0) } : {}) };
}

function summarizeStderr(stderr: string, maxChars: number): string | undefined {
  const value = stderr.trim();
  if (!value) return undefined;
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function hasMatchingDialect(configs: readonly HookRuntimeConfig[], point: HookPoint, query: string, dialect: HookDialect): boolean {
  return configs.some((config) => config.dialect === dialect && (config.config.events[point] ?? []).some((group) => matchesHookMatcher(group, query, dialect)));
}

async function runPoint(configs: readonly HookRuntimeConfig[], point: HookPoint, query: string, payload: unknown, context: HookExecutionContext, emit: HookRuntimeEmitter, shellRunner: HookShellRunner): Promise<ReturnType<typeof mergeHookOutputs>> {
  const outputs: HookOutput[] = [];
  for (const config of configs) {
    for (const group of config.config.events[point] ?? []) {
      if (!matchesHookMatcher(group, query, config.dialect)) continue;
      for (const hook of group.hooks) {
        const handlerId = `openbuddy:${config.packageName}:${point}:${Date.now().toString(36)}:${outputs.length}`;
        emit("hook/invoked", { handlerId, point, dialect: config.dialect, packageName: config.packageName, ...(group.matcher ? { matcher: group.matcher } : {}) });
        const startedAt = Date.now();
        const dialectPayload = hookPayload(config, point, query, payload, context);
        const result = await runHookCommand(shellRunner, hook.command, dialectPayload, {
          cwd: context.cwd,
          signal: context.signal,
          timeoutMs: hook.timeoutSec ? hook.timeoutSec * 1000 : config.defaultTimeoutMs,
          trailingNewline: config.dialect !== "codex",
          env: {
            OPENBUDDY_PLUGIN_ROOT: config.packageRoot,
            OPENBUDDY_PROJECT_DIR: context.cwd,
            CLAUDE_PLUGIN_ROOT: config.packageRoot,
            CLAUDE_PROJECT_DIR: context.cwd,
          },
        });
        const output = decodeHookOutput(result.exitCode, result.stdout, result.stderr, config.dialect === "openbuddy" ? undefined : hookEventName(point), { strictDialect: config.dialect !== "openbuddy" });
        if (config.dialect !== "openbuddy") {
          delete output.updatedInput;
          delete output.systemMessage;
        }
        if (config.dialect === "codex" && output.exitCode === 0 && output.additionalContext === undefined && output.stdout.length > 0 && !output.stdout.startsWith("{")) {
          output.additionalContext = output.stdout;
        }
        outputs.push(output);
        emit("hook/result", {
          handlerId,
          point,
          dialect: config.dialect,
          packageName: config.packageName,
          decision: output.decision ?? (output.exitCode === 2 ? "deny" : "pass"),
          durationMs: Date.now() - startedAt,
          ...(output.exitCode === undefined ? {} : { exitCode: output.exitCode }),
          ...(summarizeStderr(output.stderr, config.stderrSummaryMaxChars) ? { stderrSummary: summarizeStderr(output.stderr, config.stderrSummaryMaxChars) } : {}),
          stdout: output.stdout,
          ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        });
      }
    }
  }
  return mergeHookOutputs(outputs);
}

export function runHookPoint(
  configs: readonly HookRuntimeConfig[],
  point: HookPoint,
  query: string,
  payload: unknown,
  context: HookInvocationContext,
  emit: HookRuntimeEmitter,
  shellRunner: HookShellRunner = defaultHookShellRunner,
): Promise<ReturnType<typeof mergeHookOutputs>> {
  const executionContext: HookExecutionContext = {
    cwd: context.cwd,
    signal: context.signal,
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.transcriptPath ? { transcriptPath: context.transcriptPath } : {}),
  };
  return runPoint(configs, point, query, payload, executionContext, emit, shellRunner);
}

export function createPiHooksExtension(getConfigs: () => readonly HookRuntimeConfig[], emit: HookRuntimeEmitter, options: HookRuntimeOptions = {}): ExtensionFactory {
  return (pi) => {
    const shellRunner = () => options.resolveShellRunner?.() ?? options.shellRunner ?? defaultHookShellRunner;
    const pendingSessionContext = new Map<string, string>();
    const steeredStopSessions = new Set<string>();
    const executionContext = (context: { cwd: string; signal: AbortSignal | undefined; sessionManager?: { getSessionId?: () => string; getSessionFile?: () => string | undefined } }): HookExecutionContext => ({ cwd: context.cwd, signal: context.signal, sessionId: context.sessionManager?.getSessionId?.(), transcriptPath: context.sessionManager?.getSessionFile?.() });
    const reportOutcome = (point: HookPoint, outcome: Awaited<ReturnType<typeof runPoint>>, sessionId?: string): void => {
      for (const systemMessage of outcome.systemMessages) emit("hook/system-message", { point, systemMessage, ...(sessionId ? { sessionId } : {}) });
      if (outcome.stop || outcome.stopReason) emit("hook/stop", { point, stop: outcome.stop, ...(outcome.stopReason ? { stopReason: outcome.stopReason } : {}), ...(sessionId ? { sessionId } : {}) });
    };
    const run = async (point: HookPoint, query: string, payload: unknown, context: { cwd: string; signal: AbortSignal | undefined; sessionManager?: { getSessionId?: () => string; getSessionFile?: () => string | undefined } }) => {
      const outcome = await runPoint(getConfigs(), point, query, payload, executionContext(context), emit, shellRunner());
      reportOutcome(point, outcome, executionContext(context).sessionId);
      return outcome;
    };
    const sessionContextKey = (context: { cwd: string; sessionManager?: { getSessionId?: () => string } }): string => context.sessionManager?.getSessionId?.() ?? context.cwd;
    const steerStop = (outcome: Awaited<ReturnType<typeof runPoint>>, context: { cwd: string; sessionManager?: { getSessionId?: () => string } }): void => {
      const key = sessionContextKey(context);
      if (outcome.decision !== "deny") {
        steeredStopSessions.delete(key);
        return;
      }
      if (!hasMatchingDialect(getConfigs(), "turn/end", "", "claude-code") && !hasMatchingDialect(getConfigs(), "turn/end", "", "codex")) return;
      if (steeredStopSessions.has(key)) {
        emit("hook/stop-steer-skipped", { point: "turn/end", reason: "stop hook already steered this session", ...(context.sessionManager?.getSessionId?.() ? { sessionId: context.sessionManager.getSessionId() } : {}) });
        return;
      }
      const text = outcome.reason ?? "continue: blocked by Stop hook";
      steeredStopSessions.add(key);
      pi.sendUserMessage(text, { deliverAs: "steer" });
      emit("hook/stop-steered", { point: "turn/end", reason: text, ...(context.sessionManager?.getSessionId?.() ? { sessionId: context.sessionManager.getSessionId() } : {}) });
    };
    pi.on("before_agent_start", async (event, context) => {
      const outcome = await runPoint(getConfigs(), "prompt/submit", event.prompt, event, executionContext(context), emit, shellRunner());
      reportOutcome("prompt/submit", outcome, executionContext(context).sessionId);
      const key = sessionContextKey(context);
      const startupContext = pendingSessionContext.get(key);
      pendingSessionContext.delete(key);
      if (outcome.additionalContext.length === 0 && !startupContext) return undefined;
      const contextText = [startupContext, ...outcome.additionalContext].filter((value): value is string => Boolean(value)).join("\n\n");
      emit("hook/context", { point: "prompt/submit", context: contextText, source: "additionalContext" });
      return { systemPrompt: `${event.systemPrompt}\n\n<openbuddy-hook-context>\n${contextText}\n</openbuddy-hook-context>` };
    });
    pi.on("session_start", async (event, context) => {
      const outcome = await run("session/start", "", event, context);
      if (outcome.additionalContext.length) pendingSessionContext.set(sessionContextKey(context), outcome.additionalContext.join("\n\n"));
    });
    pi.on("session_shutdown", async (event, context) => {
      const key = sessionContextKey(context);
      pendingSessionContext.delete(key);
      steeredStopSessions.delete(key);
      await run("session/end", "", event, context);
    });
    pi.on("agent_start", async (event, context) => { await run("agent/start", "", event, context); });
    pi.on("agent_end", async (event, context) => { await run("agent/end", "", event, context); });
    pi.on("turn_start", async (event, context) => { await run("turn/start", String(event.turnIndex), event, context); });
    pi.on("turn_end", async (event, context) => {
      const outcome = await run("turn/end", String(event.turnIndex), event, context);
      steerStop(outcome, context);
    });
    pi.on("tool_result", async (event, context) => {
      const outcome = await run("tool/end", event.toolName, event, context);
      const configs = getConfigs();
      const hookBlocked = outcome.decision === "deny" && hasMatchingDialect(configs, "tool/end", event.toolName, "openbuddy")
        || outcome.decision === "deny" && (hasMatchingDialect(configs, "tool/end", event.toolName, "claude-code") || hasMatchingDialect(configs, "tool/end", event.toolName, "codex"));
      if (outcome.additionalContext.length === 0 && outcome.systemMessages.length === 0 && !hookBlocked) return undefined;
      const additions = [
        ...outcome.additionalContext,
        ...outcome.systemMessages.map((message) => `<openbuddy-hook-system-message>\n${message}\n</openbuddy-hook-system-message>`),
        ...(hookBlocked && outcome.reason ? [`<openbuddy-hook-block>\n${outcome.reason}\n</openbuddy-hook-block>`] : []),
      ].map((text) => ({ type: "text" as const, text: `<openbuddy-hook-context>\n${text}\n</openbuddy-hook-context>` }));
      return { content: [...event.content, ...additions], ...(hookBlocked ? { isError: true } : {}) };
    });
    pi.on("tool_call", async (event, context) => {
      const outcome = await runPoint(getConfigs(), "tool/start", event.toolName, event, executionContext(context), emit, shellRunner());
      reportOutcome("tool/start", outcome, executionContext(context).sessionId);
      const configs = getConfigs();
      const openBuddyMatch = hasMatchingDialect(configs, "tool/start", event.toolName, "openbuddy");
      const claudeMatch = hasMatchingDialect(configs, "tool/start", event.toolName, "claude-code");
      if (outcome.updatedInput && openBuddyMatch) Object.assign(event.input, outcome.updatedInput);
      if (outcome.decision === "deny" || (outcome.stop && openBuddyMatch)) return { block: true, terminate: outcome.stop && openBuddyMatch, reason: outcome.reason ?? outcome.stopReason ?? `blocked by hook for ${event.toolName}` };
      if (outcome.decision === "ask" && (openBuddyMatch || claudeMatch)) {
        const message = outcome.reason ?? `A hook requests permission to run ${event.toolName}`;
        emit("hook/permission-request", { point: "tool/start", toolName: event.toolName, message });
		const command = event.input && typeof event.input === "object" && "command" in event.input && typeof event.input.command === "string" ? event.input.command : undefined;
		const decision = options.confirm && context.hasUI
			? await options.confirm("Hook permission", message, { toolName: event.toolName, ...(command ? { pattern: command } : {}) })
			: "deny";
		const normalizedDecision: HookPermissionDecision = decision === true ? "allow" : decision === false || decision === undefined ? "deny" : decision;
		emit("hook/permission-resolved", { point: "tool/start", toolName: event.toolName, decision: normalizedDecision, approved: normalizedDecision !== "deny" });
		if (normalizedDecision === "deny") return { block: true, reason: message };
      }
      return undefined;
    });
  };
}

export function hookConfigDiagnostics(configs: readonly HookRuntimeConfig[]): HookDiagnostic[] {
  return configs.flatMap((config) => config.diagnostics.map((diagnostic) => ({ ...diagnostic, message: `${config.packageName}: ${diagnostic.message}` })));
}

export function hookConfigSummary(configs: readonly HookRuntimeConfig[]): Array<{ packageName: string; packageRoot: string; dialect: HookDialect; points: string[]; diagnostics: HookDiagnostic[] }> {
  return configs.map((config) => ({ packageName: config.packageName, packageRoot: config.packageRoot, dialect: config.dialect, points: Object.keys(config.config.events), diagnostics: config.diagnostics }));
}
