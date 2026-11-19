import { SessionManager, type ExtensionFactory, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";
import type { Slot } from "../types.js";
import { setSessionExpert } from "../features/expert.js";

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
    agent: { type: "string", description: "Optional expert id or name applied to every child (ignored when steps set their own agent)." },
    task: { type: "string", description: "The task for mode=single." },
    tasks: { type: "array", items: { type: "string" }, description: "The tasks for mode=parallel or chain (1–3 independent items, or ordered steps)." },
    steps: {
      type: "array",
      description: "Per-step work. Each item may name its own expert and role — use this for team pipelines.",
      items: {
        type: "object",
        properties: {
          task: { type: "string", description: "The self-contained task for this step." },
          agent: { type: "string", description: "Expert id or name for this step." },
          role: { type: "string", description: "Short role label shown on the child card (e.g. 调研 / 审阅)." },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
    team: { type: "string", description: "Optional team name; carried on the child events so the UI can group them." },
  },
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

interface SubagentStep {
  task: string;
  agent?: string;
  role?: string;
}

interface SubagentChild {
  id: string;
  task: string;
  agent?: string;
  role?: string;
  status: "running" | "done" | "failed" | "cancelled";
  answer?: string;
  error?: string;
  ms: number;
}

interface SubagentDetails {
  mode: string;
  agent?: string;
  team?: string;
  children: Array<Pick<SubagentChild, "id" | "status" | "ms" | "error" | "agent" | "role"> & { task: string }>;
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
async function expertFor(engine: EngineContext, ref: string | undefined, cwd: string) {
  if (!ref) return undefined;
  const { ExpertStore } = await import("@openbuddy/services/agents/store");
  const store = new ExpertStore({ dir: engine.settings.dir, trusted: (value) => engine.trusted(value) });
  try {
    // `get` resolves user → trusted project → library → builtin, so built-in team members
    // (`deep-researcher`, `code-reviewer`, …) bind exactly like user experts.
    return store.get(ref, cwd);
  } catch {
    try {
      return store.catalog(cwd).experts.find((entry) => entry.name === ref);
    } catch {
      return undefined;
    }
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
  const runChild = async (step: SubagentStep, team: string | undefined, index: number): Promise<SubagentChild> => {
    const task = step.task;
    const started = Date.now();
    const expert = await expertFor(engine, step.agent, cwd);
    const agentLabel = expert?.name ?? step.agent;
    const child: SubagentChild = { id: "", task, agent: agentLabel, role: step.role, status: "running", ms: 0 };
    const model = expert?.model;
    const modelId = model && model.includes("/") ? model.split("/").slice(1).join("/") : model;
    const providerId = model && model.includes("/") ? model.split("/")[0] : undefined;
    let slot: Slot | undefined;
    try {
      slot = await engine.open(SessionManager.inMemory(cwd), modelId, providerId, undefined, { parentId: sessionId, agentName: agentLabel });
      child.id = slot.id;
      // A child inherits the parent's 做一做 / 想一想 / 问一问: 问一问 children must not write files.
      const parentMode = engine.modes.get(sessionId);
      if (parentMode && parentMode !== "craft") engine.setMode(slot.id, parentMode);
      // Bind the expert on the child itself: model / thinking / tool allowlist + persona all apply
      // through the same path a user-bound session uses. Falling back to a persona prefix keeps
      // older experts (no tools/model) working if binding fails.
      let bound = false;
      if (expert) {
        try {
          await setSessionExpert(engine, slot.id, {
            id: expert.id,
            name: expert.name,
            avatar: expert.image,
            scope: expert.scope,
            prompt: expert.prompt,
            model: expert.model,
            thinking: expert.thinking,
            tools: expert.tools,
            skills: expert.skills,
            connectors: expert.connectors,
          });
          bound = true;
        } catch {
          /* fall back to the persona prefix below */
        }
      }
      engine.emit("agent://subagent", {
        parentId: sessionId,
        childId: slot.id,
        status: "started",
        agent: agentLabel,
        role: step.role,
        team,
        index,
        task: task.slice(0, 500),
      });
      const prompt = !bound && expert?.prompt ? `${expert.prompt}\n\n---\n\n${task}` : task;
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
          agent: agentLabel,
          role: step.role,
          team,
          index,
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
        "For a team pipeline, pass steps: each step names its own agent (expert id) and role; chain mode carries the previous answer forward.",
        "Keep tasks self-contained: a child does not see this conversation.",
      ],
      parameters: PARAMETERS,
      executionMode: "sequential",
      async execute(_toolCallId: string, params: unknown): Promise<SubagentToolResult> {
        const value = (params ?? {}) as Record<string, unknown>;
        const mode = value.mode === "parallel" || value.mode === "chain" ? value.mode : "single";
        const team = typeof value.team === "string" && value.team.trim() ? value.team.trim().slice(0, 80) : undefined;
        const fallbackAgent = typeof value.agent === "string" && value.agent.trim() ? value.agent.trim() : undefined;
        const declared = Array.isArray(value.steps)
          ? value.steps
              .map((item) => {
                const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
                const task = typeof record.task === "string" ? record.task.trim() : "";
                const agent = typeof record.agent === "string" && record.agent.trim() ? record.agent.trim() : fallbackAgent;
                const role = typeof record.role === "string" && record.role.trim() ? record.role.trim().slice(0, 40) : undefined;
                return { task, ...(agent ? { agent } : {}), ...(role ? { role } : {}) };
              })
              .filter((step) => !!step.task)
          : [];
        const legacy =
          mode === "single"
            ? typeof value.task === "string" && value.task.trim() ? [value.task.trim()] : []
            : Array.isArray(value.tasks)
              ? value.tasks.filter((task): task is string => typeof task === "string" && !!task.trim()).map((task) => task.trim())
              : [];
        const steps: SubagentStep[] = declared.length
          ? declared
          : legacy.map((task) => ({ task, ...(fallbackAgent ? { agent: fallbackAgent } : {}) }));
        const agentLabel = fallbackAgent ?? (steps.length === 1 ? steps[0].agent : undefined);
        if (!steps.length)
          return {
            content: [{ type: "text", text: mode === "single" ? "缺少 task 或 steps。" : "缺少 tasks 或 steps（1–3 条）。" }],
            isError: true,
            details: { mode, agent: agentLabel, team, children: [] },
          };
        if (mode !== "chain" && steps.length > SUBAGENT_LIMIT)
          return {
            content: [{ type: "text", text: `一次最多 ${SUBAGENT_LIMIT} 个子代理，请拆成多轮。` }],
            isError: true,
            details: { mode, agent: agentLabel, team, children: [] },
          };
        if (mode === "chain" && steps.length > 8)
          return {
            content: [{ type: "text", text: "chain 最多 8 步，请合并步骤。" }],
            isError: true,
            details: { mode, agent: agentLabel, team, children: [] },
          };

        const children: SubagentChild[] = [];
        if (mode === "parallel") {
          // Batches of SUBAGENT_LIMIT; the engine's maxRunning is the real concurrency ceiling.
          for (let i = 0; i < steps.length; i += SUBAGENT_LIMIT)
            children.push(...(await Promise.all(steps.slice(i, i + SUBAGENT_LIMIT).map((step, offset) => runChild(step, team, i + offset)))));
        } else if (mode === "chain") {
          let previous = "";
          for (let i = 0; i < steps.length; i += 1) {
            const step = steps[i];
            const child = await runChild(
              previous ? { ...step, task: `${step.task}\n\n上一步的结果：\n${previous}` } : step,
              team,
              i,
            );
            children.push(child);
            if (child.status !== "done") break;
            previous = child.answer ?? "";
          }
        } else {
          children.push(await runChild(steps[0], team, 0));
        }

        const summary = children
          .map((child, index) => {
            const who = [child.agent, child.role].filter(Boolean).join(" · ");
            const head = `## 子代理 ${index + 1}${who ? `（${who}）` : ""} · ${child.status === "done" ? "完成" : child.status === "cancelled" ? "已取消" : "失败"} · ${Math.round(child.ms / 1000)}s`;
            return child.status === "done" ? `${head}\n${child.answer}` : `${head}\n${child.error ?? "没有结果"}`;
          })
          .join("\n\n");
        const failed = children.filter((child) => child.status !== "done").length;
        return {
          content: [{ type: "text", text: summary }],
          isError: failed === children.length,
          details: {
            mode,
            ...(agentLabel ? { agent: agentLabel } : {}),
            ...(team ? { team } : {}),
            children: children.map((child) => ({
              id: child.id,
              status: child.status,
              ms: child.ms,
              error: child.error,
              task: child.task.slice(0, 200),
              ...(child.agent ? { agent: child.agent } : {}),
              ...(child.role ? { role: child.role } : {}),
            })),
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
