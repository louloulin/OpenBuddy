import {
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type SessionInfo,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { mkdir, realpath, rename } from "node:fs/promises";
import { basename, dirname, join, isAbsolute } from "node:path";
import { Providers, modelKey } from "@openbuddy/services/providers/providers";
import { ExtensionUiBridge } from "./extension-ui/bridge.js";
import { SkillsService } from "@openbuddy/services/skills/skills";
import { McpService } from "@openbuddy/services/mcp/mcp";
import { MemoryService } from "@openbuddy/services/memory/memory";
import { SkillCatalogService } from "@openbuddy/services/skills/catalog";
import { PromptsService } from "@openbuddy/services/prompts/prompts";
import type { Settings } from "@openbuddy/services/settings/settings";
import { Permissions, type Emit } from "./permissions/permissions.js";
import { isBuiltinToolDefinition } from "./builtin/reserved-tools.js";
import type { HostShell } from "@openbuddy/kernel";
import { CheckpointStore } from "./checkpoints/store.js";
import { validateThinkingLevel, type AgentMode, type PoolLimits, type PromptImages, type SessionRunStatus, type Slot, type ThinkingLevel } from "./types.js";
import { PI_VERSION } from "./version.js";
import type { AgentSettingsPatch } from "@openbuddy/protocol/agent-settings";
import * as pipeline from "./event-pipeline.js";
import * as runtime from "./session-runtime.js";
import * as pool from "./session-pool.js";
import * as catalog from "./session-catalog.js";
import { SessionSearchIndex } from "./session-search.js";
import * as features from "./features/index.js";

export { slimEvent, smallArgs, partialToolArgs } from "./event-pipeline.js";
export { deriveTitle } from "./titles.js";
export { validateThinkingLevel, type AgentMode, type ThinkingLevel, type SessionRunStatus, type PoolLimits } from "./types.js";

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
  /** Cross-session memory notes (20261116-pii W5.1). */
  readonly memory: MemoryService;
  /** 技能目录 scanner (W2.7). */
  readonly skillCatalog: SkillCatalogService;
  /** 我的指令 prompt templates (W2.7 / S8). */
  readonly prompts: PromptsService;
  readonly checkpoints: CheckpointStore;
  /** Per-session mode, reapplied whenever the session slot is rebuilt. */
  /** @internal */ modes = new Map<string, AgentMode>();
  /** @internal */ slots = new Map<string, Slot>();
  private opening = new Map<string, Promise<Slot>>();
  /** @internal */ focusedId?: string;
  /** Sessions closed by a rebuild that could not reopen (e.g. a broken extension); retried on the next reload. */
  /** @internal */ lost: Array<{ id: string; manager: SessionManager; focused: boolean }> = [];
  /** Per-path extension load failures of the last opened session (W2.6): a bad one never breaks a session. */
  /** @internal */ extensionErrors: Array<{ path: string; error: string }> = [];
  /** The extension configuration changed: the next session open must reload modules from disk (W2.6). */
  /** @internal */ extensionsDirty = false;
  private cwd: string;
  /** @internal */ inbox: string;
  /** @internal */ sessionDir: string;
  /** @internal */ listCache?: { at: number; items: Promise<SessionInfo[]> };
  /** @internal */ modelCache = new Map<string, { mtime: number; model?: { provider: string; modelId: string } }>();
  /** @internal */ readonly searchIndex: SessionSearchIndex;
  /** @internal */ evictTimer?: ReturnType<typeof setInterval>;
  constructor(
    readonly settings: Settings,
    readonly emit: Emit,
    openUrl: (url: string) => Promise<void>,
    /** @internal */ public extensionFactories: ExtensionFactory[] = [],
    readonly limits: PoolLimits = { maxLive: 6, maxRunning: 3, idleMs: 15 * 60_000 },
    /** The host's `HostShell.trash` (desktop: Electron `shell.trashItem`), injected so the engine never imports electron (R2). */
    private readonly hostTrash?: HostShell["trash"],
  ) {
    this.cwd = this.inbox = join(settings.dir, "inbox");
    // Auto-approval of built-in bookkeeping tools (`ob_todo`) needs the session's tool to be the built-in's own.
    this.permissions = new Permissions(settings, emit, 0, (sessionId, tool) => isBuiltinToolDefinition(this.slots.get(sessionId)?.session.getToolDefinition(tool)));
    this.ui = new ExtensionUiBridge(emit);
    this.providers = new Providers(settings);
    this.skills = new SkillsService(settings);
    this.mcp = new McpService(settings, openUrl, emit);
    this.memory = new MemoryService(settings, (cwd) => this.trusted(cwd));
    this.skillCatalog = new SkillCatalogService(settings);
    this.prompts = new PromptsService(settings, (cwd) => this.trusted(cwd));
    this.sessionDir = join(settings.dir, "sessions");
    // A refresh parses only new or changed session files and leaves the sidebar's list cache alone.
    this.searchIndex = new SessionSearchIndex(this.sessionDir);
    this.checkpoints = new CheckpointStore(join(settings.dir, "checkpoints"), (path) => this.trash(path));
  }
  /** Move a file to the OS trash via the host; without a host trash (tests), or if it fails, into `<dir>/trash`. */
  private async trash(path: string) {
    try {
      if (typeof this.hostTrash === "function") return await this.hostTrash(path);
    } catch { /* the host could not trash it */ }
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
  /** @internal */ async validCwd(path: string) {
    if (!isAbsolute(path)) throw Error("工作区必须为绝对路径");
    const cwd = await realpath(path);
    const { stat } = await import("node:fs/promises");
    if (!(await stat(cwd)).isDirectory()) throw Error("工作区不是目录");
    return cwd;
  }
  /** The app-owned inbox is always trusted; other folders need an explicit decision. */
  /** @internal */ trusted(cwd: string) {
    return cwd === this.inbox || this.settings.config.read().trustedFolders.includes(cwd);
  }
  /** @internal */ slot(id: string) {
    const slot = this.slots.get(id);
    if (!slot) throw Error("会话未加载");
    return slot;
  }
  /** @internal */ live(id: string) {
    return this.slot(id).session;
  }
  has(id: string) {
    return this.slots.has(id);
  }
  /** @internal */ emitEvent(slot: Slot, event: unknown) { return pipeline.emitEvent(this, slot, event); }
  /** @internal */ flushDelta(slot: Slot) { return pipeline.flushDelta(this, slot); }
  /** @internal */ emitStatus(slot: Slot) { return runtime.emitStatus(this, slot); }
  /** @internal */ runStatus(slot?: Slot): SessionRunStatus { return runtime.runStatus(slot); }
  /** @internal */ invalidateList() { return catalog.invalidateList(this); }
  /** @internal */ toolArgProgress(slot: Slot, source: { contentIndex?: number; delta?: string; partial?: { content?: Array<{ arguments?: unknown }> } }) { return pipeline.toolArgProgress(this, slot, source); }
  /** @internal */ onEvent(slot: Slot, event: AgentSessionEvent) { return pipeline.onEvent(this, slot, event); }
  /** @internal */ ensureTitle(slot: Slot, text: string) { return catalog.ensureTitle(this, slot, text); }
  /** @internal */ open(manager: SessionManager, modelId?: string, providerId?: string, thinkingLevel?: ThinkingLevel): Promise<Slot> { return pool.open(this, manager, modelId, providerId, thinkingLevel); }
  /** @internal */ focus(id: string) { return pool.focus(this, id); }
  newSession(cwd: string, modelId?: string, providerId?: string, thinkingLevel?: ThinkingLevel) { return pool.newSession(this, cwd, modelId, providerId, thinkingLevel); }
  all() { return catalog.all(this); }
  resolve(id: string, cwd?: string): Promise<SessionInfo> { return catalog.resolve(this, id, cwd); }
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
    // A live session opened earlier announced its plan then; the renderer may have missed it.
    pipeline.emitBranchPlan(this, slot);
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
      expert: features.sessionExpert(this, id),
    };
  }
  /** @internal */ savedModel(item: SessionInfo) { return catalog.savedModel(this, item); }
  list(cwd: string, includeArchived = false) { return catalog.list(this, cwd, includeArchived); }
  searchSessions(query: string, options: { cwd?: string; limit?: number } = {}) { return catalog.search(this, query, options); }
  running() { return pool.running(this); }
  /** @internal */ validateImages(session: AgentSession, images?: PromptImages) { return runtime.validateImages(session, images); }
  send(id: string, prompt: string, images?: PromptImages) { return runtime.send(this, id, prompt, images); }
  rewindPoints(id: string) { return features.rewindPoints(this, id); }
  /** @internal */ navigateBefore(slot: Slot, entryId: string) { return features.navigateBefore(this, slot, entryId); }
  rewind(id: string, entryId: string) { return features.rewind(this, id, entryId); }
  regenerate(id: string) { return features.regenerate(this, id); }
  /** 20261116-pii W1.1: versions of each user turn, and switching between them. */
  tree(id: string) { return features.tree(this, id); }
  navigate(id: string, entryId: string, opts?: Parameters<typeof features.navigate>[3]) { return features.navigate(this, id, entryId, opts); }
  /** 20261116-pii W1.2: `!command` / `!!command`. */
  bash(id: string, command: string, opts?: Parameters<typeof features.runBash>[3]) { return features.runBash(this, id, command, opts); }
  abortBash(id: string) { return features.abortBash(this, id); }
  artifacts(id: string) { return features.artifacts(this, id); }
  /** @internal */ writablePath(id: string, path: string) { return features.writablePath(this, id, path); }
  checkpointList(id: string, path?: string) { return features.checkpointList(this, id, path); }
  checkpointRead(id: string, hash: string) { return features.checkpointRead(this, id, hash); }
  checkpointRestore(id: string, path: string, hash: string | null) { return features.checkpointRestore(this, id, path, hash); }
  turnRevert(id: string, toolCallIds: string[], opts: { skip?: string[]; force?: boolean } = {}) { return features.turnRevert(this, id, toolCallIds, opts); }
  artifactSave(id: string, path: string, content: string, origin: "user" | "apply" = "user") { return features.artifactSave(this, id, path, content, origin); }
  setMode(id: string, mode: AgentMode) { return features.setMode(this, id, mode); }
  mode(id: string): AgentMode { return features.mode(this, id); }
  abortRetry(id: string) { return runtime.abortRetry(this, id); }
  exportHtml(id: string, outputPath: string) { return features.exportHtml(this, id, outputPath); }
  previewRoots(): string[] { return pool.previewRoots(this); }
  queueState(id: string) { return runtime.queueState(this, id); }
  clearQueue(id: string) { return runtime.clearQueue(this, id); }
  setQueue(id: string, steering: string[], followUp: string[]) { return runtime.setQueue(this, id, steering, followUp); }
  queue(id: string, kind: "steer" | "followUp", prompt: string, images?: PromptImages) { return runtime.queue(this, id, kind, prompt, images); }
  fork(id: string) { return features.fork(this, id); }
  cancel(id: string) { return runtime.cancel(this, id); }
  compact(id: string, instructions?: string) { return features.compact(this, id, instructions); }
  /** 设置 · 智能体 (pi-settings.json, 20261116-pii W0.4). */
  agentSettings() { return features.agentSettings(this); }
  setAgentSettings(patch: AgentSettingsPatch) { return features.setAgentSettings(this, patch); }
  /** Ctrl/Cmd+P over the favourite models (W1.6). */
  cycleModel(id: string, direction?: "forward" | "backward") { return features.cycleModel(this, id, direction); }
  close(id: string) { return pool.close(this, id); }
  shutdown() { return pool.shutdown(this); }
  /** @internal */ evictOverflow(keep: string) { return pool.evictOverflow(this, keep); }
  evictIdle(now = Date.now()) { return pool.evictIdle(this, now); }
  rename(id: string, title: string) { return catalog.rename(this, id, title); }
  metadata(id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) { return catalog.metadata(this, id, patch); }
  delete(id: string) { return catalog.deleteSession(this, id); }
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
      supportsThinking: s.supportsThinking(),
      mode: this.mode(id),
      // The expert bound on the current branch (W2.2): the header badge follows branch moves.
      expert: features.sessionExpert(this, id),
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
      // `mode` comes with the model state below (W0.5).
      cost: stats.cost,
      autoCompaction: session.autoCompactionEnabled,
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
    const session = this.live(id),
      stats = session.getSessionStats();
    return {
      cost: features.sessionCost(session),
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
      disabled: c.extensionDisabled ?? [],
      projectTrusted: this.trusted(this.currentCwd),
    };
  }
  /** 扩展中心 (W2.6): the configured paths plus what each one registers and why it failed. */
  async extensionsList(cwd?: string) {
    const cfg = this.extensionsConfig();
    const items = await features.inspectExtensions(this, cfg.paths, cwd ?? this.currentCwd);
    return {
      ...cfg,
      items: items.map((item) => ({ ...item, enabled: !cfg.disabled.includes(item.path) })),
      errors: this.extensionErrors,
    };
  }
  /** Preview one path in an isolated loader before it is added (W2.6). */
  async extensionsInspect(path: string, cwd?: string) {
    const [report] = await features.inspectExtensions(this, [path], cwd ?? this.currentCwd);
    return report;
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
        // Load it alone first: a broken extension is refused here, instead of breaking every session
        // that is opened (or rebuilt) afterwards (W2.6).
        const report = await this.extensionsInspect(path);
        if (!report.ok) throw Error(`extension_load_failed: ${report.error}`);
      }
      next.extensionPaths = (next.extensionPaths ?? []).filter(
        (p) => p !== path,
      );
      if (action === "add") next.extensionPaths.push(path);
      // A removed path also leaves the disabled list; a re-added one starts enabled again.
      next.extensionDisabled = (next.extensionDisabled ?? []).filter((p) => p !== path);
    }
    this.settings.config.write(next);
    this.extensionsDirty = true;
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
  /** 开关单个扩展（W2.6）：禁用只写入 extensionDisabled，不改动已配置的路径。 */
  async setExtensionPathEnabled(path: string, enabled: boolean) {
    // Configured paths are canonical (`configureExtensions` realpaths on add); match them.
    try { path = await realpath(path); } catch { /* already gone: keep the given path */ }
    const previous = this.settings.config.read(),
      next = structuredClone(previous);
    const disabled = (next.extensionDisabled ?? []).filter((p) => p !== path);
    if (!enabled) disabled.push(path);
    next.extensionDisabled = disabled;
    this.settings.config.write(next);
    this.extensionsDirty = true;
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
    return this.extensionsList();
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
  reload(filter: (slot: Slot) => boolean = () => true) { return pool.reload(this, filter); }
  /** @internal */ rebuild(slot: Slot) { return pool.rebuild(this, slot); }
}
