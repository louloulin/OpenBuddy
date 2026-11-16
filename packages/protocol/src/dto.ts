export interface ModelState {
  sessionId: string;
  providerId: string;
  modelId: string;
  modelKey: string;
  thinkingLevel: string;
  availableThinkingLevels: string[];
}

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


export interface ImageToolContent {
  type: "image";
  /** Base64-encoded image bytes. */
  data: string;
  mimeType: string;
  /** Optional source URI (http/file) when the tool references a file. */
  uri?: string;
}

export type ToolCallContent =
  | TextContent
  | DiffContent
  | CommandOutputContent
  | ImageToolContent;

// ---------- tool call status ----------

export type ToolCallStatus = "in_progress" | "completed" | "failed";

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

/** Serializable Pi content shared by live events and persisted history. */
export interface PiContent {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  data?: string;
  mimeType?: string;
}
export interface PiMessage {
  role: string;
  content: PiContent[] | string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  usage?: { input?: number; output?: number; totalTokens?: number; cacheRead?: number; cacheWrite?: number };
  timestamp?: number;
  model?: string;
  provider?: string;
  stopReason?: string;
  errorMessage?: string;
  /** Tool result details (edit diff/patch, bash truncation). */
  details?: unknown;
  /** compactionSummary / branchSummary text. */
  summary?: string;
  /** custom message visibility. */
  display?: boolean;
  /** bashExecution entries. */
  command?: string;
  output?: string;
}
export interface PiMessageDelta {
  type: string;
  contentIndex?: number;
  delta?: string;
  content?: string;
  toolCall?: PiContent;
  partial?: PiMessage;
  /** Slim `toolcall_delta` (main process): fields parsed from the partial arguments so far. */
  partialArgs?: { path?: string; command?: string };
  /** Slim `toolcall_delta`: length of the argument text streamed so far. */
  bytes?: number;
}
export interface SessionUpdate {
  type: string;
  sessionId?: string;
  __sessionId?: string;
  message?: PiMessage;
  assistantMessageEvent?: PiMessageDelta;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: { content?: PiContent[] };
  result?: { content?: PiContent[]; details?: unknown };
  isError?: boolean;
  durationMs?: number;
  [key: string]: unknown;
}

// ---------- context usage (x.ai/session/info + x.ai/session/usage) ----------


export interface TokenUsageCategory {
  /** Display label, e.g. "Skills" or "MCP servers". */
  label: string;
  tokens: number;
  /** Supporting detail, e.g. "21 skills". */
  detail?: string;
}


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
  providerId?: string;
  modelKey?: string;
  thinkingLevel?: string;
  availableThinkingLevels?: string[];
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

// ---------- permissions ----------

export type PermissionKind = "allow" | "allow_always" | "deny";

export interface PermissionOption {
  optionId: string;
  kind: PermissionKind;
  title: string;
}

export interface PermissionRequest {
  /** Echoed back in `agent_resolve_permission`. */
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolKind: ToolKind;
  title: string;
  /** Optional partial raw input to show the user what they're approving. */
  rawInput?: unknown;
  options: PermissionOption[];
  /** Set when the call deletes files (bash rm, delete tools): the card asks harder. */
  destructive?: { command?: string; paths?: string[] };
  /** 子代理 (W3.4): the child session asking; the card says 来自子代理 X. */
  subagent?: { parentId: string; name?: string };
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
  
  title: string;
  /** ISO timestamp of last activity (`updated_at`, falling back to `last_active_at`). */
  updatedAt?: string;
  /** Working directory the session is bound to. */
  cwd: string;
  /** True if it's a git repo (inferred from `git_root_dir` in summary.json). */
  isGitRepo?: boolean;
  
  pinned?: boolean;
  
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
}


export interface SessionSummaryEvent {
  sessionId: string;
  title: string;
}

// ---------- skills (x.ai/skills
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
// The MCP wire types (server entries, upsert request, auth results, 测试连接 W2.4, 即时连接卡 W2.5)
// live in ./mcp.ts so this file stays under its size ceiling; they are re-exported here.
export type {
  ConnectorNeededEvent,
  McpAuthStatusEntry,
  McpAuthTriggerResult,
  McpServerEntry,
  McpTestResult,
  McpUpsertRequest,
} from './mcp.js';

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


/** One permission rule. `action` ∈ allow|deny|ask; `tool` ∈ bash|read|edit|grep|mcp|any. */
export interface PermissionRule {
  action: string;
  tool: string;
  pattern?: string;
}


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
  /** Engine entry id of the user prompt. */
  entryId: string;
  index: number;
  preview: string;
}

// ---------- slash commands + prompt history ----------

export interface SlashCommand {
  name: string;
  description?: string;
  argumentHint?: string;
  source?: string;
}

// ---------- tasks / subagents ----------

export interface RunningTask {
  id: string;
  /** "automation" | "subagent" | "bash" | "task" (pii W4.5). */
  kind?: string;
  description?: string;
  status?: string;
  sessionId?: string;
  cwd?: string;
  title?: string;
  /** Epoch ms when the current turn started (用时). */
  startedAt?: number;
  /** Approval cards waiting on this session. */
  pending?: number;
  /** Sub-agent rows point at the session that spawned them. */
  parentId?: string;
}

// ---------- subagent live events (agent://subagent) ----------


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


export interface TurnErrorEvent {
  sessionId: string;
  
  kind: "rate_limit" | "error";
  
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


export interface InspirationCard {
  title: string;
  summary: string;
  takeaway: string;
}


export interface InspirationRichCard {
  cardId: string;
  title: string;
  summary: string;
  detail?: string;
  category: string;
  cover?: string;
  prompt?: string;
  actions?: { label: string; type: string; payload: string }[];
  read?: boolean;
  saved?: boolean;
  createdAt?: string;
}

export interface InspirationStarted {
  sessionId: string;
  category: string;
  count: number;
}

// ---------- xAI API Key 管理 ----------
// OAuth 功能一并移除；OpenBuddy 现仅保留 xAI API Key（BYOK）认证。


export interface AgentDefaults {
  
  defaultModel: string;
  defaultProviderId?: string;
  invalidDefault?: boolean;
  defaultThinkingLevel?: string;
  /** Default permission selection (`[ui] default_selected_permission`). */
  defaultPermission: string;
  /** Show "Always allow" options on prompts (`[ui] remember_tool_approvals`). */
  rememberToolApprovals?: boolean;
}

// ---------- plugins + marketplace (x.ai/plugins
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
  remoteUrl?: string;
  remoteRef?: string;
}

export interface MarketplaceScanResult {
  sourceName: string;
  sourceKind: string;
  sourceUrlOrPath: string;
  plugins: MarketplacePluginEntry[];
  error?: string;
}

export interface MarketplaceListResponse {
  sources: MarketplaceScanResult[];
}

// ---------- notification log (智能体邮箱 → 会话通知中心) ----------

export type NotificationKind =
  | "permission"
  | "folder_trust"
  | "task_update"
  | "plan_mode"
  | "mcp_status"
  | "models_update"
  | "summary"
  | "session_complete"
  | "error"
  | "info";

export interface NotificationEntry {
  id: number;
  kind: NotificationKind | string;
  at: string;
  title: string;
  body?: string;
  sessionId?: string;
  severity: "info" | "warn" | "error" | string;
  read: boolean;
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
  /** Failure / timeout reason (`automation_timeout`, executor error text). */
  error?: string;
  archived: boolean;
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

/** A skill category chip label (截图 3 filter row). */
export interface SkillCategory {
  id: string;
  zh: string;
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
