import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type SessionInfo,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { mkdir, realpath, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, isAbsolute, sep } from "node:path";
import { Providers, modelKey } from "../services/providers.js";
import { ExtensionUiBridge } from "./ui.js";
export type ThinkingLevel = Parameters<AgentSession["setThinkingLevel"]>[0];
export function validateThinkingLevel(value: unknown): ThinkingLevel {
  if (
    typeof value !== "string" ||
    !["off", "minimal", "low", "medium", "high", "xhigh"].includes(value)
  )
    throw Error("invalid_thinking_level");
  return value as ThinkingLevel;
}
type PromptImages = NonNullable<
  Parameters<AgentSession["prompt"]>[1]
>["images"];
import { SkillsService } from "../services/skills.js";
import { McpService } from "../services/mcp.js";
import type { Settings } from "../services/settings.js";
import { Permissions, type Emit } from "./permissions.js";
export class PiEngine {
  readonly permissions: Permissions;
  readonly ui: ExtensionUiBridge;
  readonly providers: Providers;
  readonly skills: SkillsService;
  readonly mcp: McpService;
  private session?: AgentSession;
  private unsubscribe?: () => void;
  private cwd: string;
  private sessionDir: string;
  private busy = false;
  private generation = 0;
  private cancelledGeneration = 0;
  private commandError?: string;
  private transitioning = false;
  constructor(
    readonly settings: Settings,
    readonly emit: Emit,
    openUrl: (url: string) => Promise<void>,
    private extensionFactories: ExtensionFactory[] = [],
  ) {
    this.cwd = join(settings.dir, "inbox");
    this.permissions = new Permissions(settings, emit);
    this.ui = new ExtensionUiBridge(emit);
    this.providers = new Providers(settings);
    this.skills = new SkillsService(settings);
    this.mcp = new McpService(settings, openUrl, emit);
    this.sessionDir = join(settings.dir, "sessions");
  }
  async initialize() {
    await mkdir(this.cwd, { recursive: true, mode: 0o700 });
    this.cwd = await realpath(this.cwd);
    await mkdir(this.sessionDir, { recursive: true, mode: 0o700 });
    await this.providers.initialize();
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
      agentVersion: "1.5.2",
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
  private live(id: string) {
    if (!this.session || this.session.sessionId !== id)
      throw Error("会话未加载");
    return this.session;
  }
  private async replace(
    manager: SessionManager,
    modelId?: string,
    providerId?: string,
    thinkingLevel?: ThinkingLevel,
  ) {
    if (this.transitioning) throw Error("会话切换正在进行");
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
    const requestedThinking =
      thinkingLevel ??
      (manager.getEntries().some((e) => e.type === "thinking_level_change")
        ? validateThinkingLevel(savedContext.thinkingLevel)
        : this.settings.config.read().defaults.defaultThinkingLevel
          ? validateThinkingLevel(
              this.settings.config.read().defaults.defaultThinkingLevel,
            )
          : undefined);
    this.transitioning = true;
    try {
      await this.shutdown();
      this.cwd = manager.getCwd();
      const trusted = this.settings.config
        .read()
        .trustedFolders.includes(this.cwd);
      if (
        !trusted &&
        this.settings.config.read().folderTrustDecisions?.[this.cwd] ===
          undefined
      )
        this.emit("agent://folder-trust", { cwd: this.cwd });
      const sdkSettings = SettingsManager.inMemory(
        {},
        { projectTrusted: trusted },
      );
      const loader = new DefaultResourceLoader({
        cwd: this.cwd,
        agentDir: this.settings.dir,
        settingsManager: sdkSettings,
        noExtensions: !(
          this.settings.config.read().extensionsEnabled && trusted
        ),
        additionalExtensionPaths: this.settings.config.read().extensionsEnabled
          ? (this.settings.config.read().extensionPaths ?? [])
          : [],
        noContextFiles: !trusted,
        noPromptTemplates: true,
        noThemes: true,
        noSkills: true,
        skillsOverride: () => ({
          skills: this.skills.active(this.cwd),
          diagnostics: [],
        }),
        extensionFactories: [
          this.permissions.extension(manager.getSessionId()),
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
        cwd: this.cwd,
        agentDir: this.settings.dir,
        modelRuntime: this.providers.runtime,
        sessionManager: manager,
        resourceLoader: loader,
        settingsManager: sdkSettings,
        model,
        tools: [
          "read",
          "bash",
          "edit",
          "write",
          "grep",
          "find",
          "ls",
          "mcp__*",
        ],
        thinkingLevel: requestedThinking,
      });
      this.session = session;
      const sessionId = session.sessionId;
      let finalError: string | undefined;
      this.unsubscribe = session.subscribe((event) => {
        this.emit("agent://event", { sessionId, event });
        if (event.type === "agent_start") finalError = undefined;
        if (
          event.type === "message_end" &&
          event.message.role === "assistant"
        ) {
          finalError =
            event.message.stopReason === "error"
              ? (event.message.errorMessage ?? "模型请求失败")
              : undefined;
        }
        // An errored attempt may still be retried or recovered by compaction.
        // Report a terminal error only once the SDK has completely settled.
        if (event.type === "agent_settled" && !event.aborted && finalError) {
          this.emit("agent://turn-error", {
            sessionId,
            kind: "error",
            detail: finalError,
          });
          finalError = undefined;
        }
      });
      await session.bindExtensions({
        mode: "rpc",
        uiContext: this.ui.context(sessionId),
        onError: (error) => {
          if (
            error.event === "command" &&
            this.session === session &&
            this.busy
          )
            this.commandError = error.error;
          else this.emit("agent://error", { sessionId, message: error.error });
        },
      });
      this.emit("agent://model-state", this.modelState(sessionId));
      return sessionId;
    } finally {
      this.transitioning = false;
    }
  }
  async newSession(
    cwd: string,
    modelId?: string,
    providerId?: string,
    thinkingLevel?: ThinkingLevel,
  ) {
    const actual = await this.validCwd(cwd);
    return this.replace(
      SessionManager.create(actual, this.sessionDir),
      modelId,
      providerId,
      thinkingLevel,
    );
  }
  async all() {
    return SessionManager.listAll(this.sessionDir);
  }
  async resolve(id: string, cwd?: string): Promise<SessionInfo> {
    const canonicalCwd = cwd ? await this.validCwd(cwd) : undefined;
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
  async load(id: string, cwd?: string) {
    const item = await this.resolve(id, cwd);
    await this.replace(SessionManager.open(item.path, this.sessionDir));
    for (const message of this.session!.messages) {
      this.emit("agent://event", {
        sessionId: id,
        event: { type: "message_start", message },
      });
      this.emit("agent://event", {
        sessionId: id,
        event: { type: "message_end", message },
      });
    }
    this.emit("agent://event", {
      sessionId: id,
      event: { type: "agent_settled", replay: true },
    });
    return this.modelState(id);
  }
  async list(cwd: string) {
    cwd = await this.validCwd(cwd);
    const meta = this.settings.config.read().sessions,
      items = (await this.all()).filter((s) => s.cwd === cwd);
    const result = items.map((s) => {
      const savedModel = SessionManager.open(
        s.path,
        this.sessionDir,
      ).buildSessionContext().model;
      return {
        sessionId: s.id,
        title: meta[s.id]?.title ?? s.name ?? s.firstMessage ?? "新会话",
        updatedAt: s.modified.toISOString(),
        cwd: s.cwd,
        pinned: meta[s.id]?.pinned ?? false,
        archived: meta[s.id]?.archived ?? false,
        currentModelId: savedModel?.modelId,
        currentProviderId: savedModel?.provider,
        currentModelKey: savedModel
          ? modelKey(savedModel.provider, savedModel.modelId)
          : undefined,
        status: "completed",
      };
    });
    if (
      this.session?.sessionManager.getCwd() === cwd &&
      !result.some((s) => s.sessionId === this.session!.sessionId)
    )
      result.unshift({
        sessionId: this.session.sessionId,
        title: meta[this.session.sessionId]?.title ?? "新会话",
        updatedAt: new Date().toISOString(),
        cwd,
        pinned: false,
        archived: false,
        currentModelId: this.session.model?.id,
        currentProviderId: this.session.model?.provider,
        currentModelKey: this.session.model
          ? modelKey(this.session.model.provider, this.session.model.id)
          : undefined,
        status: "pending",
      });
    return result;
  }
  private validateImages(session: AgentSession, images?: PromptImages) {
    if (images?.length && !session.model?.input.includes("image"))
      throw Error("model_does_not_support_images: 当前模型不支持图片输入");
  }
  async send(id: string, prompt: string, images?: PromptImages) {
    const session = this.live(id);
    if (this.busy || this.transitioning) throw Error("会话忙碌");
    if (
      !session.model ||
      !this.providers.model(session.model.id, session.model.provider)
    )
      throw Error("model_not_found: 当前模型已删除，请重新选择");
    this.validateImages(session, images);
    this.busy = true;
    this.commandError = undefined;
    const generation = ++this.generation;
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
        generation === this.generation &&
        this.commandError
      )
        throw Error(this.commandError);
      // Extension commands are truly handled without an agent run, so Pi emits no settled.
      // Complete the host's send lifecycle only after the command handler has finished.
      if (disposition === "handled" && generation === this.generation)
        this.emit("agent://event", {
          sessionId: id,
          event: {
            type: "agent_settled",
            aborted: this.cancelledGeneration === generation,
            commandHandled: true,
          },
        });
    } catch (error) {
      this.emit("agent://turn-error", {
        sessionId: id,
        kind: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (generation === this.generation) {
        this.permissions.cancel(id);
        this.busy = false;
      }
    }
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
  async queue(
    id: string,
    kind: "steer" | "followUp",
    prompt: string,
    images?: PromptImages,
  ) {
    const session = this.live(id);
    if (!this.busy || this.transitioning)
      throw Error("queue_unavailable: 当前没有运行中的会话");
    this.validateImages(session, images);
    const disposition =
      kind === "steer"
        ? await session.steer(prompt, images)
        : await session.followUp(prompt, images);
    return { ...this.queueState(id), disposition };
  }
  async fork(id: string) {
    this.assertIdle();
    const session = this.live(id),
      file = session.sessionManager.getSessionFile();
    if (!file || !existsSync(file))
      throw Error("fork_requires_history: 请先发送消息");
    return this.replace(
      SessionManager.forkFrom(
        file,
        session.sessionManager.getCwd(),
        this.sessionDir,
      ),
    );
  }
  assertIdle() {
    if (this.busy || this.transitioning) throw Error("会话忙碌");
  }
  async cancel(id: string) {
    this.live(id);
    this.cancelledGeneration = this.generation;
    this.ui.cancel(id, "cancelled");
    this.mcp.auth.cancel(id);
    await this.mcp.auth.settle();
    this.permissions.cancel(id);
    await this.live(id).abort();
  }
  async shutdown() {
    this.generation++;
    this.ui.cancel(undefined, "session_closed");
    this.mcp.auth.cancel();
    await this.mcp.auth.settle();
    this.permissions.cancel();
    const session = this.session;
    if (session) {
      await session.abort();
      try {
        await session.extensionRunner.emit({
          type: "session_shutdown",
          reason: "quit",
        });
      } finally {
        session.dispose();
      }
    }
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.session = undefined;
    this.busy = false;
  }
  async rename(id: string, title: string) {
    if (this.session?.sessionId === id) this.session.setSessionName(title);
    else {
      const item = await this.resolve(id);
      SessionManager.open(item.path, this.sessionDir).appendSessionInfo(title);
    }
    this.metadata(id, { title });
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
    if (this.session?.sessionId === id) {
      const file = this.session.sessionManager.getSessionFile();
      await this.shutdown();
      if (file) {
        try {
          await unlink(file);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
    } else await unlink((await this.resolve(id)).path);
    const c = this.settings.config.read();
    delete c.sessions[id];
    this.settings.config.write(c);
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
    if (this.busy || this.transitioning) throw Error("请等待当前回复完成");
    const session = this.live(id),
      model = this.providers.model(modelId, providerId);
    if (!model) throw Error("model_not_found: 模型不存在");
    if (!this.providers.runtime.hasConfiguredAuth(model.provider))
      throw Error("model_auth_missing: 提供商尚未认证");
    this.transitioning = true;
    try {
      await session.setModel(model);
      const state = this.modelState(id);
      this.emit("agent://model-state", state);
      return state;
    } finally {
      this.transitioning = false;
    }
  }
  setThinkingLevel(id: string, level: unknown) {
    const session = this.live(id);
    if (this.busy || this.transitioning) throw Error("请等待当前回复完成");
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
    return {
      cwd: session.sessionManager.getCwd(),
      model: session.model?.id,
      modelDisplayName: session.model?.name,
      ...this.modelState(id),
      context: {
        used,
        total,
        usagePct: total ? (used / total) * 100 : 0,
        systemPromptTokens: 0,
        toolDefinitionsCount: session.getAllTools().length,
        toolDefinitionsTokens: 0,
        messageCount: stats.totalMessages,
        messageTokens: used,
        turnCount: stats.userMessages,
        toolCallCount: stats.toolCalls,
        compactionCount: session.sessionManager
          .getEntries()
          .filter((e) => e.type === "compaction").length,
        freeTokens: Math.max(0, total - used),
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
      .list(this.cwd)
      .filter((s) => s.enabled)
      .map((s) => ({
        name: `skill:${s.name}`,
        description: s.description,
        source: "skill",
      }));
    const extensions =
      this.session?.extensionRunner.getRegisteredCommands().map((c) => ({
        name: c.invocationName,
        description: c.description,
        source: "extension",
      })) ?? [];
    return [...skills, ...extensions];
  }
  extensionsConfig() {
    const c = this.settings.config.read();
    return {
      enabled: c.extensionsEnabled ?? false,
      paths: c.extensionPaths ?? [],
      projectTrusted: c.trustedFolders.includes(this.cwd),
    };
  }
  async configureExtensions(
    action: "add" | "remove" | "enabled",
    value: string | boolean,
  ) {
    this.assertIdle();
    const previous = this.settings.config.read(),
      next = structuredClone(previous),
      manager = this.session?.sessionManager;
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
      if (manager) {
        try {
          await this.replace(manager);
        } catch {
          /* Preserve the original load failure. */
        }
      }
      throw error;
    }
    return this.extensionsConfig();
  }
  get currentCwd() {
    return this.cwd;
  }
  get currentSessionId() {
    return this.session?.sessionId;
  }
  async setFolderTrust(cwd: string, trusted: boolean) {
    cwd = await this.validCwd(cwd);
    const c = this.settings.config.read(),
      previous = c.trustedFolders.includes(cwd),
      current = this.session?.sessionManager.getCwd() === cwd;
    if (current && previous !== trusted) this.assertIdle();
    c.trustedFolders = c.trustedFolders.filter((p) => p !== cwd);
    if (trusted) c.trustedFolders.push(cwd);
    c.folderTrustDecisions = { ...c.folderTrustDecisions, [cwd]: trusted };
    this.settings.config.write(c);
    if (current) {
      this.session!.settingsManager.setProjectTrusted(trusted);
      if (previous !== trusted) await this.reload();
    }
  }
  async reload() {
    if (this.busy) throw Error("请等待当前回复完成");
    if (this.session) {
      const id = this.session.sessionId,
        file = this.session.sessionManager.getSessionFile();
      const manager =
        file && existsSync(file)
          ? SessionManager.open(file, this.sessionDir)
          : this.session.sessionManager;
      await this.replace(manager);
      if (this.session?.sessionId !== id) throw Error("会话重载身份发生变化");
    }
  }
}
