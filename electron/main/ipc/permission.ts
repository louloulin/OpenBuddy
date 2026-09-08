/**
 * IPC surface — permission domain.
 *
 * Phase B.1 round 3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Extracted
 * from `./agent.ts`. Owns the 4 permission-related handlers:
 *   - agent:resolve-permission — renderer responds to a pending
 *     permission request via agentHost.resolveUiRequest()
 *   - agent:resolve-question — same for question prompts
 *   - permission_list / permission_save — CRUD on the policy file
 *     via the dynamic `@openbuddy/auth-permission` module
 */
import { ipcMain } from "electron";

import {
  permissionRules,
  recordValue,
  requiredBoolean,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerPermissionIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("agent:resolve-permission", async (_e, args: { requestId: string; optionId?: string; cancelled?: boolean }) => {
    const input = recordValue(args, "permission response payload");
    const cancelled = input.cancelled === undefined ? false : requiredBoolean(input.cancelled, "cancelled");
    const optionId = input.optionId === undefined || input.optionId === null ? undefined : requiredString(input.optionId, "optionId");
    const value = cancelled || optionId === undefined || optionId === "deny"
      ? false
      : optionId === "allow_always" ? { decision: "allow_always" as const } : optionId === "allow" ? true : false;
    return { ok: agentHost.resolveUiRequest(requiredString(input.requestId, "requestId"), value) };
  });
  ipcMain.handle("agent:resolve-question", async (_e, args: { requestId: string; answers?: Record<string, string | string[]>; annotations?: Record<string, { preview?: string; notes?: string }>; cancelled?: boolean }) => {
    const input = recordValue(args, "question response payload");
    const cancelled = input.cancelled === undefined ? false : requiredBoolean(input.cancelled, "cancelled");
    const answers = input.answers === undefined ? {} : recordValue(input.answers, "answers");
    const annotations = input.annotations === undefined ? {} : recordValue(input.annotations, "annotations");
    const normalizedAnswers = Object.fromEntries(
      Object.entries(answers).map(([key, value]) => [
        key,
        typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string")) ? value : String(value),
      ]),
    );
    const normalizedAnnotations = Object.fromEntries(
      Object.entries(annotations).map(([key, value]) => [key, recordValue(value, `annotations.${key}`)]),
    );
    return {
      ok: agentHost.resolveUiRequest(
        requiredString(input.requestId, "requestId"),
        cancelled
          ? undefined
          : {
              answers: normalizedAnswers as Record<string, string | string[]>,
              annotations: normalizedAnnotations as Record<string, { preview?: string; notes?: string }>,
            },
      ),
    };
  });
  ipcMain.handle("permission_list", async () => {
    await ensureAgentHost();
    return (await import("@openbuddy/auth-permission")).permissionHandlers.readRules();
  });
  ipcMain.handle("permission_save", async (_e, args: { rules: unknown }) => {
    await ensureAgentHost();
    const input = recordValue(args, "permission_save payload");
    return (await import("@openbuddy/auth-permission")).permissionHandlers.writeRules(permissionRules(input.rules) as never);
  });
}