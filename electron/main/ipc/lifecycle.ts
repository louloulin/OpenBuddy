/**
 * IPC surface — lifecycle domain.
 *
 * Phase B.1 round 5 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * 4 boot/initialization handlers that all other capabilities depend
 * on but that don't belong in any of them:
 *
 *   - `agent:new-session`         create a fresh session, optionally with cwd+modelId
 *   - `agent:ensure-new-session`  coalesced variant — concurrent callers share one in-flight Promise
 *   - `agent:init`                boot the agent host with cwd + traceId (legacy entrypoint)
 *   - `agent:dispose`             tear down the agent host
 *
 * Why these are split out from the rest of `agent.ts`: every
 * downstream capability (sessions / workspace / prompt / plugin) only
 * makes sense once the agent host is up. Keeping the boot path in a
 * single file means the "is the agent host ready?" guard is easy to
 * audit, and the failure modes for `agent:init` (which can throw if
 * the host fails to boot) are isolated from the more frequent
 * session-mutation paths.
 *
 * The handlers in this module close over `agentHost` and
 * `ensureAgentHost` directly (no `inflightAbortControllers` /
 * `awaitExtensionsBound`) because boot does not run on the prompt
 * critical path.
 */
import { ipcMain } from "electron";

import { generateTraceId } from "@openbuddy/logging-shared";

import {
  hostDispatched,
  hostFailed,
  hostReceived,
} from "../agent/agent-host-log";
import {
  absolutePath,
  optionalString,
  recordValue,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerLifecycleIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("agent:new-session", async (_e, input?: string | { cwd?: string; modelId?: string; traceId?: string }) => {
    await ensureAgentHost();
    const payload = typeof input === "string" ? undefined : recordValue(input, "agent:new-session payload");
    // preload allows {modelId}-only payloads; fall back to the active cwd.
    const cwd = typeof input === "string"
      ? absolutePath(input, "cwd")
      : payload?.cwd === undefined || payload?.cwd === null ? agentHost.getCwd() : absolutePath(payload.cwd, "cwd");
    const modelId = payload?.modelId === undefined ? undefined : requiredString(payload.modelId, "modelId");
    const traceId = optionalString((typeof input === "string" ? undefined : payload?.traceId), "traceId") ?? generateTraceId();
    hostReceived("agent:new-session", traceId);
    try {
      const result = await agentHost.newSession(cwd, modelId, { traceId });
      hostDispatched("agent:new-session", traceId);
      return result;
    } catch (err) {
      hostFailed("agent:new-session", traceId, err);
      throw err;
    }
  });

  // Coalesced variant of `agent:new-session` — concurrent callers with the
  // same `${cwd}\0${modelId}` key share one in-flight Promise. Use this
  // from renderer-side code that wants to *lazily* obtain a fresh session
  // id (e.g. extension methods, double-clicks of "新建任务"). The returned
  // sessionId is indistinguishable from a `agent:new-session` result.
  ipcMain.handle("agent:ensure-new-session", async (_e, input?: string | { cwd?: string; modelId?: string; traceId?: string }) => {
    await ensureAgentHost();
    const payload = typeof input === "string" ? undefined : recordValue(input, "agent:ensure-new-session payload");
    const cwd = typeof input === "string"
      ? absolutePath(input, "cwd")
      : payload?.cwd === undefined || payload?.cwd === null ? agentHost.getCwd() : absolutePath(payload.cwd, "cwd");
    const modelId = payload?.modelId === undefined ? undefined : requiredString(payload.modelId, "modelId");
    const traceId = optionalString((typeof input === "string" ? undefined : payload?.traceId), "traceId") ?? generateTraceId();
    hostReceived("agent:ensure-new-session", traceId);
    try {
      const result = await agentHost.ensureNewSession(cwd, modelId, { traceId });
      hostDispatched("agent:ensure-new-session", traceId);
      return result;
    } catch (err) {
      hostFailed("agent:ensure-new-session", traceId, err);
      throw err;
    }
  });

  ipcMain.handle("agent:init", async (_e, cwd?: string | { cwd?: string; traceId?: string }) => {
    const opts = typeof cwd === "object" && cwd !== null ? cwd : undefined;
    const normalizedCwd = (typeof cwd === "string" ? cwd : opts?.cwd) === undefined
      ? undefined
      : absolutePath(typeof cwd === "string" ? cwd : opts?.cwd, "cwd");
    const traceId = optionalString(opts?.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:init", traceId);
    try {
      await agentHost.init(normalizedCwd ? { cwd: normalizedCwd, traceId } : { traceId });
      const auth = await agentHost.authStatus();
      hostDispatched("agent:init", traceId);
      return {
        ok: true,
        cwd: agentHost.getCwd(),
        auth,
        agentVersion: process.versions.electron,
        defaultModelId: agentHost.getModel() ? `${agentHost.getModel()?.provider}/${agentHost.getModel()?.id}` : undefined,
      };
    } catch (err) {
      hostFailed("agent:init", traceId, err);
      throw err;
    }
  });

  ipcMain.handle("agent:dispose", async () => {
    await agentHost.dispose();
    return { ok: true };
  });
}
