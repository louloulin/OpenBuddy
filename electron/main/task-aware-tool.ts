import type { ToolDefinition, ToolExecutionMode } from "@earendil-works/pi-coding-agent";

export type TaskSignalLookup = (toolCallId: string) => AbortSignal | undefined;
export type HarnessToolDefinition = ToolDefinition & {
  /** DeepSeek Harness metadata; dynamic classifiers fail closed in Pi. */
  isConcurrencySafe?: (args: unknown) => boolean;
  /** Optional cooperative execution budget from the Harness tool contract. */
  timeoutMs?: number;
};

export type HarnessToolFailureCode =
  | "ABORTED"
  | "ABORTED_BEFORE_DISPATCH"
  | "TOOL_FAILURE"
  | "TOOL_TIMEOUT"
  | "TOOL_MIDDLEWARE_FAILURE"
  | "TOOL_REJECTED"
  | "INVALID_TOOL_OUTPUT";

type PiToolResult = Awaited<ReturnType<ToolDefinition["execute"]>>;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "tool execution failed";
}

function textFromFeedback(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "tool execution blocked by plugin";
  const text = value.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const candidate = part as Record<string, unknown>;
    return typeof candidate.text === "string" ? candidate.text : "";
  }).filter(Boolean).join("\n");
  return text || "tool execution blocked by plugin";
}

export function harnessToolErrorResult(code: HarnessToolFailureCode, message: string): PiToolResult {
  const name = code === "ABORTED" || code === "ABORTED_BEFORE_DISPATCH" ? "AbortError" : "HarnessToolError";
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    details: { name, code, message },
    isError: true,
  } as PiToolResult;
}

export function harnessToolFailureResult(error: unknown, fallbackCode: HarnessToolFailureCode = "TOOL_FAILURE"): PiToolResult {
  return harnessToolErrorResult(fallbackCode, errorMessage(error));
}

export function normalizeHarnessToolResult(value: unknown): PiToolResult {
  if (!value || typeof value !== "object") return harnessToolErrorResult("INVALID_TOOL_OUTPUT", "tool returned an invalid result");
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.content) || candidate.content.some((part) => !part || typeof part !== "object" || typeof (part as Record<string, unknown>).type !== "string")) {
    return harnessToolErrorResult("INVALID_TOOL_OUTPUT", "tool returned an invalid content result");
  }
  if (candidate.isError !== undefined && typeof candidate.isError !== "boolean") {
    return harnessToolErrorResult("INVALID_TOOL_OUTPUT", "tool returned an invalid isError flag");
  }
  return value as PiToolResult;
}

export function normalizeHarnessPostResult(value: unknown, prior?: unknown): PiToolResult {
  if (value === undefined) return normalizeHarnessToolResult(prior);
  if (value && typeof value === "object" && (value as Record<string, unknown>).kind === "block") {
    const decision = value as Record<string, unknown>;
    return harnessToolErrorResult("TOOL_REJECTED", textFromFeedback(decision.feedback ?? decision.message));
  }
  if (value && typeof value === "object" && (value as Record<string, unknown>).kind === "accept") {
    const decision = value as Record<string, unknown>;
    const accepted = normalizeHarnessToolResult(prior);
    if (Array.isArray(decision.content)) return { ...accepted, content: decision.content } as PiToolResult;
    return accepted;
  }
  return normalizeHarnessToolResult(value);
}

function validateTimeout(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) return undefined;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Harness tool timeoutMs must be a positive finite number");
  }
  return timeoutMs;
}

/**
 * Map Harness's fail-closed tool scheduling contract onto Pi's native batch
 * scheduler. Pi exposes a static per-definition mode, so a dynamic Harness
 * classifier cannot be evaluated against call arguments at batch selection
 * time; such tools remain sequential unless they explicitly opt into Pi's
 * parallel mode.
 */
export function toolExecutionMode(tool: HarnessToolDefinition): ToolExecutionMode {
  return tool.executionMode === "parallel" ? "parallel" : "sequential";
}

export function createTaskAwareTool(tool: HarnessToolDefinition, lookup: TaskSignalLookup): ToolDefinition {
  const timeoutMs = validateTimeout(tool.timeoutMs);
  return {
    ...tool,
    executionMode: toolExecutionMode(tool),
    async execute(toolCallId, params, signal, onUpdate, context) {
      const taskSignal = lookup(toolCallId);
      const sources = [taskSignal, signal].filter((candidate): candidate is AbortSignal => Boolean(candidate));
      if (sources.some((candidate) => candidate.aborted)) {
        return harnessToolErrorResult("ABORTED_BEFORE_DISPATCH", "tool call aborted before dispatch");
      }
      const needsController = sources.length > 0 || timeoutMs !== undefined;
      const controller = needsController ? new AbortController() : undefined;
      const executionSignal = controller?.signal ?? signal;
      let timedOut = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const abort = (source: AbortSignal) => {
        if (!controller || controller.signal.aborted) return;
        controller.abort(source.reason);
      };
      const abortListeners = sources.map((source) => {
        const listener = () => abort(source);
        source.addEventListener("abort", listener, { once: true });
        return { source, listener };
      });
      if (controller && timeoutMs !== undefined) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          controller.abort(new Error(`tool timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      try {
        const result = normalizeHarnessToolResult(await tool.execute(toolCallId, params, executionSignal, onUpdate, context));
        if (timedOut) return harnessToolErrorResult("TOOL_TIMEOUT", `tool timed out after ${timeoutMs}ms`);
        if (executionSignal?.aborted) return harnessToolErrorResult("ABORTED", "tool call aborted");
        return result;
      } catch (error) {
        if (timedOut) return harnessToolErrorResult("TOOL_TIMEOUT", `tool timed out after ${timeoutMs}ms`);
        if (executionSignal?.aborted) return harnessToolErrorResult("ABORTED", "tool call aborted");
        return harnessToolFailureResult(error);
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        for (const { source, listener } of abortListeners) source.removeEventListener("abort", listener);
      }
    },
  };
}
