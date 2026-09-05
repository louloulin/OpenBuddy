/**
 * ACP (Agent Client Protocol) wire types — TypeScript mirror of the subset
 * of `agent-client-protocol` messages OpenBuddy's Rust backend forwards to
 * the frontend as Electron-compatible events.
 *
 * Source of truth: the `agent-client-protocol` 0.10.4 crate (used by pi)
 * and the x.ai extensions documented in
 *   Pi notification extension
 *
 * The Rust backend serializes these with serde and emits them as the `payload`
 * of `pi://update` / `pi://permission` / `pi://complete` events.
 */

// ---------- content blocks ----------

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThoughtContent {
  type: "thought";
  text: string;
}

export interface DiffContent {
  type: "diff";
  diff: {
    path: string;
    old: string;
    new: string;
    /** Optional unified-diff style hunks when available. */
    hunks?: Array<{ old: { start: number; lines: string[] }; new: { start: number; lines: string[] } }>;
  };
}

export interface CommandOutputContent {
  type: "command_output";
  /** The shell command that was (or is being) run. */
  command?: string;
  /** Stdout+stderr captured so far. */
  output: string;
  exitCode?: number | null;
}

export type ToolCallContent = TextContent | DiffContent | CommandOutputContent;

// ---------- tool call status ----------

export type ToolCallStatus = "in_progress" | "completed" | "failed";

// Known pi tool kinds. The wire format allows unknown
// kinds too — render them generically.
export type ToolKind =
  | "read_file"
  | "edit"
  | "grep"
  | "list_dir"
  | "run_terminal_command"
  | "web_search"
  | "web_fetch"
  | "todo_write"
  | "spawn_subagent"
  | "memory_search"
  | string; // forward-compat

// ---------- session updates (the agent -> client stream) ----------

export interface AgentMessageChunk {
  type: "agent_message_chunk";
  content: TextContent[];
}

export interface UserMessageReplay {
  type: "user_message_replay";
  content: TextContent[];
}

export interface AgentThoughtChunk {
  type: "agent_thought_chunk";
  content: ThoughtContent[];
}

export interface ToolCallUpdate {
  type: "tool_call";
  toolCallId: string;
  title: string;
  kind: ToolKind;
  status: ToolCallStatus;
  /** Raw input the tool was invoked with, when the agent sends it inline. */
  rawInput?: unknown;
  content: ToolCallContent[];
}

export interface ToolCallDeltaUpdate {
  type: "tool_call_update";
  toolCallId: string;
  /** Partial field updates (e.g. streamed raw_input). */
  update: Record<string, unknown>;
}

export interface PlanUpdate {
  type: "plan";
  plan: Plan;
}

/** A pi execution plan (ACP `Plan`). Each update replaces the whole plan. */
export interface Plan {
  entries: PlanEntry[];
}

export interface PlanEntry {
  /** Human-readable description of this task. */
  content: string;
  /** "high" | "medium" | "low". */
  priority: PlanEntryPriority;
  /** "pending" | "in_progress" | "completed". */
  status: PlanEntryStatus;
}

export type PlanEntryPriority = "high" | "medium" | "low";
export type PlanEntryStatus = "pending" | "in_progress" | "completed";

export interface UsageUpdate {
  type: "usage_update";
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/** Catch-all for x.ai/pi extension session-update types not modeled above. */
export interface ExtensionSessionUpdate {
  type: string;
  [key: string]: unknown;
}

// ---------- context usage (x.ai/session/info + x.ai/session/usage) ----------

/** One itemized context-cost row from pi (skills listing, MCP servers). */
export interface TokenUsageCategory {
  /** Display label, e.g. "Skills" or "MCP servers". */
  label: string;
  tokens: number;
  /** Supporting detail, e.g. "21 skills". */
  detail?: string;
}

/**
 * Context-window snapshot from pi's `x.ai/session/info`
 * (`ContextInfo` in Pi agent runtime, camelCase on the wire).
 * Note: skills/MCP category estimates overlap `messageTokens` (they're
 * injected as system-reminders in messages), so category percentages are
 * approximate — the UI clamps the "其他" remainder at 0.
 */
export interface ContextInfo {
  used: number;
  /** Context window size of the active model. */
  total: number;
  usagePct: number;
  systemPromptTokens: number;
  toolDefinitionsCount: number;
  toolDefinitionsTokens: number;
  messageCount: number;
  messageTokens: number;
  turnCount: number;
  toolCallCount: number;
  compactionCount: number;
  freeTokens: number;
  autoCompactThresholdPercent?: number;
  usageCategories?: TokenUsageCategory[];
}

/** Wire response of `x.ai/session/info` (only the fields the UI consumes). */
export interface SessionInfoResponse {
  sessionId: string;
  cwd: string;
  model?: string | null;
  modelDisplayName?: string;
  context: ContextInfo;
}

/**
 * Cumulative session token usage from `x.ai/session/usage` (`PromptUsage`
 * totals, camelCase on the wire). `inputTokens` includes cache reads, so the
 * average cache hit rate is `cachedReadTokens / inputTokens`.
 */
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedReadTokens: number;
  numTurns?: number;
  usageIsIncomplete?: boolean;
}

export type SessionUpdate =
  | AgentMessageChunk
  | AgentThoughtChunk
  | ToolCallUpdate
  | ToolCallDeltaUpdate
  | PlanUpdate
  | UsageUpdate
  | ExtensionSessionUpdate;

// ---------- permissions ----------

export type PermissionKind = "allow" | "allow_always" | "deny";

export interface PermissionOption {
  optionId: string;
  kind: PermissionKind;
  title: string;
  id?: string;
}

export interface PermissionRequest {
  /** Echoed back in `pi_resolve_permission`. */
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolKind: ToolKind;
  title: string;
  /** Optional partial raw input to show the user what they're approving. */
  rawInput?: unknown;
  options: PermissionOption[];
}

// ---------- prompt completion ----------

export type StopReason =
  | "end_turn"
  | "max_turns"
  | "rate_limited"
  | "cancelled"
  | string;

export interface PromptComplete {
  sessionId: string;
  promptId: string;
  turnId?: number;
  stopReason: StopReason;
  cancelTrigger?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

// ---------- session metadata ----------

/** Lifecycle status for sidebar filtering, aligned with WorkBuddy's task filter.
 *  - "working": actively streaming a response
 *  - "completed": finished normally
 *  - "failed": errored during send/stream
 *  - "pending": created but no message sent yet
 *  - "planning": in plan mode / awaiting plan approval */
export type SessionStatus = "working" | "completed" | "failed" | "pending" | "planning";

export interface SessionSummary {
  sessionId: string;
  /** Human-readable title. Display priority matches pi's `display_title`:
   * `generated_title` (LLM-generated or manual /rename) > `session_summary`
   * (user's first prompt text). */
  title: string;
  /** ISO timestamp of last activity (`updated_at`, falling back to `last_active_at`). */
  updatedAt?: string;
  /** Working directory the session is bound to. */
  cwd: string;
  /** True if it's a git repo (inferred from `git_root_dir` in summary.json). */
  isGitRepo?: boolean;
  /** True if the session is pinned to the top of the list.
   *  OpenBuddy-only state (pi has no pinned field); stored in
   *  `~/.pi/openbuddy-state.json`. */
  pinned?: boolean;
  /** True if the session is archived (hidden from the sidebar).
   *  OpenBuddy-only state (pi has no archived field); stored in
   *  `~/.pi/openbuddy-state.json`. */
  archived?: boolean;
  /** Model id bound to this session, if recorded in summary.json. */
  currentModelId?: string;
  /** Expert id bound to this session (OpenBuddy-only state). */
  expertId?: string;
  /** Expert display name (OpenBuddy-only state). */
  expertName?: string;
  /** Expert local avatar path (OpenBuddy-only state). */
  expertAvatar?: string;
  /** Lifecycle status for sidebar task filtering. Absent = "completed". */
  status?: SessionStatus;
  /** Parent Pi session when this entry is a persisted Harness subagent. */
  parentSessionId?: string;
  /** Persisted subagent origin and execution mode. */
  origin?: "subagent";
  subagentMode?: "one-shot" | "continuable";
}

/** Payload of the `pi://summary` event — a freshly generated or renamed
 *  session title pushed by pi via `x.ai/session_notification`
 *  (`SessionSummaryGenerated` variant). */
export interface SessionSummaryEvent {
  sessionId: string;
  title: string;
}

// ---------- skills (x.ai/skills/*) ----------

/** One discovered skill. Mirrors pi's `SkillInfo`. */
export interface SkillInfo {
  name: string;
  displayName?: string;
  description?: string;
  /** Where the skill was discovered: "local" | "repo" | "user" | "server" | "bundled" | "plugin". */
  scope?: string;
  enabled: boolean;
  userInvocable?: boolean;
  /** Filesystem path to the skill directory (when available). */
  path?: string;
}

// ---------- connectors / MCP (x.ai/mcp/*) ----------

/** One MCP server config entry surfaced to the UI. */
export interface McpServerEntry {
  name: string;
  /** "stdio" | "streamable_http". */
  transport?: string;
  /** For stdio: command. For http: URL. */
  target?: string;
  enabled: boolean;
  /** "user" | "project" | "bundled" | ... */
  source?: string;
  disabledReason?: string;
  vendor?: string;
  runtimeStatus?: "connecting" | "ready" | "disabled" | "failed" | string;
  toolCount?: number;
  emailProfile?: "generic" | "qq-agent-mail" | "gmail" | "outlook" | "imap-smtp" | "jmap" | string;
  runtimeError?: string;
}

export interface McpRuntimeStatus {
  serverName: string;
  status: "connecting" | "ready" | "disabled" | "failed" | string;
  toolCount: number;
  error?: string;
}

/** Frontend payload for creating/updating an MCP server. */
export interface McpUpsertRequest {
  name: string;
  /** "stdio" or "http". */
  transport: string;
  /** stdio: command. http: URL. */
  target: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
}

/** Result of `mcp_auth_trigger` (browser OAuth flow driven by pi). */
export interface McpAuthTriggerResult {
  /** Terminal or in-flight state of the main-process authorization attempt. */
  status: "authenticated" | "cancelled" | "failed" | "pending" | "setup_required";
  error?: string;
}

/** One entry of `mcp_auth_status` — a server pi flagged as needing auth. */
export interface McpAuthStatusEntry {
  serverName: string;
  status: string;
}

// ---------- CLI-type connector authorization (cli.json driven) ----------

/** Probe result for a CLI connector (`connectors_cli_status`). */
export interface ConnectorCliStatus {
  hasSpec: boolean;
  /** versionCheck passed (CLI installed & new enough). */
  installed: boolean;
  cliVersion?: string;
  /** status command matches the authed pattern. */
  authed: boolean;
  /** UI hint: show the auth URL as a QR code. */
  qrModal: boolean;
  error?: string;
}

/** Result of the CLI authorization flow (`connectors_cli_auth`). */
export interface ConnectorCliAuthResult {
  ok: boolean;
  authed: boolean;
  error?: string;
}

/** `connector://cli-auth-url` event payload. */
export interface ConnectorCliAuthUrlEvent {
  source: string;
  url: string;
  qrModal: boolean;
  suppressBrowser: boolean;
}

/** `connector://cli-auth-log` event payload (CLI stdout/stderr tail). */
export interface ConnectorCliAuthLogEvent {
  source: string;
  line: string;
}

/** `connector://cli-auth-done` event payload. */
export interface ConnectorCliAuthDoneEvent {
  source: string;
  ok: boolean;
  authed: boolean;
  error?: string;
}

// ---------- experts / assistants (~/.pi/agents/*.md) ----------

/** One agent definition (subagent template). */
export interface AgentEntry {
  name: string;
  description?: string;
  /** "user" | "project". */
  scope: string;
  /** Absolute path to the `.md` file. */
  path: string;
  /** Full file contents (frontmatter + body), for the editor view. */
  raw: string;
  /** Avatar preset index 1-20 (WorkBuddy-style). Undefined = name-initial fallback. */
  avatar?: number;
  /** Model capability tags: subset of ["default", "multimodal", "reasoning"]. */
  modelTags?: string[];
}

// ---------- permission rules (~/.pi/config.toml [permission]) ----------

/** One permission rule. `action` ∈ allow|deny|ask; `tool` ∈ bash|read|edit|grep|mcp|any. */
export interface PermissionRule {
  action: string;
  tool: string;
  pattern?: string;
}

// ---------- memory (资料库 — ~/.pi/memory/) ----------

export interface MemoryEntry {
  /** "global" | "workspace". */
  scope: string;
  /** Relative path (e.g. "MEMORY.md"). */
  path: string;
  content: string;
  size: number;
}

// ---------- session search ----------

export interface SearchHit {
  sessionId: string;
  cwd?: string;
  title?: string;
  snippet?: string;
  rank?: number;
  updatedAt?: string;
}

// ---------- rewind ----------

export interface RewindPoint {
  promptIndex: number;
  promptPreview?: string;
  timestamp?: string;
  /** First assistant response snippet (for timeline display). */
  messagePreview?: string;
  /** Whether this prompt produced file changes. */
  hasFileChanges?: boolean;
  /** Whether this prompt produced memory writes. */
  hasMemoryChanges?: boolean;
  /** Tool calls made during this turn. */
  toolNames?: string[];
}

// ---------- slash commands + prompt history ----------

export interface SlashCommand {
  name: string;
  description?: string;
  argumentHint?: string;
  source?: string;
  /** True when the command is projected onto Pi by the compatibility adapter. */
  isAdapter?: boolean;
}

// ---------- tasks / subagents ----------

export interface RunningTask {
  id: string;
  kind?: string;
  description?: string;
  status?: string;
  sessionId?: string;
}

// ---------- subagent live events (pi://subagent) ----------

/** A live subagent lifecycle event forwarded from pi's `x.ai/session_notification`. */
export interface SubagentLiveEvent {
  /** Parent session that owns the subagent. */
  sessionId: string;
  /** Lifecycle phase: "spawned" | "progress" | "finished". */
  phase: "spawned" | "progress" | "finished";
  /** Subagent unique id (= child session id). */
  subagentId: string;
  childSessionId?: string;
  description?: string;
  subagentType?: string;
  /** "running" (spawned/progress) or the finished status. */
  status?: string;
  durationMs?: number;
  turnCount?: number;
  toolCallCount?: number;
  tokensUsed?: number;
  contextWindowTokens?: number;
  contextUsagePct?: number;
  toolsUsed?: string[];
  error?: string;
  output?: string;
}

/**
 * A turn that ended abnormally. pi reports mid-stream failures (e.g. a 429
 * rate limit hit while a tool was executing) via `prompt_complete` with
 * `stopReason: "rate_limit" | "error"` rather than as a thrown error. The
 * backend forwards these as `pi://turn-error` so the UI can surface a
 * friendly explanation instead of silently marking the turn complete.
 */
export interface TurnErrorEvent {
  sessionId: string;
  /** "rate_limit" | "error" (mirrors pi's `stop_reason_for_turn_error`). */
  kind: "rate_limit" | "error";
  /** Server-provided detail (absent for rate_limit — pi omits it so the
   *  client shows its own message). */
  detail?: string;
}

// ---------- automations (local scheduler, WorkBuddy 1:1) ----------

export type ScheduleFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "HOURLY";

/** RRULE-like recurring schedule. 双周 = WEEKLY interval 2; 按间隔 = HOURLY + intervalHours. */
export interface AutomationSchedule {
  freq: ScheduleFreq;
  interval: number;
  /** Weekday codes "MO".."SU". */
  byday: string[];
  /** Days of month 1..=31 (MONTHLY/YEARLY). */
  bymonthday: number[];
  /** Months 1..=12 (YEARLY). */
  bymonth: number[];
  byhour: number;
  byminute: number;
  intervalHours: number;
}

export type AutomationScheduleType = "recurring" | "once";
export type AutomationPermissionMode = "fullAccess" | "default";
export type AutomationStatus = "ACTIVE" | "PAUSED";

// ---------- inspiration (灵感面板) ----------

/** Basic card returned by pi's inspiration generator. */
export interface InspirationCard {
  title: string;
  summary: string;
  takeaway: string;
}

export interface InspirationStarted {
  sessionId: string;
  category: string;
  count: number;
}

// ---------- agent / assistant defaults (~/.pi/config.toml) ----------

export interface AgentDefaults {
  /** Model id for new sessions (`[models] default`). Empty = pi's built-in. */
  defaultModel: string;
  /** Default permission selection (`[ui] default_selected_permission`). */
  defaultPermission: string;
  /** Show "Always allow" options on prompts (`[ui] remember_tool_approvals`). */
  rememberToolApprovals?: boolean;
}

// ---------- plugins + marketplace (x.ai/plugins/*, x.ai/marketplace/*) ----------

/** One installed plugin (subset of pi's PluginInfo). */
export interface PluginEntry {
  name: string;
  id?: string;
  root?: string;
  scope?: string;
  trusted?: boolean;
  enabled: boolean;
  version?: string;
  description?: string;
  skillCount?: number;
  skillNames?: string[];
  agentCount?: number;
  agentNames?: string[];
  hookStatus?: string;
  hookCount?: number;
  hookPoints?: string[];
  hookDiagnostics?: Array<{ level: string; message: string; event?: string; matcher?: string }>;
  mcpServerCount?: number;
  mcpStatus?: string;
  marketplaceSource?: string;
  conflict?: unknown;
}

export interface PluginsListResponse {
  plugins: PluginEntry[];
}

/** One plugin from a marketplace source (with install status). */
export interface MarketplacePluginEntry {
  name: string;
  version?: string;
  description?: string;
  category?: string;
  author?: string;
  tags?: string[];
  homepage?: string;
  relativePath: string;
  skillCount: number;
  hasHooks: boolean;
  hasAgents: boolean;
  hasMcp: boolean;
  installStatus: string;
  installedVersion?: string;
  /** Resolvable tarball / git URL for remote sources (pi.dev, custom registries). */
  remoteUrl?: string;
  /** Pin to a specific ref (tag / commit). Defaults to latest tag when omitted. */
  remoteRef?: string;
}

export interface MarketplaceScanResult {
  sourceName: string;
  sourceKind: string;
  sourceUrlOrPath: string;
  /** Distinguishes a local directory source from a remote catalog source (e.g. "pi.dev"). */
  sourceKindValue?: "local" | "remote";
  /** Built-in sources (e.g. pi.dev) cannot be removed by the user. */
  builtIn?: boolean;
  plugins: MarketplacePluginEntry[];
  error?: string;
  /** Timestamp (ISO) of the last successful refresh for this source. */
  refreshedAt?: string;
  /** Authoritative total number of packages advertised by the remote
   *  source (e.g. `5573` from `1-50 / 5573`). Only set for sources whose
   *  origin exposes a count on its index page; local sources omit this. */
  totalPackages?: number;
  /** Total pages of catalog content (e.g. `112` for `packages?page=112`).
   *  Used to drive the remote-source paginated fetch, and to render a
   *  "1-N of M" hint in the marketplace panel. */
  totalPages?: number;
}

export interface MarketplaceListResponse {
  sources: MarketplaceScanResult[];
}

/**
 * Result of a marketplace install / uninstall / update action.
 *
 * `piPriorityEnabled` is `true` only when the installed package matches a
 * registered `compatibilityAdapters[*].packageNames` entry and the marketplace
 * layer successfully mirrored the install into `profile.piExtensions` with
 * `passthrough: true`. `capability` is the OpenBuddy capability name (e.g.
 * `"mcp"`, `"automation"`) so the renderer can surface a domain-specific
 * toast.
 *
 * For non-pi-priority installs (Cordis-only bundles, skills-only plugins,
 * etc.) both fields are `undefined` and the marketplace UI falls back to the
 * existing simple toast.
 */
export interface MarketplaceActionResult {
  ok?: boolean;
  /** Absolute path of the installed plugin directory under `<agentRoot>/plugins`. */
  path?: string;
  /** Resolved npm version, when the registry response included one. */
  version?: string;
  /** Phase I.3: native pi priority was activated (install/update only). */
  piPriorityEnabled?: boolean;
  /** Phase I.3: native pi priority was deactivated (uninstall only). */
  piPriorityEnabledBefore?: boolean;
  /** Capability affected by the priority switch (mcp / permission / ...). */
  capability?: string;
}

export interface Automation {
  id: string;
  name: string;
  prompt: string;
  /** Comma-separated workspace directories (first entry is the run cwd). */
  cwds: string;
  status: AutomationStatus;
  modelId?: string;
  modelIsThinking?: boolean;
  skills: string[];
  expertId?: string;
  expertName?: string;
  connectorIds: string[];
  permissionMode: AutomationPermissionMode;
  scheduleType: AutomationScheduleType;
  schedule: AutomationSchedule;
  /** Once mode: YYYY-MM-DD. */
  scheduledDate?: string;
  /** Once mode: HH:MM. */
  scheduledTime?: string;
  /** Recurring validity window (YYYY-MM-DD, inclusive). */
  validFromDate?: string;
  validUntilDate?: string;
  pushToWeChat: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  tenantId?: string;
  creatorSubject?: string;
}

/** A single run-history entry (运行记录). */
export interface AutomationRunRecord {
  id: string;
  automationId: string;
  automationName: string;
  status: "running" | "success" | "failed" | string;
  startedAt: string;
  finishedAt?: string;
  sessionId?: string;
  archived: boolean;
  tenantId?: string;
  creatorSubject?: string;
}

export interface AutomationSnapshot {
  automations: Automation[];
  records: AutomationRunRecord[];
}

// ---------- connector marketplace (read live from a local data dir) ----------

/** One connector category chip (mirrors the Rust `ConnectorCategory`). */
export interface ConnectorCategory {
  id: string;
  zh: string;
}

/** One connector card (mirrors the Rust `ConnectorItem`, camelCase). */
export interface ConnectorItem {
  id: string;
  name: string;
  nameEn?: string;
  desc: string;
  descEn?: string;
  /** Directory key — locates `icons/<source>.*` and `connectors/<source>/mcp.json`. */
  source: string;
  /** "mcp" | "cli" | "skill-only" | "unknown". */
  kind: string;
  /** "token" | "server-side" | "oneid-token" | undefined. */
  authMode?: string;
  /** Example prompts (zh). */
  examplesZh: string[];
  /** Derived category id. */
  cat: string;
  /** Absolute local icon path — feed to `connectorsIcon`. */
  iconLocal?: string;
  /** Token-authorization form schema (token-mode connectors only). */
  tokenSchema?: TokenSchema;
}

/** One field in a token-schema form (mirrors Rust `TokenField`). */
export interface TokenField {
  /** Env-var name the value is injected as (e.g. `WENDAO_API_KEY`). */
  key: string;
  label?: string;
  /** "password" → masked input; otherwise plain text. */
  type?: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
}

/** The `token-schema.json` payload (mirrors Rust `TokenSchema`). */
export interface TokenSchema {
  title?: string;
  description?: string;
  docUrl?: string;
  docLabel?: string;
  fields: TokenField[];
}

/** Catalog payload returned by `connectors_load`. */
export interface ConnectorCatalog {
  root: string;
  categories: ConnectorCategory[];
  connectors: ConnectorItem[];
}

// ---------- skill catalog (runtime scan of agents + builtin dirs) ----------

/** One skill category chip (mirrors the Rust `SkillCategory`). */
export interface SkillCategory {
  id: string;
  zh: string;
}

/** One skill card (mirrors the Rust `SkillItem`, camelCase). */
export interface SkillItem {
  /** Skill name from frontmatter (falls back to the directory name). */
  id: string;
  name: string;
  desc: string;
  descEn?: string;
  version?: string;
  whenToUse?: string;
  /** Absolute directory containing the SKILL.md. */
  sourceDir: string;
  /** "connector" (from a connector package) | "builtin". */
  origin: "connector" | "builtin";
  /** Owning connector source name (connector origin only). */
  plugin?: string;
  /** Absolute local icon path (connector skills) — feed to `connectorsIcon`. */
  iconLocal?: string;
  /** Derived category id. */
  cat: string;
  /** Built-in skills are featured (精选). */
  featured?: boolean;
}

/** Catalog payload returned by `skills_catalog_load`. */
export interface SkillCatalog {
  root: string;
  builtinRoot: string;
  categories: SkillCategory[];
  skills: SkillItem[];
}

// ---------- unified market catalogs (built-in static data) ----------

/** A browsable skill in the static 技能 marketplace (截图 3). The actual install
 *  path for openbuddy is local (import a SKILL.md / folder); these entries just
 *  reproduce the WorkBuddy catalog UI. */
export interface SkillCatalogItem {
  id: string;
  name: string;
  desc: string;
  /** Segment the card belongs to: 推荐 / SkillHub / 套件. */
  seg: "recommend" | "skillhub" | "plugin";
  /** Category id within the segment's filter row ("" = uncategorized). */
  cat: string;
  /** Shows in the 精选技能 row at the top. */
  featured?: boolean;
  /** Optional recommendation label on a featured card. */
  reason?: string;
  /** Brand color hint for the letter-avatar icon (e.g. "#1d6f42"). */
  color?: string;
}

/** A browsable connector in the static 连接器 list (截图 4). These are MCP-type
 *  connectors; "+" opens the MCP 服务管理 modal rather than one-click install. */
export interface ConnectorCatalogItem {
  id: string;
  name: string;
  desc: string;
  /** Brand color hint for the letter-avatar icon. */
  color?: string;
}

/** Raw mcp.json file content returned by the `mcp_config_read` command. */
export interface McpConfigFile {
  filePath: string;
  content: string;
}

// ---------- expert marketplace (read live from a local data dir) ----------

/** One expert category (mirrors the Rust `ExpertCategory`). */
export interface ExpertCategory {
  id: string;
  zh: string;
  en: string;
}

/** One expert / team card (mirrors the Rust `ExpertItem`, camelCase). */
export interface ExpertItem {
  id: string;
  cat: string;
  name: string;
  nameEn?: string;
  /** Profession / 职称 — the bold card title. */
  title: string;
  titleEn?: string;
  desc: string;
  tags: string[];
  /** "agent" | "team". */
  type: "agent" | "team" | string;
  author?: string;
  /** operationalTag text — the 特邀专家 ribbon; absent when not set. */
  ribbon?: string;
  /** Default starter prompt (zh) — used to seed the summon persona. */
  init?: string;
  opc?: boolean;
  /** Pinned sort slot (displayPosition). */
  pos?: number;
  updated?: string;
  /** Absolute local avatar path — feed to `expertsThumbnail`. */
  avatarLocal?: string;
  /** COS fallback URL (used if the local file is missing). */
  avatarUrl?: string;
  /** Plugin directory name — used to locate `agents/<agentName>.md`. */
  plugin?: string;
  /** Agent markdown filename stem (lead agent for teams). */
  agentName?: string;
  /** Quick prompts ("试试这样问我") from the manifest. */
  quickPrompts?: string[];
}

/** Catalog payload returned by `experts_load`. */
export interface ExpertCatalog {
  root: string;
  categories: ExpertCategory[];
  experts: ExpertItem[];
  /** 精选场景 parsed from `<root>/_meta/featuredScenes.json` (may be empty). */
  featuredScenes: CatalogFeaturedScene[];
}

export interface WorkBuddyImportPreview {
  version: 1;
  previewToken: string;
  sourceRoot: string;
  pluginId: string;
  versionName: string;
  disposition: "new" | "same" | "upgrade" | "downgrade" | "conflict" | "blocked";
  team: boolean;
  leadAgent?: string;
  members: Array<{ agentId: string; role?: string; lead: boolean }>;
  skills: string[];
  files: Array<{ path: string; kind: "agent" | "skill" | "avatar" | "manifest"; bytes: number; sha256: string }>;
  warnings: string[];
  errors: string[];
  createdAt: number;
}

export interface WorkBuddyImportResult {
  version: 1;
  importId: string;
  pluginId: string;
  status: "installed" | "already-installed" | "rolled-back";
  installedFiles: string[];
  expertRoot: string;
  autoActivated: false;
}

export interface WorkBuddyImportStatus {
  version: 1;
  importId: string;
  pluginId: string;
  status: "installed" | "rolled-back";
  files: string[];
  backupPath?: string;
  createdAt: number;
}

/** A 精选场景 as returned by the backend (local banner resolved when present). */
export interface CatalogFeaturedScene {
  id: string;
  zh: string;
  expertIds: string[];
  /** Absolute local banner path — feed to `expertsImageBytes`. */
  imageLocal?: string;
  /** COS fallback URL. */
  imageUrl?: string;
}

/** A featured-scene banner as rendered (catalog scene or the gradient fallback
 *  authored in `featured-scenes.ts`). */
export interface FeaturedScene {
  id: string;
  zh: string;
  expertIds: string[];
  /** Absolute local banner path — feed to `expertsImageBytes`. */
  imageLocal?: string;
  /** Remote banner image (COS); when absent, the local gradient is used. */
  image?: string;
  /** Gradient endpoints for the offline fallback banner. */
  from?: string;
  to?: string;
}


// ---------- provider ids (R2.4) ----------
export type ProviderId =
  | "openai" | "anthropic" | "google" | "deepseek" | "groq"
  | "mistral" | "xai" | "newapi" | "echo" | (string & {});

// ---------- pi-package priority catalog (UX-1) ----------
//
// Static, renderer-safe mirror of `compatibilityAdapters` package metadata.
// Both the main-process loader (electron/main/agent/pi-extensions.ts) and
// the renderer (packages/ui/openbuddy-ui-mcp/src/MarketplacePanel.tsx) import
// this catalog so the marketplace card chip and the passthrough decision
// reference the same source of truth. Adapters carry dynamic logic
// (recordPassthrough side effects, tool registration, etc.); only the
// static metadata is duplicated here for renderer consumption.
export interface PiPackageCatalogEntry {
  /** npm package names this entry matches. */
  readonly packageNames: readonly string[];
  /** OpenBuddy capability id (used for `passthroughCapability` lookup). */
  readonly capability: string;
  /** OpenBuddy Cordis service owner. */
  readonly owner: string;
  /** Whether the adapter declares `passthrough: true` (when installed). */
  readonly passthrough: boolean;
  /** npm package name used by `isPiPackageInstalled` to detect the runtime presence. */
  readonly piPackageHint?: string;
  /** Short, user-facing capability label (Chinese). */
  readonly capabilityLabel: string;
}

export const PI_PACKAGE_CATALOG: readonly PiPackageCatalogEntry[] = [
  { packageNames: ["pi-mcp-adapter"], capability: "mcp", owner: "openbuddy-mcp-client", passthrough: true, piPackageHint: "pi-mcp-adapter", capabilityLabel: "MCP 客户端" },
  { packageNames: ["pi-permission-system"], capability: "permission", owner: "openbuddy-authorization", passthrough: true, piPackageHint: "pi-permission-system", capabilityLabel: "权限系统" },
  { packageNames: ["pi-goal", "pi-goal-x", "@narumitw/pi-goal"], capability: "goal", owner: "openbuddy-team", passthrough: true, piPackageHint: "pi-goal", capabilityLabel: "目标 / 团队" },
  { packageNames: ["pi-plan-mode", "@narumitw/pi-plan-mode", "@arvoretech/pi-plan-mode", "@plannotator/pi-extension"], capability: "plan", owner: "pi-plan-mode", passthrough: true, piPackageHint: "pi-plan-mode", capabilityLabel: "规划模式" },
  { packageNames: ["pi-todo", "pi-tasks", "pi-tasklist", "@narumitw/pi-todo", "@anthropic/pi-todo"], capability: "task", owner: "openbuddy-task", passthrough: true, piPackageHint: "@juicesharp/rpiv-todo", capabilityLabel: "任务清单" },
  { packageNames: ["pi-session", "pi-sessions", "pi-history", "pi-bookmark", "pi-session-manager", "@anthropic/pi-session"], capability: "session", owner: "openbuddy-session", passthrough: true, piPackageHint: "pi-session", capabilityLabel: "会话管理" },
  { packageNames: ["pi-fs", "pi-filesystem", "pi-fs-tools", "pi-file-tools", "pi-filetree", "@anthropic/pi-fs"], capability: "fs", owner: "openbuddy-fs-local", passthrough: true, piPackageHint: "pi-fs", capabilityLabel: "文件系统" },
  { packageNames: ["pi-lens"], capability: "lens", owner: "pi-lens", passthrough: true, piPackageHint: "pi-lens", capabilityLabel: "代码检视" },
  { packageNames: ["pi-simplify"], capability: "simplify", owner: "pi-simplify", passthrough: true, piPackageHint: "pi-simplify", capabilityLabel: "代码简化" },
  { packageNames: ["pi-hashline-edit-pro", "pi-hashline-edit"], capability: "hashline", owner: "pi-hashline-edit-pro", passthrough: true, piPackageHint: "pi-hashline-edit-pro", capabilityLabel: "Hashline 编辑" },
  { packageNames: ["@dietrichgebert/ponytail", "ponytail"], capability: "worktree", owner: "@dietrichgebert/ponytail", passthrough: true, piPackageHint: "@dietrichgebert/ponytail", capabilityLabel: "Worktree 工作区" },
  { packageNames: ["pi-goal-list-loop-audit"], capability: "automation", owner: "pi-goal-list-loop-audit", passthrough: true, piPackageHint: "pi-goal-list-loop-audit", capabilityLabel: "自动化队列审计" },
];

export function findPiPackageCatalogEntry(packageName: string): PiPackageCatalogEntry | undefined {
  if (!packageName) return undefined;
  return PI_PACKAGE_CATALOG.find((entry) => entry.packageNames.includes(packageName));
}
