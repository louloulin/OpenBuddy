import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionFactory,
  SessionInfo,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { McpService } from "@openbuddy/services/mcp/mcp";
import type { Providers } from "@openbuddy/services/providers/providers";
import type { Settings } from "@openbuddy/services/settings/settings";
import type { SkillsService } from "@openbuddy/services/skills/skills";
import type { CheckpointStore } from "./checkpoints/store.js";
import type { ExtensionUiBridge } from "./extension-ui/bridge.js";
import type { Emit, Permissions } from "./permissions/permissions.js";
import type { AgentMode, PoolLimits, PromptImages, SessionRunStatus, Slot, ThinkingLevel } from "./types.js";

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
  readonly providers: Providers;
  readonly skills: SkillsService;
  readonly mcp: McpService;
  readonly checkpoints: CheckpointStore;
  extensionFactories: ExtensionFactory[];
  modes: Map<string, AgentMode>;
  slots: Map<string, Slot>;
  focusedId?: string;
  lost: Array<{ id: string; manager: SessionManager; focused: boolean }>;
  inbox: string;
  sessionDir: string;
  listCache?: { at: number; items: Promise<SessionInfo[]> };
  modelCache: Map<string, { mtime: number; model?: { provider: string; modelId: string } }>;
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
  open(manager: SessionManager, modelId?: string, providerId?: string, thinkingLevel?: ThinkingLevel): Promise<Slot>;
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
  evictOverflow(keep: string): Promise<void>;
  rebuild(slot: Slot): Promise<void>;
  reload(filter?: (slot: Slot) => boolean): Promise<void>;
  metadata(id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }): void;
  /** Only forwarded as an event payload by the split-out modules. */
  modelState(id: string): unknown;
}
