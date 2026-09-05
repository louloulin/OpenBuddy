/**
 * OpenBuddy 插件面板 — 显示 main agent 已加载的 Harness 插件 + renderer
 * 侧通过 `@openbuddy/renderer-host` 注册的 contribution。
 *
 * 与 `PluginsPanel.tsx`（对接遗留 pi x.ai/plugins 系统）不同：
 * 这个面板走的是 OpenBuddy 自家的 plugin host + renderer 桥接，
 * 是 PI 为核心 AI Agent 架构的可观察面。
 */
import { useEffect, useMemo, useState } from "react";
import {
  PuzzlePieceIcon,
  RefreshCwIcon,
} from "@openbuddy/ui-primitives/icons";
import {
  agentGetStoredPluginState,
  agentPluginInventory,
  agentDeepSeekCordisSnapshot,
  agentResourceInventory,
  agentOnPluginEvent,
  agentSessionEventLog,
  agentReloadPlugin,
  agentResetPluginState,
  agentSetPluginEnabled,
  agentUpdatePluginConfig,
  agentProfilePackages,
  agentInstallProfilePackage,
  agentRemoveProfilePackage,
  agentInstallDefaultPiPackages,
  type OpenBuddyDefaultPiPackageResult,
  type OpenBuddyPluginStateSnapshot,
  type OpenBuddyPluginStatus,
  type OpenBuddySessionEventRecord,
  type OpenBuddyProfilePackage,
  type OpenBuddyResourceInventory,
} from "@/lib/agent/pi-client";
import { open as openDialog } from "@/lib/platform/electron-api";
import {
  useMainPluginInventory,
  usePluginSnapshot,
  usePluginReadiness,
  useRendererContributions,
} from "@/lib/runtime/renderer-plugin-runtime";
import type { RendererContribution } from "@openbuddy/renderer-host";

interface OpenBuddyPluginPanelProps {
  /** Optional toast handler so the panel can surface refresh errors. */
  onToast?: (msg: string) => void;
}

const STATUS_COLORS: Record<OpenBuddyPluginStatus["state"], string> = {
  pending: "#9ca3af",
  loaded: "#22c55e",
  disabled: "#9ca3af",
  failed: "#ef4444",
  unloaded: "#9ca3af",
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleTimeString();
}

function isObservablePluginEvent(type: string): boolean {
  return type.startsWith("plugin/") || type.startsWith("hook/") || type.startsWith("deepseek-cordis/");
}

function eventSummary(entry: OpenBuddySessionEventRecord): string | undefined {
  if (!entry.payload || typeof entry.payload !== "object") return undefined;
  const payload = entry.payload as Record<string, unknown>;
  if (typeof payload.systemMessage === "string") return payload.systemMessage;
  if (typeof payload.stopReason === "string") return payload.stopReason;
  if (typeof payload.error === "string") return payload.error;
  return undefined;
}

function normalizeResourceInventory(value: Partial<OpenBuddyResourceInventory>): OpenBuddyResourceInventory {
  return {
    extensions: [],
    agents: [],
    skills: [],
    prompts: [],
    themes: [],
    hooks: [],
    diagnostics: [],
    ...value,
  };
}

export function OpenBuddyPluginPanel({ onToast }: OpenBuddyPluginPanelProps) {
  // The unified inventory keeps Cordis, Pi, and renderer plugin state together.
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const inventory = useMainPluginInventory(inventoryRevision);
  const readiness = usePluginReadiness(inventoryRevision);
  const pluginSnapshot = usePluginSnapshot(inventoryRevision);
  const [deepSeekCordis, setDeepSeekCordis] = useState<{ disposed: boolean; plugins: Array<{ state: string }>; services: string[]; capabilities: Array<{ service: string; methods: string[] }> } | null>(null);
  const snapshot = [...inventory.entries, ...inventory.piExtensions].map((entry) => ({
    ...entry,
    kind: entry.kind ?? "cordis",
  }));
  const sidebarContribs = useRendererContributions("sidebar");
  const composerContribs = useRendererContributions("composer");
  const [refreshing, setRefreshing] = useState(false);
  const [installingDefaultPi, setInstallingDefaultPi] = useState(false);
  const [stored, setStored] = useState<OpenBuddyPluginStateSnapshot | null>(null);
  const [profilePackages, setProfilePackages] = useState<OpenBuddyProfilePackage[]>([]);
  const [resources, setResources] = useState<OpenBuddyResourceInventory>({ extensions: [], agents: [], skills: [], prompts: [], themes: [], hooks: [], diagnostics: [] });
  const [packageSource, setPackageSource] = useState("");
  const [installingSource, setInstallingSource] = useState(false);
  const providers = useMemo(() => [...(inventory.providers ?? [])].sort((a, b) => a.id.localeCompare(b.id)), [inventory.providers]);

  const refreshStored = async () => {
    try {
      setStored(await agentGetStoredPluginState());
    } catch (error) {
      onToast?.(`读取持久化失败：${String(error).replace(/^Error:\s*/, "")}`);
    }
  };

  useEffect(() => {
    void refreshStored();
    void agentDeepSeekCordisSnapshot().then((value) => setDeepSeekCordis(value as typeof deepSeekCordis)).catch(() => undefined);
    void agentProfilePackages().then(setProfilePackages).catch(() => undefined);
    void agentResourceInventory().then((value) => setResources(normalizeResourceInventory(value))).catch(() => undefined);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const inventory = await agentPluginInventory();
      void agentDeepSeekCordisSnapshot().then((value) => setDeepSeekCordis(value as typeof deepSeekCordis)).catch(() => undefined);
      setInventoryRevision((revision) => revision + 1);
      await refreshStored();
      setProfilePackages(await agentProfilePackages());
      setResources(normalizeResourceInventory(await agentResourceInventory()));
      // The hook keeps state in sync via plugin events; we just surface the
      // latest count here so the button has observable feedback.
      onToast?.(`已刷新 ${inventory.entries.length + inventory.piExtensions.length + inventory.packages.length} 个插件包`);
    } catch (error) {
      onToast?.(`刷新失败：${String(error).replace(/^Error:\s*/, "")}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleInstallDefaultPi = async (force: boolean) => {
    if (installingDefaultPi) return;
    setInstallingDefaultPi(true);
    try {
      const results = await agentInstallDefaultPiPackages({ force });
      const installed = results.filter((entry) => entry.status === "installed");
      const skipped = results.filter((entry) => entry.status === "skipped");
      const failed = results.filter((entry) => entry.status === "failed");
      onToast?.(
        `默认 Pi bundle：installed=${installed.length} skipped=${skipped.length} failed=${failed.length}` +
        (failed.length ? `（失败：${failed.map((entry) => `${entry.spec}: ${entry.error ?? "unknown"}`).join("；")}）` : ""),
      );
      await refreshStored();
      setProfilePackages(await agentProfilePackages());
    } catch (error) {
      onToast?.(`默认 Pi bundle 安装失败：${String(error).replace(/^Error:\s*/, "")}`);
    } finally {
      setInstallingDefaultPi(false);
    }
  };

  const defaultPiPackagesInstalled = useMemo(() => {
    if (!profilePackages.length) return false;
    const names = new Set(profilePackages.map((entry) => entry.name));
    return ["pi-context-prune", "pi-mcp-adapter", "pi-web-access", "pi-goal", "pi-plan-mode", "pi-subagents"].some((name) => names.has(name));
  }, [profilePackages]);

  const handleInstallPackage = async () => {
    const selected = await openDialog({ directory: true, multiple: false, title: "选择 profile package 目录" });
    if (!selected || Array.isArray(selected)) return;
    const sourcePath = selected;
    try {
      const installed = await agentInstallProfilePackage(sourcePath);
      setProfilePackages(await agentProfilePackages());
      onToast?.(`已安装 profile package「${installed.name}」`);
    } catch (error) {
      onToast?.(`安装失败：${String(error).replace(/^Error:\s*/, "")}`);
    }
  };

  const handleInstallPackageSource = async () => {
    const source = packageSource.trim();
    if (!source || installingSource) return;
    setInstallingSource(true);
    try {
      const installed = await agentInstallProfilePackage(source.trim());
      setProfilePackages(await agentProfilePackages());
      setPackageSource("");
      onToast?.(`已安装 profile package「${installed.name}」`);
    } catch (error) {
      onToast?.(`安装失败：${String(error).replace(/^Error:\s*/, "")}`);
    } finally {
      setInstallingSource(false);
    }
  };

  const handleRemovePackage = async (name: string) => {
    try {
      await agentRemoveProfilePackage(name);
      setProfilePackages(await agentProfilePackages());
      onToast?.(`已移除 profile package「${name}」`);
    } catch (error) {
      onToast?.(`移除失败：${String(error).replace(/^Error:\s*/, "")}`);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const next = await agentSetPluginEnabled(id, enabled);
      onToast?.(enabled ? `已启用「${id}」` : `已禁用「${id}」`);
      if (!next) onToast?.(`未找到插件 ${id}`);
    } catch (error) {
      onToast?.(`操作失败：${String(error).replace(/^Error:\s*/, "")}`);
    }
  };

  const handleReload = async (id: string) => {
    try {
      await agentReloadPlugin(id);
      onToast?.(`已重载「${id}」`);
    } catch (error) {
      onToast?.(`重载失败：${String(error).replace(/^Error:\s*/, "")}`);
    }
  };

  const handleReset = async (id: string) => {
    try {
      const next = await agentResetPluginState(id);
      setStored(next);
      onToast?.(`已清除「${id}」的持久化覆盖`);
    } catch (error) {
      onToast?.(`清除失败：${String(error).replace(/^Error:\s*/, "")}`);
    }
  };

  const handleConfigSave = async (id: string, config: unknown) => {
    try {
      await agentUpdatePluginConfig(id, config);
      await refreshStored();
      setInventoryRevision((revision) => revision + 1);
      onToast?.(`已保存「${id}」的配置`);
    } catch (error) {
      throw new Error(`保存失败：${String(error).replace(/^Error:\s*/, "")}`);
    }
  };

  // Listen for the live event stream so the panel can log recent activity.
  const [recentEvents, setRecentEvents] = useState<OpenBuddySessionEventRecord[]>([]);
  useEffect(() => {
    let cancelled = false;
    void agentSessionEventLog({ limit: 2000 }).then((history) => {
      if (cancelled) return;
      setRecentEvents(
        history
          .filter((event) => isObservablePluginEvent(event.type))
          .slice(-10)
          .map((event) => event),
      );
    });
    const unlistenPromise = agentOnPluginEvent((event) => {
      if (event.type.startsWith("deepseek-cordis/") || event.type.startsWith("profile/") || event.type.startsWith("pi/")) {
        void agentDeepSeekCordisSnapshot().then((value) => setDeepSeekCordis(value as typeof deepSeekCordis)).catch(() => undefined);
        void agentResourceInventory().then((value) => setResources(normalizeResourceInventory(value))).catch(() => undefined);
      }
      if (!isObservablePluginEvent(event.type)) return;
      setRecentEvents((prev) => {
        const next = event.sequence && event.timestamp
          ? [...prev, event as OpenBuddySessionEventRecord]
          : prev;
        return next.length > 10 ? next.slice(next.length - 10) : next;
      });
    });
    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const sortedPlugins = useMemo(
    () => [...snapshot].sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot],
  );

  return (
    <div className="openbuddy-plugin-panel">
      {/* UX-3: clarify the relationship between this panel (OpenBuddy's
          plugin host + Cordis services + pi profile.piExtensions) and the
          legacy PluginsPanel (pi x.ai/plugins). The two panels previously
          sat side by side with no cross-link, so users did not know which
          to use when; the banner explains when each applies and points
          users at the doc that documents the priority decision. */}
      <div className="openbuddy-plugin-panel__cross-link" role="note">
        <span className="openbuddy-plugin-panel__cross-link-icon" aria-hidden="true">π</span>
        <span className="openbuddy-plugin-panel__cross-link-text">
          本面板是 OpenBuddy 自家 plugin host + Cordis 服务 + pi <code>profile.piExtensions</code> 的统一视图。
          查看 legacy pi <code>x.ai/plugins</code>（enable/disable）请切到「插件」标签。
        </span>
        <a
          href="https://github.com/louloulin/OpenBuddy/blob/main/docs/PI-PRIORITY.md"
          target="_blank"
          rel="noreferrer"
          className="openbuddy-plugin-panel__cross-link-doc"
        >
          Pi 优先级文档
        </a>
      </div>
      <header className="panel-header">
        <div className="panel-header__title">
          <PuzzlePieceIcon />
          <h3>OpenBuddy 插件</h3>
        </div>
        <button
          type="button"
          className="panel-header__refresh"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCwIcon className={refreshing ? "spin" : ""} />
          {refreshing ? "刷新中…" : "刷新"}
        </button>
        <button
          type="button"
          className="panel-header__default-pi"
          onClick={() => void handleInstallDefaultPi(false)}
          disabled={installingDefaultPi || defaultPiPackagesInstalled}
          title={defaultPiPackagesInstalled ? "默认 Pi bundle 已经安装，禁用按钮以避免误触" : "安装 6 个 E2E 验证过的 Pi 包 (pi-context-prune / pi-mcp-adapter / pi-web-access / pi-goal / pi-plan-mode / pi-subagents)"}
          data-testid="openbuddy-plugin-install-default-pi"
        >
          {installingDefaultPi ? "安装默认 Pi bundle…" : defaultPiPackagesInstalled ? "默认 Pi bundle 已启用" : "启用默认 Pi bundle"}
        </button>
      </header>

      <section className="panel-section">
        <h4>运行时 readiness</h4>
        <p className="panel-section__hint" data-testid="openbuddy-plugin-readiness">
          {readiness.phase} · generation {readiness.generation} · Main {readiness.main.loaded} loaded / {readiness.main.pending} pending / {readiness.main.failed} failed · Pi {readiness.pi.loaded} loaded / {readiness.pi.pending} pending / {readiness.pi.failed} failed
          {readiness.error ? ` · ${readiness.error}` : ""}
        </p>
        {pluginSnapshot && (
          <p className="panel-section__hint" data-testid="openbuddy-plugin-consistency">
            跨端一致性：{pluginSnapshot.consistency.complete ? "完整" : "待完成"} · {pluginSnapshot.packages.length} 个 profile package · 缺失面 {pluginSnapshot.consistency.issues.length}
          </p>
        )}
        <p className="panel-section__hint" data-testid="deepseek-cordis-runtime">
          DeepSeek Cordis：{deepSeekCordis ? (deepSeekCordis.disposed ? "已释放" : "隔离运行中") : "未启用"}
          {deepSeekCordis ? ` · ${deepSeekCordis.plugins.filter((plugin) => plugin.state === "active").length} active plugins · ${deepSeekCordis.services.length} services · ${deepSeekCordis.capabilities.length} capabilities` : ""}
        </p>
      </section>

      <section className="panel-section">
        <h4>Profile packages（{profilePackages.length}）</h4>
        <p className="panel-section__hint">安装 DeepSeek Harness bundle、renderer client 或 Pi package；支持本地目录、npm、git、tarball 和 file source，安装后自动重载 Main/Renderer 插件。</p>
        <button type="button" className="plugin-list__reload" onClick={() => void handleInstallPackage()}>安装本地 package</button>
        <div className="plugin-list__source-install">
          <input
            aria-label="Package source"
            value={packageSource}
            onChange={(event) => setPackageSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleInstallPackageSource();
            }}
            placeholder="npm / git / tarball / file source"
          />
          <button
            type="button"
            className="plugin-list__reload"
            onClick={() => void handleInstallPackageSource()}
            disabled={!packageSource.trim() || installingSource}
          >
            {installingSource ? "安装中…" : "安装 source"}
          </button>
        </div>
        <ul className="plugin-list">
          {profilePackages.map((item) => (
            <li className="plugin-list__row" key={item.name}>
              <span className="plugin-list__id">{item.name}</span>
              <span className="plugin-list__name">{item.version ?? "本地"}</span>
              <span className="plugin-list__kind">
                {[
                  item.pi ? "Pi" : null,
                  item.client ? "Renderer" : null,
                  item.remote ? "Remote" : null,
                  item.typert ? "Typert" : null,
                  item.cordis ? "Cordis" : null,
                  item.bundle ? "Bundle" : null,
                ].filter(Boolean).join(" · ") || "Package"}
              </span>
              <span className="plugin-list__hint">
                统一合同 {item.manifest.schema} · {item.manifest.namespaces.join(" / ") || "无命名空间"}
                {item.manifest.missing.length > 0 ? ` · 未加载 ${item.manifest.missing.join(", ")}` : " · 已加载声明面"}
              </span>
              <span className="plugin-list__state">
                {item.listed ? "已挂载" : item.pi ? "Pi 自动发现" : "未挂载"}
                {item.health === "degraded"
                  ? ` · 依赖异常 ${item.dependencies.filter((dependency) => dependency.health !== "ok").length}`
                  : " · 健康"}
              </span>
              {item.dependencies.some((dependency) => dependency.health !== "ok") ? (
                <span className="plugin-list__hint">
                  {item.dependencies
                    .filter((dependency) => dependency.health !== "ok")
                    .map((dependency) => dependency.message)
                    .join("；")}
                </span>
              ) : null}
              <button type="button" className="plugin-list__reset" onClick={() => void handleRemovePackage(item.name)}>移除</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-section" data-testid="openbuddy-pi-resource-inventory">
        <h4>Pi 原生资源（{resources.extensions.length + resources.skills.length + resources.prompts.length + resources.themes.length + resources.agents.length + resources.hooks.length}）</h4>
        <p className="panel-section__hint">
          由 Pi <code>DefaultResourceLoader</code> 加载；扩展、技能、agents、提示词、主题和受控 Hooks 共享同一 profile 资源图。
        </p>
        <div className="plugin-list__state">
          Extensions {resources.extensions.length} · Skills {resources.skills.length} · Agents {resources.agents.length} · Prompts {resources.prompts.length} · Themes {resources.themes.length} · Hooks {resources.hooks.length}
          {resources.diagnostics.length ? ` · Diagnostics ${resources.diagnostics.length}` : ""}
        </div>
        {resources.extensions.length ? (
          <ul className="plugin-list" data-testid="openbuddy-pi-extension-inventory">
            {resources.extensions.map((extension) => (
              <li className="plugin-list__row" key={`${extension.id}:${extension.path}`}>
                <span className="plugin-list__dot" style={{ backgroundColor: extension.health === "failed" ? STATUS_COLORS.failed : extension.state === "disabled" ? STATUS_COLORS.disabled : STATUS_COLORS.loaded }} />
                <span className="plugin-list__id">{extension.id}</span>
                <span className="plugin-list__name">{extension.name}</span>
                <span className="plugin-list__kind">Pi Extension · {extension.mode ?? "native"}</span>
                <span className="plugin-list__state">
                  {extension.state} · {extension.commandCount} commands · {extension.toolCount} tools
                  {extension.sourceScope ? ` · ${extension.sourceScope}` : ""}
                  {extension.packageName ? ` · ${extension.packageName}` : ""}
                  {extension.version ? `@${extension.version}` : ""}
                  {extension.disabledReason ? ` · ${extension.disabledReason}` : ""}
                </span>
                {extension.error || extension.diagnostics?.length ? <span className="plugin-list__error">{extension.error ?? extension.diagnostics?.join("；")}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {resources.diagnostics.length ? (
          <ul className="event-log">
            {resources.diagnostics.slice(0, 5).map((diagnostic, index) => (
              <li key={`${diagnostic.path ?? diagnostic.type}-${index}`}>
                <span className="event-log__type">{diagnostic.type}</span>
                <span className="event-log__time">{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {resources.hooks.length ? (
          <ul className="plugin-list" data-testid="openbuddy-hook-inventory">
            {resources.hooks.map((hook) => (
              <li className="plugin-list__row" key={`${hook.packageName}:${hook.packageRoot}`}>
                <span className="plugin-list__dot" style={{ backgroundColor: hook.diagnostics.some((item) => item.level === "error") ? STATUS_COLORS.failed : STATUS_COLORS.loaded }} />
                <span className="plugin-list__id">{hook.packageName}</span>
                <span className="plugin-list__kind">Hook · {hook.dialect}</span>
                <span className="plugin-list__state">{hook.points.join(" · ") || "无有效事件点"}</span>
                {hook.diagnostics.length ? <span className="plugin-list__error">诊断 {hook.diagnostics.length}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="panel-section">
        <h4>渲染端插件（{inventory.renderers.length}）</h4>
        <p className="panel-section__hint">
          通过 <code>dsh.client</code> / <code>openbuddy.client</code> 声明发现，并按依赖图加载到 WorkBuddy renderer。
        </p>
        <ul className="plugin-list" data-testid="openbuddy-renderer-plugin-list">
          {inventory.renderers.map((renderer) => (
            <li className="plugin-list__row" key={renderer.id} data-testid={`renderer-plugin-row-${renderer.id}`}>
              <span className="plugin-list__dot" style={{ backgroundColor: renderer.disabled ? STATUS_COLORS.disabled : STATUS_COLORS.loaded }} />
              <span className="plugin-list__id">{renderer.id}</span>
              <span className="plugin-list__name">{renderer.name}</span>
              <span className="plugin-list__kind">Renderer</span>
              <span className="plugin-list__state">{renderer.disabled ? "disabled" : "discovered"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-section">
        <h4>Pi Model Providers（{providers.length}）</h4>
        <p className="panel-section__hint">
          Provider 由 Pi Runtime 管理；OpenBuddy 只展示来源归因，不展示密钥。扩展注册项会随 profile reload 自动更新。
        </p>
        <ul className="plugin-list" data-testid="openbuddy-provider-inventory">
          {providers.length ? providers.map((provider) => (
            <li className="plugin-list__row" key={provider.id} data-testid={`openbuddy-provider-row-${provider.id}`}>
              <span className="plugin-list__dot" style={{ backgroundColor: provider.source === "pi-extension" ? STATUS_COLORS.loaded : STATUS_COLORS.disabled }} />
              <span className="plugin-list__id">{provider.id}</span>
              <span className="plugin-list__kind">{provider.source === "pi-extension" ? "Pi 扩展" : provider.source === "user-config" ? "用户配置" : "内置"}</span>
              <span className="plugin-list__state" title={provider.extensionPath}>{provider.extensionPath ?? "Runtime catalog"}</span>
            </li>
          )) : <li className="plugin-list__empty">暂无已注册 provider</li>}
        </ul>
      </section>

      <section className="panel-section">
        <h4>Persistent Terminals（{inventory.terminals?.sessionCount ?? 0}）</h4>
        <p className="panel-section__hint">
          DeepSeek Harness terminal service 由 Pi AgentSession 提供 owner 隔离；backend 随 profile 插件加载和卸载。
        </p>
        <ul className="plugin-list" data-testid="openbuddy-terminal-inventory">
          {(inventory.terminals?.backends ?? []).length ? (inventory.terminals?.backends ?? []).map((backend) => (
            <li className="plugin-list__row" key={backend}>
              <span className="plugin-list__dot" style={{ backgroundColor: STATUS_COLORS.loaded }} />
              <span className="plugin-list__id">{backend}</span>
              <span className="plugin-list__kind">PTY backend</span>
              <span className="plugin-list__state">registered</span>
            </li>
          )) : <li className="plugin-list__empty">暂无已注册 terminal backend</li>}
        </ul>
      </section>

      <section className="panel-section">
        <h4>Agent 插件（{sortedPlugins.length}）</h4>
        <p className="panel-section__hint">
          Cordis 插件由 <code>HarnessPluginLoader</code> 管理；Pi 扩展通过 session reload 事务性重载。
        </p>
        <ul className="plugin-list" data-testid="openbuddy-plugin-list">
          {sortedPlugins.map((plugin) => {
            const override = plugin.kind === "pi"
              ? stored?.piExtensions?.[plugin.id]
              : stored?.overrides[plugin.id];
            return (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
                onToggle={handleToggle}
                onReload={handleReload}
                onReset={handleReset}
                onConfigSave={handleConfigSave}
                saved={override ? { ...override, updatedAt: stored!.updatedAt } : null}
              />
            );
          })}
        </ul>
      </section>

      <section className="panel-section">
        <h4>渲染端 contribution（sidebar {sidebarContribs.length} / composer {composerContribs.length}）</h4>
        <p className="panel-section__hint">
          通过 <code>@openbuddy/renderer-host</code> 注册，由 <code>useRendererContributions()</code> 消费。
        </p>
        <ul className="contribution-list" data-testid="openbuddy-contribution-list">
          {[...sidebarContribs, ...composerContribs].map((contrib) => (
            <ContributionRow key={contrib.id} contribution={contrib} />
          ))}
        </ul>
      </section>

      <section className="panel-section">
        <h4>事件总线（{recentEvents.length}）</h4>
        <p className="panel-section__hint">
          来自 <code>agent:event-log</code> 持久化事件日志，实时显示插件事件。
        </p>
        <ul className="event-log">
          {recentEvents.map((entry) => (
            <li key={`${entry.sequence}-${entry.type}`}>
              <span className="event-log__type">{entry.type}</span>
              <span className="event-log__time">#{entry.sequence} {formatTimestamp(entry.timestamp)}{eventSummary(entry) ? ` · ${eventSummary(entry)}` : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

interface PluginRowProps {
  plugin: OpenBuddyPluginStatus;
  onToggle: (id: string, enabled: boolean) => void;
  onReload: (id: string) => void;
  onReset: (id: string) => void;
  onConfigSave: (id: string, config: unknown) => Promise<void>;
  saved: { disabled?: boolean; config?: unknown; updatedAt: string } | null;
}

function PluginRow({
  plugin,
  onToggle,
  onReload,
  onReset,
  onConfigSave,
  saved,
}: PluginRowProps) {
  const isEnabled = plugin.state !== "disabled";
  const canReload = plugin.state === "loaded" || plugin.state === "failed";
  const [configText, setConfigText] = useState(() => JSON.stringify(saved?.config ?? {}, null, 2));
  const [configError, setConfigError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const savedConfigText = JSON.stringify(saved?.config ?? {}, null, 2);

  useEffect(() => {
    setConfigText(savedConfigText);
  }, [savedConfigText]);

  const handleConfigSubmit = async () => {
    let config: unknown;
    try {
      config = JSON.parse(configText);
    } catch (error) {
      setConfigError(`JSON 无效：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setConfigError(null);
    setSavingConfig(true);
    try {
      await onConfigSave(plugin.id, config);
    } catch (error) {
      setConfigError(String(error).replace(/^Error:\s*/, ""));
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <li className="plugin-list__row" data-state={plugin.state} data-testid={`plugin-row-${plugin.id}`}>
      <span className="plugin-list__dot" style={{ backgroundColor: STATUS_COLORS[plugin.state] }} />
      <span className="plugin-list__id">{plugin.id}</span>
      <span className="plugin-list__name">{plugin.name}</span>
      {plugin.kind ? <span className="plugin-list__kind">{plugin.kind === "pi" ? "Pi" : "Cordis"}</span> : null}
      {plugin.mode === "adapter" ? (
        <span
          className="plugin-list__kind plugin-list__kind--adapter"
          title={plugin.commands && plugin.commands.length > 0
            ? `由 ${plugin.adapter ?? "OpenBuddy"} 提供能力，投影 slash command：${plugin.commands.join(", ")}`
            : `由 ${plugin.adapter ?? "OpenBuddy"} 提供能力`}
        >
          Adapter{plugin.commands && plugin.commands.length > 0 ? ` (${plugin.commands.length})` : ""}
        </span>
      ) : null}
      {plugin.mode === "adapter" && plugin.commands && plugin.commands.length > 0 ? (
        <span className="plugin-list__commands" data-testid={`plugin-commands-${plugin.id}`}>
          {plugin.commands.join(", ")}
        </span>
      ) : null}
      {plugin.kind === "pi" && plugin.sourceScope ? (
        <span
          className="plugin-list__kind plugin-list__kind--source"
          data-testid={`plugin-source-${plugin.id}`}
          title={plugin.sourceBaseDir ? `来源目录：${plugin.sourceBaseDir}` : undefined}
        >
          {plugin.sourceScope === "user" ? "用户" : plugin.sourceScope === "project" ? "项目" : "临时"}
          {plugin.sourceOrigin === "package" ? "·Package" : "·Path"}
        </span>
      ) : null}
      <span className="plugin-list__state">{plugin.state}</span>
      {plugin.error ? <span className="plugin-list__error">{plugin.error}</span> : null}
      {saved ? (
        <span className="plugin-list__saved" data-testid={`plugin-saved-${plugin.id}`} title={`updated ${saved.updatedAt}`}>
          已保存
        </span>
      ) : null}
      <label className="plugin-list__toggle">
        <input
          type="checkbox"
          checked={isEnabled}
          disabled={plugin.managed === false}
          onChange={(event) => onToggle(plugin.id, event.target.checked)}
          aria-label={`启用 ${plugin.id}`}
        />
        <span>{isEnabled ? "已启用" : "已禁用"}</span>
      </label>
      <button
        type="button"
        className="plugin-list__reload"
        onClick={() => onReload(plugin.id)}
        disabled={!canReload}
        aria-label={`重载 ${plugin.id}`}
      >
        重载
      </button>
      <button
        type="button"
        className="plugin-list__reset"
        onClick={() => onReset(plugin.id)}
        disabled={!saved}
        aria-label={`清除 ${plugin.id} 的持久化覆盖`}
        title={saved ? `updated ${saved.updatedAt}` : "未保存覆盖"}
      >
        清除覆盖
      </button>
      {plugin.kind === "pi" && plugin.managed !== false ? (
        <div className="plugin-list__config">
          <label htmlFor={`plugin-config-${plugin.id}`}>配置 JSON</label>
          <textarea
            id={`plugin-config-${plugin.id}`}
            aria-label={`配置 ${plugin.id}`}
            data-testid={`plugin-config-${plugin.id}`}
            value={configText}
            onChange={(event) => setConfigText(event.target.value)}
            rows={4}
            spellCheck={false}
            disabled={savingConfig}
          />
          {configError ? <span className="plugin-list__error">{configError}</span> : null}
          <button
            type="button"
            className="plugin-list__reload"
            onClick={() => void handleConfigSubmit()}
            disabled={savingConfig}
            aria-label={`保存 ${plugin.id} 的配置`}
          >
            {savingConfig ? "保存中…" : "保存配置"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

interface ContributionRowProps {
  contribution: RendererContribution;
}

function ContributionRow({ contribution }: ContributionRowProps) {
  const payload = contribution.payload as { label?: string; description?: string };
  return (
    <li className="contribution-list__row" data-kind={contribution.kind}>
      <span className="contribution-list__kind">{contribution.kind}</span>
      <span className="contribution-list__id">{contribution.id}</span>
      {payload.label ? <span className="contribution-list__label">{payload.label}</span> : null}
      {payload.description ? (
        <span className="contribution-list__desc">{payload.description}</span>
      ) : null}
    </li>
  );
}
