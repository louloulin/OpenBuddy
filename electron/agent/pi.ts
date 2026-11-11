import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { mkdir, realpath, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, isAbsolute, sep } from "node:path";
import { Providers } from "../services/providers.js";
import { SkillsService } from "../services/skills.js";
import { McpService } from "../services/mcp.js";
import type { Settings } from "../services/settings.js";
import { Permissions, type Emit } from "./permissions.js";
export class PiEngine {
  readonly permissions: Permissions;
  readonly providers: Providers;
  readonly skills: SkillsService;
  readonly mcp: McpService;
  private session?: AgentSession;
  private unsubscribe?: () => void;
  private cwd: string;
  private sessionDir: string;
  private busy = false;
  private transitioning = false;
  constructor(
    readonly settings: Settings,
    readonly emit: Emit,
  ) {
    this.cwd = join(settings.dir, "inbox");
    this.permissions = new Permissions(settings, emit);
    this.providers = new Providers(settings);
    this.skills = new SkillsService(settings);
    this.mcp = new McpService(settings);
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
    return {
      ok: auth.ready,
      auth,
      cwd: this.cwd,
      agentVersion: "1.5.2",
      defaultModelId: this.providers.model()?.id,
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
  private async replace(manager: SessionManager, modelId?: string) {
    if (this.transitioning) throw Error("会话切换正在进行");
    this.transitioning = true;
    try {
      await this.shutdown();
      this.cwd = manager.getCwd();
      const trusted = this.settings.config
        .read()
        .trustedFolders.includes(this.cwd);
      if (!trusted) this.emit("agent://folder-trust", { cwd: this.cwd });
      const sdkSettings = SettingsManager.inMemory(
        { retry: { enabled: false }, compaction: { enabled: false } },
        { projectTrusted: trusted },
      );
      const loader = new DefaultResourceLoader({
        cwd: this.cwd,
        agentDir: this.settings.dir,
        settingsManager: sdkSettings,
        noExtensions: true,
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
        ],
      });
      await loader.reload();
      const saved = manager.buildSessionContext().model;
      const model = this.providers.model(modelId ?? saved?.modelId);
      if (!model) throw Error(modelId ? "模型不存在" : "请先配置提供商和模型");
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
        thinkingLevel: "off",
      });
      this.session = session;
      const sessionId = session.sessionId;
      this.unsubscribe = session.subscribe((event) => {
        this.emit("agent://event", { sessionId, event });
        if (
          event.type === "message_end" &&
          event.message.role === "assistant" &&
          ["error", "aborted"].includes(event.message.stopReason)
        ) {
          if (event.message.stopReason === "error")
            this.emit("agent://turn-error", {
              sessionId,
              kind: "error",
              detail: event.message.errorMessage ?? "模型请求失败",
            });
        }
      });
      await session.bindExtensions({
        mode: "rpc",
        onError: (error) =>
          this.emit("agent://error", { sessionId, message: error.error }),
      });
      return sessionId;
    } finally {
      this.transitioning = false;
    }
  }
  async newSession(cwd: string, modelId?: string) {
    const actual = await this.validCwd(cwd);
    return this.replace(
      SessionManager.create(actual, this.sessionDir),
      modelId,
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
  }
  async list(cwd: string) {
    cwd = await this.validCwd(cwd);
    const meta = this.settings.config.read().sessions,
      items = (await this.all()).filter((s) => s.cwd === cwd);
    const result = items.map((s) => ({
      sessionId: s.id,
      title: meta[s.id]?.title ?? s.name ?? s.firstMessage ?? "新会话",
      updatedAt: s.modified.toISOString(),
      cwd: s.cwd,
      pinned: meta[s.id]?.pinned ?? false,
      archived: meta[s.id]?.archived ?? false,
      currentModelId: SessionManager.open(
        s.path,
        this.sessionDir,
      ).buildSessionContext().model?.modelId,
      status: "completed",
    }));
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
        status: "pending",
      });
    return result;
  }
  async send(id: string, prompt: string) {
    const session = this.live(id);
    if (this.busy || this.transitioning) throw Error("会话忙碌");
    this.busy = true;
    try {
      await session.prompt(prompt);
    } catch (error) {
      this.emit("agent://turn-error", {
        sessionId: id,
        kind: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.permissions.cancel(id);
      this.busy = false;
    }
  }
  async cancel(id: string) {
    this.permissions.cancel(id);
    await this.live(id).abort();
  }
  async shutdown() {
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
  async setModel(id: string, modelId: string) {
    if (this.busy) throw Error("请等待当前回复完成");
    const model = this.providers.model(modelId);
    if (!model) throw Error("模型不存在");
    await this.live(id).setModel(model);
  }
  info(id: string) {
    const session = this.live(id),
      stats = session.getSessionStats(),
      usage = session.getContextUsage();
    const used = usage?.tokens ?? 0,
      total = session.model?.contextWindow ?? 0;
    return {
      sessionId: id,
      cwd: session.sessionManager.getCwd(),
      model: session.model?.id,
      modelDisplayName: session.model?.name,
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
    return this.skills
      .list(this.cwd)
      .filter((s) => s.enabled)
      .map((s) => ({
        name: `skill:${s.name}`,
        description: s.description,
        source: "skill",
      }));
  }
  get currentCwd() {
    return this.cwd;
  }
  get currentSessionId() {
    return this.session?.sessionId;
  }
  async setFolderTrust(cwd: string, trusted: boolean) {
    cwd = await this.validCwd(cwd);
    const c = this.settings.config.read();
    c.trustedFolders = c.trustedFolders.filter((p) => p !== cwd);
    if (trusted) c.trustedFolders.push(cwd);
    this.settings.config.write(c);
    if (this.session?.sessionManager.getCwd() === cwd)
      this.session.settingsManager.setProjectTrusted(trusted);
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
