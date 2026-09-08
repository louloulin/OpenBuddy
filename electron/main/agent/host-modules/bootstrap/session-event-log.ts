/**
 * host-modules/bootstrap/session-event-log.ts — SessionEventLog bootstrap.
 */

import { join } from "node:path";

import { SessionEventLog } from "../../../session/session-event-log";
import { type AgentHostState } from "../_state-shape";
import { piHome } from "../_host-paths";

export async function bootstrapSessionEventLog(
  state: AgentHostState,
  cwd: string,
): Promise<SessionEventLog> {
  const sessionEventLog = new SessionEventLog({
    databasePath: join(piHome(), "openbuddy-events.jsonl"),
  });
  await sessionEventLog.load();
  state.sessionEventLog = sessionEventLog;
  state.cwd = cwd;
  state.eventSequence = sessionEventLog.lastSequence();
  state.sessionSequences = new Map();
  return sessionEventLog;
}
