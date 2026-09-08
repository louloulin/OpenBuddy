/**
 * IPC surface — session domain (misc / read / metadata).
 *
 * Phase B.1 round 3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Extracted
 * from `./agent.ts`. Owns the read-side session handlers:
 *   - agent:load-session — re-bind a persisted session
 *   - agent:session-info / -messages / -usage — context snapshots
 *   - agent:session-metadata-clear — wipe the JSON mirror
 *   - session_search / session_fork — search + branch sessions
 *   - rewind_points / rewind_execute — rewind session tree
 *   - prompt_history — read prompt history
 *
 * The session lifecycle handlers (new-session / prompt / abort /
 * steer / follow-up) stay in agent.ts because they share the
 * inflightAbortControllers + awaitExtensionsBound + agentHost
 * local state and need more careful refactoring.
 */
import { ipcMain } from "electron";

import { generateTraceId } from "@openbuddy/logging-shared";

import { hostReceived, hostDispatched, hostFailed } from "../agent/agent-host-log";
import {
  absolutePath,
  optionalFiniteInteger,
  optionalString,
  recordValue,
  requiredBoolean,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerSessionMiscIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, casdoorAuth, ensureAgentHost } = deps;

  ipcMain.handle("agent:load-session", async (_e, args: { sessionId: string; cwd: string; traceId?: string }) => {
    await ensureAgentHost();
    const input = recordValue(args, "load session payload");
    casdoorAuth.authorize({ capability: "team.workspace" });
    const sessionId = requiredString(input.sessionId, "session id");
    const traceId = optionalString(input.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:load-session", traceId, sessionId);
    try {
      const result = await agentHost.loadSession(sessionId, input.cwd ? absolutePath(input.cwd, "cwd") : "", { traceId, sessionId });
      hostDispatched("agent:load-session", traceId, sessionId);
      return result;
    } catch (err) {
      hostFailed("agent:load-session", traceId, err);
      throw err;
    }
  });
  ipcMain.handle("agent:session-info", async (_e, args: { sessionId: string }) => {
    await ensureAgentHost();
    casdoorAuth.authorize({ capability: "team.workspace" });
    try {
      return agentHost.sessionInfo(requiredString(recordValue(args, "session info payload").sessionId, "session id"));
    } catch (error) {
      if (error instanceof Error && /^Pi session is not loaded:/u.test(error.message)) return null;
      throw error;
    }
  });
  ipcMain.handle("agent:session-messages", async (_e, args: { sessionId: string }) => {
    await ensureAgentHost();
    casdoorAuth.authorize({ capability: "team.workspace" });
    const input = recordValue(args, "session messages payload");
    return agentHost.readSessionEntries(requiredString(input.sessionId, "session id"));
  });
  ipcMain.handle("agent:session-usage", async (_e, args: { sessionId: string }) => {
    await ensureAgentHost();
    casdoorAuth.authorize({ capability: "team.workspace" });
    try {
      return agentHost.sessionUsage(requiredString(recordValue(args, "session usage payload").sessionId, "session id"));
    } catch (error) {
      if (error instanceof Error && /^Pi session is not loaded:/u.test(error.message)) return null;
      throw error;
    }
  });
  ipcMain.handle("agent:session-metadata-clear", async () => {
    await agentHost.clearSessionMetadata();
    return { ok: true };
  });
  ipcMain.handle("prompt_history", async (_e, args?: unknown) => {
    const input = args === undefined || args === null ? {} : recordValue(args, "prompt history payload");
    // P2-13: readPromptHistory lives in the memory module (NAPI). Lazy-load.
    const { readPromptHistory } = await import("../agent/pi-resources/memory");
    return readPromptHistory(optionalFiniteInteger(input.limit, "limit", 100, 1, 500));
  });
  ipcMain.handle("session_search", async (_e, args: { query: string; cwd?: string | null; limit?: number | null }) => {
    casdoorAuth.authorize({ capability: "team.workspace" });
    const input = recordValue(args, "session search payload");
    const { searchSessions } = await import("../agent/pi-resources/memory");
    return searchSessions(
      requiredString(input.query, "query"),
      input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd"),
      optionalFiniteInteger(input.limit, "limit", 50, 1, 200),
    );
  });
  ipcMain.handle("session_fork", async (_e, args: { sessionId: string; cwd?: string | null }) => {
    casdoorAuth.authorize({ capability: "team.workspace" });
    const input = recordValue(args, "session fork payload");
    const sessionId = requiredString(input.sessionId, "session id");
    const cwd = input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd");
    const { forkSession, forkSessionFromFile } = await import("../agent/pi-resources/memory");
    try {
      const sessionFileResult = await agentHost.sessionFile(sessionId);
      return await forkSessionFromFile(sessionFileResult.path ?? "", cwd);
    } catch {
      return forkSession(sessionId, cwd);
    }
  });
  ipcMain.handle("rewind_points", async (_e, args: { sessionId: string }) => {
    const { rewindPoints } = await import("../agent/pi-resources/memory");
    const sessionFileResult = await agentHost.sessionFile(requiredString(recordValue(args, "rewind points payload").sessionId, "session id"));
    if (!sessionFileResult.path) throw new Error("rewind_points: session file path unavailable");
    return rewindPoints(sessionFileResult.path);
  });
  ipcMain.handle("rewind_execute", async (_e, args: { sessionId: string; targetPromptIndex: number; mode?: string; force?: boolean }) => {
    const input = recordValue(args, "rewind execute payload");
    if (input.force !== undefined) requiredBoolean(input.force, "force");
    return agentHost.rewindSession(
      requiredString(input.sessionId, "session id"),
      optionalFiniteInteger(input.targetPromptIndex, "targetPromptIndex", -1, 0, 100000),
      input.mode === undefined ? undefined : requiredString(input.mode, "rewind mode"),
    );
  });
}