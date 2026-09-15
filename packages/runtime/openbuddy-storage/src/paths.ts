import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The single source of truth for OpenBuddy's agent data root.
 *
 * Every module that needs to locate agent-scoped files (sessions, mcp.json,
 * auth.json, models.json, settings.json, plugin + marketplace caches, the
 * SQLite catalogs, harness token/cache, span-tree exports, ...) MUST resolve
 * its base through `agentHome()` / `agentPath()` rather than rebuilding the
 * `PI_CODING_AGENT_DIR ?? PI_HOME ?: ~/<dir>/agent` expression locally.
 *
 * History: that expression was copied into 20+ modules across `electron/main`
 * and `packages/*`, so a single layout change meant a repo-wide grep-and-patch
 * and any missed copy silently diverged (e.g. a workspace wrote its catalog to
 * one root while the reader resolved another). Centralizing it here makes the
 * layout a one-file decision again.
 *
 * Layout: OpenBuddy owns `~/.openbuddy/agent`. It deliberately does not reuse
 * pi-coding-agent's `~/.pi/agent`, because the two products have diverged —
 * different session metadata schema, marketplace contents, and permission
 * model — and sharing the directory meant each wrote into the other's files
 * and pi-specific sessions leaked into OpenBuddy's sidebar.
 *
 * Overrides, in priority order:
 *   1. `OPENBUDDY_AGENT_DIR`  — explicit OpenBuddy root (the documented knob)
 *   2. `PI_CODING_AGENT_DIR`  — kept so existing pi-oriented setups keep working
 *   3. `PI_HOME`              — base prefix; `.openbuddy/agent` is appended
 *   4. `homedir()`            — same as (3) without PI_HOME
 */
export function agentHome(): string {
  return (
    process.env.OPENBUDDY_AGENT_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    join(process.env.PI_HOME ?? homedir(), ".openbuddy", "agent")
  );
}

/** Join `segments` onto `agentHome()`. */
export function agentPath(...segments: string[]): string {
  return join(agentHome(), ...segments);
}
