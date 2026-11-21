import type { ExtensionContext, ExtensionFactory, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { PLAN_TOOL } from "@openbuddy/protocol/plan";
import type { EngineContext } from "../engine-context.js";
import { emitPlan } from "../event-pipeline.js";
import { applyTodo, EMPTY_PLAN, MAX_STEPS, parseTodoParams, planFromBranch, type PlanState } from "./plan-state.js";

/**
 * Built-in `ob_todo` (20261116-pii W3.1): the model keeps the task's step plan, the user sees it
 * as a live checklist (PlanPanel, the 任务概览 popover). The pattern of Pi's `todo.ts` example:
 * the whole list is returned in each result's `details`, so the plan of any branch is rebuilt
 * from that branch; the in-memory copy is only a cache, re-read whenever the branch can change.
 *
 * It has no effect outside the session, so the permission gate classifies it as safe (it still
 * passes through the gate), and 想一想 / 问一问 keep it among their read-only tools.
 */
const PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["add", "update", "complete", "remove", "list"],
      description: "add: append steps · update: change a step's text / status / note · complete: mark a step done · remove: drop a step · list: read the plan",
    },
    items: { type: "array", items: { type: "string" }, description: "add: the new steps, in order (short imperative phrases in the user's language)" },
    text: { type: "string", description: "add: a single new step · update: the step's new text" },
    id: { type: "integer", description: "update / complete / remove: the step number (#id)" },
    status: { type: "string", enum: ["pending", "in_progress", "done"], description: "update: the step's new status" },
    note: { type: "string", description: "update / complete: a short remark shown under the step (an empty string clears it)" },
  },
  required: ["action"],
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

const DESCRIPTION = [
  "Record and update the step plan of the current task. The user sees it as a live checklist with progress, so keep it accurate.",
  "Use it for tasks with three or more steps: first add all steps (action add with items), set a step in_progress when you start it (action update with status), and complete it as soon as it is finished.",
  `Remove steps that turned out unnecessary. At most ${MAX_STEPS} steps. Every result returns the whole plan, so list is rarely needed.`,
].join(" ");

export interface TodoBuiltinContext {
  engine: EngineContext;
  sessionId: string;
}

export function createTodoExtension({ engine, sessionId }: TodoBuiltinContext): ExtensionFactory {
  return (pi) => {
    let plan: PlanState = EMPTY_PLAN;
    const sync = (ctx: ExtensionContext) => { plan = planFromBranch(ctx.sessionManager); };
    // Opened / reloaded, or the leaf moved (regenerate, rewind, branch switch): tell the renderer.
    const announce = (_event: unknown, ctx: ExtensionContext) => {
      sync(ctx);
      emitPlan(engine, sessionId, plan.items);
    };
    pi.on("session_start", announce);
    pi.on("session_tree", announce);
    // Before each run: earlier results are all persisted by now.
    pi.on("agent_start", (_event, ctx) => sync(ctx));

    pi.registerTool({
      name: PLAN_TOOL,
      label: "计划",
      description: DESCRIPTION,
      promptSnippet: "Keep the task's step plan the user sees as a progress checklist (add / update / complete / remove / list)",
      promptGuidelines: ["For tasks with three or more steps, record the plan with ob_todo before starting, keep one step in_progress at a time, and complete each step right after finishing it."],
      parameters: PARAMETERS,
      // Several ob_todo calls in one message must see each other's result.
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const result = applyTodo(plan, parseTodoParams(params));
        plan = { items: result.details.items, nextId: result.details.nextId };
        return { content: [{ type: "text", text: result.text }], details: result.details };
      },
    });
  };
}

/** Registered in `BUILTIN_EXTENSIONS` (builtin/index.ts). */
export const todoBuiltin = {
  id: "todo",
  label: "任务计划",
  description: "提供 ob_todo 工具：想一想时把计划步骤记下来，执行中逐步更新，计划面板和任务概览实时显示",
  tools: [PLAN_TOOL] as readonly string[],
  create: (ctx: TodoBuiltinContext): ExtensionFactory => createTodoExtension(ctx),
};
