export type HookDialect = "claude-code" | "codex" | "openbuddy";

export type HookPoint =
  | "session/start"
  | "session/end"
  | "agent/start"
  | "agent/end"
  | "turn/start"
  | "turn/end"
  | "prompt/submit"
  | "tool/start"
  | "tool/end"
  | "plugin/loaded"
  | "plugin/failed"
  | "plugin/unloaded";

export type HookDecision = "approve" | "allow" | "block" | "deny" | "ask";

export interface CommandHook {
  command: string;
  timeoutSec?: number;
}

export interface HookMatcherGroup {
  matcher?: string;
  hooks: CommandHook[];
}

export interface HookOutput {
  exitCode?: number;
  stderr: string;
  stdout: string;
  hookEventName?: string;
  decision?: HookDecision;
  reason?: string;
  continue?: boolean;
  stopReason?: string;
  additionalContext?: string;
  systemMessage?: string;
  updatedInput?: Record<string, unknown>;
}

export interface MergedHookOutcome {
  decision: "allow" | "ask" | "deny" | "none";
  reason?: string;
  stop: boolean;
  stopReason?: string;
  additionalContext: string[];
  systemMessages: string[];
  updatedInput?: Record<string, unknown>;
}

export interface HookConfig {
  dialect?: HookDialect;
  events: Partial<Record<HookPoint, HookMatcherGroup[]>>;
}

export interface HookDiagnostic {
  level: "warning" | "error";
  message: string;
  event?: string;
  matcher?: string;
}

export interface ParsedHookConfig {
  config: HookConfig;
  diagnostics: HookDiagnostic[];
}

const POINT_ALIASES: Record<string, HookPoint> = {
  "session/start": "session/start",
  SessionStart: "session/start",
  "session/end": "session/end",
  SessionEnd: "session/end",
  "agent/start": "agent/start",
  AgentStart: "agent/start",
  SubagentStart: "agent/start",
  "agent/end": "agent/end",
  AgentStop: "agent/end",
  SubagentStop: "agent/end",
  "turn/start": "turn/start",
  TurnStart: "turn/start",
  "prompt/submit": "prompt/submit",
  UserPromptSubmit: "prompt/submit",
  "turn/end": "turn/end",
  Stop: "turn/end",
  "tool/start": "tool/start",
  PreToolUse: "tool/start",
  "tool/end": "tool/end",
  PostToolUse: "tool/end",
  "plugin/loaded": "plugin/loaded",
  "plugin/failed": "plugin/failed",
  "plugin/unloaded": "plugin/unloaded",
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function positiveTimeout(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.floor(value), 60 * 60);
}

function normalizeCommand(value: unknown): CommandHook | undefined {
  if (typeof value === "string" && value.trim()) return { command: value.trim() };
  const item = record(value);
  if (!item || item.type !== undefined && item.type !== "command" || typeof item.command !== "string" || !item.command.trim()) return undefined;
  const timeoutSec = positiveTimeout(item.timeoutSec ?? item.timeout);
  return { command: item.command.trim(), ...(timeoutSec === undefined ? {} : { timeoutSec }) };
}

function matcherMatches(group: HookMatcherGroup, query: string, dialect: HookDialect): boolean {
  const matcher = group.matcher?.trim();
  if (!matcher || matcher === "*") return true;
  if (dialect === "claude-code" && /^[A-Za-z0-9_|]+$/u.test(matcher)) {
    return matcher.split("|").some((item) => item === query);
  }
  try {
    return new RegExp(matcher).test(query);
  } catch {
    return false;
  }
}

export function matchesHookMatcher(group: HookMatcherGroup, query = "", dialect: HookDialect = "openbuddy"): boolean {
  return matcherMatches(group, query, dialect);
}

export function parseHookConfig(raw: unknown, dialect: HookDialect = "openbuddy"): ParsedHookConfig {
  const root = record(raw);
  const source = record(root?.hooks) ?? root;
  const events: Partial<Record<HookPoint, HookMatcherGroup[]>> = {};
  const diagnostics: HookDiagnostic[] = [];
  if (!source) return { config: { dialect, events }, diagnostics: [{ level: "error", message: "hook config must be an object" }] };

  for (const [eventName, eventValue] of Object.entries(source)) {
    const point = POINT_ALIASES[eventName];
    if (!point) {
      diagnostics.push({ level: "warning", message: `unsupported hook event '${eventName}'`, event: eventName });
      continue;
    }
    const groups = Array.isArray(eventValue) ? eventValue : [];
    const normalized: HookMatcherGroup[] = [];
    for (const groupValue of groups) {
      const group = record(groupValue);
      if (!group) {
        diagnostics.push({ level: "warning", message: "hook matcher group must be an object", event: eventName });
        continue;
      }
      const matcher = typeof group.matcher === "string" ? group.matcher : undefined;
      if (matcher && dialect !== "openbuddy") {
        try { new RegExp(matcher); } catch {
          if (!(dialect === "claude-code" && /^[A-Za-z0-9_|]+$/u.test(matcher))) {
            diagnostics.push({ level: "warning", message: `invalid hook matcher '${matcher}'`, event: eventName, matcher });
            continue;
          }
        }
      }
      const hooks = Array.isArray(group.hooks) ? group.hooks.flatMap((item) => {
        const command = normalizeCommand(item);
        if (command) return [command];
        const itemRecord = record(item);
        diagnostics.push({ level: "warning", message: itemRecord?.type ? `unsupported hook type '${String(itemRecord.type)}'` : "hook must declare a command", event: eventName, ...(matcher ? { matcher } : {}) });
        return [];
      }) : [];
      if (hooks.length) normalized.push({ ...(matcher ? { matcher } : {}), hooks });
    }
    if (normalized.length) events[point] = [...(events[point] ?? []), ...normalized];
  }
  return { config: { dialect, events }, diagnostics };
}

function decisionRank(decision: HookDecision | undefined): number {
  switch (decision) {
    case "deny": case "block": return 3;
    case "ask": return 2;
    case "allow": case "approve": return 1;
    default: return 0;
  }
}

export function mergeHookOutputs(outputs: readonly HookOutput[]): MergedHookOutcome {
  let maxRank = 0;
  const reasons = new Map<number, string[]>();
  let stop = false;
  let stopReason: string | undefined;
  const additionalContext: string[] = [];
  const systemMessages: string[] = [];
  const updatedInput: Record<string, unknown> = {};
  let hasUpdatedInput = false;
  for (const output of outputs) {
    const rank = decisionRank(output.decision);
    maxRank = Math.max(maxRank, rank);
    if (rank >= 2 && output.reason?.trim()) reasons.set(rank, [...(reasons.get(rank) ?? []), output.reason.trim()]);
    if (output.continue === false) {
      stop = true;
      stopReason ??= output.stopReason;
    }
    if (output.additionalContext?.trim()) additionalContext.push(output.additionalContext.trim());
    if (output.systemMessage?.trim()) systemMessages.push(output.systemMessage.trim());
    if (output.updatedInput) {
      Object.assign(updatedInput, output.updatedInput);
      hasUpdatedInput = true;
    }
  }
  return {
    decision: maxRank === 3 ? "deny" : maxRank === 2 ? "ask" : maxRank === 1 ? "allow" : "none",
    ...(reasons.get(maxRank)?.length ? { reason: reasons.get(maxRank)!.join("\n\n") } : {}),
    stop,
    ...(stopReason ? { stopReason } : {}),
    additionalContext,
    systemMessages,
    ...(hasUpdatedInput ? { updatedInput } : {}),
  };
}

export interface HookDecodeOptions {
  strictDialect?: boolean;
}

export function decodeHookOutput(exitCode: number | undefined, stdout: string, stderr: string, expectedEventName?: string, options: HookDecodeOptions = {}): HookOutput {
  const output: HookOutput = { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
  if (exitCode === 2) {
    output.decision = options.strictDialect ? "block" : "deny";
    if (output.stderr) output.reason = output.stderr;
  }
  if (exitCode !== 0) return output;
  const text = stdout.trim();
  if (!text || !text.startsWith("{")) return output;
  try {
    const root = record(JSON.parse(text));
    if (!root) return output;
    if (typeof root.continue === "boolean") output.continue = root.continue;
    if (typeof root.stopReason === "string") output.stopReason = root.stopReason;
    if (typeof root.reason === "string") output.reason = root.reason;
    if (typeof root.systemMessage === "string") output.systemMessage = root.systemMessage;
    if (!options.strictDialect && typeof root.additionalContext === "string") output.additionalContext = root.additionalContext;
    if (typeof root.decision === "string" && (options.strictDialect ? ["approve", "block"] : ["approve", "allow", "block", "deny", "ask"]).includes(root.decision)) output.decision = root.decision as HookDecision;
    const specific = record(root.hookSpecificOutput);
    if (specific) {
      const specificEventName = typeof specific.hookEventName === "string" ? specific.hookEventName : undefined;
      if (specificEventName) output.hookEventName = specificEventName;
      if (expectedEventName === undefined || specificEventName === expectedEventName) {
        if (typeof specific.permissionDecision === "string" && ["allow", "deny", "ask"].includes(specific.permissionDecision)) output.decision = specific.permissionDecision as HookDecision;
        if (typeof specific.permissionDecisionReason === "string") output.reason = specific.permissionDecisionReason;
        if (typeof specific.additionalContext === "string") output.additionalContext = specific.additionalContext;
        const updated = record(specific.updatedInput);
        if (updated) output.updatedInput = updated;
      }
    }
  } catch {
    // Preserve raw stdout as a diagnostic; malformed JSON must not crash the agent.
  }
  return output;
}
