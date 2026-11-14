import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type SessionInfo,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { mkdir, realpath, rename, unlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve as resolvePath, isAbsolute, sep } from "node:path";
import { Providers, modelKey } from "@openbuddy/services/providers";
import { ExtensionUiBridge } from "./ui.js";
import { SkillsService } from "@openbuddy/services/skills";
import { McpService } from "@openbuddy/services/mcp";
import type { Settings } from "@openbuddy/services/settings";
import { Permissions, type Emit } from "./permissions.js";
import { CheckpointStore } from "./checkpoints.js";
import { collectArtifacts } from "./artifacts.js";

/** 做一做 / 想一想 / 问一问 (20261115-ui §5.8): plan and ask only get read-only tools. */
export type AgentMode = "craft" | "plan" | "ask";
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
export type ThinkingLevel = Parameters<AgentSession["setThinkingLevel"]>[0];
export function validateThinkingLevel(value: unknown): ThinkingLevel {
  if (
    typeof value !== "string" ||
    !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
  )
    throw Error("invalid_thinking_level");
  return value as ThinkingLevel;
}
type PromptImages = NonNullable<
  Parameters<AgentSession["prompt"]>[1]
>["images"];

/** Renderer-visible lifecycle of one pooled session. */
export type SessionRunStatus = "running" | "idle" | "failed";

/**
 * Strip the cumulative `message` / `partial` snapshots from streaming events.
 * They grow with the reply, so forwarding them per token makes IPC cost
 * quadratic; the renderer reassembles content from deltas and `message_end`.
 */
export function slimEvent(event: AgentSessionEvent): unknown {
  if (event.type === "message_update") {
    const source = event.assistantMessageEvent as unknown as Record<string, unknown> & {
      type: string;
      contentIndex?: number;
      partial?: { content?: Array<Record<string, unknown>>; usage?: unknown };
      error?: { errorMessage?: string };
    };
    // Raw argument deltas are summarized by the engine instead (see toolArgProgress).
    if (source.type === "toolcall_delta") return undefined;
    const slim: Record<string, unknown> = { type: source.type };
    for (const key of ["contentIndex", "delta", "content", "toolCall", "reason"])
      if (source[key] !== undefined) slim[key] = source[key];
    if (source.type === "toolcall_start" && source.contentIndex !== undefined) {
      const part = source.partial?.content?.[source.contentIndex];
      if (part?.type === "toolCall")
        slim.toolCall = { type: "toolCall", id: part.id, name: part.name, arguments: {} };
    }
    if (source.type === "error" && source.error?.errorMessage)
      slim.errorMessage = source.error.errorMessage;
    // The finished block / arguments arrive again in message_end right after: do not send
    // them twice (a 1MB write used to cross IPC three times — 20261115-ui §3 budget).
    if (source.type === "text_end" || source.type === "thinking_end") delete slim.content;
    if (source.type === "toolcall_end" && slim.toolCall && typeof slim.toolCall === "object") {
      const call = slim.toolCall as { arguments?: unknown };
      slim.toolCall = { ...call, arguments: smallArgs(call.arguments) };
    }
    // `partial.usage` is cumulative and only message_end's is used.
    return { type: "message_update", assistantMessageEvent: slim };
  }
  // The renderer already holds the arguments from message_end; keep small ones for display.
  if (event.type === "tool_execution_start" && argsSize(event.args) > MAX_FORWARDED_ARGS) {
    const { args: _args, ...rest } = event;
    return rest;
  }
  // Both repeat content the renderer already received through message_end.
  if (event.type === "agent_end") return { type: "agent_end", willRetry: event.willRetry };
  if (event.type === "turn_end") return { type: "turn_end" };
  if (event.type === "entry_appended") return undefined;
  // Updates repeat the arguments and the cumulative output: send the output tail only.
  if (event.type === "tool_execution_update") {
    const content = (event.partialResult as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
    return {
      type: event.type,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      ...(Array.isArray(content) ? { partialResult: { content: content.map((part) => (part.type === "text" && typeof part.text === "string" && part.text.length > TOOL_OUTPUT_TAIL ? { ...part, text: part.text.slice(-TOOL_OUTPUT_TAIL) } : part)) } } : {}),
    };
  }
  return event;
}
const TOOL_OUTPUT_TAIL = 8 * 1024;
const MAX_FORWARDED_ARGS = 32 * 1024;
/** Approximate JSON size of tool arguments without serializing megabytes. */
function argsSize(args: unknown, depth = 0): number {
  if (typeof args === "string") return args.length + 2;
  if (!args || typeof args !== "object") return 8;
  if (depth > 3) return MAX_FORWARDED_ARGS + 1;
  let n = 2;
  for (const [k, v] of Object.entries(args)) {
    n += k.length + 4 + argsSize(v, depth + 1);
    if (n > MAX_FORWARDED_ARGS) break;
  }
  return n;
}
/** Arguments for display while the full copy is on its way: large values are left out. */
export function smallArgs(args: unknown): unknown {
  if (argsSize(args) <= MAX_FORWARDED_ARGS) return args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return Object.fromEntries(Object.entries(args).filter(([, v]) => argsSize(v) <= 1024));
}
/** Text/thinking deltas are merged for this long before crossing IPC. */
const DELTA_COALESCE_MS = 16;
const TOOL_DELTA_INTERVAL_MS = 100;
/** Best-effort `path` / `command` from the first bytes of streamed tool-call JSON. */
export function partialToolArgs(head: string, parsed?: unknown): { path?: string; command?: string } {
  const args = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const out: { path?: string; command?: string } = {};
  const unescape = (v: string) => { try { return JSON.parse(`"${v}"`) as string; } catch { return v; } };
  const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : head.match(/"(?:path|file_path)"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const command = typeof args.command === "string" ? args.command : head.match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)/)?.[1];
  if (path) out.path = typeof args.path === "string" || typeof args.file_path === "string" ? path : unescape(path);
  if (command) out.command = (typeof args.command === "string" ? command : unescape(command)).slice(0, 500);
  return out;
}

const PERSONA = /<!--EXPERT_PERSONA_BEGIN-->[\s\S]*?<!--EXPERT_PERSONA_END-->/g;
/** First-turn title shown in the sidebar: the user's own words, without injected context. */
export function deriveTitle(raw: string): string | undefined {
  let text = raw.replace(PERSONA, "").replace(/\s*<openbuddy-(plan|ask)-mode>[\s\S]*?<\/openbuddy-\1-mode>\s*/, "");
  let skill: string | undefined;
  const block = text.match(/^\s*<skill name="([^"]+)"[^>]*>[\s\S]*?<\/skill>\s*/);
  if (block) {
    skill = block[1];
    text = text.slice(block[0].length);
  }
  const attachments = [...text.matchAll(/<attachment name="([^"]*)">/g)].map((m) => m[1]);
  text = text
    .replace(/<attachment name=[^>]*>[\s\S]*?<\/attachment>/g, "")
    .replace(/\n*相关文件:\n(?:- .*(?:\n|$))+/g, "")
    .replace(/^请查看以下文件:\n(?:- .*(?:\n|$))+/, "")
    .replace(/^\[项目「[^」]*」背景与规范\][\s\S]*?\[用户消息\]\n/, "")
    .replace(/^【角色设定 — [^】]*】[\s\S]*?用户的第一个问题：\s*/, "")
    .replace(/^【[^】]{1,12}】/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    if (skill) return `技能：${skill}`;
    if (attachments.length) return `查看 ${attachments[0]}`;
    return undefined;
  }
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}
function messageText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => !!part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

interface Slot {
  /** Streaming tool-call arguments per content index (summarized for the renderer). */
  toolArgs?: Map<number, { bytes: number; head: string; at: number }>;
  /** Text/thinking delta waiting to be merged with the next ones (see emitEvent). */
  pendingDelta?: { type: string; contentIndex?: number; delta: string; timer?: ReturnType<typeof setTimeout> };
  lastDeltaAt?: number;
  /** Tool set the session was created with (restored by 做一做). */
  defaultTools: string[];
  id: string;
  session: AgentSession;
  unsubscribe: () => void;
  busy: boolean;
  generation: number;
  cancelledGeneration: number;
  commandError?: string;
  /** Configuration changed while running; rebuild once settled. */
  stale: boolean;
  lastActive: number;
  finalError?: string;
  failed: boolean;
}

export interface PoolLimits {
  /** Sessions kept alive (idle ones are evicted LRU beyond this). */
  maxLive: number;
  /** Sessions allowed to run a turn at the same time. */
  maxRunning: number;
  /** Idle time after which an unfocused, idle session is closed. */
  idleMs: number;
}

/**
 * Pi engine with a pool of live sessions. Switching or creating sessions never
 * aborts another session's turn; each slot owns its busy/generation state and
 * permission / UI requests are routed by session id.
 */
export class PiEngine {
  readonly permissions: Permissions;
  readonly ui: ExtensionUiBridge;
  readonly providers: Providers;
  readonly skills: SkillsService;
  readonly mcp: McpService;
  readonly checkpoints: CheckpointStore;
  /** Per-session mode, reapplied whenever the session slot is rebuilt. */
  private modes = new Map<string, AgentMode>();
  private slots = new Map<string, Slot>();
  private opening = new Map<string, Promise<Slot>>();
  private focusedId?: string;
  /** Sessions closed by a rebuild that could not reopen (e.g. a broken extension); retried on the next reload. */
  private lost: Array<{ id: string; manager: SessionManager; focused: boolean }> = [];
  private cwd: string;
  private inbox: string;
  private sessionDir: string;
  private listCache?: { at: number; items: Promise<SessionInfo[]> };
  private modelCache = new Map<string, { mtime: number; model?: { provider: string; modelId: string } }>();
  private evictTimer?: ReturnType<typeof setInterval>;
  constructor(
    readonly settings: Settings,
    readonly emit: Emit,
    openUrl: (url: string) => Promise<void>,
    private extensionFactories: ExtensionFactory[] = [],
    readonly limits: PoolLimits = { maxLive: 6, maxRunning: 3, idleMs: 15 * 60_000 },
  ) {
    this.cwd = this.inbox = join(settings.dir, "inbox");
    this.permissions = new Permissions(settings, emit);
    this.ui = new ExtensionUiBridge(emit);
    this.providers = new Providers(settings);
    this.skills = new SkillsService(settings);
    this.mcp = new McpService(settings, openUrl, emit);
    this.sessionDir = join(settings.dir, "sessions");
    this.checkpoints = new CheckpointStore(join(settings.dir, "checkpoints"), (path) => this.trash(path));
  }
  /** Move a file to the OS trash; outside Electron (tests) into `<dir>/trash`. */
  private async trash(path: string) {
    try {
      const electron = (await import("electron")) as unknown as { shell?: { trashItem?: (p: string) => Promise<void> } };
      if (typeof electron.shell?.trashItem === "function") return await electron.shell.trashItem(path);
    } catch { /* not running inside Electron */ }
    const target = join(this.settings.dir, "trash", `${Date.now()}-${basename(path)}`);
    await mkdir(dirname(target), { recursive: true });
    await rename(path, target);
  }
  async initialize() {
    await mkdir(this.cwd, { recursive: true, mode: 0o700 });
    this.cwd = this.inbox = await realpath(this.cwd);
    await mkdir(this.sessionDir, { recursive: true, mode: 0o700 });
    await this.providers.initialize();
    this.evictTimer = setInterval(() => void this.evictIdle(), 60_000);
    this.evictTimer.unref?.();
  }
  async init(cwd?: string) {
    if (cwd) this.cwd = await this.validCwd(cwd);
    const auth = await this.providers.authStatus();
    const defaults = this.providers.defaults(),
      selected = defaults.invalidDefault ? undefined : this.providers.model();
    return {
      ok: auth.ready,
      auth,
      cwd: this.cwd,
      inbox: this.inbox,
      agentVersion: PI_VERSION,
      defaultModelId: selected?.id,
      defaultProviderId: selected?.provider ?? defaults.defaultProviderId,
      defaultModelKey: selected
        ? modelKey(selected.provider, selected.id)
        : defaults.defaultModel || undefined,
      invalidDefault: defaults.invalidDefault,
    };
  }
  private async validCwd(path: string) {
    if (!isAbsolute(path)) throw Error("工作区必须为绝对路径");
    const cwd = await realpath(path);
    const { stat } = await import("node:fs/promises");
    if (!(await stat(cwd)).isDirectory()) throw Error("工作区不是目录");
    return cwd;
  }
  /** The app-owned inbox is always trusted; other folders need an explicit decision. */
  private trusted(cwd: string) {
    return cwd === this.inbox || this.settings.config.read().trustedFolders.includes(cwd);
  }
  private slot(id: string) {
    const slot = this.slots.get(id);
    if (!slot) throw Error("会话未加载");
    return slot;
  }
  private live(id: string) {
    return this.slot(id).session;
  }
  has(id: string) {
    return this.slots.has(id);
  }
  /**
   * Forward one renderer event. Consecutive text/thinking deltas of the same block are
   * merged (leading edge immediately, then at most one IPC message per 16ms); anything
   * else flushes the pending delta first so ordering is preserved.
   */
  private emitEvent(slot: Slot, event: unknown) {
    const update = (event as { type?: string; assistantMessageEvent?: { type?: string; contentIndex?: number; delta?: unknown } }).type === "message_update"
      ? (event as { assistantMessageEvent: { type?: string; contentIndex?: number; delta?: unknown } }).assistantMessageEvent
      : undefined;
    const mergeable = !!update && (update.type === "text_delta" || update.type === "thinking_delta") && typeof update.delta === "string" && Object.keys(update).every((k) => k === "type" || k === "contentIndex" || k === "delta");
    if (mergeable) {
      const pending = slot.pendingDelta;
      if (pending && pending.type === update!.type && pending.contentIndex === update!.contentIndex) {
        pending.delta += update!.delta as string;
        return;
      }
      this.flushDelta(slot);
      const now = Date.now();
      if (now - (slot.lastDeltaAt ?? 0) >= DELTA_COALESCE_MS) {
        slot.lastDeltaAt = now;
        this.emit("agent://event", { sessionId: slot.id, event });
        return;
      }
      const next: NonNullable<Slot["pendingDelta"]> = { type: update!.type!, contentIndex: update!.contentIndex, delta: update!.delta as string };
      next.timer = setTimeout(() => { if (slot.pendingDelta === next) this.flushDelta(slot); }, DELTA_COALESCE_MS - (now - (slot.lastDeltaAt ?? 0)));
      slot.pendingDelta = next;
      return;
    }
    this.flushDelta(slot);
    this.emit("agent://event", { sessionId: slot.id, event });
  }
  private flushDelta(slot: Slot) {
    const pending = slot.pendingDelta;
    if (!pending) return;
    slot.pendingDelta = undefined;
    if (pending.timer) clearTimeout(pending.timer);
    slot.lastDeltaAt = Date.now();
    const assistantMessageEvent: Record<string, unknown> = { type: pending.type, delta: pending.delta };
    if (pending.contentIndex !== undefined) assistantMessageEvent.contentIndex = pending.contentIndex;
    this.emit("agent://event", { sessionId: slot.id, event: { type: "message_update", assistantMessageEvent } });
  }
  private emitStatus(slot: Slot) {
    this.flushDelta(slot);
    this.emit("agent://session-status", {
      sessionId: slot.id,
      status: this.runStatus(slot),
    });
  }
  private runStatus(slot?: Slot): SessionRunStatus {
    if (!slot) return "idle";
    if (slot.busy) return "running";
    return slot.failed ? "failed" : "idle";
  }
  private invalidateList() {
    this.listCache = undefined;
  }
  /** Throttled `toolcall_delta` summary: target path / command and bytes streamed so far. */
  private toolArgProgress(slot: Slot, source: { contentIndex?: number; delta?: string; partial?: { content?: Array<{ arguments?: unknown }> } }) {
    const index = source.contentIndex ?? 0;
    const map = (slot.toolArgs ??= new Map());
    const state = map.get(index) ?? { bytes: 0, head: "", at: 0 };
    const delta = typeof source.delta === "string" ? source.delta : "";
    state.bytes += delta.length;
    if (state.head.length < 4096) state.head += delta;
    map.set(index, state);
    const now = Date.now();
    if (now - state.at < TOOL_DELTA_INTERVAL_MS) return;
    state.at = now;
    this.emitEvent(slot, {
      type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: index, partialArgs: partialToolArgs(state.head, source.partial?.content?.[index]?.arguments), bytes: state.bytes } });
  }
  private onEvent(slot: Slot, event: AgentSessionEvent) {
    const sessionId = slot.id;
    if (event.type === "message_update") {
      const source = event.assistantMessageEvent as unknown as { type: string; contentIndex?: number; delta?: string; partial?: { content?: Array<{ arguments?: unknown }> } };
      if (source.type === "toolcall_delta") this.toolArgProgress(slot, source);
      else if (source.type === "toolcall_start" || source.type === "toolcall_end") slot.toolArgs?.delete(source.contentIndex ?? 0);
    }
    if (event.type === "message_start") slot.toolArgs = undefined;
    // An extension or /name renamed the session, or the thinking level moved (e.g. clamped after
    // a model switch): keep the sidebar title and the composer's thinking control in sync (C7/C8).
    if (event.type === "session_info_changed" && event.name?.trim()) {
      this.metadata(sessionId, { title: event.name.trim() });
      this.invalidateList();
      this.emit("agent://summary", { sessionId, title: event.name.trim() });
    }
    if (event.type === "thinking_level_changed") {
      try { this.emit("agent://model-state", this.modelState(sessionId)); } catch { /* model not resolved yet */ }
    }
    const payload = slimEvent(event);
    if (payload) this.emitEvent(slot, payload);
    if (event.type === "tool_execution_end") {
      void this.checkpoints.finish(event.toolCallId).then(
        (record) => { if (record || event.toolName === "write" || event.toolName === "edit") this.emit("agent://artifacts", { sessionId }); },
        () => {},
      );
    }
    if (event.type === "agent_start") {
      slot.finalError = undefined;
      slot.failed = false;
      if (!slot.busy) {
        slot.busy = true;
        this.emitStatus(slot);
      }
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      slot.finalError =
        event.message.stopReason === "error"
          ? (event.message.errorMessage ?? "模型请求失败")
          : undefined;
    }
    if (event.type === "message_end" && event.message.role === "user") this.ensureTitle(slot, messageText(event.message));
    // An errored attempt may still be retried or recovered by compaction.
    // Report a terminal error only once the SDK has completely settled.
    if (event.type === "agent_settled") {
      if (!event.aborted && slot.finalError) {
        this.emit("agent://turn-error", {
          sessionId,
          kind: "error",
          detail: slot.finalError,
        });
        slot.failed = true;
      }
      slot.finalError = undefined;
      // The SDK accepts a new prompt as soon as it settled; don't make the
      // renderer wait for the outer prompt() promise to unwind.
      slot.busy = false;
      slot.lastActive = Date.now();
      this.invalidateList();
      this.emitStatus(slot);
      if (slot.stale) void this.rebuild(slot).catch((error) => this.emit("agent://error", { sessionId, message: String(error instanceof Error ? error.message : error) }));
    }
  }
  private ensureTitle(slot: Slot, text: string) {
    const meta = this.settings.config.read().sessions[slot.id];
    if (meta?.title || slot.session.sessionName) return;
    const title = deriveTitle(text);
    if (!title) return;
    this.metadata(slot.id, { title });
    this.emit("agent://summary", { sessionId: slot.id, title });
  }
  /** Create a live session for `manager` without touching any other session. */
  private async open(
    manager: SessionManager,
    modelId?: string,
    providerId?: string,
    thinkingLevel?: ThinkingLevel,
  ): Promise<Slot> {
    const savedContext = manager.buildSessionContext();
    const model = modelId
      ? this.providers.model(modelId, providerId)
      : savedContext.model
        ? this.providers.model(
            savedContext.model.modelId,
            savedContext.model.provider,
          )
        : this.providers.model();
    if (!model) throw Error("model_not_found: 请先配置提供商和模型");
    if (!this.providers.runtime.hasConfiguredAuth(model.provider))
      throw Error("model_auth_missing: 模型提供商尚未认证");
    const config = this.settings.config.read();
    const requestedThinking =
      thinkingLevel ??
      (manager.getEntries().some((e) => e.type === "thinking_level_change")
        ? validateThinkingLevel(savedContext.thinkingLevel)
        : config.defaults.defaultThinkingLevel
          ? validateThinkingLevel(config.defaults.defaultThinkingLevel)
          : undefined);
    const cwd = manager.getCwd();
    const trusted = this.trusted(cwd);
    if (!trusted && config.folderTrustDecisions?.[cwd] === undefined)
      this.emit("agent://folder-trust", { cwd });
    const sdkSettings = SettingsManager.inMemory({}, { projectTrusted: trusted });
    const sessionId = manager.getSessionId();
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: this.settings.dir,
      settingsManager: sdkSettings,
      noExtensions: !(config.extensionsEnabled && trusted),
      additionalExtensionPaths: config.extensionsEnabled
        ? (config.extensionPaths ?? [])
        : [],
      noContextFiles: !trusted,
      noPromptTemplates: true,
      noThemes: true,
      noSkills: true,
      skillsOverride: () => ({
        skills: this.skills.active(cwd),
        diagnostics: [],
      }),
      extensionFactories: [
        this.permissions.extension(sessionId),
        // After the permission gate: only calls that may run get a snapshot.
        this.checkpoints.extension(sessionId, () => cwd),
        this.mcp.extension(),
        ...this.extensionFactories,
      ],
    });
    await loader.reload();
    const errors = loader.getExtensions().errors;
    if (errors.length)
      throw Error(
        `extension_load_failed: ${errors.map((e) => `${e.path}: ${e.error}`).join("; ")}`,
      );
    const { session } = await createAgentSession({
      cwd,
      agentDir: this.settings.dir,
      modelRuntime: this.providers.runtime,
      sessionManager: manager,
      resourceLoader: loader,
      settingsManager: sdkSettings,
      model,
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "mcp__*"],
      thinkingLevel: requestedThinking,
    });
    const defaultTools = session.getActiveToolNames();
    const mode = this.modes.get(session.sessionId) ?? "craft";
    if (mode !== "craft") session.setActiveToolsByName(defaultTools.filter((name) => READ_ONLY_TOOLS.includes(name)));
    const slot: Slot = {
      defaultTools,
      id: session.sessionId,
      session,
      unsubscribe: () => {},
      busy: false,
      generation: 0,
      cancelledGeneration: -1,
      stale: false,
      lastActive: Date.now(),
      failed: false,
    };
    slot.unsubscribe = session.subscribe((event) => this.onEvent(slot, event));
    try {
      await session.bindExtensions({
        mode: "rpc",
        uiContext: this.ui.context(slot.id),
        onError: (error) => {
          if (error.event === "command" && this.slots.get(slot.id) === slot && slot.busy)
            slot.commandError = error.error;
          else this.emit("agent://error", { sessionId: slot.id, message: error.error });
        },
      });
    } catch (error) {
      slot.unsubscribe();
      session.dispose();
      throw error;
    }
    this.slots.set(slot.id, slot);
    this.invalidateList();
    this.emit("agent://model-state", this.modelState(slot.id));
    await this.evictOverflow(slot.id);
    return slot;
  }
  private focus(id: string) {
    this.focusedId = id;
    const slot = this.slots.get(id);
    if (slot) slot.lastActive = Date.now();
  }
  async newSession(
    cwd: string,
    modelId?: string,
    providerId?: string,
    thinkingLevel?: ThinkingLevel,
  ) {
    const actual = await this.validCwd(cwd);
    const slot = await this.open(
      SessionManager.create(actual, this.sessionDir),
      modelId,
      providerId,
      thinkingLevel,
    );
    this.focus(slot.id);
    return slot.id;
  }
  async all() {
    const now = Date.now();
    if (!this.listCache || now - this.listCache.at > 1500)
      this.listCache = { at: now, items: SessionManager.listAll(this.sessionDir) };
    return this.listCache.items;
  }
  async resolve(id: string, cwd?: string): Promise<SessionInfo> {
    const canonicalCwd = cwd ? await this.validCwd(cwd) : undefined;
    this.invalidateList();
    const item = (await this.all()).find(
      (s) => s.id === id && (!canonicalCwd || s.cwd === canonicalCwd),
    );
    if (!item) throw Error("会话不存在");
    const actual = await realpath(item.path),
      root = await realpath(this.sessionDir),
      rel = relative(root, actual);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw Error("会话路径越界");
    return { ...item, path: actual };
  }
  /** Bring a session into the pool (reusing a live one) and return its snapshot. */
  async load(id: string, cwd?: string) {
    let slot = this.slots.get(id);
    if (!slot) {
      let pending = this.opening.get(id);
      if (!pending) {
        pending = this.resolve(id, cwd).then((item) =>
          this.open(SessionManager.open(item.path, this.sessionDir)),
        );
        this.opening.set(id, pending);
        void pending.catch(() => {}).finally(() => this.opening.delete(id));
      }
      slot = await pending;
    }
    this.focus(id);
    return this.snapshot(id);
  }
  /** Everything the renderer needs to rebuild a transcript without replaying events. */
  snapshot(id: string) {
    const slot = this.slot(id);
    return {
      ...this.modelState(id),
      cwd: slot.session.sessionManager.getCwd(),
      messages: slot.session.messages,
      busy: slot.busy,
      status: this.runStatus(slot),
      queue: this.queueState(id),
    };
  }
  private savedModel(item: SessionInfo) {
    const mtime = item.modified.getTime();
    const cached = this.modelCache.get(item.path);
    if (cached && cached.mtime === mtime) return cached.model;
    const model = SessionManager.open(item.path, this.sessionDir).buildSessionContext().model;
    const value = model ? { provider: model.provider, modelId: model.modelId } : undefined;
    this.modelCache.set(item.path, { mtime, model: value });
    return value;
  }
  async list(cwd: string, includeArchived = false) {
    cwd = await this.validCwd(cwd);
    const meta = this.settings.config.read().sessions,
      items = (await this.all()).filter((s) => s.cwd === cwd);
    const result = items
      .filter((s) => includeArchived || !meta[s.id]?.archived)
      .map((s) => {
        const savedModel = this.savedModel(s);
        const slot = this.slots.get(s.id);
        return {
          sessionId: s.id,
          title: meta[s.id]?.title ?? s.name ?? deriveTitle(s.firstMessage ?? "") ?? "新任务",
          updatedAt: s.modified.toISOString(),
          cwd: s.cwd,
          pinned: meta[s.id]?.pinned ?? false,
          archived: meta[s.id]?.archived ?? false,
          currentModelId: savedModel?.modelId,
          currentProviderId: savedModel?.provider,
          currentModelKey: savedModel
            ? modelKey(savedModel.provider, savedModel.modelId)
            : undefined,
          status: listStatus(this.runStatus(slot)),
        };
      });
    // Sessions created in this run are not on disk until their first exchange.
    for (const slot of this.slots.values()) {
      if (slot.session.sessionManager.getCwd() !== cwd || result.some((s) => s.sessionId === slot.id)) continue;
      if (!slot.busy && !meta[slot.id]?.title) continue;
      const model = slot.session.model;
      result.unshift({
        sessionId: slot.id,
        title: meta[slot.id]?.title ?? "新任务",
        updatedAt: new Date(slot.lastActive).toISOString(),
        cwd,
        pinned: meta[slot.id]?.pinned ?? false,
        archived: meta[slot.id]?.archived ?? false,
        currentModelId: model?.id,
        currentProviderId: model?.provider,
        currentModelKey: model ? modelKey(model.provider, model.id) : undefined,
        status: listStatus(this.runStatus(slot)),
      });
    }
    return result;
  }
  /** Sessions currently running a turn (the renderer's 任务 view of background work). */
  running() {
    const meta = this.settings.config.read().sessions;
    return [...this.slots.values()]
      .filter((slot) => slot.busy)
      .map((slot) => ({
        taskId: slot.id,
        sessionId: slot.id,
        cwd: slot.session.sessionManager.getCwd(),
        title: meta[slot.id]?.title ?? slot.session.sessionName ?? "新任务",
        status: "running",
      }));
  }
  private validateImages(session: AgentSession, images?: PromptImages) {
    if (images?.length && !session.model?.input.includes("image"))
      throw Error("model_does_not_support_images: 当前模型不支持图片输入");
  }
  async send(id: string, prompt: string, images?: PromptImages) {
    const slot = this.slot(id),
      session = slot.session;
    if (slot.busy) throw Error("会话忙碌");
    const running = [...this.slots.values()].filter((s) => s.busy).length;
    if (running >= this.limits.maxRunning)
      throw Error(`too_many_running: 最多同时运行 ${this.limits.maxRunning} 个任务，请等待其中一个完成`);
    if (
      !session.model ||
      !this.providers.model(session.model.id, session.model.provider)
    )
      throw Error("model_not_found: 当前模型已删除，请重新选择");
    this.validateImages(session, images);
    slot.busy = true;
    slot.failed = false;
    slot.commandError = undefined;
    slot.lastActive = Date.now();
    const generation = ++slot.generation;
    this.emitStatus(slot);
    session.extensionRunner.setUIContext(this.ui.context(id), "rpc");
    try {
      let disposition: string | undefined;
      await session.prompt(prompt, {
        images,
        preflightResult: (value) => {
          disposition = value;
        },
      });
      if (
        disposition === "handled" &&
        generation === slot.generation &&
        slot.commandError
      )
        throw Error(slot.commandError);
      // Extension commands are truly handled without an agent run, so Pi emits no settled.
      // Complete the host's send lifecycle only after the command handler has finished.
      if (disposition === "handled" && generation === slot.generation)
        this.emitEvent(slot, {
          type: "agent_settled",
          aborted: slot.cancelledGeneration === generation,
          commandHandled: true,
        });
    } catch (error) {
      if (generation === slot.generation) slot.failed = true;
      throw error;
    } finally {
      if (generation === slot.generation) {
        this.permissions.cancel(id);
        if (slot.busy) {
          slot.busy = false;
          this.emitStatus(slot);
        }
        if (slot.stale && this.slots.get(id) === slot) void this.rebuild(slot).catch(() => {});
      }
    }
  }
  /** User prompts on the current branch, newest last (for 历史 / 从这里编辑). */
  rewindPoints(id: string) {
    return this.live(id)
      .getUserMessagesForForking()
      .map((m, index) => ({ entryId: m.entryId, index, preview: deriveTitle(m.text) ?? m.text.slice(0, 60) }));
  }
  /** Move the branch leaf to just before `entryId`; the renderer rebuilds from `session_rewound`. */
  private async navigateBefore(slot: Slot, entryId: string) {
    if (slot.busy) throw Error("会话忙碌");
    const result = await slot.session.navigateTree(entryId, { summarize: false });
    if (result.cancelled) throw Error("rewind_cancelled: 已取消");
    this.invalidateList();
    this.emitEvent(slot, { type: "session_rewound", messages: slot.session.messages });
    return result.editorText ?? "";
  }
  /** 从这里编辑: drop this prompt and everything after it; returns the prompt text. */
  async rewind(id: string, entryId: string) {
    const slot = this.slot(id);
    if (!slot.session.getUserMessagesForForking().some((m) => m.entryId === entryId)) throw Error("rewind_point_not_found: 该消息不在当前分支");
    return { editorText: await this.navigateBefore(slot, entryId) };
  }
  /** 重新生成: branch before the last prompt and send it again (images included). */
  async regenerate(id: string) {
    const slot = this.slot(id);
    const last = slot.session.getUserMessagesForForking().at(-1);
    if (!last) throw Error("rewind_point_not_found: 没有可重新生成的消息");
    const entry = slot.session.sessionManager.getEntry(last.entryId) as { message?: { content?: unknown } } | undefined;
    const content = Array.isArray(entry?.message?.content) ? (entry!.message!.content as Array<{ type?: string; data?: string; mimeType?: string }>) : [];
    const images = content
      .filter((part) => part.type === "image" && part.data && part.mimeType)
      .map((part) => ({ type: "image" as const, data: part.data!, mimeType: part.mimeType! }));
    const text = (await this.navigateBefore(slot, last.entryId)) || last.text;
    await this.send(id, text, images.length ? images : undefined);
  }
  // ---- 产物 / 快照 (20261115-ui §5.5–5.6) ----
  /** Files this session created or modified (write/edit), from its full history. */
  async artifacts(id: string) {
    const slot = this.slot(id);
    const entries = slot.session.sessionManager.getEntries() as unknown as Parameters<typeof collectArtifacts>[0];
    return collectArtifacts(entries, slot.session.sessionManager.getCwd(), await this.checkpoints.list(id));
  }
  /** A path this session may write: inside its workspace. */
  private writablePath(id: string, path: string) {
    const cwd = this.slot(id).session.sessionManager.getCwd();
    const target = resolvePath(cwd, path);
    const rel = relative(resolvePath(cwd), target);
    if (!isAbsolute(path) || rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw Error("path_outside_workspace: 只能修改工作区内的文件");
    return target;
  }
  checkpointList(id: string, path?: string) { return this.checkpoints.list(id, path); }
  checkpointRead(id: string, hash: string) { return this.checkpoints.read(id, hash); }
  async checkpointRestore(id: string, path: string, hash: string | null) {
    await this.checkpoints.restore(id, this.writablePath(id, path), hash);
    this.emit("agent://artifacts", { sessionId: id });
  }
  async turnRevert(id: string, toolCallIds: string[], opts: { skip?: string[]; force?: boolean } = {}) {
    if (this.slot(id).busy) throw Error("会话忙碌");
    const result = await this.checkpoints.revert(id, toolCallIds, opts);
    if (result.restored.length) this.emit("agent://artifacts", { sessionId: id });
    return result;
  }
  async artifactSave(id: string, path: string, content: string, origin: "user" | "apply" = "user") {
    await this.checkpoints.userSave(id, this.writablePath(id, path), content, origin);
    this.emit("agent://artifacts", { sessionId: id });
  }
  setMode(id: string, mode: AgentMode) {
    const slot = this.slot(id);
    this.modes.set(id, mode);
    slot.session.setActiveToolsByName(mode === "craft" ? slot.defaultTools : slot.defaultTools.filter((name) => READ_ONLY_TOOLS.includes(name)));
  }
  mode(id: string): AgentMode { return this.modes.get(id) ?? "craft"; }
  abortRetry(id: string) { this.live(id).abortRetry(); }
  async exportHtml(id: string, outputPath: string) {
    if (!isAbsolute(outputPath)) throw Error("invalid_payload: outputPath");
    return this.live(id).exportToHtml(outputPath);
  }
  /** Workspaces the preview protocol may serve: live session folders and the inbox. */
  previewRoots(): string[] {
    return [this.inbox, ...[...this.slots.values()].map((s) => s.session.sessionManager.getCwd())];
  }
  queueState(id: string) {
    const s = this.live(id);
    return {
      steering: [...s.getSteeringMessages()],
      followUp: [...s.getFollowUpMessages()],
    };
  }
  clearQueue(id: string) {
    return this.live(id).clearQueue();
  }
  /**
   * Replace the pending queue (撤回一条 / 改成插话 / 调整顺序, 20261115-ui U4.5). Pi only offers
   * clear + append, so the new order is re-queued; queued images are not kept.
   */
  async setQueue(id: string, steering: string[], followUp: string[]) {
    const slot = this.slot(id),
      session = slot.session;
    session.clearQueue();
    if (slot.busy) {
      for (const text of steering) await session.steer(text);
      for (const text of followUp) await session.followUp(text);
    }
    return this.queueState(id);
  }
  async queue(
    id: string,
    kind: "steer" | "followUp",
    prompt: string,
    images?: PromptImages,
  ) {
    const slot = this.slot(id),
      session = slot.session;
    if (!slot.busy)
      throw Error("queue_unavailable: 当前没有运行中的会话");
    this.validateImages(session, images);
    const disposition =
      kind === "steer"
        ? await session.steer(prompt, images)
        : await session.followUp(prompt, images);
    return { ...this.queueState(id), disposition };
  }
  async fork(id: string) {
    const slot = this.slot(id);
    if (slot.busy) throw Error("会话忙碌");
    const file = slot.session.sessionManager.getSessionFile();
    if (!file || !existsSync(file))
      throw Error("fork_requires_history: 请先发送消息");
    const forked = await this.open(
      SessionManager.forkFrom(
        file,
        slot.session.sessionManager.getCwd(),
        this.sessionDir,
      ),
    );
    this.focus(forked.id);
    return forked.id;
  }
  async cancel(id: string) {
    const slot = this.slot(id);
    slot.cancelledGeneration = slot.generation;
    this.ui.cancel(id, "cancelled");
    this.mcp.auth.cancel(id);
    await this.mcp.auth.settle();
    this.permissions.cancel(id);
    if (slot.session.isCompacting) slot.session.abortCompaction();
    await slot.session.abort();
  }
  /** /compact: summarise older history into a compaction entry to free context. */
  async compact(id: string, instructions?: string) {
    const slot = this.slot(id);
    if (slot.busy) throw Error("会话忙碌");
    const generation = slot.generation;
    slot.busy = true;
    this.emitStatus(slot);
    try {
      const result = await slot.session.compact(instructions?.trim() || undefined);
      this.invalidateList();
      return { tokensBefore: result.tokensBefore, tokensAfter: result.estimatedTokensAfter };
    } finally {
      if (generation === slot.generation) {
        slot.busy = false;
        this.emitStatus(slot);
        if (slot.stale && this.slots.get(id) === slot) void this.rebuild(slot).catch(() => {});
      }
    }
  }
  /** Close one live session; its persisted history stays on disk. */
  async close(id: string) {
    const slot = this.slots.get(id);
    if (!slot) return;
    this.slots.delete(id);
    if (this.focusedId === id) this.focusedId = undefined;
    slot.generation++;
    this.ui.cancel(id, "session_closed");
    this.mcp.auth.cancel(id);
    this.permissions.cancel(id);
    try {
      await slot.session.abort();
      await slot.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    } finally {
      this.flushDelta(slot);
      slot.unsubscribe();
      slot.session.dispose();
      this.invalidateList();
    }
  }
  async shutdown() {
    clearInterval(this.evictTimer);
    this.evictTimer = undefined;
    this.lost = [];
    this.ui.cancel(undefined, "session_closed");
    this.mcp.auth.cancel();
    await this.mcp.auth.settle();
    this.permissions.cancel();
    for (const id of [...this.slots.keys()]) await this.close(id);
  }
  /** Close idle sessions over the live limit (least recently used first). */
  private async evictOverflow(keep: string) {
    const candidates = [...this.slots.values()]
      .filter((s) => s.id !== keep && s.id !== this.focusedId && !s.busy && !this.permissions.hasPending(s.id) && !this.ui.hasPending(s.id))
      .sort((a, b) => a.lastActive - b.lastActive);
    while (this.slots.size > this.limits.maxLive && candidates.length)
      await this.close(candidates.shift()!.id);
  }
  async evictIdle(now = Date.now()) {
    for (const slot of [...this.slots.values()])
      if (
        slot.id !== this.focusedId &&
        !slot.busy &&
        !this.permissions.hasPending(slot.id) &&
        !this.ui.hasPending(slot.id) &&
        now - slot.lastActive > this.limits.idleMs
      )
        await this.close(slot.id);
  }
  async rename(id: string, title: string) {
    const slot = this.slots.get(id);
    if (slot) slot.session.setSessionName(title);
    else {
      const item = await this.resolve(id);
      SessionManager.open(item.path, this.sessionDir).appendSessionInfo(title);
    }
    this.metadata(id, { title });
    this.invalidateList();
    this.emit("agent://summary", { sessionId: id, title });
  }
  metadata(
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ) {
    const c = this.settings.config.read();
    c.sessions[id] = { ...c.sessions[id], ...patch };
    this.settings.config.write(c);
  }
  async delete(id: string) {
    this.lost = this.lost.filter((entry) => entry.id !== id);
    const slot = this.slots.get(id);
    const file = slot
      ? slot.session.sessionManager.getSessionFile()
      : (await this.resolve(id)).path;
    if (slot) await this.close(id);
    if (file) {
      try {
        await unlink(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    const c = this.settings.config.read();
    delete c.sessions[id];
    this.settings.config.write(c);
    this.invalidateList();
  }
  modelState(id: string) {
    const s = this.live(id),
      m = s.model;
    if (!m) throw Error("model_not_found");
    return {
      sessionId: id,
      providerId: m.provider,
      modelId: m.id,
      modelKey: modelKey(m.provider, m.id),
      thinkingLevel: s.thinkingLevel,
      availableThinkingLevels: s.getAvailableThinkingLevels(),
    };
  }
  async setModel(id: string, modelId: string, providerId?: string) {
    const slot = this.slot(id);
    if (slot.busy) throw Error("请等待当前回复完成");
    const model = this.providers.model(modelId, providerId);
    if (!model) throw Error("model_not_found: 模型不存在");
    if (!this.providers.runtime.hasConfiguredAuth(model.provider))
      throw Error("model_auth_missing: 提供商尚未认证");
    await slot.session.setModel(model);
    const state = this.modelState(id);
    this.emit("agent://model-state", state);
    return state;
  }
  setThinkingLevel(id: string, level: unknown) {
    const slot = this.slot(id),
      session = slot.session;
    if (slot.busy) throw Error("请等待当前回复完成");
    const requested = validateThinkingLevel(level);
    if (!session.getAvailableThinkingLevels().includes(requested))
      throw Error("unsupported_thinking_level: 当前模型不支持该等级");
    session.setThinkingLevel(requested);
    const state = this.modelState(id);
    this.emit("agent://model-state", state);
    return state;
  }
  info(id: string) {
    const session = this.live(id),
      stats = session.getSessionStats(),
      usage = session.getContextUsage();
    const used = usage?.tokens ?? 0,
      total = session.model?.contextWindow ?? 0;
    const estimate = (text: string) => Math.ceil(text.length / 4);
    const systemPromptTokens = estimate(session.systemPrompt ?? "");
    const tools = session.getAllTools();
    const toolDefinitionsTokens = estimate(JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))));
    const messageTokens = Math.max(0, used - systemPromptTokens - toolDefinitionsTokens);
    return {
      cwd: session.sessionManager.getCwd(),
      mode: this.mode(id),
      cost: stats.cost,
      model: session.model?.id,
      modelDisplayName: session.model?.name,
      ...this.modelState(id),
      context: {
        used,
        total,
        usagePct: total ? Math.round((used / total) * 1000) / 10 : 0,
        systemPromptTokens: used ? systemPromptTokens : 0,
        toolDefinitionsCount: tools.length,
        toolDefinitionsTokens: used ? toolDefinitionsTokens : 0,
        messageCount: stats.totalMessages,
        messageTokens,
        turnCount: stats.userMessages,
        toolCallCount: stats.toolCalls,
        compactionCount: session.sessionManager
          .getEntries()
          .filter((e) => e.type === "compaction").length,
        freeTokens: Math.max(0, total - used),
        estimated: true,
      },
    };
  }
  usage(id: string) {
    const stats = this.live(id).getSessionStats();
    return {
      usage: {
        inputTokens: stats.tokens.input + stats.tokens.cacheRead,
        outputTokens: stats.tokens.output,
        totalTokens: stats.tokens.total,
        cachedReadTokens: stats.tokens.cacheRead,
        numTurns: stats.userMessages,
      },
    };
  }
  commands() {
    const skills = this.skills
      .list(this.currentCwd)
      .filter((s) => s.enabled)
      .map((s) => ({
        name: `skill:${s.name}`,
        description: s.description,
        source: "skill",
      }));
    const focused = this.focusedId ? this.slots.get(this.focusedId) : undefined;
    const extensions =
      focused?.session.extensionRunner.getRegisteredCommands().map((c) => ({
        name: c.invocationName,
        description: c.description,
        source: "extension",
      })) ?? [];
    const builtins = focused
      ? [{ name: "compact", description: "压缩上下文：总结较早的对话以释放空间", source: "builtin" }]
      : [];
    return [...builtins, ...skills, ...extensions];
  }
  extensionsConfig() {
    const c = this.settings.config.read();
    return {
      enabled: c.extensionsEnabled ?? false,
      paths: c.extensionPaths ?? [],
      projectTrusted: this.trusted(this.currentCwd),
    };
  }
  async configureExtensions(
    action: "add" | "remove" | "enabled",
    value: string | boolean,
  ) {
    const previous = this.settings.config.read(),
      next = structuredClone(previous);
    if (action === "enabled") next.extensionsEnabled = value as boolean;
    else {
      const path =
        action === "add" ? await realpath(value as string) : (value as string);
      if (action === "add") {
        const { stat } = await import("node:fs/promises");
        const s = await stat(path);
        if (!s.isDirectory() && !/\.(ts|js|mjs|cjs)$/.test(path))
          throw Error("invalid_extension_path");
      }
      next.extensionPaths = (next.extensionPaths ?? []).filter(
        (p) => p !== path,
      );
      if (action === "add") next.extensionPaths.push(path);
    }
    this.settings.config.write(next);
    try {
      await this.reload();
    } catch (error) {
      this.settings.config.write(previous);
      try {
        await this.reload();
      } catch {
        /* Preserve the original load failure. */
      }
      throw error;
    }
    return this.extensionsConfig();
  }
  get currentCwd() {
    const focused = this.focusedId ? this.slots.get(this.focusedId) : undefined;
    return focused?.session.sessionManager.getCwd() ?? this.cwd;
  }
  get currentSessionId() {
    return this.focusedId;
  }
  get inboxCwd() {
    return this.inbox;
  }
  async setFolderTrust(cwd: string, trusted: boolean) {
    cwd = await this.validCwd(cwd);
    const c = this.settings.config.read();
    // Persist the decision first so a busy session cannot make the dialog return.
    c.trustedFolders = c.trustedFolders.filter((p) => p !== cwd);
    if (trusted) c.trustedFolders.push(cwd);
    c.folderTrustDecisions = { ...c.folderTrustDecisions, [cwd]: trusted };
    this.settings.config.write(c);
    await this.reload((slot) => slot.session.sessionManager.getCwd() === cwd);
  }
  /** Rebuild live sessions after a configuration change; busy ones rebuild when settled. */
  async reload(filter: (slot: Slot) => boolean = () => true) {
    let failure: unknown;
    // Reopen sessions an earlier failed rebuild dropped (the config may have been rolled back since).
    for (const entry of this.lost.splice(0)) {
      if (this.slots.has(entry.id)) continue;
      try {
        const next = await this.open(entry.manager);
        if (entry.focused) this.focus(next.id);
      } catch (error) {
        this.lost.push(entry);
        failure ??= error;
      }
    }
    for (const slot of [...this.slots.values()].filter(filter)) {
      if (slot.busy) {
        slot.stale = true;
        continue;
      }
      try {
        await this.rebuild(slot);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }
  private async rebuild(slot: Slot) {
    if (this.slots.get(slot.id) !== slot) return;
    const focused = this.focusedId === slot.id;
    const file = slot.session.sessionManager.getSessionFile();
    const manager =
      file && existsSync(file)
        ? SessionManager.open(file, this.sessionDir)
        : slot.session.sessionManager;
    await this.close(slot.id);
    let next: Slot;
    try {
      next = await this.open(manager);
    } catch (error) {
      this.lost.push({ id: slot.id, manager, focused });
      throw error;
    }
    if (next.id !== slot.id) throw Error("会话重载身份发生变化");
    if (focused) this.focus(next.id);
  }
}
function listStatus(status: SessionRunStatus) {
  return status === "running" ? "working" : status === "failed" ? "failed" : "completed";
}
/** Version of the bundled Pi SDK, read from its package manifest. */
const PI_VERSION = (() => {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve("@earendil-works/pi-coding-agent"));
    for (let depth = 0; depth < 6; depth++, dir = dirname(dir)) {
      const manifest = join(dir, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@earendil-works/pi-coding-agent" && pkg.version) return pkg.version;
    }
  } catch {
    /* Fall through to an explicit unknown marker. */
  }
  return "unknown";
})();
