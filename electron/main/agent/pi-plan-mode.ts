import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

export type PiPlanState = {
  enabled: boolean;
  state: string;
  planText: string;
};

export type PiPlanController = {
  getPlan: (sessionId: string) => Promise<PiPlanState>;
  setEnabled: (sessionId: string, enabled: boolean) => Promise<PiPlanState>;
  requestEnabled?: (sessionId: string, enabled: boolean) => Promise<PiPlanState>;
  commitPending?: (sessionId: string) => Promise<PiPlanState>;
  setPlan: (sessionId: string, planText: string) => Promise<PiPlanState>;
  approve: (sessionId: string) => Promise<PiPlanState>;
  reject: (sessionId: string) => Promise<PiPlanState>;
};

export type PiPlanModeOptions = {
  resolveController: () => PiPlanController | undefined;
  policy?: string;
};

const DEFAULT_POLICY = [
  "## Plan mode",
  "You are working in plan mode. First reason about the requested work and produce a complete Markdown plan.",
  "Prefer inspection and read-only actions while the plan is being prepared; do not claim the plan is approved until the user approves it.",
  "When the plan is complete, call `exit_plan_mode` with the full plan so the user can review it.",
].join("\n");

function planId(context: { sessionManager: { getSessionId: () => string } }): string {
  return context.sessionManager.getSessionId();
}

function notify(context: { ui: { notify: (message: string, type?: "info" | "warning" | "error") => void } }, message: string, type: "info" | "warning" | "error" = "info"): void {
  context.ui.notify(message, type);
}

function summarize(state: PiPlanState): string {
  const mode = state.enabled ? "enabled" : "disabled";
  const text = state.planText.trim();
  return `Plan mode ${mode} (${state.state}).${text ? `\n\n${text}` : ""}`;
}

async function handlePlanCommand(args: string, context: ExtensionCommandContext, options: PiPlanModeOptions): Promise<void> {
  const controller = options.resolveController();
  if (!controller) {
    notify(context, "OpenBuddy plan service is unavailable.", "error");
    return;
  }
  const sessionId = planId(context);
  const input = args.trim();
  const [verb, ...rest] = input.split(/\s+/u);
  const value = rest.join(" ").trim();
  if (!verb || verb === "show" || verb === "status") {
    notify(context, summarize(await controller.getPlan(sessionId)));
    return;
  }
  if (verb === "on" || verb === "enable" || verb === "enabled") {
    notify(context, summarize(await (controller.requestEnabled?.(sessionId, true) ?? controller.setEnabled(sessionId, true))));
    return;
  }
  if (verb === "off" || verb === "disable" || verb === "disabled") {
    notify(context, summarize(await (controller.requestEnabled?.(sessionId, false) ?? controller.setEnabled(sessionId, false))));
    return;
  }
  if (verb === "set") {
    if (!value) throw new Error("/plan set requires plan text");
    notify(context, summarize(await controller.setPlan(sessionId, value)));
    return;
  }
  if (verb === "approve" || verb === "accept") {
    notify(context, summarize(await controller.approve(sessionId)));
    return;
  }
  if (verb === "reject" || verb === "deny") {
    notify(context, summarize(await controller.reject(sessionId)));
    return;
  }
  throw new Error(`Unknown /plan command: ${verb}. Use show, on, off, set, approve, or reject.`);
}

export function createPiPlanModeExtension(options: PiPlanModeOptions): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on("before_agent_start", async (event: BeforeAgentStartEvent, context) => {
      const controller = options.resolveController();
      if (!controller) return;
      if (controller.commitPending) await controller.commitPending(planId(context));
      const state = await controller.getPlan(planId(context));
      if (!state.enabled) return;
      const policy = options.policy?.trim() || DEFAULT_POLICY;
      return { systemPrompt: `${event.systemPrompt}\n\n${policy}` };
    });
    pi.registerCommand("plan", {
      description: "Inspect or change Pi plan mode.",
      handler: (args, context) => handlePlanCommand(args, context, options),
    });
    // The plan-mode policy tells the model to call `exit_plan_mode`; this is
    // that tool. It stores the plan in the shared controller (the plan panel
    // renders it) and leaves approval to the user — previously the name the
    // model was told to call did not exist at all.
    if (typeof (pi as { registerTool?: unknown }).registerTool !== "function") return;
    pi.registerTool({
      name: "exit_plan_mode",
      label: "Submit plan",
      description: "Plan mode only: submit the finished Markdown plan for the user to review and approve. Do not start executing until the user approves.",
      parameters: Type.Object({ plan: Type.String({ description: "The complete plan in Markdown" }) }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const plan = String((params as { plan?: unknown } | undefined)?.plan ?? "").trim();
        const controller = options.resolveController();
        const sessionId = (ctx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager?.getSessionId?.();
        if (!plan || !controller || !sessionId) {
          return {
            content: [{ type: "text" as const, text: plan ? "Plan service is unavailable; present the plan in your reply instead." : "plan must not be empty" }],
            details: { submitted: false },
          };
        }
        await controller.setPlan(sessionId, plan);
        return {
          content: [{ type: "text" as const, text: "Plan submitted. Stop here and wait for the user to approve or request changes." }],
          details: { submitted: true },
        };
      },
    });
  };
}
