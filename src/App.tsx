import { useCallback, useEffect, useRef, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./components/HomePage";
import { ChatView } from "./components/ChatView";
import { PlaceholderPage } from "./components/PlaceholderPage";
import { Toast } from "./components/Toast";
// PermissionDialog is now inline in ChatView (PermissionInlineCard), not a global modal.
import { ThemeProvider } from "./components/ThemeProvider";
import { SettingsPanel } from "./components/SettingsPanel";
import { AboutDialog } from "./components/AboutDialog";
import { FolderTrustDialog } from "./components/FolderTrustDialog";
import { TopbarActions } from "./components/TopbarActions";
import { SidebarToggleIcon, WbNewTaskIcon } from "./foundation/components/Icon/icons";
import { ModelRuntimeContext, type ModelOption } from "./components/ModelSelector";
import { useExtensionUiStore } from "./stores/extension-ui-store";
import { useAgentModelStore } from "./stores/agent-model-store";
import { useSessionStore } from "./stores/session-store";
import { useSessionsStore } from "./stores/sessions-store";
import { usePermissionStore } from "./stores/permission-store";
import { useQuestionStore } from "./stores/question-store";
import { usePendingExpertStore } from "./stores/pending-expert-store";
import { TopbarTitle } from "./components/TopbarTitle";
import { ThumbImg } from "./components/experts-panel/shared/ThumbImg";
import {
  agentInit,
  agentNewSession,
  agentSend,
  agentCancel,
  agentResolveUi,
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
} from "./lib/agent-client";
import type { AgentEntry } from "./lib/types";
import { useProjectsStore, type ProjectMeta } from "./stores/projects-store";
import { usePiQueueStore } from "./stores/pi-queue-store";
import { recordUsage, loadUsage, loadQuotaConfig } from "./lib/usage-quota";
import { dispatchNotification } from "./lib/notify-channels";
import {
  registerTelemetryProvider,
  createConsoleTelemetryProvider,
  reportEvent,
  type TelemetryProvider,
} from "./lib/telemetry-contract";
import { exportEventsBatch, type OtlpConfig } from "./lib/otlp-exporter";
import { IS_MACOS } from "./lib/platform";
import { friendlyError } from "./lib/error-format";


export const EXPERT_PERSONA_BEGIN = "<!--EXPERT_PERSONA_BEGIN-->";
export const EXPERT_PERSONA_END = "<!--EXPERT_PERSONA_END-->";


function deriveTitle(text: string): string {
  // Strip <system-reminder>…</system-reminder> blocks (system-injected context).
  let clean = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  // Strip skill XML markup (<command-name>…</command-name> etc.).
  clean = clean.replace(/<\/?command-(?:name|message|args)>/g, "").trim();
  if (!clean) clean = text.trim();
  // Take first 10 whitespace-delimited words.
  const words = clean.split(/\s+/).slice(0, 10).join(" ");
  if (!words) return "新会话";
  return words.length > 40 ? words.slice(0, 40) + "…" : words;
}

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

function clearPendingRequests(sessionId: string) {
  const permissions = usePermissionStore.getState();
  for (const request of permissions.queues[sessionId] ?? []) permissions.dismiss(request.requestId, sessionId);
  const questions = useQuestionStore.getState();
  for (const request of questions.queues[sessionId] ?? []) {
    void agentResolveUi({ sessionId, requestId: request.requestId, cancelled: true }).catch(() => {});
    questions.dismiss(request.requestId, sessionId, "cancelled");
  }
  useExtensionUiStore.getState().clear(sessionId);
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [trustRequest, setTrustRequest] = useState<{ cwd?: string; reason?: string } | null>(null);
  const [placeholderView, setPlaceholderView] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cwdRef = useRef<string>("");
  const resourceSessionRef = useRef<string | undefined>(undefined);

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

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    // 注册遥测 console provider(Aegis 替代),启动时一次。
    registerTelemetryProvider(
      createConsoleTelemetryProvider({
        sink: (e) => console.debug(`[telemetry] ${e.level.toUpperCase()} ${e.name}`, e.props ?? ""),
      }),
    );
    // 若用户配置了 OTLP endpoint,额外注册 OTLP 导出 provider(自托管监控)。
    const otlpEndpoint = typeof localStorage !== "undefined" ? localStorage.getItem("openbuddy.otlp.endpoint") : null;
    if (otlpEndpoint) {
      const otlpConfig: OtlpConfig = { endpoint: otlpEndpoint, serviceName: "openbuddy" };
      const otlpProvider: TelemetryProvider = {
        id: "otlp",
        isEnabled: () => true,
        reportEvent: (e) => { void exportEventsBatch([e], otlpConfig, { post: async () => ({ ok: true, status: 200 }) }); },
        reportMetric: () => {},
      };
      registerTelemetryProvider(otlpProvider);
    }
    reportEvent("app_started", "info");

    // 尝试自动激活 @anthropic-ai/sandbox-runtime(装好包后零改动生效)。
    // 非阻塞:失败(包未安装)静默降级为纯逻辑守卫。
    void import("@/lib/sandbox-init")
      .then((m) => m.tryActivateSandbox())
      .then((status) => {
        if (status.activated) {
        }
      })
      .catch(() => {/* 静默 */});

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
          onModelState: state => useAgentModelStore.getState().apply(state),
          onUpdate: (u) => {
            sessionStore.getState().applyUpdate(u);
            if (u.type === "queue_update" && u.sessionId && Array.isArray(u.steering) && Array.isArray(u.followUp)) {
              usePiQueueStore.getState().apply(u.sessionId, { steering: u.steering.filter((text): text is string => typeof text === "string"), followUp: u.followUp.filter((text): text is string => typeof text === "string") });
            }
          },
          onPermission: (p) => {
            if (p.sessionId !== sessionStore.getState().sessionId) return;
            reportEvent("permission_request", "warn", { sessionId: p.sessionId });
            permissionStore.getState().request(p);
            void notificationAppend(
              "permission",
              p.options?.[0]?.title ?? "工具执行权限请求",
              undefined,
              p.sessionId,
              "warn",
            );
          },
          onComplete: (p) => {
            reportEvent("session_complete", "info", { sessionId: p.sessionId, stopReason: p.stopReason });
            // Ignore completes for side-channel sessions (inspiration generation)
            // — they're handled by their own listeners, not the main transcript.
            sessionStore.getState().markComplete(p);
            clearPendingRequests(p.sessionId);
            const currentSessionId = sessionStore.getState().sessionId;
            if (currentSessionId && p.sessionId && p.sessionId !== currentSessionId) {
              return;
            }
            // Update sidebar status so the task filter reflects the completion.
            sessionsStore.getState().upsert({ sessionId: p.sessionId, status: "completed" });
            p.usage = sessionStore.getState().transcripts[p.sessionId]?.usage;
            // Record token usage for the quota dashboard (weixinpay alternative).
            if (p.usage && (p.usage.promptTokens || p.usage.completionTokens)) {
              const currentModel = useAgentModelStore.getState().states[p.sessionId]?.modelKey;
              recordUsage(loadUsage(), {
                modelId: currentModel ?? "unknown",
                promptTokens: p.usage.promptTokens ?? 0,
                completionTokens: p.usage.completionTokens ?? 0,
              }, loadQuotaConfig() ?? undefined);
            }
            // Refresh the composer context-usage pill after each turn.
            void notificationAppend(
              "session_complete",
              `会话完成（${p.stopReason ?? "end_turn"}）`,
              undefined,
              p.sessionId,
              "info",
            );
            // Dispatch to external notification channels (IM alternative: Slack/Discord/webhook/email).
            void dispatchNotification({
              title: "OpenBuddy 会话完成",
              body: `会话 ${p.sessionId.slice(0, 8)} 已完成（${p.stopReason ?? "end_turn"}）`,
              level: "info",
              sessionId: p.sessionId,
            }).catch(() => { /* notification dispatch failure is non-fatal */ });
            // 消息队列自动续发(对齐 WorkBuddy message-queue):该会话若有 active
            // 队列项,取下一条继续发送,实现「回完一条自动发下一条」。

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
            void notificationAppend(
              "summary",
              `生成会话标题：${title}`,
              undefined,
              sessionId,
              "info",
            );
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
            void notificationAppend(
              "models_update",
              "模型列表已更新",
              undefined,
              undefined,
              "info",
            );
          },
          onQuestion: request => {
            if (request.sessionId !== sessionStore.getState().sessionId) {
              void agentResolveUi({ requestId: request.requestId, sessionId: request.sessionId, cancelled: true }).catch(() => {});
              return;
            }
            questionStore.getState().request(request);
          },
          onUiDismiss: event => questionStore.getState().dismiss(event.requestId, event.sessionId, event.reason),
          onUiState: event => useExtensionUiStore.getState().apply(event),
          onUiNotification: event => {
            if (event.sessionId === sessionStore.getState().sessionId) setToast(event.message);
          },
          onAgentDied: ({ reason }) => {
            console.error('[OpenBuddy] Agent thread died:', reason);
            setToast(`⚠️ AI 引擎异常退出：${reason}。请重启应用。`);
            sessionStore.getState().setError(`AI 引擎异常退出：${reason}`);
            reportEvent("agent_died", "error", { reason });
          },
          onTurnError: (e) => {
            // connection reset, …) via prompt_complete with stopReason
            // "rate_limit"/"error". Surface a friendly message instead of
            // silently marking the turn complete.
            console.warn('[OpenBuddy] Turn ended abnormally:', e);
            // Only surface for the focused session — background sessions
            // finalizing after a switch shouldn't hijack the error banner.
            const currentSessionId = sessionStore.getState().sessionId;
            if (currentSessionId && e.sessionId && e.sessionId !== currentSessionId) {
              return;
            }
            const msg =
              e.kind === "rate_limit"
                ? "⚠️ API 速率限制已触发（执行工具期间）。请等待 1-2 分钟后重试，或缩短对话上下文（新建会话）。"
                : e.detail
                  ? `⚠️ 本轮执行出错：${e.detail}`
                  : "⚠️ 本轮执行出错，请重试。";
            sessionStore.getState().setError(msg);
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
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };
  const handlePlaceholder = (label: string) => {
    // Route a few sidebar shortcut buttons to real panels instead of toasts.
    if (label === "用户中心") {
      setSettingsOpen(true);
      return;
    }
    if (label === "通知") {
      // events are logged.
      setSettingsOpen(true);
      return;
    }
    showToast(`${label} 即将上线`);
  };
  const handleNavigate = (label: string) => {
    const previous = sessionStore.getState().sessionId;
    if (previous) clearPendingRequests(previous);
    if (sessionStore.getState().sessionId) resourceSessionRef.current = sessionStore.getState().sessionId ?? undefined;
    if (["助理", "专家·技能·连接器", "自动化", "资料库", "灵感", "云存储"].includes(label)) { showToast(`${label} 暂未在 Electron MVP 开放`); return; }
    setPlaceholderView(label);
    sessionsStore.getState().setCurrent(null);
    sessionStore.getState().reset();
  };

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
    try {
      const cwd = cwdRef.current;
      const sessionId = await createSession(cwd, currentModelId);
      sessionsStore.getState().setCurrent(sessionId);
      setPlaceholderView(null);
      sessionsStore.getState().upsert({ sessionId, title: deriveTitle(text), cwd, status: "working" });
      sessionStore.getState().setSession(sessionId);

      // Check for pending expert — inject persona invisibly.
      const pending = usePendingExpertStore.getState().expert;
      let textForAgent = text;
      if (pending && pending.prompt) {
        // MessageItem strips it from display on history replay.
        textForAgent = `${EXPERT_PERSONA_BEGIN}\n${pending.prompt}\n${EXPERT_PERSONA_END}\n\n${text}`;
        // Bind expert to session for persistence + UI badge.

        sessionsStore.getState().upsert({ sessionId, expertId: pending.expertId, expertName: pending.name, expertAvatar: pending.avatarLocal });
        usePendingExpertStore.getState().clear();
      }

      // UI shows only the user's visible text.
      sessionStore.getState().pushUser(text);
      sessionStore.getState().startStreaming();
      await agentSend(sessionId, textForAgent, attachments);
    } catch (e) {
      console.error('[OpenBuddy] handleSendNew error:', e);
      sessionStore.getState().setError(friendlyError(e));
      const sid = sessionStore.getState().sessionId;
      if (sid) sessionsStore.getState().upsert({ sessionId: sid, status: "failed" });
      throw e;
    }
  };

  const handleSendCurrent = async (text: string, attachments?: { path: string }[]) => {
    if (!currentSessionId) return handleSendNew(text, attachments);
    // Guard against double-send / send-during-streaming. Composer also guards
    // via its `streaming` prop, but that value can be stale within the same
    // render tick; the store flag is the source of truth. A second pushUser +
    // startStreaming would orphan an empty placeholder that never completes.
    if (sessionStore.getState().streaming || modelPending.current) return;
    try {
      sessionsStore.getState().upsert({ sessionId: currentSessionId, status: "working" });
      sessionStore.getState().pushUser(text);
      sessionStore.getState().startStreaming();
      await agentSend(currentSessionId, text, attachments);
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
      sessionsStore.getState().upsert({ sessionId: currentSessionId, status: "failed" });
      throw e;
    }
  };

  const handleCancel = async () => {
    if (!currentSessionId) return;
    try {
      await agentCancel(currentSessionId);
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
    } finally {
      // Don't rely on the backend emitting a `complete` for the cancel (it may
      // be dropped by routing after a fast switch). Finalize locally so the
      // Composer's stop button and the loading row don't hang. Already-streamed
      // text is kept; only the in-flight flag is cleared.
      sessionStore.getState().stopStreaming();
      clearPendingRequests(currentSessionId);
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
    const previous = sessionStore.getState().sessionId;
    if (previous) clearPendingRequests(previous);
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

  const handleSelectSession = async (sessionId: string, sessionCwd?: string) => {
    const previous = sessionStore.getState().sessionId;
    if (previous && previous !== sessionId) clearPendingRequests(previous);
    const operation = ++modelOperation.current; modelPending.current = true; setModelBusy(true);
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(sessionId);
    // setSession no longer wipes the transcript — it just moves focus. If we
    // already have a cached transcript for this session it arms replay
    // don't (first open / post-restart) the upcoming replay fills the empty
    // transcript. Either way the focused mirror is refreshed in one step.
    sessionStore.getState().setSession(sessionId);
    try {
      // Load with the session's OWN cwd (independent sessions have cwd="").
      // Viewing a 空间 child must NOT re-aim the new-session target directory.
      useAgentModelStore.getState().apply(await agentLoadSession(sessionId, sessionCwd ?? ""));
      // Populate the context-usage pill for the freshly loaded session.
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
    } finally {
      // Replay window is over: a *new* turn's updates for this session must be
      // ingested again. (No-op when there was no cached transcript to suppress.)
      sessionStore.getState().clearReplaySuppression(sessionId);
      if (operation === modelOperation.current) { modelPending.current = false; setModelBusy(false); }
    }
  };

  // Rewind rewrites the backend history, so our cached transcript is stale —
  const handleRewound = () => {
    const id = sessionStore.getState().sessionId;
    if (!id) return;
    sessionStore.getState().dropSessionCache(id);
    sessionStore.getState().setSession(id); // empty cache → replay refills
    void agentLoadSession(id, cwdRef.current).catch((e) =>
      sessionStore.getState().setError(friendlyError(e))
    );
  };

  // Fork copies the session to a new id — jump to it so the user sees the
  // branch they just created (and it appears in the sidebar).
  const handleForked = (newId: string) => {
    const cwd = cwdRef.current;
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(newId);
    sessionsStore.getState().upsert({ sessionId: newId, title: "分叉会话", cwd });
    sessionStore.getState().setSession(newId);
    void agentLoadSession(newId, cwd).catch((e) =>
      sessionStore.getState().setError(friendlyError(e))
    );
  };

  // Select an expert from the + menu (chat or home composer). Instead of
  // immediately creating a session, set the pending expert and go home so the
  // user can type their message with the expert badge visible.
  const handleStartWithExpert = (
    agent: AgentEntry,
    _meta?: { expertId?: string; source?: string },
  ) => {
    const promptBody = agent.raw
      ? extractMarkdownBody(agent.raw)
      : agent.description ?? "";
    usePendingExpertStore.getState().set({
      name: agent.name,
      prompt: promptBody,
      description: agent.description ?? agent.name,
      expertId: _meta?.expertId ?? agent.name,
      source: _meta?.source ?? agent.scope ?? "local",
    });
    handleGoHome();
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

  const activeNav = placeholderView ?? (currentSessionId ? "" : "新建任务");

  return (
    <ModelRuntimeContext.Provider value={{ busy: modelBusy, unavailableReason: !focusedModelSession && invalidDefault ? "默认模型不可用，请重新选择模型" : undefined, canSend: !!currentModelId && models.some(model => model.id === currentModelId), thinkingLevel: activeModelState?.thinkingLevel, thinkingLevels: activeModelState?.availableThinkingLevels ?? [], onThinkingChange: activeModelState ? handleThinkingChange : undefined }}>
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
          onOpenSearch={() => showToast("会话搜索将在后续版本提供")}
          onPlaceholder={handlePlaceholder}
          onToast={showToast}
          onOpenProject={handleOpenProjectFromSidebar}
          onStartProjectConversation={handleStartProjectConversation}
          activeNav={activeNav}
        />
        <main className="app__main">
          {}
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
                {currentEntry?.expertName && (
                  <span className="expert-badge" data-tip={`专家：${currentEntry.expertName}`}>
                    <ThumbImg name={currentEntry.expertName} local={currentEntry.expertAvatar} size={18} shape="circle" />
                    {currentEntry.expertName}
                  </span>
                )}
                {currentSessionId && (
                  <TopbarActions
                    sessionId={currentSessionId}
                    title={currentTitle}
                    pinned={currentEntry?.pinned}
                    onToast={showToast}
                    onSessionsChanged={(patch) => {
                      if (patch) sessionsStore.getState().upsert({ sessionId: currentSessionId, ...patch });
                    }}
                  />
                )}
              </div>
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
              初始化失败:{initError}
              <br />
              请在「设置 → 账户管理」设置 xAI API Key，或在「设置 → 模型」配置 BYOK provider 后重试。
            </div>
          ) : !init ? (
            <div className="app__notice">正在本地初始化 agent…</div>
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
              cwd={cwdRef.current}
              workspaces={workspaces}
              onSelectWorkspace={handleSelectWorkspace}
              onRewound={handleRewound}
              onForked={handleForked}
              onToast={showToast}
              onSelectExpert={handleStartWithExpert}
              onNavigateConnectors={() => setPlaceholderView("专家·技能·连接器")}
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
              onNavigateConnectors={() => setPlaceholderView("专家·技能·连接器")}
            />
          )}
        </main>
      </div>
      <Toast message={toast} />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onModelsChanged={refreshModels} />
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
