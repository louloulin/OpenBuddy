import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Shared agent home path resolver.
 *
 * Both `electron/main/agent-host.ts::piHome()` (Pi integration reads) and
 * `electron/main/pi-resources.ts::piRoot()` (workbench-scope storage reads)
 * need to resolve to the same directory. Sharing this helper prevents the
 * divergent-path bug that caused `mcp.json` to be written under
 * `${userData}/pi-agent/` while the agent-host read it under
 * `${userData}/workspaces/<scope>/pi-agent/`.
 */
export function agentHome(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent");
}
