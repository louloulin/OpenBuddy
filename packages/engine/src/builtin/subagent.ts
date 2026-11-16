import { SessionManager, type ExtensionFactory, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";
import type { Slot } from "../types.js";

/**
 * 子代理 built-in (20261116-pii W3.4).
 *
 * `ob_subagent` runs one or more child sessions and returns their answers to the parent model:
 *
 * - **single** — one child, one task (like asking a specialist).
 * - **parallel** — up to `SUBAGENT_LIMIT` children at once (each claim, then a synthesis).
 * - **chain** — the tasks run in order; each one sees the previous answer.
 *
 * Each child is a real Pi session in the engine's pool (`SessionManager.inMemory`, so it never
 * shows up in the sidebar). It inherits the parent's model unless the named expert sets one, and
 * the expert's persona is prepended to the task. Children are tagged with `parentId` so stopping
 * the parent cancels them and their approvals can say 来自子代理 X.
 */

export const SUBAGENT_TOOL = "ob_subagent";
/** Children allowed to run at the same time (pii W3.4: default 3). */
export const SUBAGENT_LIMIT = 3;
/** Child turns are bounded: a sub-agent must not run away with the parent's budget. */
const CHILD_TIMEOUT_MS = 10 * 60_000;

const PARAMETERS = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["single", "parallel", "chain"], description: "single: one task; parallel: independent tasks at once; chain: each task sees the previous answer" },
    agent: { type: "string", description: "Optional expert id or name whose persona and model the child uses (see 专家中心)." },
    task: { type: "string", description: "The task for mode=single." },
    tasks: { type: "array", items: { type: "string" }, description: "The tasks for mode=parallel or chain (1–3 independent items, or ordered steps)." },
  },
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

interface SubagentChild {
  id: string;
  task: string;
  status: "running" | "done" | "failed" | "cancelled";
  answer?: string;
  error?: string;
  ms: number;
}

interface SubagentDetails {
  mode: string;
  agent?: string;
  children: Array<Pick<SubagentChild, "id" | "status" | "ms" | "error"> & { task: string }>;
}

interface SubagentToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: SubagentDetails;
  isError?: boolean;
}

const DESCRIPTION = [
  "Run a sub-agent: a separate session that works on a task and reports back.",
  "Use it for work that can be split (parallel), for an independent check, or to loop in a specialist expert by id/name.",
  "Only the final answer of each child comes back here — the child's transcript is kept in its own session.",
].join(" ");

export interface SubagentContext {
  engine: EngineContext;
  sessionId: string;
  cwd: string;
}

/** Experts are read through the store the host module uses; created lazily so no engine cycle appears. */
async function expertFor(engine: EngineContext, ref: string | undefined) {
  if (!ref) return undefined;
  const { ExpertStore } = await import("@openbuddy/services/agents/store");
  const store = new ExpertStore({ dir: engine.settings.dir, trusted: (cwd) => engine.trusted(cwd) });
  try {
    const byId = store.list().find((entry) => entry.id === ref);
    return byId ?? store.list().find((entry) => entry.name === ref);
  } catch {
    return undefined;
  }
}

/** Last assistant text of a child session (its answer). */
function answerOf(slot: Slot): string {
  const messages = slot.session.sessionManager.buildSessionContext().messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message.role !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content))
      return content
        .filter((part): part is { type: "text"; text: string } => !!part && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();
  }
  return "";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createSubagentExtension({ engine, sessionId, cwd }: SubagentContext): ExtensionFactory {
  /** Run one child to completion; never throws (a failed child is reported, not fatal to the tool). */
  const runChild = async (task: string, expertName: string | undefined, persona: string | undefined, model?: string): Promise<SubagentChild> => {
    const started = Date.now();
    const child: SubagentChild = { id: "", task, status: "running", ms: 0 };
    const modelId = model && model.includes("/") ? model.split("/").slice(1).join("/") : model;
    const providerId = model && model.includes("/") ? model.split("/")[0] : undefined;
    let slot: Slot | undefined;
    try {
      slot = await engine.open(SessionManager.inMemory(cwd), modelId, providerId, undefined, { parentId: sessionId, agentName: expertName });
      child.id = slot.id;
      // A child inherits the parent's 做一做 / 想一想 / 问一问: 问一问 children must not write files.
      const parentMode = engine.modes.get(sessionId);
      if (parentMode && parentMode !== "craft") engine.setMode(slot.id, parentMode);
      engine.emit("agent://subagent", {
        parentId: sessionId,
        childId: slot.id,
        status: "started",
        agent: expertName,
        task: task.slice(0, 500),
      });
      const prompt = persona ? `${persona}\n\n---\n\n${task}` : task;
      const turn = engine.send(slot.id, prompt);
      const deadline = started + CHILD_TIMEOUT_MS;
      while (slot.busy && Date.now() < deadline) await sleep(100);
      if (slot.busy) {
        slot.cancelledGeneration = slot.generation;
        await slot.session.abort();
        child.status = "cancelled";
        child.error = "子代理超时";
      } else {
        await turn.catch(() => {});
        child.answer = answerOf(slot);
        child.status = child.answer ? "done" : "failed";
        if (!child.answer) child.error = "子代理没有给出回答";
      }
    } catch (error) {
      child.status = "failed";
      child.error = error instanceof Error ? error.message : String(error);
    } finally {
      child.ms = Date.now() - started;
      if (slot) {
        const usage = (() => {
          try {
            return slot.session.getContextUsage?.();
          } catch {
            return undefined;
          }
        })();
        engine.emit("agent://subagent", {
          parentId: sessionId,
          childId: slot.id,
          status: child.status,
          agent: expertName,
          summary: child.answer?.slice(0, 500),
          error: child.error,
          ms: child.ms,
          usage,
        });
        // An in-memory child has no history worth keeping: close it so the pool stays small.
        await engine.close(slot.id).catch(() => {});
      }
    }
    return child;
  };

  return (pi) => {
    pi.registerTool({
      name: SUBAGENT_TOOL,
      label: "子代理",
      description: DESCRIPTION,
      promptSnippet: "Run one or more sub-agents (parallel or chained) and collect their answers",
      promptGuidelines: [
        "Use ob_subagent when the work splits into independent parts (parallel) or needs an ordered hand-off (chain).",
        "Keep tasks self-contained: a child does not see this conversation.",
      ],
      parameters: PARAMETERS,
      executionMode: "sequential",
      async execute(_toolCallId: string, params: unknown): Promise<SubagentToolResult> {
        const value = (params ?? {}) as Record<string, unknown>;
        const mode = value.mode === "parallel" || value.mode === "chain" ? value.mode : "single";
        const expert = await expertFor(engine, typeof value.agent === "string" ? value.agent : undefined);
        const agentLabel = expert?.name ?? (typeof value.agent === "string" ? value.agent : undefined);
        const tasks =
          mode === "single"
            ? typeof value.task === "string" && value.task.trim() ? [value.task.trim()] : []
            : Array.isArray(value.tasks) ? value.tasks.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim()) : [];
        if (!tasks.length)
          return {
            content: [{ type: "text", text: mode === "single" ? "缺少 task。" : "缺少 tasks（1–3 条）。" }],
            isError: true,
            details: { mode, agent: agentLabel, children: [] },
          };
        if (mode !== "chain" && tasks.length > SUBAGENT_LIMIT)
          return {
            content: [{ type: "text", text: `一次最多 ${SUBAGENT_LIMIT} 个子代理，请拆成多轮。` }],
            isError: true,
            details: { mode, agent: agentLabel, children: [] },
          };

        const children: SubagentChild[] = [];
        if (mode === "parallel") {
          // Batches of SUBAGENT_LIMIT; the engine's maxRunning is the real concurrency ceiling.
          for (let i = 0; i < tasks.length; i += SUBAGENT_LIMIT)
            children.push(...(await Promise.all(tasks.slice(i, i + SUBAGENT_LIMIT).map((task) => runChild(task, agentLabel, expert?.prompt, expert?.model)))));
        } else if (mode === "chain") {
          let previous = "";
          for (const task of tasks) {
            const child = await runChild(previous ? `${task}\n\n上一步的结果：\n${previous}` : task, agentLabel, expert?.prompt, expert?.model);
            children.push(child);
            if (child.status !== "done") break;
            previous = child.answer ?? "";
          }
        } else {
          children.push(await runChild(tasks[0], agentLabel, expert?.prompt, expert?.model));
        }

        const summary = children
          .map((child, index) => {
            const head = `## 子代理 ${index + 1}${agentLabel ? `（${agentLabel}）` : ""} · ${child.status === "done" ? "完成" : child.status === "cancelled" ? "已取消" : "失败"} · ${Math.round(child.ms / 1000)}s`;
            return child.status === "done" ? `${head}\n${child.answer}` : `${head}\n${child.error ?? "没有结果"}`;
          })
          .join("\n\n");
        const failed = children.filter((child) => child.status !== "done").length;
        return {
          content: [{ type: "text", text: summary }],
          isError: failed === children.length,
          details: {
            mode,
            agent: agentLabel,
            children: children.map((child) => ({ id: child.id, status: child.status, ms: child.ms, error: child.error, task: child.task.slice(0, 200) })),
          },
        };
      },
    });
  };
}

/** Registered in `BUILTIN_EXTENSIONS` (builtin/index.ts). */
export const subagentBuiltin = {
  id: "subagent",
  label: "子代理",
  description: "让模型用 ob_subagent 并行或串行派出子代理（可选指定专家），结果汇总回父会话；父任务停止时级联取消",
  tools: [SUBAGENT_TOOL] as readonly string[],
  create: (ctx: SubagentContext) => createSubagentExtension(ctx),
};
