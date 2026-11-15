import type { ExtensionContext, ExtensionFactory, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";

/**
 * 记忆 built-in (20261116-pii W5.2–W5.3).
 *
 * - `before_agent_start` appends the enabled memory notes to the system prompt, always appending
 *   (never replacing what Pi, the project context or the expert persona wrote), within a budget.
 * - `ob_remember` lets the model save a durable preference the user will want next time. It is a
 *   write to disk, so the permission gate classifies it like any other write (default: ask); the
 *   tool itself only validates and calls the service.
 *
 * Memory lives outside the session (files), so it is shared by every task of the user and survives
 * forks, branch switches and regenerations — unlike per-session state (session-state.ts).
 */
export const MEMORY_TOOL = "ob_remember";

const PARAMETERS = {
  type: "object",
  properties: {
    content: { type: "string", description: "The durable fact or preference to remember, as one short sentence in the user's language." },
    title: { type: "string", description: "Optional short heading, e.g. 周报格式偏好. Keep it stable so related notes group together." },
  },
  required: ["content"],
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

interface MemoryToolDetails {
  path?: string;
  scope?: string;
}

interface MemoryToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: MemoryToolDetails;
  isError?: boolean;
}

const DESCRIPTION = [
  "Save a durable preference or fact about the user that should shape future tasks (report format, tone, recurring tools, workspace conventions).",
  "Use it only when the user states a lasting preference or explicitly asks you to remember something; do not record temporary task details, secrets, API keys or personal data the user did not ask to keep.",
  "The note is stored in the user's memory library, is visible and editable there, and is injected into later tasks.",
].join(" ");

export interface MemoryBuiltinContext {
  engine: EngineContext;
  sessionId: string;
}

export function createMemoryExtension({ engine }: MemoryBuiltinContext): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", async (event, ctx) => {
      const text = await engine.memory.injection(cwdOf(ctx));
      if (!text) return;
      return { systemPrompt: `${event.systemPrompt}\n\n${text}` };
    });

    pi.registerTool({
      name: MEMORY_TOOL,
      label: "记住",
      description: DESCRIPTION,
      promptSnippet: "Remember a lasting user preference or fact for future tasks (visible and editable in 资料库 · 记忆)",
      promptGuidelines: ["Call ob_remember when the user states a lasting preference or asks you to remember something; keep it to one short sentence and never store secrets."],
      parameters: PARAMETERS,
      executionMode: "sequential",
      async execute(_toolCallId, params): Promise<MemoryToolResult> {
        const value = (params ?? {}) as Record<string, unknown>;
        if (typeof value.content !== "string" || !value.content.trim())
          return { content: [{ type: "text", text: "没有可保存的内容。" }], isError: true, details: {} };
        try {
          const entry = await engine.memory.remember(value.content, typeof value.title === "string" ? value.title : undefined);
          return {
            content: [{ type: "text", text: `已记住（${entry.path}）：${value.content.trim().slice(0, 200)}` }],
            details: { path: entry.path, scope: entry.scope },
          };
        } catch (error) {
          return { content: [{ type: "text", text: `保存记忆失败：${error instanceof Error ? error.message : String(error)}` }], isError: true, details: {} };
        }
      },
    });
  };
}

function cwdOf(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.sessionManager.getCwd();
  } catch {
    return undefined;
  }
}

/** Registered in `BUILTIN_EXTENSIONS` (builtin/index.ts). */
export const memoryBuiltin = {
  id: "memory",
  label: "长期记忆",
  description: "把用户确认过的偏好注入每次任务的系统提示词，并提供 ob_remember 让模型主动记录；在资料库 · 记忆中可见、可删",
  tools: [MEMORY_TOOL] as readonly string[],
  create: (ctx: MemoryBuiltinContext): ExtensionFactory => createMemoryExtension(ctx),
};
