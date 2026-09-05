/**
 * pi-compatibility-commands.ts — slash-command describe/invoke helpers for the
 * pi compatibility adapters.
 *
 * Phase 3 (架构高内聚低耦合): extracted from `pi-extensions.ts` (~300 lines).
 * These are pure functions that project OpenBuddy's canonical Cordis services
 * onto the pi slash-command surface. They have no dependency on the adapter
 * array or the resolution/factory logic — only on the `CompatibilityCommandContext`
 * shape passed in at invocation time.
 *
 * Keeping them in their own module lets the adapter definitions in
 * `pi-extensions.ts` stay declarative (data only) and keeps the command
 * surface testable in isolation.
 */

export interface CompatibilityCommandContext {
  cwd?: string;
  sessionManager?: { getSessionId?: () => string };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

async function callIfPresent(service: unknown, keys: readonly string[]): Promise<unknown> {
  if (!service) return undefined;
  for (const key of keys) {
    const fn = (service as Record<string, unknown>)[key];
    if (typeof fn === "function") {
      try {
        return await (fn as (...args: unknown[]) => Promise<unknown>).call(service);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function summariseMcpSnapshot(snapshot: unknown): string {
  const record = asRecord(snapshot);
  if (!record) return "MCP status unavailable";
  const servers = Array.isArray(record.servers) ? record.servers : Array.isArray(record.entries) ? record.entries : [];
  if (servers.length === 0) return "No MCP servers are configured in ~/.pi/agent/mcp.json.";
  const summary = servers
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) return null;
      const name = typeof item.name === "string" ? item.name : typeof item.serverName === "string" ? item.serverName : null;
      const status = typeof item.status === "string" ? item.status : typeof item.state === "string" ? item.state : "unknown";
      const toolCount = typeof item.toolCount === "number" ? item.toolCount : Array.isArray(item.tools) ? item.tools.length : undefined;
      return name ? `${name}=${status}${toolCount !== undefined ? `(${toolCount} tools)` : ""}` : null;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join(", ");
  return summary ? `MCP servers: ${summary}.` : "MCP status unavailable";
}

export async function describeMcpCommand(service: unknown, args: string): Promise<string> {
  const trimmed = args.trim();
  const verb = trimmed.split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
  if (!verb || verb === "list" || verb === "status") {
    const snapshot = await callIfPresent(service, ["list", "status", "servers"]);
    const description = snapshot === undefined ? "MCP status unavailable" : summariseMcpSnapshot(snapshot);
    return `OpenBuddy routes MCP ${verb || "list"} to openbuddy-mcp-client. ${description}`;
  }
  if (verb === "reload") {
    return "OpenBuddy MCP config reload happens automatically when openbuddy-mcp-client refreshes the ~/.pi/agent/mcp.json snapshot; rerun /mcp list to confirm.";
  }
  if (verb === "tools") {
    return "OpenBuddy exposes MCP tools through the openbuddy-mcp-client service; they appear under mcp__<server>__<tool> for the LLM.";
  }
  return `OpenBuddy does not load pi-mcp-adapter natively; command '/mcp ${trimmed}' is delegated to the openbuddy-mcp-client canonical service.`;
}

export async function describeMcpAuthCommand(service: unknown, args: string): Promise<string> {
  const serverName = args.trim();
  if (!serverName) return "OpenBuddy MCP auth: pass a server name, e.g. /mcp-auth filesystem.";
  if (!service) return `OpenBuddy MCP auth for ${serverName} is not ready; the openbuddy-mcp-client service is not mounted yet.`;
  const authorizer = (service as Record<string, unknown>).authorize;
  if (typeof authorizer !== "function") return `OpenBuddy MCP auth for ${serverName} requires interactive OAuth; trigger it from the WorkBuddy settings panel instead of this RPC command.`;
  return `OpenBuddy MCP auth for ${serverName} is delegated to openbuddy-mcp-client.authorize; interactive prompts are surfaced through the WorkBuddy UI.`;
}

export async function describePermissionSystemCommand(service: unknown, args: string): Promise<string> {
  const verb = args.trim().split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
  if (!verb || verb === "status") {
    const mode = await callIfPresent(service, ["readMode"]);
    const rules = await callIfPresent(service, ["readRules"]);
    const ruleCount = Array.isArray(rules) ? rules.length : 0;
    return `OpenBuddy permission policy is delegated to openbuddy-permission (mode=${typeof mode === "string" ? mode : "unknown"}, rules=${ruleCount}).`;
  }
  if (verb === "rules") return "OpenBuddy permission rules are persisted in ~/.pi/agent/settings.json and exposed through openbuddy-permission.readRules/writeRules.";
  if (verb === "mode") return "OpenBuddy permission mode is delegated to openbuddy-permission.writeMode; change it from Settings -> Permissions.";
  if (verb === "reload") return "OpenBuddy permission rules reload automatically when the underlying settings.json changes; the next agent turn sees the new policy.";
  return `OpenBuddy does not load pi-permission-system natively; command '/permission-system ${args.trim()}' is delegated to openbuddy-permission.`;
}

export async function describeGoalCommand(service: unknown, args: string): Promise<string> {
  const verb = args.trim().split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
  if (!verb || verb === "list" || verb === "status") {
    const teams = await callIfPresent(service, ["list"]);
    const count = Array.isArray(teams) ? teams.length : 0;
    return `OpenBuddy goal orchestration is delegated to openbuddy-team (${count} active teams).`;
  }
  if (verb === "show") return "OpenBuddy team detail is delegated to openbuddy-team.get; pass a team id after /goal show.";
  if (verb === "stop") return "OpenBuddy team stop is delegated to openbuddy-team.finish; pass a team id after /goal stop.";
  return `OpenBuddy does not load pi-goal natively; command '/goal ${args.trim()}' is delegated to openbuddy-team.`;
}

export async function describePlanCommand(service: unknown, args: string): Promise<string> {
  const verb = args.trim().split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
  if (!verb || verb === "status" || verb === "show") {
    const plans = await callIfPresent(service, ["list"]);
    const count = Array.isArray(plans) ? plans.length : 0;
    if (count > 0) return `pi-plan-mode owns ${count} plan(s); OpenBuddy does not mirror plan state.`;
    return `pi-plan-mode is delegated natively; OpenBuddy does not load a Cordis plan plugin.`;
  }
  if (verb === "enable" || verb === "disable") return `Plan-mode toggle is delegated to pi-plan-mode; /plan ${verb} passes through to the installed pi extension.`;
  if (verb === "set") return "Plan content is delegated to pi-plan-mode; pass the plan text after /plan set.";
  return `Command '/plan ${args.trim()}' is delegated to pi-plan-mode natively.`;
}

export async function describeTasksCommand(service: unknown, args: string): Promise<string> {
  const verb = args.trim().split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
  const delegated = "@juicesharp/rpiv-todo (37k weekly downloads) when installed; otherwise the bundled pi todo tool.";
  if (!verb || verb === "list" || verb === "status") {
    return `Per-session task list is delegated to ${delegated}`;
  }
  if (verb === "add") return `Task add is delegated to ${delegated}; pass the task content after /tasks add.`;
  if (verb === "done" || verb === "complete") return `Task completion is delegated to ${delegated}; pass the task id after /tasks done.`;
  if (verb === "remove" || verb === "delete") return `Task removal is delegated to ${delegated}; pass the task id after /tasks remove.`;
  if (verb === "clear") return `Task clear is delegated to ${delegated}; clears all completed tasks for the current session.`;
  return `Command '/tasks ${args.trim()}' is delegated to ${delegated}`;
}

export async function describeSessionCommand(service: unknown, args: string): Promise<string> {
  const verb = args.trim().split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
  if (!verb || verb === "list") {
    return "OpenBuddy session ledger is delegated to openbuddy-session; WorkBuddy's Sidebar renders the same set, pinned and archived states round-trip through ~/.pi/agent/sessions.";
  }
  if (verb === "workspaces") return "OpenBuddy workspace discovery is delegated to openbuddy-session.listWorkspaces; groups every cwd in the session store by session count.";
  if (verb === "pin" || verb === "unpin") return `OpenBuddy pin toggle is delegated to openbuddy-session.setPinned; /sessions ${verb} is an alias for setPinned(<id>, ${verb === "pin"}).`;
  if (verb === "archive" || verb === "unarchive") return `OpenBuddy archive toggle is delegated to openbuddy-session.setArchived; /sessions ${verb} is an alias for setArchived(<id>, ${verb === "archive"}).`;
  return `OpenBuddy does not load pi-session natively; command '/sessions ${args.trim()}' is delegated to openbuddy-session.`;
}

export async function describeFsCommand(service: unknown, args: string): Promise<string> {
  const verb = args.trim().split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
  if (!verb || verb === "list") {
    return "OpenBuddy workspace-scoped filesystem facade is delegated to openbuddy-fs-local; WorkBuddy's File Tree panel renders the same set with hidden/IGNORED_DIRS filtering and a 2000-entry cap.";
  }
  if (verb === "stat") return "OpenBuddy path stat is delegated to openbuddy-fs-local.stat; pass a relative or absolute path after /fs stat to check existence and kind (file|directory|other).";
  if (verb === "read") return "OpenBuddy text read is delegated to openbuddy-fs-local.readTextFile; pass a path after /fs read. Default maxBytes=256 KiB with truncation marker.";
  if (verb === "open") return "OpenBuddy OS open is delegated to openbuddy-fs-local.openPath; pass a path after /fs open to launch the file or directory via the OS.";
  if (verb === "reveal") return "OpenBuddy reveal-in-folder is delegated to openbuddy-fs-local.reveal; pass a path after /fs reveal to focus the parent in Finder/Explorer.";
  if (verb === "mkdir") return "OpenBuddy directory create is delegated to openbuddy-fs-local.makeDirectory; pass a workspace-relative path after /fs mkdir. Requires an active workspace.";
  return `OpenBuddy does not load pi-fs natively; command '/fs ${args.trim()}' is delegated to openbuddy-fs-local.`;
}

function commandParts(args: string): { verb: string; rest: string } {
  const trimmed = args.trim();
  const [verb = "", ...rest] = trimmed.split(/\s+/u);
  return { verb: verb.toLowerCase(), rest: rest.join(" ").trim() };
}

function requireService<T extends Record<string, unknown>>(service: unknown, name: string): T {
  if (!service || typeof service !== "object") throw new Error(`${name} service is not mounted`);
  return service as T;
}

function requireSessionId(context: CompatibilityCommandContext): string {
  const id = context.sessionManager?.getSessionId?.();
  if (!id) throw new Error("Pi session id is unavailable");
  return id;
}

export async function invokeTasksCommand(service: unknown, args: string, context: CompatibilityCommandContext): Promise<string | undefined> {
  const { verb, rest } = commandParts(args);
  if (!service || typeof service !== "object") return undefined;
  const task = service as { list?: (id: string) => Promise<unknown[]>; add?: (id: string, content: string) => Promise<{ id: string }>; update?: (id: string, taskId: string, patch: object) => Promise<{ id: string } | null>; remove?: (id: string, taskId: string) => Promise<void>; clear?: (id: string) => Promise<void> };
  const sessionId = requireSessionId(context);
  if (!verb || verb === "list" || verb === "status") {
    if (!task.list) return undefined;
    const entries = await task.list(sessionId);
    return `Tasks (${entries.length}): ${entries.map((entry) => `${(entry as { id?: string }).id ?? "?"}:${(entry as { status?: string }).status ?? "?"}`).join(", ") || "empty"}.`;
  }
  if (verb === "add") {
    if (!rest) throw new Error("/tasks add requires task content");
    if (!task.add) return undefined;
    const entry = await task.add(sessionId, rest);
    return `Task added: ${entry.id}.`;
  }
  if (verb === "done" || verb === "complete") {
    if (!rest) throw new Error(`/tasks ${verb} requires a task id`);
    if (!task.update) return undefined;
    const entry = await task.update(sessionId, rest, { status: "completed" });
    if (!entry) throw new Error(`task not found: ${rest}`);
    return `Task completed: ${entry.id}.`;
  }
  if (verb === "remove" || verb === "delete") {
    if (!rest) throw new Error(`/tasks ${verb} requires a task id`);
    if (!task.remove) return undefined;
    await task.remove(sessionId, rest);
    return `Task removed: ${rest}.`;
  }
  if (verb === "clear") {
    if (!task.clear) return undefined;
    await task.clear(sessionId);
    return "Completed tasks cleared.";
  }
  return undefined;
}

export async function invokeSessionCommand(service: unknown, args: string, context: CompatibilityCommandContext): Promise<string | undefined> {
  const { verb, rest } = commandParts(args);
  const sessions = requireService(service, "openbuddy-session");
  const cwd = context.cwd ?? ".";
  if (!verb || verb === "list") return `Sessions: ${JSON.stringify(await (sessions.list as (cwd: string) => Promise<unknown[]>).call(sessions, cwd))}.`;
  if (verb === "workspaces") return `Workspaces: ${JSON.stringify(await (sessions.listWorkspaces as () => Promise<unknown[]>).call(sessions))}.`;
  if (!rest) throw new Error(`/sessions ${verb} requires a session id`);
  if (verb === "pin" || verb === "unpin") {
    await (sessions.setPinned as (id: string, pinned: boolean) => Promise<void>).call(sessions, rest, verb === "pin");
    return `Session ${verb}ned: ${rest}.`;
  }
  if (verb === "archive" || verb === "unarchive") {
    await (sessions.setArchived as (id: string, archived: boolean) => Promise<void>).call(sessions, rest, verb === "archive");
    return `Session ${verb}d: ${rest}.`;
  }
  return undefined;
}

export async function invokeFsCommand(service: unknown, args: string, context: CompatibilityCommandContext): Promise<string | undefined> {
  const { verb, rest } = commandParts(args);
  const fs = requireService(service, "openbuddy-fs-local");
  const cwd = context.cwd ?? ".";
  if (!verb || verb === "list") return `Files: ${JSON.stringify(await (fs.listDir as (path: string, cwd: string) => Promise<unknown[]>).call(fs, rest || ".", cwd))}.`;
  if (!rest) throw new Error(`/fs ${verb} requires a path`);
  if (verb === "stat") return `File: ${JSON.stringify(await (fs.stat as (path: string, cwd: string) => Promise<unknown>).call(fs, rest, cwd))}.`;
  if (verb === "read") return `File content:\n${await (fs.readTextFile as (path: string, cwd: string) => Promise<string>).call(fs, rest, cwd)}`;
  if (verb === "open") { await (fs.openPath as (path: string, cwd: string) => Promise<void>).call(fs, rest, cwd); return `Opened: ${rest}.`; }
  if (verb === "reveal") { await (fs.reveal as (path: string, cwd: string) => Promise<void>).call(fs, rest, cwd); return `Revealed: ${rest}.`; }
  if (verb === "mkdir") return `Directory: ${await (fs.makeDirectory as (path: string, root: string) => Promise<string>).call(fs, rest, cwd)}.`;
  return undefined;
}

// Stage G-1d: real invoke handlers for adapters whose describeInvocation
// was previously the only response surface. Each handler validates the
// resolved service (Cordis plugin mount) before delegating, then returns
// the same verb-shaped human-readable summary the legacy describe code
// produced so slash-command and tool paths stay consistent.

export async function invokeMcpCommand(service: unknown, args: string): Promise<string | undefined> {
  const { verb, rest } = commandParts(args);
  if (!service || typeof service !== "object") return undefined;
  const mcp = service as Record<string, unknown>;
  if (!verb || verb === "list" || verb === "status") {
    const snapshot = await callIfPresent(mcp, ["list", "status", "servers"]);
    return `MCP servers: ${summariseMcpSnapshot(snapshot)}.`;
  }
  if (verb === "reload") {
    await callIfPresent(mcp, ["reload", "refresh"]);
    return "MCP config reloaded; rerun /mcp list to confirm.";
  }
  if (verb === "tools") {
    if (!rest) return "OpenBuddy MCP tools: pass a server name after `tools`, e.g. /mcp tools filesystem.";
    const tools = await callIfPresent(mcp, ["listTools", "tools"]);
    return `MCP tools for ${rest}: ${summariseMcpSnapshot(tools)}.`;
  }
  if (verb === "reconnect" || verb === "disable" || verb === "enable") {
    if (!rest) throw new Error(`/mcp ${verb} requires a server name`);
    const fn = (mcp as Record<string, (...args: unknown[]) => Promise<unknown>>)[verb];
    if (typeof fn !== "function") return undefined;
    await fn.call(mcp, rest);
    return `MCP server ${rest}: ${verb}d.`;
  }
  return undefined;
}

export async function invokePermissionSystemCommand(service: unknown, args: string): Promise<string | undefined> {
  const { verb, rest } = commandParts(args);
  if (!service || typeof service !== "object") return undefined;
  const perm = service as Record<string, unknown>;
  if (!verb || verb === "status") {
    const mode = await callIfPresent(perm, ["readMode"]);
    const rules = await callIfPresent(perm, ["readRules"]);
    const ruleCount = Array.isArray(rules) ? rules.length : 0;
    return `OpenBuddy permission policy: mode=${typeof mode === "string" ? mode : "unknown"}, rules=${ruleCount}.`;
  }
  if (verb === "rules") {
    const rules = await callIfPresent(perm, ["readRules"]);
    return `OpenBuddy permission rules (${Array.isArray(rules) ? rules.length : 0}): ${JSON.stringify(rules ?? [])}.`;
  }
  if (verb === "mode") {
    if (!rest) throw new Error("/permission-system mode requires a mode name");
    const writer = (perm as Record<string, (...args: unknown[]) => Promise<unknown>>).writeMode;
    if (typeof writer !== "function") return undefined;
    await writer.call(perm, rest);
    return `OpenBuddy permission mode set to: ${rest}.`;
  }
  if (verb === "reload") {
    await callIfPresent(perm, ["reload", "refresh"]);
    return "OpenBuddy permission rules reloaded.";
  }
  return undefined;
}

export async function invokeGoalCommand(service: unknown, args: string): Promise<string | undefined> {
  const { verb, rest } = commandParts(args);
  if (!service || typeof service !== "object") return undefined;
  const team = service as Record<string, unknown>;
  if (!verb || verb === "list" || verb === "status") {
    const teams = await callIfPresent(team, ["list", "status"]);
    const count = Array.isArray(teams) ? teams.length : 0;
    return `OpenBuddy goal/team runner: ${count} active team(s).`;
  }
  if (verb === "show") {
    if (!rest) throw new Error("/goal show requires a team id");
    const getter = (team as Record<string, (...args: unknown[]) => Promise<unknown>>).get;
    if (typeof getter !== "function") return undefined;
    const detail = await getter.call(team, rest);
    return `Team ${rest}: ${JSON.stringify(detail)}.`;
  }
  if (verb === "stop") {
    if (!rest) throw new Error("/goal stop requires a team id");
    const stopper = (team as Record<string, (...args: unknown[]) => Promise<unknown>>).finish;
    if (typeof stopper !== "function") return undefined;
    await stopper.call(team, rest);
    return `Team ${rest} stopped.`;
  }
  return undefined;
}
