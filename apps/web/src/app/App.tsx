import { useCallback, useEffect, useRef, useState } from "react";
import { TitleBar } from "./shell/TitleBar";
import { Sidebar } from "../features/sessions/Sidebar";
import { HomePage } from "../features/home/HomePage";
import { ChatView } from "../features/chat/ChatView";
import { PlaceholderPage } from "./routing/PlaceholderPage";
import { Toast } from "@openbuddy/ui/Toast";
// PermissionDialog is now inline in ChatView (PermissionInlineCard), not a global modal.
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { AboutDialog } from "../features/settings/AboutDialog";
import { FolderTrustDialog } from "../features/approvals/FolderTrustDialog";
import { TopbarActions } from "./shell/TopbarActions";
import { SidebarToggleIcon, WbNewTaskIcon } from "@openbuddy/ui/icon/icons/index";
import { ModelRuntimeContext, type ModelOption } from "../features/models/ModelSelector";
import { useExtensionUiStore } from "../features/approvals/state/extension-ui-store";
import { useAgentModelStore } from "../features/models/state/agent-model-store";
import { useSessionStore } from "../features/chat/state/session-store";
import { usePlanFeed } from "../features/chat/state/plan-store";
import { useArtifactsStore } from "../features/workbench/state/artifacts-store";
import { useSessionsStore } from "../features/sessions/state/sessions-store";
import { usePermissionStore } from "../features/approvals/state/permission-store";
import { useQuestionStore } from "../features/approvals/state/question-store";
import { BoundExpertBadge } from "../features/experts";
import { bindPendingExpert, clearSessionExpert, selectExpert, showLoadedExpert, showSessionExpert } from "./expert-session";
import { TopbarTitle } from "./shell/TopbarTitle";
import {
  agentInit,
  agentNewSession,
  agentSend,
  agentCompact,
  agentCancel,
  agentLoadSession,
  agentListSessions,
  agentListWorkspaces,
  agentRenameSession,
  agentSetModel,
  agentGetModelState,
  agentSetThinkingLevel,
  agentsDefaultsGet,
  agentsDefaultsSave,
  agentAuthStatus,
  providersList,
  flattenModels,
  notificationAppend,
  subscribeAgentEvents,
  type InitResult,
  type WorkspaceInfo,
} from "@openbuddy/client/agent-client";
import type { AgentEntry } from "@openbuddy/protocol/dto";
import { useProjectsStore, type ProjectMeta } from "../features/projects/state/projects-store";
import { usePiQueueStore } from "../features/composer/state/pi-queue-store";
import { recordUsage, loadUsage, loadQuotaConfig } from "../features/settings/usage-quota";
import { dispatchNotification } from "../features/settings/notify-channels";
import {
  registerTelemetryProvider,
  createConsoleTelemetryProvider,
  reportEvent,
} from "../shared/telemetry/telemetry-contract";
import { IS_MACOS } from "@openbuddy/platform/platform";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { AppDialogHost } from "../shared/ui/AppDialog";
import { ImageLightboxHost } from "@openbuddy/ui/ImageLightbox";
import { SearchPalette, ShortcutsPanel } from "./palette/ShortcutsPanel";
import { matchShortcut } from "../shared/lib/shortcuts";
import { copyText } from "@openbuddy/platform/clipboard";
import { useUnseenStore } from "./state/unseen-store";
import { parseUserText, baseName, EXPERT_PERSONA_BEGIN, EXPERT_PERSONA_END } from "@openbuddy/chat-core/user-text";
import { featureView, useFeatureNav } from "./routing/use-feature-nav";
import { openHubAt } from "./routing/ExpertsHub";

export { EXPERT_PERSONA_BEGIN, EXPERT_PERSONA_END };

/** Optimistic sidebar title; the engine persists the authoritative one after the first turn. */
function deriveTitle(text: string): string {
  const display = parseUserText(text);
  const clean = display.text.replace(/^【[^】]{1,12}】/, "").replace(/\s+/g, " ").trim();
  if (!clean) return display.skill ? `技能：${display.skill}` : display.attachments[0] ? `查看 ${baseName(display.attachments[0])}` : "新任务";
  return clean.length > 30 ? clean.slice(0, 30) + "…" : clean;
}
/** `/compact [instructions]` typed as the whole message. */
const COMPACT_COMMAND = /^\/compact(?:\s+([\s\S]*))?$/;
const sessionStatusOf = (status: "running" | "idle" | "failed") => status === "running" ? "working" as const : status === "failed" ? "failed" as const : "completed" as const;

/**
 * Strip YAML frontmatter (`---\n...\n---`) from a markdown agent file and
 * return only the body (the system prompt content).
 */
function extractMarkdownBody(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return raw.trim();
  const afterOpen = trimmed.indexOf("\n");
  if (afterOpen === -1) return raw.trim();
  const rest = trimmed.slice(afterOpen + 1);
  const closeIdx = rest.search(/\n---\s*(\n|$)/);
  if (closeIdx === -1) return raw.trim();
  return rest.slice(closeIdx + 1).replace(/^\n---\s*/, "").trim();
}



const LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/** What Pi will use for a requested level (unset = Pi's default "medium"): the next supported one up. */
function clampThinking(requested: string | undefined, levels: string[]): string | undefined {
  if (!levels.length) return undefined;
  const want = requested ?? "medium";
  if (levels.includes(want)) return want;
  const i = LEVEL_ORDER.indexOf(want);
  return levels.find(level => LEVEL_ORDER.indexOf(level) >= i) ?? levels[levels.length - 1];
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}

function Shell() {
  const [init, setInit] = useState<InitResult | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [trustRequest, setTrustRequest] = useState<{ cwd?: string; reason?: string } | null>(null);
  const [placeholderView, setPlaceholderView] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Ctrl/Cmd+K search and the Ctrl/Cmd+/ shortcut list (20261115-ui U8.2). */
  const [palette, setPalette] = useState<"search" | "shortcuts" | null>(null);
  /** Entry points the host can serve (pii W0.1/W0.2: host_capabilities + FeatureRegistry). */
  const features = useFeatureNav();

  const [toast, setToast] = useState<string | null>(null);
  const focusedModelSession = useSessionStore(state => state.sessionId);
  const homeModelKey = useAgentModelStore(state => state.homeModelKey);
  const activeModelState = useAgentModelStore(state => focusedModelSession ? state.states[focusedModelSession] : undefined);
  const currentModelId = focusedModelSession ? activeModelState?.modelKey : homeModelKey;
  const [modelBusy, setModelBusy] = useState(false);
  const [invalidDefault, setInvalidDefault] = useState(false);
  const modelOperation = useRef(0);
  const modelPending = useRef(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  // Home (no session yet): the thinking level new tasks start with = defaults.defaultThinkingLevel.
  const [homeThinking, setHomeThinking] = useState<string | undefined>(undefined);
  useEffect(() => { void agentsDefaultsGet().then(d => setHomeThinking(d.defaultThinkingLevel)).catch(() => {}); }, [models]);
  const homeLevels = models.find(model => model.id === homeModelKey)?.availableThinkingLevels ?? [];
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToastRef = useRef<(message: string) => void>(() => {});
  const cwdRef = useRef<string>("");
  const selectSessionRef = useRef<((sessionId: string, cwd?: string) => Promise<void>) | null>(null);
  const resourceSessionRef = useRef<string | undefined>(undefined);

  usePlanFeed(); // agent://plan → plan store (PlanPanel, 任务概览; pii W3.2)
  const sessionStore = useSessionStore;
  const sessionsStore = useSessionsStore;
  const permissionStore = usePermissionStore;
  const questionStore = useQuestionStore;

  /** Re-fetch providers + auth readiness after Settings add/edit/delete.
   *
   * Previously this only updated `models`, so the home Composer still saw
   * `apiReady=false` (from the cold-start `init.auth.ready`) and stayed
   * disabled with "请先配置 API Key" — looking like nothing changed.
   * Also, the first added model was never auto-selected as currentModelId.
   */
  const refreshModels = useCallback(async () => {
    try {
      const [list, auth, defaults] = await Promise.all([providersList(), agentAuthStatus(), agentsDefaultsGet()]);
      const options = flattenModels(list);
      setInvalidDefault(!!defaults.invalidDefault);
      setModels(options);

      const preferred = options.find(option => option.id === defaults.defaultModel)
        ?? options.find(option => option.modelId === defaults.defaultModel && option.providerId === defaults.defaultProviderId)
        ?? (options.filter(option => option.modelId === defaults.defaultModel).length === 1 ? options.find(option => option.modelId === defaults.defaultModel) : undefined);
      useAgentModelStore.getState().setHomeModelKey(preferred?.id ?? (defaults.defaultModel ? undefined : options[0]?.id));
      // Unlock the home Composer as soon as a BYOK provider exists (or OAuth).
      setInit((prev) => (prev ? { ...prev, auth } : prev));
    } catch {
      // Non-fatal — the picker keeps its previous list.
    }
  }, []);

  // Deep links into 设置 from inline cards (error card, approval card "查看拦截规则").
  useEffect(() => {
    const open = (event: Event) => {
      setSettingsSection((event as CustomEvent<{ section?: string }>).detail?.section);
      setSettingsOpen(true);
    };
    window.addEventListener("openbuddy:open-settings", open);
    return () => window.removeEventListener("openbuddy:open-settings", open);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    // 注册遥测 console provider(Aegis 替代),启动时一次。
    registerTelemetryProvider(
      createConsoleTelemetryProvider({
        sink: (e) => console.debug(`[telemetry] ${e.level.toUpperCase()} ${e.name}`, e.props ?? ""),
      }),
    );
    reportEvent("app_started", "info");

    (async () => {
      try {
        const result = await agentInit();
        if (disposed) return;
        // 新建任务 aims at it (⇒ 任务 group), and the user can re-aim a new
        // session at another directory via the Composer workspace picker
        // (⇒ that 空间 node). homeCwd drives the store's group routing.
        cwdRef.current = result.cwd;
        sessionsStore.getState().setHomeCwd(result.cwd);
        setInit(result);
        setInvalidDefault(!!result.invalidDefault);

        unlisten = await subscribeAgentEvents({
          // The bound expert rides along, so the badge follows ‹1/2› switches, 重新生成 and 从这里编辑 (pii W2.2).
          onModelState: state => { useAgentModelStore.getState().apply(state); if (state.expert !== undefined) showSessionExpert(state.sessionId, state.expert); },
          onUpdate: (u) => {
            sessionStore.getState().queueUpdate(u);
            if (u.type === "queue_update" && u.sessionId && Array.isArray(u.steering) && Array.isArray(u.followUp)) {
              usePiQueueStore.getState().apply(u.sessionId, { steering: u.steering.filter((text): text is string => typeof text === "string"), followUp: u.followUp.filter((text): text is string => typeof text === "string") });
            }
          },
          onPermission: (p) => {
            // Requests stay queued per session; background sessions show a badge in the sidebar.
            reportEvent("permission_request", "warn", { sessionId: p.sessionId });
            permissionStore.getState().request(p);
            if (p.sessionId !== sessionStore.getState().sessionId) {
              void notificationAppend("permission", "后台任务等待确认", sessionsStore.getState().titleOf?.(p.sessionId), p.sessionId, "warn");
            }
          },
          onPermissionDismiss: (event) => permissionStore.getState().dismiss(event.requestId, event.sessionId),
          onArtifacts: (event) => { void useArtifactsStore.getState().refresh(event.sessionId); },
          // A system notification was clicked: open that session.
          onFocusSession: (event) => {
            const state = sessionsStore.getState();
            const entry = state.independent.find((x) => x.sessionId === event.sessionId)
              ?? Object.values(state.workspaceSessions).flat().find((x) => x.sessionId === event.sessionId);
            void selectSessionRef.current?.(event.sessionId, entry?.cwd);
          },
          onSessionStatus: (event) => {
            sessionsStore.getState().upsert({ sessionId: event.sessionId, status: sessionStatusOf(event.status) });
          },
          onComplete: (p) => {
            reportEvent("session_complete", "info", { sessionId: p.sessionId, stopReason: p.stopReason });
            // Ignore completes for side-channel sessions (inspiration generation)
            // — they're handled by their own listeners, not the main transcript.
            sessionStore.getState().markComplete(p);
            const transcript = sessionStore.getState().transcripts[p.sessionId];
            const failed = !!transcript?.error;
            sessionsStore.getState().upsert({ sessionId: p.sessionId, status: failed ? "failed" : "completed", updatedAt: new Date().toISOString() });
            p.usage = transcript?.usage;
            // Record token usage for the quota dashboard (weixinpay alternative).
            if (p.usage && (p.usage.promptTokens || p.usage.completionTokens)) {
              const currentModel = useAgentModelStore.getState().states[p.sessionId]?.modelKey;
              recordUsage(loadUsage(), {
                modelId: currentModel ?? "unknown",
                promptTokens: p.usage.promptTokens ?? 0,
                completionTokens: p.usage.completionTokens ?? 0,
              }, loadQuotaConfig() ?? undefined);
            }
            // Only background completions are worth a notification; the focused one is on screen.
            if (p.sessionId !== sessionStore.getState().sessionId && p.stopReason !== "cancelled") {
              const title = sessionsStore.getState().titleOf?.(p.sessionId) ?? "任务";
              void notificationAppend("session_complete", failed ? `任务失败：${title}` : `任务完成：${title}`, undefined, p.sessionId, failed ? "error" : "info");
              if (!failed) useUnseenStore.getState().mark(p.sessionId);
              void dispatchNotification({
                title: failed ? "OpenBuddy 任务失败" : "OpenBuddy 任务完成",
                body: title,
                level: failed ? "error" : "info",
                sessionId: p.sessionId,
              }).catch(() => { /* notification dispatch failure is non-fatal */ });
            }

          },
          onSummary: ({ sessionId, title }) => {
            // sidebar entry in place. This overrides the "新会话" placeholder
            // set optimistically in handleSendNew. Stamp updatedAt so the
            // sidebar can re-sort the freshly-active session to the top.
            sessionsStore.getState().upsert({
              sessionId,
              title,
              updatedAt: new Date().toISOString(),
            });
            // Sync title into the owning project's conversation list.
            const allProjects = useProjectsStore.getState().projects;
            for (const p of allProjects) {
              if (p.conversations.some((c) => c.sessionId === sessionId)) {
                useProjectsStore.getState().updateConversationTitle(p.id, sessionId, title);
                break;
              }
            }
          },
          onFolderTrust: (p) => {
            const req = (p ?? {}) as { cwd?: string; reason?: string };
            setTrustRequest({ cwd: req.cwd, reason: req.reason });
            void notificationAppend(
              "folder_trust",
              `请求信任文件夹：${req.cwd ?? "(unknown)"}`,
              req.reason,
              undefined,
              "warn",
            );
          },
          onMcpStatus: (p) => {
            void notificationAppend(
              "mcp_status",
              "MCP 连接器状态变化",
              typeof p === "string" ? p : JSON.stringify(p).slice(0, 200),
              undefined,
              "info",
            );
          },
          onModelsUpdate: () => {
            void refreshModels();
          },
          onQuestion: request => {
            // Queued per session like permissions; answered when the user returns.
            questionStore.getState().request(request);
          },
          onUiDismiss: event => questionStore.getState().dismiss(event.requestId, event.sessionId, event.reason),
          onUiState: event => useExtensionUiStore.getState().apply(event),
          onUiNotification: event => {
            if (event.sessionId === sessionStore.getState().sessionId) showToastRef.current(event.message);
          },
          onTurnError: (e) => {
            // connection reset, …) via prompt_complete with stopReason
            // "rate_limit"/"error". Surface a friendly message instead of
            // silently marking the turn complete.
            console.warn('[OpenBuddy] Turn ended abnormally:', e);
            // Errors belong to their own session's transcript (shown inline in that turn).
            sessionStore.getState().setError(e.detail || "本轮执行出错，请重试。", e.sessionId);
            reportEvent("turn_error", "error", { sessionId: e.sessionId, kind: e.kind });
          },
        });

        if (disposed) { unlisten(); return; }

        // Sidebar now shows two groups: 任务 (the inbox cwd's sessions) +
        // 空间 (one node per other working directory). Load both up front;
        // 空间 node children are lazy-loaded when a node is expanded.
        const [independent, ws] = await Promise.all([
          agentListSessions(result.cwd),
          agentListWorkspaces(),
        ]);
        sessionsStore.getState().setIndependent(independent);
        sessionsStore.getState().setWorkspaces(ws);
        setWorkspaces(ws);

        // Load the model list (from config.toml [model.*]) for the picker.
        const providers = await providersList();
        const providerOptions = flattenModels(providers);
        setModels(providerOptions);

        // bundled model) when the user's configured custom model (e.g. glm-5
        // via a BYOK [model.*] entry) isn't recognized as a catalog entry.
        // (which only knows their custom model id). So: when the user has
        // configured at least one BYOK provider, prefer the first one over
        // intent and makes the out-of-box BYOK experience work.
        const reportedDefault = providerOptions.find(option => option.id === result.defaultModelKey)
          ?? providerOptions.find(option => option.providerId === result.defaultProviderId && option.modelId === result.defaultModelId)
          ?? (providerOptions.filter(option => option.modelId === result.defaultModelId).length === 1 ? providerOptions.find(option => option.modelId === result.defaultModelId) : undefined);
        useAgentModelStore.getState().setHomeModelKey(reportedDefault?.id ?? (result.defaultModelKey || result.defaultModelId ? undefined : providerOptions[0]?.id));

      } catch (e) {
        setInitError(String(e));
      }
    })();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [sessionStore, sessionsStore, permissionStore, questionStore]);

  const currentSessionId = sessionsStore((s) => s.currentSessionId);
  // The active session's sidebar entry (title + cwd), looked up across the
  // 任务 + 空间 groups — drives the topbar title on the conversation page and
  // the cwd scoping of a manual rename (mirrors WorkBuddy's topbar).
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

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), message.length > 30 ? 4000 : 2400);
  };
  showToastRef.current = showToast;
  // 用户中心 / 通知 open 设置. Other labels no longer fall back to a "即将上线" toast (pii W0.3: no toast-only entries).
  const handlePlaceholder = (label: string) => { if (label === "用户中心" || label === "通知") setSettingsOpen(true); };
  const handleNavigate = (label: string) => {
    if (sessionStore.getState().sessionId) resourceSessionRef.current = sessionStore.getState().sessionId ?? undefined;
    // pii W0.2: the FeatureRegistry decides (was a hard-coded block list, now routing/features.tsx LEGACY_BLOCKED_VIEWS).
    const view = featureView(label);
    if (!view) return;
    setPlaceholderView(view);
    sessionsStore.getState().setCurrent(null);
    sessionStore.getState().reset();
  };

  // 管理连接器 (composer): the 连接器 tab of 专家·技能·连接器 through the registry; no bypass (pii W0.2).
  const openConnectors = featureView("专家·技能·连接器") ? (tab: "experts" | "connectors" = "connectors") => { openHubAt(tab); handleNavigate("专家·技能·连接器"); } : undefined;
  // Sidebar project node click → open the Projects panel with that project selected.
  const handleOpenProjectFromSidebar = (projectId: string) => {
    useProjectsStore.getState().setActiveProjectId(projectId);
    handleNavigate("项目");
  };

  const createSession = async (cwd: string, key?: string) => {
    if (!key || !models.some(model => model.id === key)) throw new Error("请先选择可用模型");
    if (modelPending.current) throw new Error("模型正在切换，请稍候");
    const sid = await agentNewSession(cwd, key);
    useAgentModelStore.getState().apply(await agentGetModelState(sid));
    return sid;
  };

  const handleSendNew = async (text: string, attachments?: { path: string }[]) => {
    if (!attachments?.length && COMPACT_COMMAND.test(text.trim())) {
      showToastRef.current?.("新任务还没有可以压缩的上下文");
      return;
    }
    let sessionId: string | undefined;
    try {
      const cwd = cwdRef.current;
      sessionId = await createSession(cwd, currentModelId);
      sessionsStore.getState().setCurrent(sessionId);
      setPlaceholderView(null);
      sessionsStore.getState().upsert({ sessionId, title: deriveTitle(text), cwd, status: "working", updatedAt: new Date().toISOString() });
      sessionStore.getState().setSession(sessionId);

      // A summoned expert is bound to the new task (persona, model, tools) before its first prompt (pii W2.2).
      const expertNotice = await bindPendingExpert(sessionId);
      if (expertNotice) showToast(expertNotice);

      // UI shows only the user's visible text.
      sessionStore.getState().pushUser(text, attachments?.map(a => a.path), sessionId);
      sessionStore.getState().startStreaming(sessionId);
      await agentSend(sessionId, text, attachments);
      refreshWorkspaces(cwd);
    } catch (e) {
      console.error('[OpenBuddy] handleSendNew error:', e);
      if (sessionId) {
        sessionStore.getState().dropPending(sessionId);
        sessionStore.getState().setError(friendlyError(e), sessionId);
        sessionsStore.getState().upsert({ sessionId, status: "failed" });
      } else {
        showToast(friendlyError(e));
      }
      throw e;
    }
  };

  /** A first session in a new folder creates its 空间 node. */
  const refreshWorkspaces = (cwd: string) => {
    if (!cwd || cwd === sessionsStore.getState().homeCwd) return;
    void agentListWorkspaces().then(ws => { sessionsStore.getState().setWorkspaces(ws); setWorkspaces(ws); }).catch(() => {});
  };

  const handleSendCurrent = async (text: string, attachments?: { path: string }[]) => {
    if (!currentSessionId) return handleSendNew(text, attachments);
    // Guard against double-send / send-during-streaming. Composer also guards
    // via its `streaming` prop, but that value can be stale within the same
    // render tick; the store flag is the source of truth. A second pushUser +
    // startStreaming would orphan an empty placeholder that never completes.
    const sessionId = currentSessionId;
    if (sessionStore.getState().transcripts[sessionId]?.busy || modelPending.current) return;
    const compact = attachments?.length ? null : text.trim().match(COMPACT_COMMAND);
    if (compact) {
      // Built-in /compact: summarise older history in place instead of sending a prompt.
      try {
        const result = await agentCompact(sessionId, compact[1]?.trim() || undefined);
        const k = (n: number) => `${Math.round(n / 100) / 10}K`;
        // Only quote numbers that show a saving (usage-based "before" vs estimated "after" can disagree).
        const shrank = result.tokensAfter !== undefined && result.tokensBefore > 0 && result.tokensAfter < result.tokensBefore;
        showToastRef.current?.(shrank ? `上下文已压缩（${k(result.tokensBefore)} → 约 ${k(result.tokensAfter!)} tokens）` : "上下文已压缩");
      } catch (e) {
        const reason = friendlyError(e);
        showToastRef.current?.(/Nothing to compact/i.test(reason) ? "对话还很短，暂时不需要压缩" : /Already compacted/i.test(reason) ? "刚刚已经压缩过了" : `压缩失败：${reason}`);
      }
      return;
    }
    try {
      sessionsStore.getState().upsert({ sessionId, status: "working", updatedAt: new Date().toISOString() });
      sessionStore.getState().pushUser(text, attachments?.map(a => a.path), sessionId);
      sessionStore.getState().startStreaming(sessionId);
      await agentSend(sessionId, text, attachments);
    } catch (e) {
      sessionStore.getState().dropPending(sessionId);
      sessionStore.getState().setError(friendlyError(e), sessionId);
      sessionsStore.getState().upsert({ sessionId, status: "failed" });
      throw e;
    }
  };

  const handleCancel = async () => {
    const sessionId = currentSessionId;
    if (!sessionId) return;
    try {
      await agentCancel(sessionId);
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      // The engine settles the turn and dismisses its pending requests; finalize
      // locally too so the stop button never hangs. Streamed text is kept.
      sessionStore.getState().stopStreaming(sessionId);
    }
  };

  // SessionSummaryGenerated on success (agent://summary → onSummary upserts the
  // same entry); we also upsert optimistically to avoid a flicker while the
  // event round-trips. On failure we rethrow so TopbarTitle reverts its draft.
  const handleRenameTitle = async (newTitle: string) => {
    if (!currentEntry) return;
    try {
      await agentRenameSession(currentEntry.sessionId, newTitle, currentEntry.cwd);
      sessionsStore.getState().upsert({
        sessionId: currentEntry.sessionId,
        title: newTitle,
      });
    } catch (e) {
      showToast(`重命名失败：${String(e).replace(/^Error:\s*/, "")}`);
      throw e;
    }
  };

  const handleModelChange = async (key: string) => {
    if (modelPending.current || sessionStore.getState().streaming) throw new Error("请等待当前操作完成后切换模型");
    const model = models.find(option => option.id === key);
    if (!model) throw new Error("模型已不可用，请刷新模型配置");
    const sid = sessionStore.getState().sessionId;
    const operation = ++modelOperation.current;
    modelPending.current = true; setModelBusy(true);
    try {
      if (sid) {
        const actual = await agentSetModel(sid, model.modelId ?? key, model.providerId);
        useAgentModelStore.getState().apply(actual);
      } else {
        const defaults = await agentsDefaultsGet();
        await agentsDefaultsSave({ ...defaults, defaultModel: key, defaultProviderId: model.providerId });
        useAgentModelStore.getState().setHomeModelKey(key);
        setInvalidDefault(false);
      }
    } finally {
      if (operation === modelOperation.current) { modelPending.current = false; setModelBusy(false); }
    }
  };
  /** Home: save the level new tasks start with (the engine reads it at agent_new_session). */
  const handleHomeThinkingChange = async (level: string) => {
    const defaults = await agentsDefaultsGet();
    await agentsDefaultsSave({ ...defaults, defaultThinkingLevel: level });
    setHomeThinking(level);
  };
  const handleThinkingChange = async (level: string) => {
    const sid = sessionStore.getState().sessionId;
    if (!sid || modelPending.current || sessionStore.getState().streaming) throw new Error("请在会话空闲时调整思考等级");
    const actual = useAgentModelStore.getState().states[sid];
    if (!actual?.availableThinkingLevels.includes(level)) throw new Error("当前模型不支持此思考等级");
    const operation = ++modelOperation.current;
    modelPending.current = true; setModelBusy(true);
    try { useAgentModelStore.getState().apply(await agentSetThinkingLevel(sid, level)); }
    finally { if (operation === modelOperation.current) { modelPending.current = false; setModelBusy(false); } }
  };

  // Workspace picker: only re-aim the "target cwd" for the NEXT new session.
  // In the two-section model the sidebar already shows every workspace, so we
  // must NOT clear the current transcript or rebuild the list here — picking a
  // directory just decides which group the next 新建任务 lands in (empty =
  // 任务 group, a real dir = that 空间 node).
  // No agent re-init is needed: spawn_grok ignores its cwd and every session
  // carries its own cwd at new_session/load_session time.
  const handleSelectWorkspace = (newCwd: string) => {
    cwdRef.current = newCwd;
    // Refresh the workspace list so a freshly picked directory appears in the
    // picker and sidebar without requiring an app restart.
    void agentListWorkspaces().then((ws) => {
      sessionsStore.getState().setWorkspaces(ws);
      setWorkspaces(ws);
    }).catch(() => {/* non-fatal */});
    // Refresh the sidebar's session list for the newly picked cwd (list_sessions
    // already filters by cwd server-side). Picking the inbox cwd refreshes the
    // 任务 group; any other cwd loads + expands that 空间 node immediately,
    // instead of waiting for the user to expand it.
    if (!newCwd) return;
    void agentListSessions(newCwd)
      .then((list) => {
        const store = sessionsStore.getState();
        if (newCwd === store.homeCwd) {
          store.setIndependent(list);
        } else {
          store.setWorkspaceSessions(newCwd, list);
          store.setExpanded(newCwd, true);
        }
      })
      .catch(() => {/* non-fatal */});
  };

  const handleNewSession = () => {
    ++modelOperation.current; modelPending.current = false; setModelBusy(false);
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(null);
    sessionStore.getState().reset();
  };

  /** Navigate to home page without resetting session state (used after expert summon). */
  const handleGoHome = () => {
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(null);
  };

  // 空间节点展开/折叠: 记录展开态, 首次展开时懒加载该 cwd 的子会话。
  const handleToggleWorkspace = async (cwd: string, next: boolean) => {
    sessionsStore.getState().setExpanded(cwd, next);
    if (next && sessionsStore.getState().workspaceSessions[cwd] === undefined) {
      try {
        const list = await agentListSessions(cwd);
        sessionsStore.getState().setWorkspaceSessions(cwd, list);
      } catch (e) {
        showToast(`加载空间会话失败：${String(e)}`);
      }
    }
  };

  /** Focus a session: live sessions are only focused, others are opened from disk and hydrated. */
  const openSession = async (sessionId: string, sessionCwd: string | undefined, force = false) => {
    const snapshot = await agentLoadSession(sessionId, sessionCwd ?? "");
    useAgentModelStore.getState().apply(snapshot);
    sessionStore.getState().hydrate(sessionId, snapshot.messages, snapshot.busy, force);
    usePiQueueStore.getState().apply(sessionId, snapshot.queue);
    showLoadedExpert(sessionId, snapshot);
    sessionsStore.getState().upsert({ sessionId, status: sessionStatusOf(snapshot.status) });
    // Artifacts need the loaded session; ChatView's own request may have raced the load.
    void useArtifactsStore.getState().refresh(sessionId);
    return snapshot;
  };

  const handleSelectSession = async (sessionId: string, sessionCwd?: string) => {
    setPlaceholderView(null);
    // Re-selecting the focused session is a no-op (it used to restart the engine session).
    if (sessionsStore.getState().currentSessionId === sessionId && sessionStore.getState().sessionId === sessionId && sessionStore.getState().messages.length) return;
    const operation = ++modelOperation.current; modelPending.current = true; setModelBusy(true);
    sessionsStore.getState().setCurrent(sessionId);
    sessionStore.getState().setSession(sessionId);
    try {
      await openSession(sessionId, sessionCwd);
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e), sessionId);
    } finally {
      if (operation === modelOperation.current) { modelPending.current = false; setModelBusy(false); }
    }
  };

  selectSessionRef.current = handleSelectSession;

  // Rewind rewrites the backend history, so the cached transcript is rebuilt from the engine.
  const handleRewound = async () => {
    const id = sessionStore.getState().sessionId;
    if (!id) return;
    await openSession(id, currentEntry?.cwd, true).catch((e) =>
      sessionStore.getState().setError(friendlyError(e), id)
    );
  };

  // Fork copies the session to a new id (the engine already opened it) — jump to it.
  const handleForked = async (newId: string) => {
    const cwd = currentEntry?.cwd ?? cwdRef.current;
    const title = currentEntry?.title ? `${currentEntry.title}（分叉）` : "分叉任务";
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(newId);
    sessionsStore.getState().upsert({ sessionId: newId, title, cwd, updatedAt: new Date().toISOString() });
    sessionStore.getState().setSession(newId);
    try {
      await openSession(newId, cwd, true);
      await agentRenameSession(newId, title, cwd).catch(() => {});
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e), newId);
    }
  };

  // An expert picked from the + menu: an open task switches to it now; on the home page it becomes
  // the pending expert, bound when the new task is sent (the user types the message first).
  const handleStartWithExpert = (agent: AgentEntry) => {
    const sessionId = !placeholderView ? currentSessionId ?? undefined : undefined;
    void selectExpert(agent, sessionId).then((message) => { if (message) showToast(message); });
    if (!sessionId) handleGoHome();
  };

  // Discover launcher: open a new session and send the wizard's prompt. If an
  // agent is chosen, prepend its full persona as a preamble (same pattern as
  // handleStartWithExpert). Closes the placeholder view so the chat shows.
  const handleLaunchDiscover = async (prompt: string, agent?: AgentEntry) => {
    setPlaceholderView(null);
    try {
      const cwd = cwdRef.current;
      const sessionId = await createSession(cwd, currentModelId);
      sessionsStore.getState().setCurrent(sessionId);
      sessionsStore.getState().upsert({
        sessionId,
        title: agent ? agent.name : deriveTitle(prompt),
        cwd,
        status: "working",
      });
      sessionStore.getState().setSession(sessionId);
      let body: string;
      if (agent) {
        const promptBody = agent.raw
          ? extractMarkdownBody(agent.raw)
          : agent.description ?? "";
        body = [
          `【角色设定 — ${agent.name}】`,
          `从现在开始，你将以下述专家身份进行本次对话。请严格遵循角色定义。`,
          ``,
          promptBody,
          ``,
          `---`,
          `用户的第一个问题：`,
          ``,
          prompt,
        ].join("\n");
      } else {
        body = prompt;
      }
      sessionStore.getState().pushUser(body);
      sessionStore.getState().startStreaming();
      await agentSend(sessionId, body);
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      const sid = sessionStore.getState().sessionId;
      if (sid) sessionsStore.getState().upsert({ sessionId: sid, status: "failed" });
      showToast(`启动失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  // 进入本地项目：把种子会话瞄到项目关联目录（使其归入对应空间节点），
  // 新建会话并注入项目说明作为种子消息。
  const handleStartProject = async (project: ProjectMeta) => {
    try {
      if (project.cwd) {
        cwdRef.current = project.cwd;
      }
      setPlaceholderView(null);
      const cwd = cwdRef.current;
      const sessionId = await createSession(cwd, currentModelId);
      sessionsStore.getState().setCurrent(sessionId);
      sessionsStore.getState().upsert({ sessionId, title: project.name, cwd, status: "working" });
      sessionStore.getState().setSession(sessionId);
      // Register the session as a project conversation.
      useProjectsStore.getState().addConversation(project.id, {
        sessionId,
        title: project.name,
        createdAt: new Date().toISOString(),
      });
      const seed = project.instructions?.trim()
        ? project.instructions
        : `你好，我们开始「${project.name}」项目吧。`;
      sessionStore.getState().pushUser(seed);
      sessionStore.getState().startStreaming();
      await agentSend(sessionId, seed);
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      const sid = sessionStore.getState().sessionId;
      if (sid) sessionsStore.getState().upsert({ sessionId: sid, status: "failed" });
      showToast(`启动项目失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  // 在项目中新建对话（从侧栏 + 按钮或项目详情页 Composer 触发）。
  const handleStartProjectConversation = async (projectId: string, message?: string) => {
    const project = useProjectsStore.getState().projects.find((p) => p.id === projectId);
    if (!project) return;
    try {
      const cwd = project.cwd || cwdRef.current;
      const sessionId = await createSession(cwd, currentModelId);

      const title = message ? deriveTitle(message) : `${project.name} 对话`;

      // Register conversation in the project.
      useProjectsStore.getState().addConversation(projectId, {
        sessionId,
        title,
        createdAt: new Date().toISOString(),
      });

      // Navigate to chat view.
      setPlaceholderView(null);
      sessionsStore.getState().setCurrent(sessionId);
      sessionsStore.getState().upsert({ sessionId, title, cwd, status: message ? "working" : "pending" });
      sessionStore.getState().setSession(sessionId);

      if (message) {
        // For the first conversation in a project, prepend project instructions
        const isFirst = project.conversations.length === 0;
        const hasInstructions = !!project.instructions?.trim();
        const prompt = isFirst && hasInstructions
          ? `[项目「${project.name}」背景与规范]\n${project.instructions!.trim()}\n\n[用户消息]\n${message}`
          : message;
        sessionStore.getState().pushUser(message);
        sessionStore.getState().startStreaming();
        await agentSend(sessionId, prompt);
      }
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      const sid = sessionStore.getState().sessionId;
      if (sid) sessionsStore.getState().upsert({ sessionId: sid, status: "failed" });
      showToast(`创建项目对话失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  // Global shortcuts from the registry (src/lib/shortcuts.ts); the latest handlers via a ref.
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (e) => {
    if (e.isComposing || e.defaultPrevented) return;
    const run = (fn: () => void) => { e.preventDefault(); fn(); };
    if (matchShortcut(e, "newTask")) run(() => { setPalette(null); handleNewSession(); });
    else if (matchShortcut(e, "search")) run(() => setPalette((p) => (p === "search" ? null : "search")));
    else if (matchShortcut(e, "shortcuts")) run(() => setPalette((p) => (p === "shortcuts" ? null : "shortcuts")));
    else if (matchShortcut(e, "settings")) run(() => setSettingsOpen(true));
    else if (matchShortcut(e, "toggleSidebar")) run(() => setSidebarCollapsed((v) => !v));
    else if (matchShortcut(e, "copyLast")) run(() => {
      const last = [...sessionStore.getState().messages].reverse().find((m) => m.role === "assistant" && m.parts.some((p) => p.kind === "text" && p.text.trim()));
      if (!last) { showToast("还没有可复制的回答"); return; }
      const text = last.parts.filter((p): p is Extract<typeof p, { kind: "text" }> => p.kind === "text").map((p) => p.text).join("\n\n");
      void copyText(text).then(() => showToast("已复制最后一条回答"), () => showToast("复制失败"));
    });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const activeNav = placeholderView ?? (currentSessionId ? "" : "新建任务");

  return (
    <ModelRuntimeContext.Provider value={{ busy: modelBusy, unavailableReason: !focusedModelSession && invalidDefault ? "默认模型不可用，请重新选择模型" : undefined, canSend: !!currentModelId && models.some(model => model.id === currentModelId), thinkingLevel: focusedModelSession ? activeModelState?.thinkingLevel : clampThinking(homeThinking, homeLevels), thinkingLevels: focusedModelSession ? activeModelState?.availableThinkingLevels ?? [] : homeLevels, onThinkingChange: focusedModelSession ? (activeModelState ? handleThinkingChange : undefined) : homeLevels.length > 1 ? handleHomeThinkingChange : undefined, sessionId: focusedModelSession ?? undefined, supportsThinking: focusedModelSession ? activeModelState?.supportsThinking : undefined }}>
    <div className={"app" + (IS_MACOS ? " app--macos" : "")}>
      {/* macOS 使用系统原生 Overlay 标题栏(红绿灯 + 原生菜单栏),
          不再渲染自绘 TitleBar;Windows/Linux 保持自绘。 */}
      {!IS_MACOS && (
        <TitleBar onPlaceholder={handlePlaceholder} onShowAbout={() => setAboutOpen(true)} />
      )}
      <div className={"app__body" + (sidebarCollapsed ? " app__body--collapsed" : "")}>
        <Sidebar
          onNewSession={handleNewSession}
          onSelect={handleSelectSession}
          onNavigate={handleNavigate}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleCollapse={() => setSidebarCollapsed(true)}
          onToggleWorkspace={handleToggleWorkspace}
          onOpenSearch={() => setPalette("search")}
          onPlaceholder={handlePlaceholder}
          onToast={showToast}
          onOpenProject={handleOpenProjectFromSidebar}
          onStartProjectConversation={handleStartProjectConversation}
          activeNav={activeNav}
          nav={features.primary}
          moreItems={features.more}
        />
        <main className="app__main">
          {!placeholderView && currentSessionId ? (
            <header className="main-topbar" data-window-drag-region>
              <div className="main-topbar__left">
                {sidebarCollapsed && (
                  <>
                    <button
                      className="main-topbar__btn"
                      aria-label="展开侧边栏"
                      data-tip="展开侧边栏"
                      onClick={() => setSidebarCollapsed(false)}
                    >
                      <SidebarToggleIcon size="md" />
                    </button>
                    <button
                      className="main-topbar__btn"
                      aria-label="新建任务"
                      data-tip="新建任务"
                      onClick={handleNewSession}
                    >
                      <WbNewTaskIcon size="md" />
                    </button>
                  </>
                )}
                <TopbarTitle title={currentTitle} onRename={handleRenameTitle} />
                {currentEntry?.expertName && <BoundExpertBadge name={currentEntry.expertName} avatar={currentEntry.expertAvatar} onClear={() => void clearSessionExpert(currentSessionId).then(showToast)} />}
                {currentSessionId && (
                  <TopbarActions
                    sessionId={currentSessionId}
                    title={currentTitle}
                    onForked={handleForked}
                    pinned={currentEntry?.pinned}
                    onToast={showToast}
                    onSessionsChanged={(patch) => {
                      if (patch) sessionsStore.getState().upsert({ sessionId: currentSessionId, ...patch });
                    }}
                  />
                )}
              </div>
              <div className="main-topbar__right" id="chat-topbar-slot" />
            </header>
          ) : (
            sidebarCollapsed && (
              <div className="main-topbar-float">
                <button
                  className="main-topbar__btn"
                  aria-label="展开侧边栏"
                  data-tip="展开侧边栏"
                  onClick={() => setSidebarCollapsed(false)}
                >
                  <SidebarToggleIcon size="md" />
                </button>
                <button
                  className="main-topbar__btn"
                  aria-label="新建任务"
                  data-tip="新建任务"
                  onClick={handleNewSession}
                >
                  <WbNewTaskIcon size="md" />
                </button>
              </div>
            )
          )}
          {initError ? (
            <div className="app__notice app__notice--err">
              初始化失败：{initError}
              <br />
              请在「设置 → 模型」添加模型服务商后重试。
            </div>
          ) : !init ? (
            <div className="app__notice">正在启动…</div>
          ) : placeholderView ? (
            <PlaceholderPage
              label={placeholderView}
              onPlaceholder={handlePlaceholder}
              onNavigate={handleNavigate}
              onGoHome={handleGoHome}
              onStartWithExpert={handleStartWithExpert}
              onToast={showToast}
              cwd={cwdRef.current}
              onSelectWorkspace={handleSelectWorkspace}
              sessionId={currentSessionId ?? resourceSessionRef.current}
              onLaunch={handleLaunchDiscover}
              onSend={handleSendNew}
              streaming={streaming}
              apiReady={init.auth.ready}
              onOpenSettings={() => setSettingsOpen(true)}
              modelId={currentModelId}
              models={models}
              onModelChange={handleModelChange}
              onStartProject={handleStartProject}
              onStartProjectConversation={handleStartProjectConversation}
            />
          ) : currentSessionId ? (
            <ChatView
              onSend={handleSendCurrent}
              onCancel={handleCancel}
              modelId={currentModelId}
              models={models}
              onModelChange={handleModelChange}
              cwd={currentEntry?.cwd || cwdRef.current}
              workspaces={workspaces}
              onSelectWorkspace={handleSelectWorkspace}
              onRewound={handleRewound}
              onForked={handleForked}
              onToast={showToast}
              onSelectExpert={handleStartWithExpert}
              onNavigateConnectors={openConnectors}
            />
          ) : (
            <HomePage
              onSend={handleSendNew}
              streaming={streaming}
              apiReady={init.auth.ready}
              onOpenSettings={() => setSettingsOpen(true)}
              onPlaceholder={handlePlaceholder}
              modelId={currentModelId}
              models={models}
              onModelChange={handleModelChange}
              cwd={cwdRef.current}
              workspaces={workspaces}
              onSelectWorkspace={handleSelectWorkspace}
              onSelectExpert={handleStartWithExpert}
              onNavigateConnectors={openConnectors}
            />
          )}
        </main>
      </div>
      <Toast message={toast} />
      {palette === "search" && <SearchPalette sessions={[...useSessionsStore.getState().independent, ...Object.values(useSessionsStore.getState().workspaceSessions).flat()]} onClose={() => setPalette(null)} onNewTask={handleNewSession} onOpen={(s) => { void handleSelectSession(s.sessionId, s.cwd); }} />}
      {palette === "shortcuts" && <ShortcutsPanel onClose={() => setPalette(null)} />}
      <AppDialogHost />
      <ImageLightboxHost />
      <SettingsPanel sections={features.sections} open={settingsOpen} initialSection={settingsSection} onClose={() => { setSettingsOpen(false); setSettingsSection(undefined); }} onModelsChanged={refreshModels} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} init={init} />
      <FolderTrustDialog
        request={trustRequest}
        onResolve={() => setTrustRequest(null)}
        onToast={showToast}
      />
    </div>
    </ModelRuntimeContext.Provider>
  );
}
