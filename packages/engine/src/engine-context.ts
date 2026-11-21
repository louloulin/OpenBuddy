import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionFactory,
  SessionInfo,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { McpService } from "@openbuddy/services/mcp/mcp";
import type { MemoryService } from "@openbuddy/services/memory/memory";
import type { SkillCatalogService } from "@openbuddy/services/skills/catalog";
import type { PromptsService } from "@openbuddy/services/prompts/prompts";
import type { UsageService } from "@openbuddy/services/usage/usage";
import type { ProjectsService } from "@openbuddy/services/projects/projects";
import type { Providers } from "@openbuddy/services/providers/providers";
import type { Settings } from "@openbuddy/services/settings/settings";
import type { SkillsService } from "@openbuddy/services/skills/skills";
import type { CheckpointStore } from "./checkpoints/store.js";
import type { ExtensionUiBridge } from "./extension-ui/bridge.js";
import type { FolderTrustRequests } from "./folder-trust-requests.js";
import type { SessionSearchIndex } from "./session-search.js";
import type { Emit, Permissions } from "./permissions/permissions.js";
import type { AgentMode, PoolLimits, PromptImages, SessionRunStatus, Slot, ThinkingLevel } from "./types.js";
import type { SessionModelState } from "@openbuddy/protocol/agent-settings";

/**
 * The PiEngine members used by the modules split out of pi-engine.ts (event pipeline,
 * session pool / runtime / catalog, features/*). Those modules receive the engine as
 * their first argument and type it with this interface instead of importing
 * pi-engine.ts, which imports them; PiEngine satisfies it structurally.
 * Calls go through these members (not module-to-module) so behaviour and test
 * overrides on the instance are unchanged.
 */
export interface EngineContext {
  readonly settings: Settings;
  readonly emit: Emit;
  readonly limits: PoolLimits;
  readonly permissions: Permissions;
  readonly ui: ExtensionUiBridge;
  /** Untrusted folders awaiting a decision; replayed by `trust_pending` (§2.4 path 3). */
  readonly folderTrust: FolderTrustRequests;
  readonly providers: Providers;
  readonly skills: SkillsService;
  readonly mcp: McpService;
  readonly memory: MemoryService;
  readonly skillCatalog: SkillCatalogService;
  readonly prompts: PromptsService;
  /** 用量统计 (W5.6); the per-session snapshot method is `usage(id)`. */
  readonly usageStats: UsageService;
  /** 项目 (W5.4): `instructionsFor(cwd)` feeds the session's appended system prompt. */
  readonly projects: ProjectsService;
  readonly checkpoints: CheckpointStore;
  extensionFactories: ExtensionFactory[];
  modes: Map<string, AgentMode>;
  slots: Map<string, Slot>;
  focusedId?: string;
  lost: Array<{ id: string; manager: SessionManager; focused: boolean }>;
  /** Per-path extension load failures recorded instead of failing a session (W2.6). */
  extensionErrors: Array<{ path: string; error: string }>;
  /** Set when the extension configuration changed; the next open reloads modules from disk (W2.6). */
  extensionsDirty: boolean;
  inbox: string;
  sessionDir: string;
  listCache?: { at: number; items: Promise<SessionInfo[]> };
  modelCache: Map<string, { mtime: number; model?: { provider: string; modelId: string } }>;
  /** Full-text index over the saved sessions (pii W1.4). */
  readonly searchIndex: SessionSearchIndex;
  evictTimer?: ReturnType<typeof setInterval>;
  validCwd(path: string): Promise<string>;
  trusted(cwd: string): boolean;
  slot(id: string): Slot;
  live(id: string): AgentSession;
  emitEvent(slot: Slot, event: unknown): void;
  flushDelta(slot: Slot): void;
  emitStatus(slot: Slot): void;
  runStatus(slot?: Slot): SessionRunStatus;
  invalidateList(): void;
  toolArgProgress(slot: Slot, source: { contentIndex?: number; delta?: string; partial?: { content?: Array<{ arguments?: unknown }> } }): void;
  onEvent(slot: Slot, event: AgentSessionEvent): void;
  ensureTitle(slot: Slot, text: string): void;
  open(manager: SessionManager, modelId?: string, providerId?: string, thinkingLevel?: ThinkingLevel, subagent?: { parentId: string; agentName?: string }): Promise<Slot>;
  /** Create a fresh session (W1.7 handoff, W4 automation); returns its id. */
  newSession(cwd: string, modelId?: string, providerId?: string, thinkingLevel?: ThinkingLevel, background?: boolean): Promise<string>;
  focus(id: string): void;
  all(): Promise<SessionInfo[]>;
  resolve(id: string, cwd?: string): Promise<SessionInfo>;
  savedModel(item: SessionInfo): { provider: string; modelId: string } | undefined;
  validateImages(session: AgentSession, images?: PromptImages): void;
  send(id: string, prompt: string, images?: PromptImages): Promise<void>;
  navigateBefore(slot: Slot, entryId: string): Promise<string>;
  writablePath(id: string, path: string): string;
  queueState(id: string): { steering: string[]; followUp: string[] };
  close(id: string): Promise<void>;
  /** 做一做 / 想一想 / 问一问 (uses the session's slot; persistence is per branch). */
  setMode(id: string, mode: AgentMode): void;
  evictOverflow(keep: string): Promise<void>;
  rebuild(slot: Slot): Promise<void>;
  reload(filter?: (slot: Slot) => boolean): Promise<void>;
  /** Duplicate a live session onto a new id (features/fork.ts; also used by 会话导入, W6.5). */
  fork(id: string): Promise<string>;
  metadata(id: string, patch: { title?: string; pinned?: boolean; archived?: boolean; handoffFrom?: { sessionId: string; title?: string } | null }): void;
  /** Only forwarded as an event payload by the split-out modules. */
  modelState(id: string): SessionModelState;
}
