import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { DEFAULT_COMPACTION_SETTINGS, shouldCompact } from "@earendil-works/pi-agent-core";
import openBuddyApplyPatch, { type OpenBuddyApplyPatchConfig } from "./extensions/apply-patch";
import { sessionMetadataBridgeFactory } from "./extensions/session-metadata-bridge";
import { modelBridgeFactory } from "./extensions/model-bridge";
import { calendarPiFactory } from "./extensions/calendar-pi-extension";
import { isPiPackageInstalled } from "./pi-package-installed";
import {
  createTelemetryBridgeExtension,
  type OpenBuddyTelemetrySink,
} from "./pi-telemetry-bridge";
import {
  applyOpenBuddyPluginManifestPassthrough,
  openbuddyPluginManifestSchema,
  recordPassthrough,
  serializePiTrack,
  validateOpenBuddyPluginManifest,
  type OpenBuddyPiExtensionSpec,
  type OpenBuddyPluginManifest,
  type SerializedPiTrack,
} from "@openbuddy/plugin-host";
import { isServiceKey, type ServiceKey, type ServiceKeyResolver } from "./pi-service-keys";
import {
  registerAdapterTool,
  registerDescribeFallbackTool,
  type AdapterToolSpec,
} from "./pi-tool-bridge";
import {
  describeFsCommand,
  describeGoalCommand,
  describeMcpAuthCommand,
  describeMcpCommand,
  describePermissionSystemCommand,
  describePlanCommand,
  describeSessionCommand,
  describeTasksCommand,
  invokeFsCommand,
  invokeGoalCommand,
  invokeMcpCommand,
  invokePermissionSystemCommand,
  invokeSessionCommand,
  invokeTasksCommand,
  type CompatibilityCommandContext,
} from "./pi-compatibility-commands";

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
    // Phase I.1 — task decision: keep Cordis, drop the orphan PI tool.
    // The `openbuddy_tasks` tool was registered here as a Stage G-1d
    // experiment so the LLM could drive the per-session task list from
    // inside the agent loop, but every verb it delegated to already
    // existed as a slash command (`/tasks list|add|done|remove|clear`)
    // that users invoke directly. Keeping both surfaces confused the
    // LLM and doubled the codebase paths to maintain. The Cordis
    // `task` service (TaskService + openbuddy-core-plugin.ts `ctx.get("task")`)
    // now owns the surface exclusively, so this `tools` block is gone.
    //
    // Refs: docs/OPENBUDDY_PI_NATIVE_PLAN.md v3 §I.1
    // ("决策保留 Cordis（用户已在用），删 PI extension adapter（孤儿）").
    //
    // No `tools` here — the slash commands `/tasks` + `/todo` cover the
    // user-visible surface, and the Cordis `task` service remains the
    // canonical backend (see `electron/main/agent/host-modules/task-service.ts`).
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

/**
 * Phase K.2 — OpenBuddyPlugin manifest table for the 9 builtin extensions.
 *
 * Each entry is a Phase K.1 SDK `OpenBuddyPluginManifest` describing:
 *   - the canonical plugin id
 *   - a single `pi` track that resolves to the inline factory below
 *   - config defaults merged into the loadable track row
 *   - flags the resolver honours at load time (e.g. passthrough)
 *
 * The list is the source of truth for builtin metadata; `resolvePiExtensions`
 * routes every builtin lookup through `serializePiTrack` so the manifest is
 * the only shape the resolver has to read. Adding a new builtin is now two
 * edits (manifest row + factory row) instead of one, but the manifest is
 * testable in isolation and serialises deterministically.
 *
 * Per v6 §3.4 of OPENBUDDY_PI_NATIVE_PLAN.md, the SDK is a thin manifest
 * helper; the actual loading is still done by PI's `loadExtensions()`.
 */
export const BUILTIN_PI_PLUGIN_MANIFESTS: readonly OpenBuddyPluginManifest[] = [
  {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-apply-patch",
    packageName: "@openbuddy/builtin-apply-patch",
    version: "1.0.0",
    description: "Worktree-scoped patch tool that routes through `apply_patch` while trusting only the profile cwd.",
    tracks: [
      {
        kind: "pi",
        inline: "openbuddy-apply-patch",
        config: {
          schema: "openbuddy.apply-patch.v1",
          defaults: { dryRun: false },
        },
      },
    ],
  },
  {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-pi-observability",
    packageName: "@openbuddy/builtin-pi-observability",
    version: "1.0.0",
    description: "Forward every native Pi event the harness exposes into the plugin/event channel for the renderer.",
    tracks: [
      {
        kind: "pi",
        inline: "openbuddy-pi-observability",
        config: {
          schema: "openbuddy.pi-observability.v1",
          defaults: { toolEvents: true },
        },
      },
    ],
  },
  {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-pi-context-status",
    packageName: "@openbuddy/builtin-pi-context-status",
    version: "1.0.0",
    description: "Surface `context` / `turn_end` / `session_compact` snapshots to the renderer-side context panel.",
    tracks: [
      { kind: "pi", inline: "openbuddy-pi-context-status" },
    ],
  },
  {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-pi-context-guard",
    packageName: "@openbuddy/builtin-pi-context-guard",
    version: "1.0.0",
    description: "Reuse pi SDK `shouldCompact` to trigger `session_compact` when the context window crosses the configured threshold.",
    tracks: [
      {
        kind: "pi",
        inline: "openbuddy-pi-context-guard",
        config: {
          schema: "openbuddy.pi-context-guard.v1",
          defaults: { thresholdTokens: 100_000 },
        },
      },
    ],
  },
  {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-pi-telemetry-bridge",
    packageName: "@openbuddy/builtin-pi-telemetry-bridge",
    version: "1.0.0",
    description: "Forward pi span events to the OpenBuddy telemetry sink. No-ops when the sink has not been registered yet.",
    tracks: [
      { kind: "pi", inline: "openbuddy-pi-telemetry-bridge" },
    ],
  },
  {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-pi-compact-announce",
    packageName: "@openbuddy/builtin-pi-compact-announce",
    version: "1.0.0",
    description: "Inject a structured follow-up user message after every context compaction so the user sees the reclaim details.",
    tracks: [
      { kind: "pi", inline: "openbuddy-pi-compact-announce" },
    ],
  },
  {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-extra-providers",
    packageName: "@openbuddy/builtin-extra-providers",
    version: "1.0.0",
    description: "Register first-class providers for local Ollama, optional corporate proxy, and Orcarouter when the matching env vars are set.",
    tracks: [
      { kind: "pi", inline: "openbuddy-extra-providers" },
    ],
  },
  {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-pi-session-metadata",
    packageName: "@openbuddy/builtin-pi-session-metadata",
    version: "1.0.0",
    description: "Demonstrates the ExtensionAPI pattern for session metadata — reads the JSON mirror at session_start and forwards info changes.",
    tracks: [
      { kind: "pi", inline: "openbuddy-pi-session-metadata" },
    ],
  },
  {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-pi-model-bridge",
    packageName: "@openbuddy/builtin-pi-model-bridge",
    version: "1.0.0",
    description: "Observes model_select / set_model / before_provider_request without breaking the legacy installAgentModel() provider CRUD path.",
    tracks: [
      { kind: "pi", inline: "openbuddy-pi-model-bridge" },
    ],
  },
  {
    schema: openbuddyPluginManifestSchema,
    id: "openbuddy-pi-calendar",
    packageName: "@openbuddy/builtin-pi-calendar",
    version: "1.0.0",
    description: "Phase I.2 — register the calendar capability's 4 PI tools (calendar_list / calendar_create / calendar_update / calendar_remove) so the LLM can drive calendar operations through first-class pi tools rather than only slash commands / IPC.",
    tracks: [
      {
        kind: "pi",
        inline: "openbuddy-pi-calendar",
        config: {
          schema: "openbuddy.pi-calendar.v1",
          defaults: { readOnly: false },
        },
      },
    ],
  },
];

/**
 * Reverse lookup table mapping manifest id → manifest. Built once at module
 * load so `resolvePiExtensions` can answer "is this id a builtin?" in O(1)
 * without scanning the manifest list on every profile reload.
 */
export const BUILTIN_PI_PLUGIN_MANIFEST_BY_ID: ReadonlyMap<string, OpenBuddyPluginManifest> = new Map(
  BUILTIN_PI_PLUGIN_MANIFESTS.map((manifest) => [manifest.id, manifest]),
);

/**
 * Phase K.2 helper — returns the serialised PI track row for a builtin id,
 * or `undefined` when the id does not match a manifest entry. Callers use
 * the row to materialise a `loadExtensions()`-compatible descriptor without
 * re-reading the manifest. The resolver also threads manifest-level
 * `flags.passthrough` into the track config so the loader can decide
 * whether to skip the adapter path.
 */
export function resolveBuiltinPiPlugin(id: string): SerializedPiTrack | undefined {
  const manifest = BUILTIN_PI_PLUGIN_MANIFEST_BY_ID.get(id);
  if (!manifest) return undefined;
  const [row] = serializePiTrack(validateOpenBuddyPluginManifest(manifest));
  if (!row) return undefined;
  return applyOpenBuddyPluginManifestPassthrough(row, manifest);
}

// ─── Builtin extension registry (G10 PR 2) ──────────────────────────
// Round 18: introduce `registerBuiltinExtension(name, factory)` + the
// `BuiltinExtensionFactory` type so individual builtin entries can
// register themselves in one line. Previously the registry was a
// 250-line `Record<string, ...>` literal where each entry had to spell
// out the full `(emit, config, options) => ExtensionFactory` shape.
// The helper is intentionally trivial — `builtinPiExtensionFactories[name] =
// factory` — but the typed signature makes new builtins self-documenting
// and keeps the per-entry code a one-liner when the entry is a pure
// delegate (apply-patch, telemetry-bridge, etc.).
//
// Migration is incremental: the existing record literal still works for
// builtins that need bespoke wiring (observability, context-status,
// compact-announce, extra-providers, etc.). Round 19+ can refactor more
// of them if the helper earns its keep.

/** Per-builtin factory signature — `(emit, config, options) => ExtensionFactory`. */
export type BuiltinExtensionFactory = (
  emit: PiExtensionResolutionOptions["emit"],
  config: unknown,
  options: PiExtensionResolutionOptions,
) => ExtensionFactory;

/**
 * Register a builtin extension factory under `name`. Equivalent to
 * `builtinPiExtensionFactories[name] = factory` but typed — `name` is
 * a free-form string so unknown-name typos surface at the call site
 * (the registry is `Record<string, BuiltinExtensionFactory>` so a typo
 * would still compile, but the helper exists to make the intent
 * explicit and to give third-party extensions a stable API to register
 * themselves against).
 */
export function registerBuiltinExtension(
  name: string,
  factory: BuiltinExtensionFactory,
): void {
  builtinPiExtensionFactories[name] = factory;
}

export const builtinPiExtensionFactories: Record<string, BuiltinExtensionFactory> = {
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
      // Reuse pi SDK's canonical compaction decision (level-triggered) instead
      // of hand-rolling the threshold check. Combined with the edge-triggered
      // `crossed` guard so we only request compaction once per crossing, not on
      // every turn above the threshold. `threshold` is the context window here.
      const shouldCompactNow = shouldCompact(tokens, threshold, DEFAULT_COMPACTION_SETTINGS);
      if (!crossed || !shouldCompactNow || !context.compact) return;
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
    // Orcarouter.ai gateway — OpenAI Chat-Completions compatible aggregator
    // with 200+ upstream models and an `orcarouter/auto` routing mode.
    // Only registered when ORCAROUTER_API_KEY is set so the default
    // OpenBuddy install doesn't ship a placeholder. ORCAROUTER_BASE_URL
    // overrides the default endpoint for self-hosted Orcarouter instances.
    const orcarouterApiKey = process.env.ORCAROUTER_API_KEY;
    if (orcarouterApiKey) {
      const orcarouterBaseUrl = (process.env.ORCAROUTER_BASE_URL ?? "https://api.orcarouter.ai/v1").replace(/\/+$/, "");
      api.registerProvider("orcarouter", {
        baseUrl: orcarouterBaseUrl,
        apiKey: orcarouterApiKey,
        models: [],
      });
    }
  },

  // Phase B.1 — 5th builtin ExtensionFactory. Demonstrates the ExtensionAPI
  // pattern for session metadata. Reads the JSON mirror at session_start,
  // forwards info changes, leaves persistence to the existing host module.
  // Future B.2+ rounds will gradually migrate session-metadata.ts functions
  // to use this pattern directly.
  "openbuddy-pi-session-metadata": (_emit, _config, _options) => sessionMetadataBridgeFactory,

  // Phase B.1 round 2 — 6th builtin ExtensionFactory for model lifecycle
  // events. Demonstrates a second ExtensionAPI pattern that observes
  // model_select / set_model / before_provider_request without breaking
  // the legacy installAgentModel() provider CRUD path.
  "openbuddy-pi-model-bridge": (_emit, _config, _options) => modelBridgeFactory,

  // Phase I.2 — 10th builtin ExtensionFactory. Registers the calendar
  // capability's PI tools (calendar_list / calendar_create / calendar_update
  // / calendar_remove) so the LLM can drive calendar operations through
  // first-class pi tools. The Cordis `calendar` service (mounted by
  // capability-plugins.ts) remains the canonical backend; the tools
  // here just adapt the Cordis service surface to the PI ExtensionAPI.
  "openbuddy-pi-calendar": (_emit, _config, _options) => calendarPiFactory,
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
      // Phase K.2 — validate the builtin through the OpenBuddyPlugin SDK so
      // the manifest metadata (config defaults, passthrough flag) is honoured
      // uniformly. The factory is still resolved by id so the inline
      // implementations stay where they live today; the SDK only owns the
      // manifest shape (per v6 §3.4). When a manifest declares
      // `flags.passthrough`, surface it via `recordPassthrough` so the Cordis
      // capability plugin can short-circuit duplicate registrations.
      const serialized = resolveBuiltinPiPlugin(spec.id);
      if (serialized?.config?.passthrough === true) {
        // Builtin extensions are OpenBuddy-native, so the manifest-level
        // passthrough flag maps to the "opted-in" PassthroughSource. The
        // capability key prefixes the builtin id so downstream adapters
        // can distinguish manifest-driven from auto-detected passthroughs.
        recordPassthrough(`builtin:${spec.id}`, "opted-in", spec.id);
      }
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
