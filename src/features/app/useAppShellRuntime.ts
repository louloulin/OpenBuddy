/**
 * src/features/app/useAppShellRuntime.ts
 *
 * Phase 1 — 微内核激活（核心）
 * 把 1757 行 App.tsx 中所有 useState / useRef / useEffect / useCallback
 * 集中到这一个 hook。返回 `AppShellRuntime`，由 AppShell 组件消费。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  piInit,
  piAuthStatus,
  piSend,
  piSendContent,
  piCancel,
  piLoadSession,
  piListSessions,
  piListWorkspaces,
  piListWorkspaceRegistry,
  piRenameSession,
  piSetModel,
  piCreateWorkspace,
  providersList,
  flattenModels,
  providersDeleteModel,
  agentCurrentModel,
  agentOnPiTelemetryEvent,
  agentSessionMessages,
  sessionEntriesToChatMessages,
  type InitResult,
  type WorkspaceInfo,
} from "@/lib/agent/pi-client";
import { useSessionStore, type UserContentPart } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useFeedbackStore } from "@/stores/feedback-store";
import { usePendingExpertStore } from "@/stores/pending-expert-store";
import { setToast as pushToast, useToastStore } from "@/stores/toast-store";
import { restoreComposerText } from "@openbuddy/ui-conversation";
import { useProjectsStore, type ProjectMeta } from "@/stores/projects-store";
import { getStoredThemeName, useTheme } from "@openbuddy/ui-theme/client";
import { clearRequestedMarketTab, requestMarketTab } from "@/lib/navigation/market-tab";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useOptimisticNewSession } from "@/hooks/useOptimisticNewSession";
import { newSessionFlow, composeDiscoverBody } from "@/lib/agent/new-session-flow";
import { abandonInFlightStream } from "@/lib/agent/abandon-stream";
import { listenSafe, isElectronBridgeUnavailable, getElectronBridgeStatus, confirm } from "@/lib/platform/electron-api";
import { friendlyError } from "@/lib/platform/error-format";
import { shortModelLabel } from "@/lib/ui/timeline-utils";
// R48 — 登录编排整体搬进 `overlay.sign-in` 对话框(CasdoorSignInDialog),
//   宿主只保留状态入口(casdoorStatus / casdoorLogout)与身份视图类型。
import { casdoorLogout, casdoorStatus, type CasdoorSessionView } from "@/lib/casdoor/casdoor-client";
import { auditRecord } from "@/lib/audit/audit-client";
import type { CasdoorLifecycleEvent } from "@openbuddy/auth-casdoor";
import { getRendererPluginRuntime } from "@/lib/runtime/renderer-plugin-runtime";
import { createRendererLogger, generateTrace, withTrace } from "@openbuddy/logging-renderer";
import {
  registerTelemetryProvider,
  createConsoleTelemetryProvider,
  reportEvent,
  type TelemetryProvider,
} from "@/lib/telemetry/telemetry-contract";
import { exportEventsBatch, type OtlpConfig } from "@/lib/telemetry/otlp-exporter";
import type { ModelOption } from "@openbuddy/ui-workbench";
import type { AgentEntry } from "@openbuddy/shared-types";
import type { AppShellRuntime, ExtensionUiBySession, SettingsSection, ToastOptions } from "./types";

export { EXPERT_PERSONA_BEGIN, EXPERT_PERSONA_END } from "@/lib/agent/persona-markers";

const ACTIVE_SESSION_STORAGE_KEY = "openbuddy.active-session";
type PersistedActiveSession = { sessionId: string; cwd: string };

function readPersistedActiveSession(): PersistedActiveSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.sessionId === "string" && typeof parsed.cwd === "string") {
      return parsed as PersistedActiveSession;
    }
  } catch { /* ignore */ }
  return null;
}

/** 把主进程模型切换的错误翻译成用户能处置的中文提示。 */
function friendlyModelSwitchError(error: unknown): string {
  const message = String(error).replace(/^Error:\s*/u, "");
  if (/No API key for/i.test(message)) return "该模型没有可用的 API Key，请先在设置中配置";
  if (/策略禁止使用模型/u.test(message)) return message;
  if (/model\b.*\bnot found|Model not found/i.test(message)) return "模型不存在或已下线，请刷新模型列表后重试";
  return message;
}

function deriveTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "新会话";
  // B7(审计 2026-10-14):标题不再是「首条消息原文硬截 28 字」——
  // 先剥掉 markdown 记号(# 标题、` 代码、* emphasis、[link](url)、
  // 图片),压掉换行,再在自然边界(句读/空白)处截断。
  const stripped = trimmed
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*`>~_]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const source = stripped || trimmed;
  if (source.length <= 20) return source;
  const head = source.slice(0, 20);
  const boundary = Math.max(head.lastIndexOf(" "), head.lastIndexOf(","), head.lastIndexOf("，"), head.lastIndexOf("。"), head.lastIndexOf(";"), head.lastIndexOf("；"));
  return `${boundary >= 10 ? head.slice(0, boundary) : head}…`;
}

function isStreamDebugEnabled(): boolean {
  return typeof window !== "undefined" && (window.localStorage?.getItem("openbuddy.stream.debug") === "1");
}
const STREAM_DEBUG = isStreamDebugEnabled();

const appLogger = createRendererLogger({ devMode: false, name: "openbuddy-app" });

function isPlaceholderTitle(title?: string | null): boolean {
  if (!title) return true;
  return /^(新会话|分叉会话|未命名会话)$/i.test(title);
}

function extractMarkdownBody(raw: string): string {
  const idx = raw.indexOf("\n\n");
  return idx === -1 ? raw : raw.slice(idx + 2);
}

export function useAppShellRuntime(): AppShellRuntime {
  // ====== state declarations =================================================
  const [init, setInit] = useState<InitResult | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("model");
  // R9.x — casdoorSession 状态保留,但不再驱动侧栏底部的「企业登录」按钮;
  //   后续「设置 → 账户」页面按需启用时只需 setCasdoorSession(...) 即可。
  const [casdoorSession, setCasdoorSession] = useState<CasdoorSessionView | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // R23 — 「发送反馈」卡是否打开。触发点在左下角账户菜单(ui-sidebar),
  // 状态留在宿主:UI 包只负责"画一个入口",不持有时序策略。
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // R48 — 「登录」对话框(Casdoor)。左下角账户菜单的登录入口打开它,而不是
  //   直接调 casdoorLogin —— 未配置时入口会先弹一句用户无法处置的错误。
  const [signInOpen, setSignInOpen] = useState(false);
  // R23 — 数据目录选择器(设置 → 数据管理 → 更改数据目录)。
  const [dataDirOpen, setDataDirOpen] = useState(false);
  const [trustRequest, setTrustRequest] = useState<{ cwd?: string; reason?: string } | null>(null);
  const [taskRefreshSignal, setTaskRefreshSignal] = useState(0);
  const [placeholderView, setPlaceholderView] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem("openbuddy.assistant.activeTab"); } catch { return null; }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toastQueue = useToastStore((s) => s.queue);
  const dismissToast = useToastStore((s) => s.dismiss);
  const [currentModelId, setCurrentModelId] = useState<string | undefined>(undefined);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [switchingWorkspace, setSwitchingWorkspace] = useState<string | null>(null);
  const [extensionText, setExtensionText] = useState("");
  const [extensionTextNonce, setExtensionTextNonce] = useState(0);
  const [extensionTextBySession, setExtensionTextBySession] = useState<Record<string, string>>({});
  const [extensionUiBySession, setExtensionUiBySession] = useState<Record<string, ExtensionUiBySession>>({});

  // ====== refs ==============================================================
  const cwdRef = useRef<string>("");
  const currentModelIdRef = useRef<string | undefined>(undefined);
  const extensionTextBySessionRef = useRef<Record<string, string>>({});
  const handleAgentDiedRef = useRef<(payload: { reason: string }) => void>(() => {});
  const refreshModelsRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // ====== hooks =============================================================
  const rendererRuntime = getRendererPluginRuntime();
  const { setTheme } = useTheme();
  const optimisticSession = useOptimisticNewSession();
  const sessionStore = useSessionStore;
  const sessionsStore = useSessionsStore;
  const currentSessionId = sessionsStore((s) => s.currentSessionId) ?? undefined;

  // ====== toast utilities ===================================================
  const setToast = useCallback((message: string, opts?: ToastOptions) => {
    pushToast(message, { kind: opts?.kind, ttlMs: opts?.ttlMs, id: opts?.id, action: opts?.action });
  }, []);

  useEffect(() => {
    if (toastQueue.length === 0) return;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const now = Date.now();
    for (const entry of toastQueue) {
      if (entry.ttlMs <= 0) continue;
      const elapsed = now - entry.createdAt;
      const remaining = entry.ttlMs - elapsed;
      if (remaining <= 0) { dismissToast(entry.id); continue; }
      timers.push(setTimeout(() => dismissToast(entry.id), remaining));
    }
    return () => { for (const t of timers) clearTimeout(t); };
  }, [toastQueue, dismissToast]);

  useEffect(() => { extensionTextBySessionRef.current = extensionTextBySession; }, [extensionTextBySession]);
  useEffect(() => { currentModelIdRef.current = currentModelId; }, [currentModelId]);

  const notifyBridgeUnavailable = useCallback(() => {
    setToast("⚠️ 检测到 Electron bridge 不可用，请重启或重新构建应用。");
  }, [setToast]);

  const refreshModels = useCallback(async () => {
    try {
      const [list, auth] = await Promise.all([providersList(), piAuthStatus()]);
      const options = flattenModels(list);
      setModels(options);
      setCurrentModelId((prev) => prev && options.some((o) => o.id === prev) ? prev : options[0]?.id);
      setInit((prev) => (prev ? { ...prev, auth } : prev));
    } catch { /* 非致命 */ }
  }, []);
  refreshModelsRef.current = refreshModels;

  // 载入/恢复会话后,模型选择器必须跟着宿主里的真实模型走。此前渲染端只在
  // 初始化时读一次 defaultModelId,之后切到旧会话时 picker 仍显示上一个
  // 会话的模型 —— 用户看到的和下一轮实际使用的不是同一个模型。
  const syncCurrentModelFromHost = useCallback(async () => {
    try {
      const model = await agentCurrentModel() as { provider?: string; id?: string } | null;
      if (model?.provider && model.id) {
        const next = `${model.provider}/${model.id}`;
        currentModelIdRef.current = next;
        setCurrentModelId(next);
      }
    } catch { /* 读取失败不阻塞 UI */ }
  }, []);

  // ====== agent session SSE 订阅 ============================================
  const sessionEvents = useAgentSession({
    setTrustRequest,
    setTaskRefreshSignal,
    setExtensionTextBySession,
    setExtensionText,
    setExtensionTextNonce,
    setExtensionUiBySession,
    setWorkspaces,
    setTheme,
    setToast,
    extensionTextBySessionRef,
    refreshModels: () => refreshModelsRef.current(),
    notifyBridgeUnavailable,
    handleAgentDied: (payload) => handleAgentDiedRef.current?.(payload) ?? undefined,
    cwdRef,
    currentModelIdRef,
  });

  // ====== bridge polling =====================================================
  useEffect(() => {
    let lastBridgeToastKey: string | null = null;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const status = getElectronBridgeStatus();
      if (!status.available) {
        const reason = status.reason ?? "unknown";
        if (lastBridgeToastKey !== reason) {
          lastBridgeToastKey = reason;
          const baseMessage = reason === "preload-not-loaded"
            ? "⚠️ 检测到 Electron bridge 不可用，请重启或重新构建应用。"
            : `⚠️ bridge 版本不支持 (apiVersion=${status.apiVersion ?? "?"})，请重启或重新构建。`;
          setToast(baseMessage, {
            kind: "warning", ttlMs: 0, id: "bridge-unavailable",
            action: {
              label: "重试", hint: "↵",
              onClick: () => {
                const s = getElectronBridgeStatus();
                if (s.available) { setToast("bridge 已恢复。", { kind: "info", ttlMs: 3000, id: "bridge-unavailable" }); lastBridgeToastKey = null; }
                else setToast(`bridge 仍不可用（${s.reason ?? "unknown"}）。`, { kind: "warning", ttlMs: 4000, id: "bridge-unavailable" });
              },
            },
          });
        }
      } else if (lastBridgeToastKey) {
        lastBridgeToastKey = null;
        setToast("bridge 已恢复。", { kind: "info", ttlMs: 3000, id: "bridge-unavailable" });
      }
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [setToast]);

  // ====== Casdoor ============================================================
  useEffect(() => {
    void casdoorStatus().then(setCasdoorSession).catch(() => setCasdoorSession(null));
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenSafe<CasdoorSessionView>("casdoor://auth", (event) => {
      if (!disposed) setCasdoorSession(event.payload);
    }, () => notifyBridgeUnavailable()).then((cleanup) => {
      if (disposed) cleanup?.(); else unlisten = cleanup ?? undefined;
    });
    return () => { disposed = true; unlisten?.(); };
  }, [notifyBridgeUnavailable]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenSafe<CasdoorLifecycleEvent>("casdoor://lifecycle", async (event) => {
      if (disposed) return;
      if (event.payload.kind === "session-invalidated" || event.payload.kind === "logout" || event.payload.kind === "config-change") setCasdoorSession(null);
      if (event.payload.scopeChanged || !["refresh", "session-invalidated", "config-change"].includes(event.payload.kind)) return;
      sessionStore.getState().reset();
      sessionsStore.setState({ independent: [], workspaces: [], workspaceSessions: {}, currentSessionId: null, drafts: {}, expanded: {} });
      setWorkspaces([]);
      try {
        const [independent, ws] = await Promise.all([piListSessions(cwdRef.current), piListWorkspaces()]);
        if (disposed) return;
        sessionsStore.getState().setIndependent(independent);
        sessionsStore.getState().setWorkspaces(ws);
        setWorkspaces(ws);
      } catch { if (!disposed) setToast("企业会话已刷新，请重新加载工作台数据"); }
    }, () => notifyBridgeUnavailable()).then((cleanup) => { if (disposed) cleanup?.(); else unlisten = cleanup ?? undefined; });
    return () => { disposed = true; unlisten?.(); };
  }, [sessionStore, sessionsStore, setToast, notifyBridgeUnavailable]);

  // Plan5 / real-Electron audit — provider & model catalog mutations.
  // The Settings dialog calls `onModelsChanged` itself, but a save coming
  // from anywhere else (IPC harness, plugin, CLI) previously left the
  // composer disabled forever: `apiReady` is `init.auth.ready`, a one-shot
  // snapshot. Re-derive it whenever main broadcasts that the catalog moved.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenSafe<{ reason?: string }>("openbuddy://providers-changed", () => {
      if (disposed) return;
      void refreshModelsRef.current();
    }, () => notifyBridgeUnavailable()).then((cleanup) => {
      if (disposed) cleanup?.(); else unlisten = cleanup ?? undefined;
    });
    return () => { disposed = true; unlisten?.(); };
  }, [notifyBridgeUnavailable]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenSafe<{ scope: string }>("openbuddy://workbench-scope", async () => {
      if (disposed) return;
      sessionStore.getState().reset();
      sessionsStore.setState({ independent: [], workspaces: [], workspaceSessions: {}, currentSessionId: null, drafts: {}, expanded: {} });
      setWorkspaces([]);
      try {
        const [independent, ws] = await Promise.all([piListSessions(cwdRef.current), piListWorkspaces()]);
        if (disposed) return;
        sessionsStore.getState().setIndependent(independent);
        sessionsStore.getState().setWorkspaces(ws);
        setWorkspaces(ws);
      } catch { if (!disposed) setToast("工作台租户上下文已切换，请重新加载会话列表"); }
    }, () => notifyBridgeUnavailable()).then((cleanup) => { if (disposed) cleanup?.(); else unlisten = cleanup ?? undefined; });
    return () => { disposed = true; unlisten?.(); };
  }, [sessionStore, sessionsStore, setToast, notifyBridgeUnavailable]);

  // ====== layout/theme sync ==================================================
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const attach = (): void => {
      if (cancelled || stop) return;
      const layout = rendererRuntime.context.get("layout") as { getSnapshot?: () => { sidebarCollapsed?: boolean }; subscribe?: (l: (s: { sidebarCollapsed?: boolean }) => void) => () => void } | undefined;
      if (!layout?.getSnapshot) return;
      const getSnapshot = layout.getSnapshot.bind(layout);
      const sync = (snapshot = getSnapshot()): void => { if (!cancelled && typeof snapshot.sidebarCollapsed === "boolean") setSidebarCollapsed(snapshot.sidebarCollapsed); };
      sync();
      stop = layout.subscribe?.(sync);
    };
    attach();
    const offLoaded = rendererRuntime.events.on("plugin/loaded", attach);
    const offProfile = rendererRuntime.events.on("profile/loaded", attach);
    return () => { cancelled = true; offLoaded(); offProfile(); stop?.(); };
  }, [rendererRuntime]);

  useEffect(() => {
    const layout = rendererRuntime.context.get("layout") as { setSidebarCollapsed?: (c: boolean) => void } | undefined;
    layout?.setSidebarCollapsed?.(sidebarCollapsed);
  }, [rendererRuntime, sidebarCollapsed]);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const attach = (): void => {
      if (cancelled || stop) return;
      const theme = rendererRuntime.context.get("theme") as { getTheme?: () => { active?: { colorScheme?: string } }; subscribe?: (l: (s: { active?: { colorScheme?: string } }) => void) => () => void } | undefined;
      if (!theme?.getTheme) return;
      const getSnapshot = theme.getTheme.bind(theme);
      // 宿主/IDE 的 colorScheme 只作为**环境默认值**:它会在每次
      // plugin/profile 加载时重新同步一次,如果无条件写进主题 store,
      // 用户手选的命名主题(例如 sakura)会在下一次加载被悄悄换成
      // pair 里的默认色。用户一旦通过 ThemePicker 显式选过主题,
      // 就由 ThemePicker 独占控制权。
      const sync = (snapshot = getSnapshot()): void => {
        if (cancelled || getStoredThemeName()) return;
        const c = snapshot.active?.colorScheme;
        if (c === "light" || c === "dark") setTheme(c);
      };
      sync();
      stop = theme.subscribe?.(sync);
    };
    attach();
    const offLoaded = rendererRuntime.events.on("plugin/loaded", attach);
    const offProfile = rendererRuntime.events.on("profile/loaded", attach);
    return () => { cancelled = true; offLoaded(); offProfile(); stop?.(); };
  }, [rendererRuntime, setTheme]);

  // ====== telemetry + sandbox + piInit ======================================
  useEffect(() => {
    registerTelemetryProvider(createConsoleTelemetryProvider({ sink: (e) => console.debug(`[telemetry] ${e.level.toUpperCase()} ${e.name}`, e.props ?? "") }));
    const otlpEndpoint = typeof localStorage !== "undefined" ? localStorage.getItem("openbuddy.otlp.endpoint") : null;
    if (otlpEndpoint) {
      const otlpConfig: OtlpConfig = { endpoint: otlpEndpoint, serviceName: "openbuddy" };
      const otlpProvider: TelemetryProvider = {
        id: "otlp", isEnabled: () => true,
        reportEvent: (e) => { void exportEventsBatch([e], otlpConfig, { post: async () => ({ ok: true, status: 200 }) }); },
        reportMetric: () => {},
      };
      registerTelemetryProvider(otlpProvider);
    }
    reportEvent("app_started", "info");
    let telemetryUnlisten: (() => void) | null = null;
    void agentOnPiTelemetryEvent((event) => { if (!event || typeof event.name !== "string") return; reportEvent(event.name, event.level ?? "info", event.props, { ts: event.ts }); })
      .then((unlisten) => { telemetryUnlisten = unlisten; }).catch(() => {});
    void import("@/lib/security/sandbox-init").then((m) => m.tryActivateSandbox()).then((status) => { if (status.activated) console.log(`[OpenBuddy] OS 级沙箱已激活`); }).catch(() => {});
    (async () => {
      try {
        const result = await piInit();
        cwdRef.current = result.cwd;
        sessionsStore.getState().setHomeCwd(result.cwd);
        setInit(result);
        setCurrentModelId(result.defaultModelId);
        const [independent, registry] = await Promise.all([piListSessions(result.cwd), piListWorkspaceRegistry()]);
        const ws = registry.items;
        sessionsStore.getState().setIndependent(independent);
        sessionsStore.getState().setWorkspaces(ws);
        setWorkspaces(ws);
        const persistedActive = readPersistedActiveSession();
        if (persistedActive) {
          let entry = independent.find((item) => item.sessionId === persistedActive.sessionId);
          if (!entry && persistedActive.cwd && persistedActive.cwd !== result.cwd) {
            const ws_sessions = await piListSessions(persistedActive.cwd);
            sessionsStore.getState().setWorkspaceSessions(persistedActive.cwd, ws_sessions);
            entry = ws_sessions.find((item) => item.sessionId === persistedActive.sessionId);
          }
          if (entry) {
            sessionsStore.getState().setCurrent(entry.sessionId);
            sessionStore.getState().setSession(entry.sessionId);
            try {
              await piLoadSession(entry.sessionId, entry.cwd ?? persistedActive.cwd);
              const entries = await agentSessionMessages(entry.sessionId);
              const { messages: history } = sessionEntriesToChatMessages(entries);
              useSessionStore.getState().loadHistoryMessages(entry.sessionId, history as unknown as import("@/stores/session-store").ChatMessage[]);
            } catch (e) { sessionStore.getState().setError(friendlyError(e)); }
          } else { localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY); }
        }
        const providers = await providersList();
        const providerOptions = flattenModels(providers);
        setModels(providerOptions);
        const refreshedAuth = await piAuthStatus();
        setInit((previous) => previous ? { ...previous, auth: refreshedAuth } : previous);
        if (providerOptions.length > 0) {
          const piDefault = result.defaultModelId;
          if (!providerOptions.some((p) => p.id === piDefault)) setCurrentModelId(providerOptions[0].id);
        }
        // 以宿主里实际 active 的模型为准(恢复的旧会话可能和刚 init 的默认
        // 模型不同),放在 providerOptions 兜底之后,避免被它覆盖。
        await syncCurrentModelFromHost();
      } catch (e) {
        const bridge = getElectronBridgeStatus();
        const raw = String(e);
        if (!bridge.available) { notifyBridgeUnavailable(); appLogger.warn("bridge.init.failed", { reason: bridge.reason ?? "unknown" }); }
        setInitError(bridge.available ? raw : `Electron bridge unavailable (${bridge.reason})`);
      }
    })();
  }, [sessionStore, sessionsStore, notifyBridgeUnavailable, syncCurrentModelFromHost]);

  // ====== derived: current entry + persistence ===============================
  const currentEntry = sessionsStore((s) => {
    const id = s.currentSessionId;
    if (!id) return undefined;
    const inTasks = s.independent.find((x) => x.sessionId === id);
    if (inTasks) return inTasks;
    for (const cwd of Object.keys(s.workspaceSessions)) {
      const hit = s.workspaceSessions[cwd].find((x) => x.sessionId === id);
      if (hit) return hit;
    }
    return undefined;
  });
  const currentTitle = currentEntry?.title || "";
  const streaming = sessionStore((s) => s.streaming);

  useEffect(() => {
    setExtensionText(extensionTextBySession[currentSessionId ?? ""] ?? "");
  }, [currentSessionId, extensionTextBySession]);

  useEffect(() => {
    try { if (!currentSessionId) return; localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify({ sessionId: currentSessionId, cwd: currentEntry?.cwd ?? cwdRef.current } satisfies PersistedActiveSession)); } catch {}
  }, [currentEntry?.cwd, currentSessionId]);

  const initCwd = init?.cwd ?? "";
  useEffect(() => {
    if (!initCwd) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        try {
          const [list, registry] = await Promise.all([piListSessions(initCwd), piListWorkspaceRegistry()]);
          if (cancelled) return;
          sessionsStore.getState().setIndependent(list);
          sessionsStore.getState().setWorkspaces(registry.items);
          setWorkspaces(registry.items);
        } catch (e) { appLogger.warn("sidebar.refresh.failed", { err: String(e) }); }
      })();
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [initCwd, currentSessionId, sessionsStore]);

  // ====== keyboard shortcuts =================================================
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      // The home composer is autofocused, so `isEditable` is true the moment the
      // app opens. Guarding purely on it made `?` and ⌘, unreachable until the
      // user clicked somewhere else. Only suppress a bare `?` once the user has
      // actually typed something (then "?" is legitimate text); modifier combos
      // never produce text, so they are never suppressed.
      const typedIntoEditable =
        isEditable &&
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
          ? target.value.length > 0
          : (target?.textContent?.length ?? 0) > 0);
      if (e.key === "?" && !typedIntoEditable && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setShortcutsOpen((v) => !v); }
      // Plan5 B.6 — Ctrl/Cmd+/ 是 `?` 的跨键盘布局别名(美式键盘 `?` 需要
      // Shift,其它布局不一定有 `?` 键)。两条路径都收敛到同一个
      // `shortcutsOpen`,所以永远只渲染一个面板。
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === "/") { e.preventDefault(); setShortcutsOpen((v) => !v); }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); setSearchOpen(true); }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === ",") { e.preventDefault(); setSettingsOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      if (target) { const tag = target.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return; }
      if (e.key.toLowerCase() === "b" || e.key === "\\") { e.preventDefault(); setSidebarCollapsed((c) => !c); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ====== helpers ============================================================
  function lookupSessionTitle(sessionId: string): string | undefined {
    const s = sessionsStore.getState();
    const inTasks = s.independent.find((x) => x.sessionId === sessionId);
    if (inTasks) return inTasks.title;
    for (const cwd of Object.keys(s.workspaceSessions)) {
      const hit = s.workspaceSessions[cwd].find((x) => x.sessionId === sessionId);
      if (hit) return hit.title;
    }
    return undefined;
  }

  // ====== business callbacks =================================================
  // R9.x — openAccountSettings 已移除(企业登录按钮从侧栏底部消失)。
  //   Casdoor 集成仍保留,通过「设置 → 账户」按需唤起。

  const openSettings = useCallback((section?: SettingsSection) => {
    setSettingsSection(section ?? "model");
    setSettingsOpen(true);
    // R17 / Phase D — 本地审计:settings 面板打开可追溯。
    // 故意 catch 静默:audit 失败不影响设置打开。
    void auditRecord({
      event: "settings.open",
      outcome: "info",
      subject: section ?? "model",
    }).catch(() => undefined);
  }, []);

  // R15 恢复的历史语义(见 git show 536dc0e):左下角同时提供登录与设置两条
  //   路径。R48 把"登录"拆成独立的 `overlay.sign-in` 对话框(点一下必弹出),
  //   `openAccountSettings` 回归它名字本身 —— 打开「设置 → 账户管理」,
  //   顺带刷新一次 Casdoor 状态(租户 / 成员 / 权限治理都在那一页)。
  const openAccountSettings = useCallback(() => {
    setSettingsSection("account");
    setSettingsOpen(true);
    void casdoorStatus().then(setCasdoorSession).catch(() => setCasdoorSession(null));
  }, []);

  // R48 — 「登录」入口统一走 Casdoor 登录对话框(overlay.sign-in)。
  //   为什么不再直接 casdoorLogin:未配置企业身份时主进程必然返回一句
  //   用户当场无法处置的错误,而"点登录什么都没弹出"体验上等于入口坏了。
  //   对话框把「补配置 → 发起授权 → 等回调」收在同一个面板里,登录这件事
  //   从"跳去设置"变成"点一下就有反馈"。底层编排仍是 Casdoor,没有第二套
  //   身份后端(见 git 536dc0e / R15 的历史实现)。
  const openSignIn = useCallback(() => {
    setSignInOpen(true);
  }, []);

  // R15 — 左下角账户菜单触发的 casdoor 流程。
  // 登录:打开 Casdoor 浏览器窗口(主进程通过 IPC 触发),错误以 toast 反馈。
  // 登出:直接调 casdoorLogout,清掉本地 casdoorSession,后续 IPC 监听器
  //     会接住 casdoor://lifecycle 事件并自动 reset 会话列表。
  // R48 — 侧栏「登录」按钮:打开 Casdoor 登录对话框。真正的 casdoorLogin
  //   调用与审计记录都发生在对话框里(失败也留在框内展示,不再是一条
  //   一闪而过的 toast)。
  const handleLogin = useCallback(() => {
    setSignInOpen(true);
    void auditRecord({
      event: "casdoor.login",
      outcome: "info",
      subject: "sign-in-dialog",
    }).catch(() => undefined);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await casdoorLogout();
      setCasdoorSession(null);
      setToast("已退出企业账户");
      void auditRecord({
        event: "casdoor.logout",
        outcome: "success",
      }).catch(() => undefined);
    } catch (error) {
      setToast(`登出失败:${String(error).replace(/^Error:\s*/, "")}`);
      void auditRecord({
        event: "casdoor.logout",
        outcome: "failure",
        detail: { error: String(error) },
      }).catch(() => undefined);
    }
  }, [setToast]);

  // Each toast expires on its own TTL. This used to `clear()` the WHOLE queue
  // 2 s later, wiping sticky error toasts (e.g. "立即重连") along with it.
  const showToast = useCallback((message: string) => {
    setToast(message, { ttlMs: 2500 });
  }, [setToast]);

  const handlePlaceholder = useCallback((label: string) => {
    if (label === "通知") { openSettings("notifications"); return; }
    showToast(`${label} 当前不可用`);
  }, [openSettings, showToast]);

  const handleNavigate = useCallback((label: string, options?: { tab?: string }) => {
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    // R40 — "直达某一页里的某个 tab"。侧栏「腾讯文档」等入口带 `{ tab }` 过来,
    // 面板未挂载时靠 localStorage、已挂载时靠事件(见 @/lib/navigation/market-tab)。
    // 普通导航(无 tab 意图)顺手清掉残留意图,否则下次进入会被上一次挟持。
    if (options?.tab) requestMarketTab(options.tab);
    else clearRequestedMarketTab();
    setPlaceholderView(label);
    sessionsStore.getState().setCurrent(null);
    sessionStore.getState().reset();
    try { if (typeof label === "string" && label.startsWith("助理")) window.localStorage.setItem("openbuddy.assistant.activeTab", label); else if (typeof label === "string") window.localStorage.removeItem("openbuddy.assistant.activeTab"); } catch {}
  }, [sessionStore, sessionsStore]);

  const handleSelectEmailFromSearch = useCallback((accountId: string, threadId: string) => { localStorage.setItem("openbuddy.email.inbox-target", JSON.stringify({ accountId, threadId })); handleNavigate("邮件"); }, [handleNavigate]);
  const handleSelectKnowledgeFromSearch = useCallback((entryId: string, url?: string) => { localStorage.setItem("openbuddy.knowledge.target", JSON.stringify({ entryId, url })); handleNavigate("知识库"); }, [handleNavigate]);
  const handleOpenProjectFromSidebar = useCallback((projectId: string) => { useProjectsStore.getState().setActiveProjectId(projectId); handleNavigate("项目"); }, [handleNavigate]);

  const handleSendNew = useCallback(async (text: string, content?: UserContentPart[]) => {
    if (STREAM_DEBUG) console.log('[OpenBuddy] handleSendNew:', { text, cwd: cwdRef.current, modelId: currentModelId });
    setPlaceholderView(null);
    const { pendingId, promise } = optimisticSession.ensureNewSession(cwdRef.current, currentModelId);
    const optimisticContent = content ?? [{ type: "text" as const, text }];
    sessionStore.getState().pushOptimisticUserContent(optimisticContent);
    sessionStore.getState().setStreaming(true);
    sessionsStore.getState().upsert({ sessionId: pendingId, title: deriveTitle(text), cwd: cwdRef.current, status: "working" });
    const pendingExpert = usePendingExpertStore.getState().expert;
    if (pendingExpert && pendingExpert.prompt) usePendingExpertStore.getState().clear();
    try {
      await newSessionFlow({
        pendingId, promise, text, content: content ? optimisticContent : undefined, cwd: cwdRef.current,
        flowDeps: {
          awaitPendingNewSession: optimisticSession.awaitPendingNewSession,
          ...(pendingExpert && pendingExpert.prompt ? { persona: { expertId: pendingExpert.expertId, name: pendingExpert.name, source: pendingExpert.source, ...(pendingExpert.avatarLocal !== undefined ? { avatarLocal: pendingExpert.avatarLocal } : {}), prompt: pendingExpert.prompt } } : {}),
        },
      });
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().popOptimistic();
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().setSession(null);
      sessionsStore.getState().setCurrent(null);
      sessionsStore.getState().remove(pendingId);
      setToast(`创建会话失败：${friendlyError(e)}`);
      restoreComposerText(text);
    }
  }, [optimisticSession, sessionStore, sessionsStore, setToast, currentModelId]);

  const handleSendCurrent = useCallback(async (text: string) => {
    const traceId = generateTrace();
    const log = withTrace(appLogger, traceId);
    log.info("composer.send.current", { sessionId: currentSessionId, textLength: text.length });
    if (!currentSessionId) return handleSendNew(text);
    if (sessionStore.getState().streaming) return;
    try {
      sessionsStore.getState().upsert({ sessionId: currentSessionId, status: "working" });
      const t = lookupSessionTitle(currentSessionId);
      if (isPlaceholderTitle(t)) {
        const derivedTitle = deriveTitle(text);
        sessionsStore.getState().upsert({ sessionId: currentSessionId, title: derivedTitle });
        void piRenameSession(currentSessionId, derivedTitle, cwdRef.current).catch(() => undefined);
      }
      sessionStore.getState().pushOptimisticUser(text);
      sessionStore.getState().setStreaming(true);
      await piSend(currentSessionId, text, { traceId });
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().popOptimistic();
      sessionsStore.getState().upsert({ sessionId: currentSessionId, status: "failed" });
      restoreComposerText(text);
      if (isElectronBridgeUnavailable(e)) notifyBridgeUnavailable();
    }
  }, [currentSessionId, handleSendNew, sessionStore, sessionsStore, notifyBridgeUnavailable]);

  const handleSendContent = useCallback(async (content: UserContentPart[]) => {
    const traceId = generateTrace();
    const log = withTrace(appLogger, traceId);
    const textPart = content.find((c) => c.type === "text");
    const textForLog = textPart?.text ?? "";
    log.info("composer.send.content", { sessionId: currentSessionId, textLength: textForLog.length });
    if (!currentSessionId) return handleSendNew(textForLog, content);
    if (sessionStore.getState().streaming) return;
    try {
      sessionsStore.getState().upsert({ sessionId: currentSessionId, status: "working" });
      const t = lookupSessionTitle(currentSessionId);
      if (isPlaceholderTitle(t) && textPart?.text) {
        const derivedTitle = deriveTitle(textPart.text);
        sessionsStore.getState().upsert({ sessionId: currentSessionId, title: derivedTitle });
        void piRenameSession(currentSessionId, derivedTitle, cwdRef.current).catch(() => undefined);
      }
      sessionStore.getState().pushOptimisticUserContent(content);
      sessionStore.getState().setStreaming(true);
      await piSendContent(currentSessionId, content, { traceId, mode: "queue" });
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().popOptimistic();
      sessionsStore.getState().upsert({ sessionId: currentSessionId, status: "failed" });
      restoreComposerText(textForLog);
      if (isElectronBridgeUnavailable(e)) notifyBridgeUnavailable();
    }
  }, [currentSessionId, handleSendNew, sessionStore, sessionsStore, notifyBridgeUnavailable]);

  const handleCancel = useCallback(async () => {
    if (!currentSessionId) return;
    try { await piCancel(currentSessionId); } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      if (isElectronBridgeUnavailable(e)) notifyBridgeUnavailable();
    } finally {
      abandonInFlightStream({ sessionId: currentSessionId, reason: "用户取消", status: "completed" });
    }
  }, [currentSessionId, sessionStore, notifyBridgeUnavailable]);

  const handleRenameTitle = useCallback(async (newTitle: string) => {
    if (!currentEntry) return;
    try { await piRenameSession(currentEntry.sessionId, newTitle, currentEntry.cwd); sessionsStore.getState().upsert({ sessionId: currentEntry.sessionId, title: newTitle }); }
    catch (e) { showToast(`重命名失败：${String(e).replace(/^Error:\s*/, "")}`); throw e; }
  }, [currentEntry, sessionsStore, showToast]);

  // 流式中选择的模型先挂起,回合结束后再真正切换(F3:进行中回合不换模型)。
  const pendingModelRef = useRef<{ sessionId: string | undefined; modelId: string } | null>(null);

  const { awaitPendingNewSession } = optimisticSession;

  const applyModelSwitch = useCallback(async (modelId: string) => {
    // 新建会话的第一轮里 currentSessionId 还是 `__pending_*` 占位 id。
    // 直接发给主进程会撞 "Pi session is not loaded" 跨会话护栏,所以先等
    // 真实 id 落地。
    let targetSessionId = currentSessionId;
    if (targetSessionId?.startsWith("__pending_")) {
      targetSessionId = (await awaitPendingNewSession()) ?? targetSessionId;
    }
    if (!targetSessionId || targetSessionId.startsWith("__pending_")) {
      // 还没有真实会话:只记住选择,下一条消息创建会话时会带上它。
      currentModelIdRef.current = modelId;
      setCurrentModelId(modelId);
      return;
    }
    const previous = currentModelIdRef.current;
    const sessionId = targetSessionId;
    const trySet = () => piSetModel(sessionId, modelId);
    try {
      await trySet();
      currentModelIdRef.current = modelId;
      setCurrentModelId(modelId);
    } catch (error) {
      const message = String(error);
      // 主进程跨会话护栏抛的是 "Pi session is not loaded: …"(历史实现只
      // 匹配从未出现过的 "unknown session",导致恢复分支是死代码)。
      if (/is not loaded|unknown session/i.test(message)) {
        try {
          await piLoadSession(sessionId, currentEntry?.cwd ?? cwdRef.current);
          await trySet();
          currentModelIdRef.current = modelId;
          setCurrentModelId(modelId);
          return;
        } catch (retryError) {
          currentModelIdRef.current = previous;
          setCurrentModelId(previous);
          showToast(`模型切换失败：${friendlyModelSwitchError(retryError)}`);
          return;
        }
      }
      // 切换失败必须回滚显示,否则 picker 会一直显示一个并未生效的模型,
      // 而下一轮实际用的还是旧模型。
      currentModelIdRef.current = previous;
      setCurrentModelId(previous);
      showToast(`模型切换失败：${friendlyModelSwitchError(error)}`);
    }
  }, [awaitPendingNewSession, currentEntry, currentSessionId, showToast]);

  const handleModelChange = useCallback(async (modelId: string) => {
    if (streaming) {
      pendingModelRef.current = { sessionId: currentSessionId, modelId };
      showToast(`已选择 ${shortModelLabel(modelId) || modelId}，将在本轮结束后切换`);
      return;
    }
    pendingModelRef.current = null;
    await applyModelSwitch(modelId);
  }, [applyModelSwitch, currentSessionId, showToast, streaming]);

  // 回合结束(含失败)后执行挂起的模型切换。若用户流式中已切到别的会话,
  // 旧会话上的选择不能落到新会话。
  useEffect(() => {
    if (streaming) return;
    const pending = pendingModelRef.current;
    if (!pending) return;
    pendingModelRef.current = null;
    const sameSession = pending.sessionId === currentSessionId
      || (pending.sessionId?.startsWith("__pending_") === true && currentSessionId?.startsWith("__pending_") !== true);
    if (!sameSession) return;
    void applyModelSwitch(pending.modelId);
  }, [applyModelSwitch, currentSessionId, streaming]);

  // plan1030 §5.2.1 — 对话内删除模型。picker 传来的 id 是 `provider/modelId`
  // 规范形(flattenModels 的输出);宿主 deleteModel 后会自动把 active 模型
  // 迁移到同 provider 的其他模型(restoreActiveModelAfterMutation),渲染端
  // 只需刷新列表 —— refreshModels 内部会把失效的 currentModelId 重置为第一项。
  const handleModelDelete = useCallback(async (modelId: string) => {
    const separator = modelId.indexOf("/");
    if (separator <= 0) {
      showToast(`无法删除 ${shortModelLabel(modelId) || modelId}：缺少 provider 信息`);
      return;
    }
    const providerId = modelId.slice(0, separator);
    const bareModelId = modelId.slice(separator + 1);
    const label = shortModelLabel(modelId) || modelId;
    if (!await confirm(`删除模型「${label}」？`, { tone: "danger", confirmLabel: "删除" })) return;
    try {
      await providersDeleteModel(providerId, bareModelId);
      showToast(`已删除 ${label}`);
      await refreshModelsRef.current();
    } catch (error) {
      showToast(`删除失败：${friendlyError(error)}`);
    }
  }, [showToast]);

  const handleSelectWorkspace = useCallback((newCwd: string) => {
    cwdRef.current = newCwd;
    setSwitchingWorkspace(newCwd);
    void piCreateWorkspace(newCwd).then(() => piListWorkspaceRegistry()).then((registry) => { sessionsStore.getState().setWorkspaces(registry.items); setWorkspaces(registry.items); })
      .catch((error) => { setToast(`工作空间不可用：${String(error).replace(/^Error:\s*/u, "")}`, { kind: "warning" }); })
      .finally(() => { setSwitchingWorkspace((current) => (current === newCwd ? null : current)); });
  }, [sessionsStore, setToast]);

  const handleNewSession = useCallback(() => { localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY); setPlaceholderView(null); sessionsStore.getState().setCurrent(null); }, [sessionsStore]);
  const handleGoHome = useCallback(() => { localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY); setPlaceholderView(null); sessionsStore.getState().setCurrent(null); }, [sessionsStore]);

  const handleToggleWorkspace = useCallback(async (cwd: string, next: boolean) => {
    sessionsStore.getState().setExpanded(cwd, next);
    if (next && sessionsStore.getState().workspaceSessions[cwd] === undefined) {
      try { const list = await piListSessions(cwd); sessionsStore.getState().setWorkspaceSessions(cwd, list); }
      catch (e) { showToast(`加载空间会话失败：${String(e)}`); }
    }
  }, [sessionsStore, showToast]);

  const handleSelectSession = useCallback(async (sessionId: string, sessionCwd?: string) => {
    // 宿主同一时刻只有一个活动会话:载入别的会话会中止正在运行的回合。
    // 以前是静默中止;现在先说清楚,确认后走正常的停止流程再切换。
    const live = sessionStore.getState();
    if (live.streaming && live.sessionId && live.sessionId !== sessionId) {
      const ok = await confirm("当前回复仍在生成，切换会话将停止它。", {
        tone: "warning",
        confirmLabel: "停止并切换",
      });
      if (!ok) return;
      await handleCancel();
    }
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(sessionId);
    sessionStore.getState().setSession(sessionId);
    sessionStore.getState().setHistoryLoading(true);
    try {
      await piLoadSession(sessionId, sessionCwd ?? "");
      const entries = await agentSessionMessages(sessionId);
      const { messages: history } = sessionEntriesToChatMessages(entries);
      useSessionStore.getState().loadHistoryMessages(sessionId, history as unknown as import("@/stores/session-store").ChatMessage[]);
      await syncCurrentModelFromHost();
    } catch (e) { sessionStore.getState().setError(friendlyError(e)); }
    finally {
      if (sessionStore.getState().sessionId === sessionId) sessionStore.getState().setHistoryLoading(false);
    }
  }, [sessionStore, sessionsStore, syncCurrentModelFromHost, handleCancel]);

  const handleRewound = useCallback(async () => {
    const id = sessionStore.getState().sessionId;
    if (!id) return;
    try {
      await piLoadSession(id, cwdRef.current);
      const entries = await agentSessionMessages(id);
      const { messages: history } = sessionEntriesToChatMessages(entries);
      useSessionStore.getState().loadHistoryMessages(id, history as unknown as import("@/stores/session-store").ChatMessage[]);
    } catch (e) { sessionStore.getState().setError(friendlyError(e)); }
  }, [sessionStore]);

  const handleForked = useCallback((newId: string) => {
    const cwd = cwdRef.current;
    const oldId = sessionStore.getState().sessionId;
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(newId);
    sessionsStore.getState().upsert({ sessionId: newId, title: "分叉会话", cwd });
    sessionStore.getState().setSession(newId);
    if (oldId && oldId !== newId) useFeedbackStore.getState().renameSession(oldId, newId);
    void piLoadSession(newId, cwd).catch((e) => sessionStore.getState().setError(friendlyError(e)));
  }, [sessionStore, sessionsStore]);

  const handleStartWithExpert = useCallback((agent: AgentEntry, _meta?: { expertId?: string; source?: string }) => {
    const promptBody = agent.raw ? extractMarkdownBody(agent.raw) : agent.description ?? "";
    usePendingExpertStore.getState().set({
      name: agent.name, prompt: promptBody, description: agent.description ?? agent.name,
      expertId: _meta?.expertId ?? agent.name, source: _meta?.source ?? agent.scope ?? "local",
    });
    handleGoHome();
  }, [handleGoHome]);

  const handleLaunchDiscover = useCallback(async (prompt: string, agent?: AgentEntry) => {
    const cwd = cwdRef.current;
    const body = composeDiscoverBody(prompt, agent);
    setPlaceholderView(null);
    const { pendingId, promise } = optimisticSession.ensureNewSession(cwd);
    sessionStore.getState().pushOptimisticUser(body);
    sessionStore.getState().setStreaming(true);
    sessionsStore.getState().upsert({ sessionId: pendingId, title: agent ? agent.name : deriveTitle(prompt), cwd, status: "working" });
    try { await newSessionFlow({ pendingId, promise, text: body, cwd, flowDeps: { awaitPendingNewSession: optimisticSession.awaitPendingNewSession } }); }
    catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().popOptimistic();
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().setSession(null);
      sessionsStore.getState().setCurrent(null);
      sessionsStore.getState().remove(pendingId);
      showToast(`启动失败：${friendlyError(e)}`);
    }
  }, [optimisticSession, sessionStore, sessionsStore, showToast]);

  const handleStartProject = useCallback(async (project: ProjectMeta) => {
    if (project.cwd) cwdRef.current = project.cwd;
    const cwd = cwdRef.current;
    const seed = project.instructions?.trim() ? project.instructions : `你好，我们开始「${project.name}」项目吧。`;
    setPlaceholderView(null);
    const { pendingId, promise } = optimisticSession.ensureNewSession(cwd);
    sessionStore.getState().pushOptimisticUser(seed);
    sessionStore.getState().setStreaming(true);
    sessionsStore.getState().upsert({ sessionId: pendingId, title: project.name, cwd, status: "working" });
    try { await newSessionFlow({ pendingId, promise, text: seed, cwd, flowDeps: { awaitPendingNewSession: optimisticSession.awaitPendingNewSession, projectSeed: { id: project.id, name: project.name, instructions: project.instructions }, registerProjectConversation: true } }); }
    catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().popOptimistic();
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().setSession(null);
      sessionsStore.getState().setCurrent(null);
      sessionsStore.getState().remove(pendingId);
      showToast(`启动项目失败：${friendlyError(e)}`);
    }
  }, [optimisticSession, sessionStore, sessionsStore, showToast]);

  const handleStartProjectConversation = useCallback(async (projectId: string, message?: string) => {
    const project = useProjectsStore.getState().projects.find((p) => p.id === projectId);
    if (!project) return;
    const cwd = project.cwd || cwdRef.current;
    const title = message ? deriveTitle(message) : `${project.name} 对话`;
    setPlaceholderView(null);
    const { pendingId, promise } = optimisticSession.ensureNewSession(cwd);
    sessionStore.getState().setStreaming(true);
    sessionsStore.getState().upsert({ sessionId: pendingId, title, cwd, status: message ? "working" : "pending" });
    if (message) sessionStore.getState().pushOptimisticUser(message);
    try { await newSessionFlow({ pendingId, promise, text: message ?? "", cwd, flowDeps: { awaitPendingNewSession: optimisticSession.awaitPendingNewSession, projectSeed: { id: project.id, name: project.name, instructions: project.instructions }, registerProjectConversation: true } }); }
    catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().popOptimistic();
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().setSession(null);
      sessionsStore.getState().setCurrent(null);
      sessionsStore.getState().remove(pendingId);
      showToast(`创建项目对话失败：${friendlyError(e)}`);
    }
  }, [sessionStore, sessionsStore, optimisticSession, showToast]);

  const handleAgentDied = useCallback(({ reason }: { reason: string }) => {
    console.error('[OpenBuddy] Agent thread died:', reason);
    // R-err-provider-chat — agent-died is not a provider error per se, but
    // the chat transcript still needs an inline TurnErrorCard instead of a
    // bare "（已中断：agent-died: ...）" placeholder. Treat the agent-died
    // reason as the card body and pin `provider_error` so the chip renders
    // a localised title ("模型服务暂时不可用") rather than the generic
    // fallback. The top banner + toast keep their existing copy.
    const focusedSessionId = sessionStore.getState().sessionId;
    const bannerMsg = `AI 引擎异常退出：${reason}`;
    sessionStore.getState().setError(bannerMsg);
    reportEvent("agent_died", "error", { reason });
    if (focusedSessionId) {
      abandonInFlightStream({
        sessionId: focusedSessionId,
        reason: `agent-died: ${reason}`,
        error: { message: bannerMsg, code: "provider_error" },
      });
    }
    setToast(`⚠️ AI 引擎异常退出：${reason}。正在尝试自动恢复…`, {
      kind: "error", ttlMs: 0, id: "agent-died",
      action: { label: "立即重连", hint: "↵", onClick: () => { void sessionEvents.resubscribe(); setToast("已尝试重新连接 AI 引擎。", { kind: "info", ttlMs: 3000, id: "agent-died-resub-attempted" }); } },
    });
    setTimeout(() => { void sessionEvents.resubscribe(); }, 1500);
  }, [sessionStore, setToast, sessionEvents]);
  handleAgentDiedRef.current = handleAgentDied;

  // ====== final return ======================================================
  return {
    init, initError, apiReady: init?.auth.ready ?? false,
    toastQueue, dismissToast,
    settingsOpen, settingsSection, shortcutsOpen, searchOpen, aboutOpen, trustRequest, placeholderView,
    setSettingsOpen, setShortcutsOpen, setSearchOpen, setAboutOpen, setTrustRequest, setPlaceholderView,
    setSettingsSection,
    feedbackOpen, setFeedbackOpen,
    signInOpen, setSignInOpen, openSignIn, setCasdoorSession,
    dataDirOpen, setDataDirOpen,
    sidebarCollapsed, setSidebarCollapsed,
    currentModelId, setCurrentModelId, models, workspaces, switchingWorkspace,
    currentSessionId, currentTitle, streaming,
    casdoorSession, taskRefreshSignal,
    extensionText, extensionTextNonce, extensionUiBySession,
    notifyBridgeUnavailable,
    openSettings, openAccountSettings, handleLogin, handleLogout, showToast, setToast,
    handleNavigate, handleGoHome, handleNewSession, handlePlaceholder, handleOpenProjectFromSidebar,
    handleSendNew, handleSendCurrent, handleSendContent, handleCancel,
    handleSelectSession, handleToggleWorkspace, handleRenameTitle, handleModelChange, handleModelDelete, handleSelectWorkspace,
    handleRewound, handleForked, handleStartWithExpert, handleLaunchDiscover, handleStartProject,
    handleStartProjectConversation, handleSelectEmailFromSearch, handleSelectKnowledgeFromSearch,
    refreshModels, sessionEvents,
  };
}
