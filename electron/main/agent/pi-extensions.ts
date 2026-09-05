import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import openBuddyApplyPatch, { type OpenBuddyApplyPatchConfig } from "./extensions/apply-patch";
import { isPiPackageInstalled } from "./pi-package-installed";
import {
  createTelemetryBridgeExtension,
  type OpenBuddyTelemetrySink,
} from "./pi-telemetry-bridge";
import { recordPassthrough } from "@openbuddy/plugin-host";
import type { OpenBuddyPiExtensionSpec } from "@openbuddy/plugin-host";
import { isServiceKey, type ServiceKey, type ServiceKeyResolver } from "./pi-service-keys";
import {
  registerAdapterTool,
  registerDescribeFallbackTool,
  type AdapterToolSpec,
} from "./pi-tool-bridge";

export interface PiExtensionResolutionOptions {
  profileDir: string;
  resolveSource: (source: string) => string;
  emit: (type: string, payload: unknown) => void;
  /**
   * Sink the OpenBuddy telemetry bridge forwards pi span events to. When
   * omitted (e.g. during cold boot before any provider is registered) the
   * bridge no-ops so it can never break agent startup.
   */
  telemetrySink?: OpenBuddyTelemetrySink;
  /**
   * Resolves an OpenBuddy canonical service by typed service key. The
   * adapter uses this to delegate adapter-owned commands to the existing
   * OpenBuddy service without re-importing the third-party package. The
   * resolver may return undefined when the canonical service has not been
   * mounted yet (e.g. before profile bootstrap); the adapter then falls
   * back to a notification explaining the projection.
   */
  resolveService?: ServiceKeyResolver;
}

interface CompatibilityCommandContext {
  cwd?: string;
  sessionManager?: { getSessionId?: () => string };
}

export interface PiExtensionResolution {
  factories: Array<{ name: string; factory: ExtensionFactory; hidden: true }>;
  paths: string[];
  resolved: Array<{ id: string; source: string; builtIn: boolean; mode?: "native" | "adapter"; adapter?: string; commands?: readonly string[] }>;
  diagnostics: Array<{ id: string; state: "disabled" | "failed"; error?: string }>;
}

export type PiExtensionRuntimeState = "pending" | "loaded" | "disabled" | "failed";

export interface PiExtensionStatus {
  id: string;
  name: string;
  kind: "pi";
  state: PiExtensionRuntimeState;
  source?: string;
  builtIn?: boolean;
  /** Profile-declared extensions can be persisted; auto-discovered extensions cannot. */
  managed?: boolean;
  /** Pi ResourceLoader trust scope for auto-discovered resources. */
  sourceScope?: "user" | "project" | "temporary";
  /** Whether Pi discovered the resource from a package manifest or top-level path. */
  sourceOrigin?: "package" | "top-level";
  /** Package root used by Pi to resolve the resource, when available. */
  sourceBaseDir?: string;
  /** `adapter` means the package is represented by an existing OpenBuddy capability owner. */
  mode?: "native" | "adapter";
  adapter?: string;
  /** Slash commands the compatibility adapter projects onto Pi. */
  commands?: readonly string[];
  /** Runtime health combines loader errors and dependency diagnostics. */
  health?: "healthy" | "degraded" | "failed";
  /** Package identity when the extension came from a profile/package root. */
  packageName?: string;
  /** Published package version, when available from the package manifest. */
  version?: string;
  /** Sanitized diagnostics associated with the extension load. */
  diagnostics?: readonly string[];
  /** Stable reason for a non-loaded extension state. */
  disabledReason?: "user" | "policy" | "load-failed";
  /** Runtime artifact counts exposed by Pi's native loader. */
  toolCount?: number;
  hookCount?: number;
  loadedAt?: string;
  error?: string;
}

export interface PiExtensionLoadRecord {
  path: string;
  resolvedPath?: string;
  hidden?: boolean;
  sourceInfo?: {
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}

export interface PiExtensionLoadError {
  path: string;
  error: string;
}

export function piExtensionsResolvedPayload(
  resolution: Pick<PiExtensionResolution, "factories" | "paths" | "resolved">,
): {
  builtins: string[];
  paths: string[];
  availableBuiltins: string[];
  commands: string[];
} {
  return {
    builtins: resolution.factories.map((extension) => extension.name),
    paths: [...resolution.paths],
    availableBuiltins: builtinPiExtensionIds(),
    commands: resolution.resolved
      .filter((entry) => entry.mode === "adapter" && entry.commands && entry.commands.length > 0)
      .flatMap((entry) => entry.commands ?? []),
  };
}

/** Merge Pi's actual ResourceLoader result into the profile status projection. */
export function mergePiExtensionStatuses(
  statuses: readonly PiExtensionStatus[],
  loaded: readonly PiExtensionLoadRecord[],
  errors: readonly PiExtensionLoadError[],
): PiExtensionStatus[] {
  const result = statuses.filter((status) => status.managed !== false).map((status) => ({ ...status }));
  const findBySource = (source: string, sourceBaseDir?: string) => {
    const exact = result.findIndex((status) => status.source === source || status.id === source);
    if (exact >= 0) return exact;
    if (!sourceBaseDir) return -1;
    return result.findIndex((status) => status.source === sourceBaseDir && status.sourceBaseDir === sourceBaseDir);
  };
  for (const extension of loaded) {
    if (extension.hidden) continue;
    const source = extension.resolvedPath ?? extension.path;
    const sourceInfo = extension.sourceInfo;
    const index = findBySource(source, sourceInfo?.baseDir);
    const sourceMetadata = sourceInfo ? {
      sourceScope: sourceInfo.scope,
      sourceOrigin: sourceInfo.origin,
      ...(sourceInfo.baseDir ? { sourceBaseDir: sourceInfo.baseDir } : {}),
    } : {};
    if (index >= 0) {
      const current = result[index]!;
      result[index] = { ...current, state: "loaded", source, managed: current.managed ?? true, disabledReason: undefined, ...sourceMetadata };
    } else {
      result.push({ id: source, name: extension.path, kind: "pi", state: "loaded", source, builtIn: false, managed: false, ...sourceMetadata });
    }
  }
  for (const failure of errors) {
    const index = findBySource(failure.path);
    if (index >= 0) {
      result[index] = { ...result[index]!, state: "failed", health: "failed", disabledReason: "load-failed", error: failure.error, diagnostics: [failure.error] };
    } else {
      result.push({ id: failure.path, name: failure.path, kind: "pi", state: "failed", source: failure.path, builtIn: false, managed: false, health: "failed", disabledReason: "load-failed", diagnostics: [failure.error], error: failure.error });
    }
  }
  return result;
}

type ExtensionEventApi = {
  on: (event: string, handler: (payload: unknown, context: PiExtensionContextApi) => unknown) => void;
};

type PiExtensionContextApi = {
  getContextUsage?: () => { tokens?: number; contextWindow?: number; percent?: number } | undefined;
  compact?: (options?: { customInstructions?: string }) => void;
};

interface PiCompatibilityAdapter {
  packageNames: readonly string[];
  capability: string;
  /**
   * Cordis service key the adapter delegates to. The owner label is
   * surfaced in the inventory; serviceKey is what the resolver looks up
   * against `state.context.get(...)`. They can be equal but not always:
   * the mcp-client exposes a richer surface than the bare
   * `openbuddy-mcp-client` name in some bundles.
   */
  owner: string;
  serviceKey: ServiceKey;
  /**
   * Recommended npm package the user can install to release this adapter
   * (i.e. opt into `passthrough: true` and run the native Pi extension).
   * Surfaced in markdown inventory and adapter diagnostics so users know
   * which third-party package unlocks the upstream behavior.
   */
  piPackageHint?: string;
  /**
   * Slash commands the adapter projects onto Pi. The names mirror the
   * third-party packages so existing muscle memory keeps working; the
   * handlers delegate to the OpenBuddy canonical service instead of
   * importing the third-party module.
   */
  commands: readonly CompatibilityCommandSpec[];
  /**
   * When true, OpenBuddy lets the matching Pi package run natively (no
   * adapter substitution) and only falls back to the canonical service
   * if the package is unavailable. Reserved for the highest-traffic Pi
   * packages (`pi-mcp-adapter`, `pi-web-access`, `pi-subagents`,
   * `pi-todo`) so the open-source WorkBuddy stays compatible with the
   * broader pi.dev ecosystem instead of silently rewriting user installs.
   *
   * Each adapter entry stays registered so uninstalled/legacy installs
   * continue to see the OpenBuddy command surface — switching to native
   * only happens when the spec opts in via `passthrough: true`.
   */
  passthrough?: boolean;
  /**
   * Stage G-1d: each adapter can additionally expose one or more real pi
   * tools (LLM-callable) by listing a `tools` array. The bridge in
   * `pi-tool-bridge.ts` wraps the existing invokeInvocation handler so the
   * LLM can drive the canonical OpenBuddy service from inside the agent
   * loop — not just via slash commands. When the array is omitted, the
   * adapter only registers the human-facing slash command (pre-G-1d
   * behavior preserved).
   */
  tools?: readonly AdapterToolSpec[];
}

export interface CompatibilityCommandSpec {
  name: string;
  description: string;
  /** Optional human-readable hint shown in slash-command autocomplete. */
  argumentHint?: string;
  /**
   * Produces the notification body for a slash-command invocation. Receives
   * the canonical service resolved from options.resolveService (or undefined
   * if the service has not been mounted yet) and the raw arg string.
   * Implementations should always return a string so the handler has
   * something to pass to ctx.ui.notify.
   */
  describeInvocation: (service: unknown, args: string) => string | Promise<string>;
  /** Executes the command against the canonical service when the verb is supported. */
  invokeInvocation?: (service: unknown, args: string, context: CompatibilityCommandContext) => Promise<string | undefined>;
}

const compatibilityAdapters: readonly PiCompatibilityAdapter[] = [
  {
    packageNames: ["pi-mcp-adapter"],
    capability: "mcp",
    owner: "openbuddy-mcp-client",
    serviceKey: "mcpClient",
    passthrough: true,
    piPackageHint: "pi-mcp-adapter",
    commands: [
      {
        name: "mcp",
        description: "OpenBuddy projects the pi-mcp-adapter command onto the canonical openbuddy-mcp-client service.",
        argumentHint: "[list | reload | status | reconnect <server> | disable <server> | enable <server> | tools | setup <server> | logout <server>]",
        describeInvocation: (service, args) => describeMcpCommand(service, args),
        invokeInvocation: invokeMcpCommand,
      },
      {
        name: "pi-mcp",
        description: "Alias of /mcp; OpenBuddy keeps one canonical MCP backend.",
        argumentHint: "[list | reload | status | tools]",
        describeInvocation: (service, args) => describeMcpCommand(service, args),
        invokeInvocation: invokeMcpCommand,
      },
      {
        name: "mcp-auth",
        // Stage G-1d: mcp-auth has no real invokeInvocation because OAuth
        // flows must be triggered from the WorkBuddy settings UI (the
        // legacy describe text is preserved as the canonical fallback).
        description: "OpenBuddy projects pi-mcp-adapter auth onto the openbuddy-mcp-client OAuth helper.",
        argumentHint: "<server-name>",
        describeInvocation: (service, args) => describeMcpAuthCommand(service, args),
      },
    ],
    // Stage G-1d: register one real pi tool so the LLM can drive the MCP
    // canonical service from inside the agent loop (list/reload/status).
    tools: [
      {
        name: "openbuddy_mcp",
        description: "Inspect the OpenBuddy MCP canonical service: list servers, reload config, fetch server status, or list tools exposed by a configured server.",
        parameters: Type.Object({
          verb: Type.Union([
            Type.Literal("list"),
            Type.Literal("reload"),
            Type.Literal("status"),
            Type.Literal("tools"),
          ]),
          server: Type.Optional(Type.String()),
        }),
        serializeArgs: (args: unknown) => {
          const a = args as { verb: string; server?: string };
          return a.server ? `${a.verb} ${a.server}` : a.verb;
        },
      },
    ],
  },
  {
    packageNames: ["pi-permission-system"],
    capability: "permission",
    owner: "openbuddy-authorization",
    serviceKey: "permission",
    passthrough: true,
    piPackageHint: "pi-permission-system",
    commands: [
      {
        name: "permission-system",
        description: "OpenBuddy projects pi-permission-system onto the canonical openbuddy-permission service.",
        argumentHint: "[status | rules | mode <name> | reload]",
        describeInvocation: (service, args) => describePermissionSystemCommand(service, args),
        invokeInvocation: invokePermissionSystemCommand,
      },
    ],
    // Stage G-1d: real pi tool so the LLM can inspect the canonical
    // permission mode + rule set from inside the agent loop.
    tools: [
      {
        name: "openbuddy_permissions",
        description: "Inspect the OpenBuddy canonical permission policy: read current mode and the persisted rule list.",
        parameters: Type.Object({
          verb: Type.Union([
            Type.Literal("status"),
            Type.Literal("rules"),
          ]),
        }),
        serializeArgs: (args: unknown) => (args as { verb: string }).verb,
      },
    ],
  },
  {
    packageNames: ["pi-goal", "pi-goal-x", "@narumitw/pi-goal"],
    capability: "goal",
    owner: "openbuddy-team",
    serviceKey: "team",
    passthrough: true,
    piPackageHint: "pi-goal",
    commands: [
      {
        name: "goal",
        description: "OpenBuddy projects pi-goal onto the canonical openbuddy-team runner.",
        argumentHint: "[status | list | show <id> | stop <id>]",
        describeInvocation: (service, args) => describeGoalCommand(service, args),
        invokeInvocation: invokeGoalCommand,
      },
    ],
    // Stage G-1d: real pi tool so the LLM can list active teams and
    // inspect a specific team from inside the agent loop.
    tools: [
      {
        name: "openbuddy_goals",
        description: "Inspect the OpenBuddy canonical goal/team runner: list active teams or fetch the details of a specific team id.",
        parameters: Type.Object({
          verb: Type.Union([
            Type.Literal("list"),
            Type.Literal("status"),
            Type.Literal("show"),
          ]),
          target: Type.Optional(Type.String()),
        }),
        serializeArgs: (args: unknown) => {
          const a = args as { verb: string; target?: string };
          return a.target ? `${a.verb} ${a.target}` : a.verb;
        },
      },
    ],
  },
  {
    packageNames: ["pi-plan-mode", "@narumitw/pi-plan-mode", "@arvoretech/pi-plan-mode", "@plannotator/pi-extension"],
    capability: "plan",
    owner: "pi-plan-mode",
    serviceKey: "plan",
    passthrough: true,
    piPackageHint: "pi-plan-mode",
    commands: [
      {
        name: "plan",
        description: "OpenBuddy delegates plan-mode to pi-plan-mode (27k weekly) natively; @plannotator handles interactive review when installed.",
        argumentHint: "[status | show | enable | disable | set <text>]",
        describeInvocation: (service, args) => describePlanCommand(service, args),
      },
    ],
  },
  {
    packageNames: ["pi-todo", "pi-tasks", "pi-tasklist", "@narumitw/pi-todo", "@anthropic/pi-todo"],
    capability: "task",
    owner: "openbuddy-task",
    serviceKey: "task",
    passthrough: true,
    piPackageHint: "@juicesharp/rpiv-todo",
    commands: [
      {
        name: "tasks",
        description: "WorkBuddy projects pi-todo onto @juicesharp/rpiv-todo (37k weekly downloads) when available; otherwise the bundled pi todo tool owns the user-visible surface.",
        argumentHint: "[list | add <content> | done <id> | remove <id> | clear]",
        describeInvocation: (service, args) => describeTasksCommand(service, args),
        invokeInvocation: invokeTasksCommand,
      },
      {
        name: "todo",
        description: "Alias of /tasks.",
        argumentHint: "[list | add <content> | done <id> | remove <id> | clear]",
        describeInvocation: (service, args) => describeTasksCommand(service, args),
        invokeInvocation: invokeTasksCommand,
      },
    ],
    // Stage G-1d: real pi tool so the LLM can drive the per-session task
    // list from inside the agent loop.
    tools: [
      {
        name: "openbuddy_tasks",
        description: "Manage the per-session OpenBuddy task list: list, add, complete, remove, or clear tasks.",
        parameters: Type.Object({
          verb: Type.Union([
            Type.Literal("list"),
            Type.Literal("add"),
            Type.Literal("done"),
            Type.Literal("remove"),
            Type.Literal("clear"),
          ]),
          content: Type.Optional(Type.String()),
          taskId: Type.Optional(Type.String()),
        }),
        serializeArgs: (args: unknown) => {
          const a = args as { verb: string; content?: string; taskId?: string };
          if (a.verb === "add") return a.content ? `add ${a.content}` : "add";
          if (a.verb === "done" || a.verb === "remove") return a.taskId ? `${a.verb} ${a.taskId}` : a.verb;
          return a.verb;
        },
      },
    ],
  },
  {
    packageNames: ["pi-session", "pi-sessions", "pi-history", "pi-bookmark", "pi-session-manager", "@anthropic/pi-session"],
    capability: "session",
    owner: "openbuddy-session",
    serviceKey: "sessions",
    // P-3: passthrough when pi-session (or any alias in packageNames) is
    // installed; otherwise the Cordis openbuddy-session service still
    // owns the surface. The compat adapter's installed detection
    // (isPiPackageInstalled) returns false for packages that are not in
    // root node_modules OR <agentHome>/plugins/<name>/, so the Cordis
    // fallback path stays active until the user actually installs pi-session.
    passthrough: true,
    piPackageHint: "pi-session",
    commands: [
      {
        name: "sessions",
        description: "OpenBuddy projects pi-session onto the canonical openbuddy-session service.",
        argumentHint: "[list | workspaces | pin <id> | unpin <id> | archive <id> | unarchive <id>]",
        describeInvocation: (service, args) => describeSessionCommand(service, args),
        invokeInvocation: invokeSessionCommand,
      },
      {
        name: "history",
        description: "Alias of /sessions; OpenBuddy keeps one canonical session ledger per workspace.",
        argumentHint: "[list | workspaces | pin <id> | unpin <id> | archive <id> | unarchive <id>]",
        describeInvocation: (service, args) => describeSessionCommand(service, args),
        invokeInvocation: invokeSessionCommand,
      },
    ],
    // Stage G-1d: register one real pi tool so the LLM can drive the
    // session ledger from inside the agent loop. /sessions and /history
    // remain registered for muscle-memory parity; both delegate to the
    // same invokeSessionCommand handler.
    tools: [
      {
        name: "openbuddy_sessions",
        description: "Manage OpenBuddy session ledger: list / pin / archive across workspaces.",
        parameters: Type.Object({
          verb: Type.Union([
            Type.Literal("list"),
            Type.Literal("workspaces"),
            Type.Literal("pin"),
            Type.Literal("unpin"),
            Type.Literal("archive"),
            Type.Literal("unarchive"),
          ]),
          target: Type.Optional(Type.String()),
        }),
        // Narrow inside the lambda; the bridge signature accepts unknown
        // because TypeBox Static collapses nested Union/Optional.
        serializeArgs: (args: unknown) => {
          const a = args as { verb: string; target?: string };
          return a.target ? `${a.verb} ${a.target}` : a.verb;
        },
      },
    ],
  },
  {
    packageNames: ["pi-fs", "pi-filesystem", "pi-fs-tools", "pi-file-tools", "pi-filetree", "@anthropic/pi-fs"],
    capability: "fs",
    owner: "openbuddy-fs-local",
    serviceKey: "fsLocal",
    // P-3: passthrough when pi-fs (or any alias) is installed; otherwise
    // the Cordis openbuddy-fs-local service owns the surface. The compat
    // adapter treats passthrough=true as "passthrough IF installed" — the
    // installed detection probe walks both root node_modules and the
    // marketplace <agentHome>/plugins/<name> tree (R-X1).
    passthrough: true,
    piPackageHint: "pi-fs",
    commands: [
      {
        name: "fs",
        description: "OpenBuddy projects pi-fs onto the canonical openbuddy-fs-local service.",
        argumentHint: "[list <path> | stat <path> | read <path> | open <path> | reveal <path> | mkdir <path>]",
        describeInvocation: (service, args) => describeFsCommand(service, args),
        invokeInvocation: invokeFsCommand,
      },
      {
        name: "files",
        description: "Alias of /fs; OpenBuddy keeps one canonical workspace-scoped filesystem facade.",
        argumentHint: "[list <path> | stat <path> | read <path> | open <path> | reveal <path> | mkdir <path>]",
        describeInvocation: (service, args) => describeFsCommand(service, args),
        invokeInvocation: invokeFsCommand,
      },
    ],
    // Stage G-1d: real pi tool so the LLM can drive the workspace-scoped
    // filesystem facade from inside the agent loop.
    tools: [
      {
        name: "openbuddy_fs",
        description: "Operate on the OpenBuddy workspace-scoped filesystem facade: list directories, stat paths, read text files, open paths in the OS shell, reveal in Finder/Explorer, or create directories.",
        parameters: Type.Object({
          verb: Type.Union([
            Type.Literal("list"),
            Type.Literal("stat"),
            Type.Literal("read"),
            Type.Literal("open"),
            Type.Literal("reveal"),
            Type.Literal("mkdir"),
          ]),
          path: Type.Optional(Type.String()),
        }),
        serializeArgs: (args: unknown) => {
          const a = args as { verb: string; path?: string };
          return a.path ? `${a.verb} ${a.path}` : a.verb;
        },
      },
    ],
  },
  // pi-plugin-reuse-batch / A4: white-listed zero-cost pi extensions. Each
  // adapter block exists only to surface the package as a known surface in
  // `builtinPiExtensionIds`; `passthrough: true` + auto-detect lets the
  // native pi package run whenever the user installs it.
  {
    packageNames: ["pi-lens"],
    capability: "lens",
    owner: "pi-lens",
    serviceKey: "lens",
    passthrough: true,
    piPackageHint: "pi-lens",
    commands: [],
  },
  {
    packageNames: ["pi-simplify"],
    capability: "simplify",
    owner: "pi-simplify",
    serviceKey: "simplify",
    passthrough: true,
    piPackageHint: "pi-simplify",
    commands: [],
  },
  {
    packageNames: ["pi-hashline-edit-pro", "pi-hashline-edit"],
    capability: "hashline",
    owner: "pi-hashline-edit-pro",
    serviceKey: "hashline",
    passthrough: true,
    piPackageHint: "pi-hashline-edit-pro",
    commands: [],
  },
  {
    packageNames: ["@dietrichgebert/ponytail", "ponytail"],
    capability: "worktree",
    owner: "@dietrichgebert/ponytail",
    serviceKey: "worktree",
    passthrough: true,
    piPackageHint: "@dietrichgebert/ponytail",
    commands: [],
  },
  // Stage H-4: openbuddy-automation removed (Stage G-1c). The canonical
  // automation backplane is now `pi-goal-list-loop-audit` (npm 18,959
  // downloads/month, source of truth for goal-loop queue + audit). When
  // the package is installed the native loader is auto-detected and
  // `findCompatibilityAdapter` short-circuits the Cordis mount; the
  // legacy `automations:*` IPC channels throw a migration message
  // pointing users at this package (see misc.ts:442-461).
  {
    packageNames: ["pi-goal-list-loop-audit"],
    capability: "automation",
    owner: "pi-goal-list-loop-audit",
    serviceKey: "automation",
    passthrough: true,
    piPackageHint: "pi-goal-list-loop-audit",
    commands: [],
  },
];

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

async function describeMcpCommand(service: unknown, args: string): Promise<string> {
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

async function describeMcpAuthCommand(service: unknown, args: string): Promise<string> {
  const serverName = args.trim();
  if (!serverName) return "OpenBuddy MCP auth: pass a server name, e.g. /mcp-auth filesystem.";
  if (!service) return `OpenBuddy MCP auth for ${serverName} is not ready; the openbuddy-mcp-client service is not mounted yet.`;
  const authorizer = (service as Record<string, unknown>).authorize;
  if (typeof authorizer !== "function") return `OpenBuddy MCP auth for ${serverName} requires interactive OAuth; trigger it from the WorkBuddy settings panel instead of this RPC command.`;
  return `OpenBuddy MCP auth for ${serverName} is delegated to openbuddy-mcp-client.authorize; interactive prompts are surfaced through the WorkBuddy UI.`;
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

async function describePermissionSystemCommand(service: unknown, args: string): Promise<string> {
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

async function describeGoalCommand(service: unknown, args: string): Promise<string> {
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

async function describePlanCommand(service: unknown, args: string): Promise<string> {
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

async function describeTasksCommand(service: unknown, args: string): Promise<string> {
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

async function describeSessionCommand(service: unknown, args: string): Promise<string> {
  const verb = args.trim().split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
  if (!verb || verb === "list") {
    return "OpenBuddy session ledger is delegated to openbuddy-session; WorkBuddy's Sidebar renders the same set, pinned and archived states round-trip through ~/.pi/agent/sessions.";
  }
  if (verb === "workspaces") return "OpenBuddy workspace discovery is delegated to openbuddy-session.listWorkspaces; groups every cwd in the session store by session count.";
  if (verb === "pin" || verb === "unpin") return `OpenBuddy pin toggle is delegated to openbuddy-session.setPinned; /sessions ${verb} is an alias for setPinned(<id>, ${verb === "pin"}).`;
  if (verb === "archive" || verb === "unarchive") return `OpenBuddy archive toggle is delegated to openbuddy-session.setArchived; /sessions ${verb} is an alias for setArchived(<id>, ${verb === "archive"}).`;
  return `OpenBuddy does not load pi-session natively; command '/sessions ${args.trim()}' is delegated to openbuddy-session.`;
}

async function describeFsCommand(service: unknown, args: string): Promise<string> {
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

async function invokeTasksCommand(service: unknown, args: string, context: CompatibilityCommandContext): Promise<string | undefined> {
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

async function invokeSessionCommand(service: unknown, args: string, context: CompatibilityCommandContext): Promise<string | undefined> {
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

async function invokeFsCommand(service: unknown, args: string, context: CompatibilityCommandContext): Promise<string | undefined> {
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

async function invokeMcpCommand(service: unknown, args: string): Promise<string | undefined> {
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

async function invokePermissionSystemCommand(service: unknown, args: string): Promise<string | undefined> {
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

async function invokeGoalCommand(service: unknown, args: string): Promise<string | undefined> {
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

function packageNameFromSource(source: string): string {
  const normalized = source.replaceAll("\\", "/").replace(/\/index(?:\.[cm]?[jt]sx?)?$/u, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.at(-2)?.startsWith("@")) return `${parts.at(-2)}/${parts.at(-1)}`;
  return parts.at(-1) ?? normalized;
}

/**
 * Pure structural lookup for a compatibility adapter by npm package name.
 *
 * Differs from `findCompatibilityAdapter(spec)` in two ways:
 *  1. Takes a bare npm package name instead of a full OpenBuddyPiExtensionSpec,
 *     so callers without a profile (e.g. the marketplace install flow) can
 *     pre-classify a package before writing profile.piExtensions.
 *  2. Does NOT call `recordPassthrough` and does NOT consult
 *     `isPiPackageInstalled` — it only answers "is there a registered adapter
 *     whose declared `packageNames` array contains this npm name?". The
 *     marketplace layer is responsible for translating that into the
 *     `passthrough: true` flag on the profile spec; the loader's existing
 *     passthrough machinery then runs at reload time.
 *
 * Returns `undefined` when no adapter matches. The marketplace flow treats
 * that as a no-op (the install is recorded in profile.bundles only).
 */
export function findCompatibilityAdapterForPackageName(packageName: string): PiCompatibilityAdapter | undefined {
  if (!packageName) return undefined;
  return compatibilityAdapters.find((entry) => entry.packageNames.includes(packageName));
}

function findCompatibilityAdapter(spec: OpenBuddyPiExtensionSpec): PiCompatibilityAdapter | undefined {
  const candidates = [spec.id, spec.source].filter((value): value is string => Boolean(value)).map(packageNameFromSource);
  const adapter = compatibilityAdapters.find((entry) => entry.packageNames.some((name) => candidates.includes(name)));
  if (!adapter) return undefined;
  // P0 passthrough: a passthrough-eligible adapter is skipped when either
  // (a) the spec explicitly opts in via `passthrough: true`, or
  // (b) the corresponding pi package is installed in the user's
  //     node_modules (auto passthrough, see `pi-package-installed.ts`).
  // An explicit `passthrough: false` always keeps the OpenBuddy adapter
  // as a hard fallback so users can opt out of the auto-detection.
  //
  // Stage D F1+F4: when we skip, record the decision in the shared
  // passthrough registry so the Cordis capability plugin can short-circuit
  // its `apply()` and avoid registering duplicate tools for the same
  // surface that the native Pi package now owns.
  if (adapter.passthrough === true && (spec as { passthrough?: boolean }).passthrough !== false) {
    const optedIn = (spec as { passthrough?: boolean }).passthrough === true;
    const installed = !optedIn && adapter.piPackageHint ? isPiPackageInstalled(adapter.piPackageHint) : false;
    if (optedIn || installed) {
      recordPassthrough(adapter.capability, optedIn ? "opted-in" : "installed", adapter.owner);
      return undefined;
    }
  }
  return adapter;
}

/**
 * Static inventory of every slash command the compatibility adapter projects
 * onto Pi. Exported for documentation, inventory projection, and tests; it
 * does not register commands on its own.
 */
export function describeCompatibilityAdapterCommands(): Array<CompatibilityCommandSpec & { capability: string; owner: string }> {
  return compatibilityAdapters.flatMap((adapter) =>
    adapter.commands.map((command) => ({ ...command, capability: adapter.capability, owner: adapter.owner })),
  );
}

/**
 * Markdown section for the system prompt that documents every adapter-projected
 * slash command. Returns an empty string when no adapters are registered so
 * the host can skip the section cleanly. Each entry is grouped by capability
 * (MCP, web, permission, memory, goal, plan) and includes the
 * command name, description, and OpenBuddy canonical service that backs it.
 */
export function describeCompatibilityAdapterCommandsMarkdown(
  activeAdapters: readonly string[] = [],
): string {
  if (activeAdapters.length === 0) return "";
  const sections: string[] = [
    "## Pi 扩展兼容投影",
    "",
    "OpenBuddy 通过同名的 slash command 接管下列 Pi 扩展家族。当 `passthrough` 标记为 true 且 spec 声明 `passthrough: true` 时，OpenBuddy 放行让 Pi 原生包运行；否则第三方包不被解析或执行，handler 委托给 `state.context.get(serviceKey)` 解析的 OpenBuddy canonical service，未挂载时回退到说明投影的友好提示。",
  ];
  for (const adapter of compatibilityAdapters) {
    if (!activeAdapters.some((id) => adapter.packageNames.includes(id) || id === adapter.capability)) continue;
    const passthroughTag = adapter.passthrough ? " (passthrough 可放行)" : "";
    const piPackageHint = adapter.piPackageHint ? ` — 安装 \`${adapter.piPackageHint}\` 后可在 spec 中加 \`passthrough: true\` 让原生 Pi 包接管` : "";
    sections.push("", `### \`${adapter.capability}\` → \`${adapter.owner}\` (serviceKey: \`${adapter.serviceKey}\`)${passthroughTag}${piPackageHint}`);
    for (const command of adapter.commands) {
      sections.push(`- \`/${command.name}\` — ${command.description}${command.argumentHint ? ` 参数提示：\`${command.argumentHint}\`` : ""}`);
    }
  }
  return sections.join("\n");
}

function createCompatibilityAdapterFactory(
  spec: OpenBuddyPiExtensionSpec,
  adapter: PiCompatibilityAdapter,
  options: PiExtensionResolutionOptions,
): ExtensionFactory {
  const emit = options.emit;
  return (pi) => {
    emit("pi/extension-adapted", {
      id: spec.id,
      capability: adapter.capability,
      owner: adapter.owner,
      reason: adapter.passthrough
        ? "OpenBuddy retains the canonical capability backend as a fallback for the passthrough Pi package"
        : "OpenBuddy keeps one canonical capability backend instead of loading a duplicate Pi backend",
      commands: adapter.commands.map((command) => command.name),
      tools: (adapter.tools ?? []).map((tool) => tool.name),
      passthrough: adapter.passthrough === true,
    });
    const api = pi as unknown as { registerCommand?: (name: string, options: { description?: string; argumentHint?: string; handler: (args: string, ctx: CompatibilityCommandContext & { ui: { notify: (message: string, level?: "info" | "warning" | "error") => void } }) => Promise<void> }) => void };
    if (typeof api.registerCommand !== "function") return;
    for (const command of adapter.commands) {
      api.registerCommand(command.name, {
        description: command.description,
        ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
        handler: async (args, ctx) => {
          let summary: string;
          try {
            // Resolve via the typed ServiceKey first. If the resolver
            // returns undefined (no service mounted yet) fall back to the
            // owner string — legacy callers key their service map by
            // owner name (e.g. "openbuddy-mcp-client"), so we preserve
            // that lookup path here even though owner is not itself a
            // typed ServiceKey in the new registry.
            const resolve = options.resolveService;
            const byKey = resolve ? resolve(adapter.serviceKey) : undefined;
            const byOwner = !byKey && resolve ? resolve(adapter.owner as ServiceKey) : undefined;
            const resolved = byKey ?? byOwner;
            summary = resolved && command.invokeInvocation
              ? await command.invokeInvocation(resolved, args, ctx) ?? await command.describeInvocation(resolved, args)
              : await command.describeInvocation(resolved, args);
          } catch (error) {
            summary = `OpenBuddy adapter /${command.name} failed: ${error instanceof Error ? error.message : String(error)}`;
          }
          ctx.ui.notify(summary, "info");
        },
      });
    }
    // Stage G-1d: register one pi tool per entry in adapter.tools so the
    // LLM can invoke the canonical OpenBuddy service from inside the
    // agent loop. We pick the first command with an invokeInvocation as
    // the handler (slash commands sharing the same verb set are aliases);
    // adapters without an invokeInvocation cannot back a tool so they are
    // skipped here.
    const toolSourceCommand = adapter.commands.find((command) => typeof command.invokeInvocation === "function");
    if (!toolSourceCommand || !toolSourceCommand.invokeInvocation) return;
    const resolveService = () => {
      const resolve = options.resolveService;
      if (!resolve) return undefined;
      const byKey = resolve(adapter.serviceKey);
      const byOwner = byKey ?? resolve(adapter.owner as ServiceKey);
      return byKey ?? byOwner;
    };
    for (const tool of adapter.tools ?? []) {
      registerAdapterTool(pi, tool, {
        invokeInvocation: toolSourceCommand.invokeInvocation,
        resolveService,
      });
    }
  };
}

function summaryPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return { valueType: typeof payload };
  const value = payload as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ["sessionId", "toolCallId", "toolName", "reason", "willRetry", "fromExtension", "name", "stopReason", "success"]) {
    if (typeof value[key] === "string" || typeof value[key] === "boolean") summary[key] = value[key];
  }
  for (const key of ["tokens", "contextWindow", "inputTokens", "outputTokens", "totalTokens"]) {
    if (typeof value[key] === "number" && Number.isFinite(value[key])) summary[key] = value[key];
  }
  if (Array.isArray(value.messages)) summary.messageCount = value.messages.length;
  if (Array.isArray(value.content)) summary.contentCount = value.content.length;
  return summary;
}

export const builtinPiExtensionFactories: Record<string, (emit: PiExtensionResolutionOptions["emit"], config: unknown, options: PiExtensionResolutionOptions) => ExtensionFactory> = {
  "openbuddy-apply-patch": (_emit, config, _options) => {
    const cfg = (config as Partial<OpenBuddyApplyPatchConfig> | undefined) ?? {};
    if (!cfg.trustedCwd) throw new Error("openbuddy-apply-patch: trustedCwd is required");
    return openBuddyApplyPatch({ trustedCwd: cfg.trustedCwd, dryRun: cfg.dryRun });
  },
  "openbuddy-pi-observability": ((emit, config, _options): ExtensionFactory => (pi: ExtensionAPI) => {
    const api = pi as unknown as ExtensionEventApi;
    const includeToolEvents = config && typeof config === "object" && "toolEvents" in config
      ? Boolean((config as { toolEvents?: unknown }).toolEvents)
      : true;
    const forward = (type: string) => (payload: unknown) => emit(`pi/${type}`, summaryPayload(payload));
    api.on("agent_start", forward("agent-start"));
    api.on("agent_end", forward("agent-end"));
    api.on("model_select", forward("model-select"));
    api.on("session_info_changed", forward("session-info-changed"));
    // MVP-4 — forward the native session_tree event so the renderer can
    // build a real branching UI without re-walking JSONL itself.
    api.on("session_tree", forward("session-tree"));
    // MVP-5 — surface session_before_fork to the renderer so it can prompt
    // the user for confirmation before branching commits.
    api.on("session_before_fork", forward("session-before-fork"));
    // MVP-7 — surface provider request/response hooks for cost/latency tracking.
    api.on("before_provider_request", forward("provider-request"));
    api.on("after_provider_response", forward("provider-response"));
    if (includeToolEvents) {
      api.on("tool_execution_start", forward("tool-start"));
      api.on("tool_execution_end", forward("tool-end"));
    }
  }),
  "openbuddy-pi-context-status": ((emit, _config, _options): ExtensionFactory => (pi: ExtensionAPI) => {
    const api = pi as unknown as ExtensionEventApi;
    api.on("context", (payload) => emit("pi/context", summaryPayload(payload)));
    api.on("turn_end", (_payload, context) => {
      const usage = context.getContextUsage?.();
      emit("pi/context-status", usage ? summaryPayload(usage) : { available: false });
    });
    api.on("session_compact", (payload) => emit("pi/context-compacted", summaryPayload(payload)));
  }),
  "openbuddy-pi-context-guard": (emit, config, _options) => (pi) => {
    const api = pi as unknown as ExtensionEventApi;
    const threshold = config && typeof config === "object" && typeof (config as { thresholdTokens?: unknown }).thresholdTokens === "number"
      ? Math.max(1, Number((config as { thresholdTokens: number }).thresholdTokens))
      : 100_000;
    let previousTokens: number | null = null;
    api.on("turn_end", (_payload, context) => {
      const usage = context.getContextUsage?.();
      const tokens = typeof usage?.tokens === "number" ? usage.tokens : null;
      if (tokens === null) return;
      const crossed = previousTokens !== null && previousTokens <= threshold && tokens > threshold;
      previousTokens = tokens;
      if (!crossed || !context.compact) return;
      emit("pi/context-compaction-requested", { thresholdTokens: threshold, tokens });
      context.compact();
    });
  },
  "openbuddy-pi-telemetry-bridge": (_emit, _config, options) => {
    if (!options?.telemetrySink) return () => {};
    return createTelemetryBridgeExtension(options.telemetrySink);
  },
  // MVP-8 — inject a structured follow-up user message after every context
  // compaction so the user can see exactly what just happened and how much
  // context was reclaimed. Uses pi.sendUserMessage which the SDK routes
  // through the normal message pipeline (visible in transcript + counted in
  // usage). No-op on older SDK builds that lack sendUserMessage.
  "openbuddy-pi-compact-announce": (_emit, _config, _options): ExtensionFactory => (pi) => {
    const api = pi as unknown as {
      on?: (event: string, handler: (payload: unknown) => void) => void;
      sendUserMessage?: (text: string, options?: { source?: string }) => void;
    };
    if (typeof api.on !== "function" || typeof api.sendUserMessage !== "function") return;
    api.on("session_compact", (raw) => {
      const ev = raw as {
        compactionEntry?: { tokensBefore?: number; tokensAfter?: number; summary?: string };
        reason?: "manual" | "threshold" | "overflow";
        willRetry?: boolean;
      };
      const before = ev.compactionEntry?.tokensBefore;
      const after = ev.compactionEntry?.tokensAfter;
      const reason = ev.reason ?? "manual";
      const willRetry = ev.willRetry ?? false;
      const reclaimed =
        typeof before === "number" && typeof after === "number" ? before - after : null;
      const lines: string[] = [];
      lines.push(`[OpenBuddy] 上下文已压缩 (${reason}${willRetry ? ", 将自动重试" : ""})`);
      if (reclaimed !== null && reclaimed > 0) {
        lines.push(`节省 tokens: ${reclaimed} (${before} → ${after})`);
      }
      const summary = ev.compactionEntry?.summary;
      if (typeof summary === "string" && summary.trim()) {
        const oneLine = summary.replace(/\s+/g, " ").trim();
        lines.push(`摘要: ${oneLine.length > 240 ? oneLine.slice(0, 240) + "…" : oneLine}`);
      }
      api.sendUserMessage!(lines.join("\n"), { source: "extension" });
    });
  },
  // MVP-6 — register first-class providers via pi.registerProvider().
  // Currently surfaces local Ollama (the most-requested missing provider)
  // and an optional corporate proxy when OPENBUDDY_PROXY_BASE_URL is set.
  // The models list is empty by design — pi's model discovery layer will
  // populate it on the next /v1/models fetch (see host-modules/agent-model.ts
  // providerCatalog). Both providers route through the openai-completions
  // protocol which the existing host-models mapping already handles.
  "openbuddy-extra-providers": (_emit, _config, _options): ExtensionFactory => (pi) => {
    const api = pi as unknown as { registerProvider?: (name: string, config: unknown) => void };
    if (typeof api.registerProvider !== "function") return;
    // Ollama — local, no auth, defaults to localhost:11434 unless OLLAMA_HOST
    // is set in the environment. Uses openai-completions protocol because
    // Ollama exposes an OpenAI-compatible /v1/chat/completions endpoint.
    const ollamaBaseUrl = (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
    api.registerProvider("ollama", {
      baseUrl: `${ollamaBaseUrl}/v1`,
      apiKey: "ollama",
      models: [],
    });
    // Optional corporate proxy — only registered when the env vars are set,
    // so the default OpenBuddy install doesn't ship a dummy provider.
    const proxyBaseUrl = process.env.OPENBUDDY_PROXY_BASE_URL;
    const proxyKey = process.env.OPENBUDDY_PROXY_KEY;
    if (proxyBaseUrl) {
      api.registerProvider("corp-proxy", {
        baseUrl: proxyBaseUrl.replace(/\/+$/, ""),
        apiKey: proxyKey ?? "",
        models: [],
      });
    }
  },
};

export function resolvePiExtensions(
  specs: readonly OpenBuddyPiExtensionSpec[],
  options: PiExtensionResolutionOptions,
): PiExtensionResolution {
  const result: PiExtensionResolution = { factories: [], paths: [], resolved: [], diagnostics: [] };
  for (const spec of specs) {
    if (!spec || typeof spec.id !== "string" || !spec.id.trim()) {
      result.diagnostics.push({ id: String(spec?.id ?? "<unknown>"), state: "failed", error: "Pi extension id is required" });
      continue;
    }
    if (spec.enabled === false) {
      result.diagnostics.push({ id: spec.id, state: "disabled" });
      continue;
    }
    const adapter = findCompatibilityAdapter(spec);
    if (adapter) {
      result.factories.push({
        name: `openbuddy-adapter:${spec.id}`,
        factory: createCompatibilityAdapterFactory(spec, adapter, options),
        hidden: true,
      });
      result.resolved.push({
        id: spec.id,
        source: `<adapter:${adapter.owner}>`,
        builtIn: true,
        mode: "adapter",
        adapter: adapter.owner,
        commands: adapter.commands.map((command) => command.name),
      });
      continue;
    }
    const builtin = builtinPiExtensionFactories[spec.id];
    if (builtin) {
      result.factories.push({ name: spec.id, factory: builtin(options.emit, spec.config, options), hidden: true });
      result.resolved.push({ id: spec.id, source: `<inline:${spec.id}>`, builtIn: true });
      continue;
    }
    if (!spec.source) {
      result.diagnostics.push({ id: spec.id, state: "failed", error: `Unknown Pi extension ${spec.id}; source is required` });
      continue;
    }
    try {
      const source = isAbsolute(spec.source) ? resolve(spec.source) : options.resolveSource(spec.source);
      result.paths.push(source);
      result.resolved.push({ id: spec.id, source, builtIn: false });
    } catch (error) {
      result.diagnostics.push({ id: spec.id, state: "failed", error: String(error) });
    }
  }
  return result;
}

export function applyPiExtensionOverrides(
  specs: readonly OpenBuddyPiExtensionSpec[],
  overrides: Record<string, { enabled?: boolean; config?: unknown; passthrough?: boolean }> | undefined,
): OpenBuddyPiExtensionSpec[] {
  return specs.map((spec) => {
    const override = overrides?.[spec.id];
    if (!override) return { ...spec };
    return {
      ...spec,
      ...(override.enabled === undefined ? {} : { enabled: override.enabled }),
      ...(override.config === undefined ? {} : { config: override.config }),
      ...(override.passthrough === undefined ? {} : { passthrough: override.passthrough }),
    };
  });
}

export function builtinPiExtensionIds(): string[] {
  return Object.keys(builtinPiExtensionFactories);
}
