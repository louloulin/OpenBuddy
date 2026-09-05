import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { TitleBar } from "@openbuddy/ui-shell";
import { Sidebar } from "@openbuddy/ui-sidebar";
import { ChatView } from "@openbuddy/ui-conversation";
import { PlaceholderPage } from "./components/shared/PlaceholderPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Toast } from "@openbuddy/ui-primitives";
import { SlotProvider, useUiRuntime } from "@openbuddy/ui-runtime/client";
import { useTheme } from "@openbuddy/ui-theme/client";
// P1-01: Route-level React.lazy. Heavy components only load when the user
// opens the corresponding view. Each lazy is wrapped in a default-export
// adapter because the source modules use named exports. Suspense fallback
// keeps the rest of the UI interactive while the chunk fetches.
const HomePage = lazy(() =>
  import("@openbuddy/ui-settings").then((m) => ({ default: m.HomePage })),
);
const SettingsPanel = lazy(() =>
  import("@openbuddy/ui-settings").then((m) => ({ default: m.SettingsPanel })),
);
const SearchOverlay = lazy(() =>
  import("@openbuddy/ui-workbench").then((m) => ({ default: m.SearchOverlay })),
);
const AboutDialog = lazy(() =>
  import("@openbuddy/ui-dialogs").then((m) => ({ default: m.AboutDialog })),
);
const FolderTrustDialog = lazy(() =>
  import("@openbuddy/ui-dialogs").then((m) => ({ default: m.FolderTrustDialog })),
);
const TasksPanel = lazy(() =>
  import("@openbuddy/ui-automation").then((m) => ({ default: m.TasksPanel })),
);
import { TopbarActions } from "@openbuddy/ui-shell";
import { SidebarToggleIcon, WbNewTaskIcon } from "@openbuddy/ui-primitives/icons";
import type { ModelOption } from "@openbuddy/ui-workbench";
import { useSessionStore } from "./stores/session-store";
import { useFeedbackStore } from "./stores/feedback-store";
import { useSessionsStore } from "./stores/sessions-store";
import { usePermissionStore } from "./stores/permission-store";
import { useQuestionStore } from "./stores/question-store";
import { usePendingExpertStore } from "./stores/pending-expert-store";
import { setToast as pushToast, useToastStore } from "./stores/toast-store";
import { TopbarTitle, KeyboardShortcutsDialog } from "@openbuddy/ui-shell";
import { APP_VERSION } from "./lib/platform/app-version";
import { ThumbImg } from "@openbuddy/ui-experts";
import {
  piInit,
  piNewSession,
  piSend,
  piSendContent,
  piCancel,
  piLoadSession,
  piListSessions,
  piListWorkspaces,
  piListWorkspaceRegistry,
  piCreateWorkspace,
  piRenameSession,
  piSetModel,
  piAuthStatus,
  providersList,
  flattenModels,
  agentOnPiTelemetryEvent,
  agentSessionMessages,
  sessionEntriesToChatMessages,
  type InitResult,
  type WorkspaceInfo,
} from "./lib/agent/pi-client";
import { useOptimisticNewSession } from "./hooks/useOptimisticNewSession";
import { useAgentSession } from "./hooks/useAgentSession";
import { newSessionFlow, composeDiscoverBody } from "./lib/agent/new-session-flow";
import type { AgentEntry, Plan } from "@openbuddy/shared-types";
import { useProjectsStore, type ProjectMeta } from "./stores/projects-store";
import { useMessageQueueStore, hasActiveItems } from "./stores/message-queue-store";
import { useSubagentStore } from "./stores/subagent-store";
import {
  registerTelemetryProvider,
  createConsoleTelemetryProvider,
  reportEvent,
  type TelemetryProvider,
} from "./lib/telemetry/telemetry-contract";
import { exportEventsBatch, type OtlpConfig } from "./lib/telemetry/otlp-exporter";
import { IS_MACOS } from "./lib/platform/platform";
import { friendlyError } from "./lib/platform/error-format";
import { casdoorLogin, casdoorStatus, type CasdoorSessionView } from "./lib/casdoor/casdoor-client";
import type { CasdoorLifecycleEvent } from "@openbuddy/auth-casdoor";
import { listen, listenSafe, isElectronBridgeUnavailable } from "./lib/platform/electron-api";
import { getElectronBridgeStatus } from "./lib/platform/electron-api";
import { getRendererPluginRuntime } from "./lib/runtime/renderer-plugin-runtime";
import { createRendererLogger, generateTrace, withTrace } from "@openbuddy/logging-renderer";

const appLogger = createRendererLogger({
  devMode: ((typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) || false),
  name: "openbuddy-app",
});
let lastBridgeToastKey: string | null = null;

// RC6 — per-delta pi://update logging is opt-in only. Streaming emits
// dozens of updates per second; an unconditional console.log fires on
// every chunk, which Vite's HMR client relays to the devtools and
// collapses UI responsiveness. Set `openbuddy.debug.stream=1` in
// localStorage to re-enable verbose logging when debugging.
function isStreamDebugEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  try { return localStorage.getItem("openbuddy.debug.stream") === "1"; }
  catch { return false; }
}
const STREAM_DEBUG = isStreamDebugEnabled();

/** Hidden markers wrapping the expert persona in the text sent to pi.
 *  The UI strips these (and everything between them) from user messages.
 *  Defined canonically in `@/lib/agent/persona-markers` (Phase 2); the
 *  ui-conversation package mirrors them locally to keep its tsc program
 *  independent of root App.tsx. */
import { EXPERT_PERSONA_BEGIN, EXPERT_PERSONA_END } from "./lib/agent/persona-markers";
import { abandonInFlightStream } from "./lib/agent/abandon-stream";
export { EXPERT_PERSONA_BEGIN, EXPERT_PERSONA_END };
const ACTIVE_SESSION_STORAGE_KEY = "openbuddy.active-session";

type PersistedActiveSession = { sessionId: string; cwd: string };

function readPersistedActiveSession(): PersistedActiveSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) ?? "null") as Partial<PersistedActiveSession> | null;
    if (typeof value?.sessionId !== "string" || typeof value.cwd !== "string") return null;
    return { sessionId: value.sessionId, cwd: value.cwd };
  } catch {
    return null;
  }
}

/**
 * Derive a short sidebar title from the user's first message.
 * Mirrors pi's `title_fallback_from_user_text`: strip system/skill markup,
 * take the first ~10 words, cap at 40 chars.
 */
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

/** Titles that mean "no real title yet" — safe to overwrite with a
 *  user-message-derived one without clobbering pi summaries or renames. */
function isPlaceholderTitle(title?: string | null): boolean {
  return !title || title === "新会话" || title === "未命名会话" || title === "OpenBuddy";
}

/** Look up a session's current title across the 任务 group and every
 *  空间 node's expanded session cache. */
function lookupSessionTitle(sessionId: string): string | undefined {
  const state = useSessionsStore.getState();
  return state.independent.find((s) => s.sessionId === sessionId)?.title
    ?? Object.values(state.workspaceSessions).flat().find((s) => s.sessionId === sessionId)?.title;
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

/**
 * BuiltinUiPlugins — registers all built-in @openbuddy/ui-* plugins into the
 * SlotProvider runtime. Each plugin registers its components into the
 * slot core (sidebar / conversation / details / shell.overlay) so the
 * AppFrame can render them.
 *
 * Third-party plugins continue to load via the existing
 * @openbuddy/renderer-host client module system; this component only
 * adds the product-side built-ins.
 */
function BuiltinUiPlugins() {
  const runtime = useUiRuntime();
  const disposers = useRef<Array<() => Promise<void>>>([]);
  useEffect(() => {
    const disposersLocal = disposers.current;
    let cancelled = false;
    void (async () => {
      const layout = await import("@openbuddy/ui-layout/client");
      const theme = await import("@openbuddy/ui-theme/client");
      const locale = await import("@openbuddy/ui-locale/client");
      const rt = await import("@openbuddy/ui-runtime/client");
      const prim = await import("@openbuddy/ui-primitives/client");
      const plugins = [
        { name: "ui-theme", apply: theme.applyTheme },
        { name: "ui-locale", apply: locale.applyLocale },
        { name: "ui-runtime", apply: rt.applyUiRuntime },
        { name: "ui-primitives", apply: prim.apply },
        { name: "ui-layout", apply: layout.apply },
      ];
      for (const p of plugins) {
        if (cancelled) return;
        const d = await runtime.registerBuiltinUi({ name: p.name, apply: p.apply as never });
        disposersLocal.push(d);
      }
    })();
    return () => {
      cancelled = true;
      for (const d of disposersLocal.splice(0)) { void d(); }
    };
  }, [runtime]);
  return null;
}

export default function App() {
  return (
    <SlotProvider>
      <BuiltinUiPlugins />
      <Shell />
    </SlotProvider>
  );
}

function Shell() {
  const [init, setInit] = useState<InitResult | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // R1 — keyboard shortcuts overlay state. Triggered by '?' key globally.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't fire while user is typing in a text input/textarea
      const target = e.target as HTMLElement | null;
      const isEditable = target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
      if (e.key === "?" && !isEditable && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setSearchOpen(true);
      }
      // R1.4 — Cmd+, opens the settings panel.
      if (!isEditable && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [settingsSection, setSettingsSection] = useState<"model" | "account">("model");
  const [casdoorSession, setCasdoorSession] = useState<CasdoorSessionView | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [trustRequest, setTrustRequest] = useState<{ cwd?: string; reason?: string } | null>(null);
  const [taskRefreshSignal, setTaskRefreshSignal] = useState(0);
  const [placeholderView, setPlaceholderView] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem("openbuddy.assistant.activeTab"); } catch { return null; }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const rendererRuntime = getRendererPluginRuntime();
  // Store aliases — bound up here (before any useCallback) so that
  // handleAgentDied's dependency array can resolve them on the first
  // render. They were originally declared below the first useEffect, which
  // triggered a TDZ `Cannot access 'sessionStore' before initialization`
  // error because useCallback eagerly reads its dependency array.
  const sessionStore = useSessionStore;
  const sessionsStore = useSessionsStore;
  // R2.3 — replace local useState toast with the global toast queue.
  // The legacy `setToast(message)` API is preserved as a wrapper so the
  // ~10 call sites below don't need to change. New callers can use the
  // exported `setToast` from toast-store directly for kind/id/ttl control.
  // R2.5 — accepts an optional inline action (Retry / Open settings).
  const toastQueue = useToastStore((s) => s.queue);
  const dismissToast = useToastStore((s) => s.dismiss);
  const setToast = useCallback((message: string, opts?: { action?: { label: string; onClick: () => void; hint?: string }; kind?: "info" | "warning" | "error"; ttlMs?: number; id?: string }) => {
    pushToast(message, {
      kind: opts?.kind,
      ttlMs: opts?.ttlMs,
      id: opts?.id,
      action: opts?.action,
    });
  }, []);
  // Auto-dismiss toast entries after their TTL expires (set by store on push).
  useEffect(() => {
    if (toastQueue.length === 0) return;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const now = Date.now();
    for (const entry of toastQueue) {
      if (entry.ttlMs <= 0) continue;
      const elapsed = now - entry.createdAt;
      const remaining = entry.ttlMs - elapsed;
      if (remaining <= 0) {
        dismissToast(entry.id);
        continue;
      }
      timers.push(setTimeout(() => dismissToast(entry.id), remaining));
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [toastQueue, dismissToast]);
  const [currentModelId, setCurrentModelId] = useState<string | undefined>(undefined);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [extensionText, setExtensionText] = useState("");
  const [extensionTextNonce, setExtensionTextNonce] = useState(0);
  const [extensionTextBySession, setExtensionTextBySession] = useState<Record<string, string>>({});
  const [extensionUiBySession, setExtensionUiBySession] = useState<Record<string, {
    statuses: Record<string, string>;
    widgets: Record<string, string[]>;
    workingMessage?: string;
    workingVisible?: boolean;
    workingIndicator?: unknown;
    hiddenThinkingLabel?: string;
    toolsExpanded?: boolean;
  }>>({});
  const { setTheme } = useTheme();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cwdRef = useRef<string>("");
  const currentModelIdRef = useRef<string | undefined>(undefined);
  // Optimistic session creation. When the user actually types a prompt and
  // hits Send (handleSendNew / handleLaunchDiscover / handleStartProject),
  // the hook mints a `__pending_<nonce>` id locally, flips both stores to it
  // synchronously, pushes the user bubble + starts streaming — and renders
  // ChatView **immediately**. The real id arrives later from the backend
  // IPC and we then migrate the focused session id + drafts + sidebar row
  // over to it. handleNewSession / handleGoHome (sidebar "新建任务" button
  // without typing) deliberately skip this — going to HomePage must NOT
  // leave an empty row in the sidebar.
  //
  // Extracted from App.tsx in Phase 1 of the chat-flow refactor — see
  // `src/hooks/useOptimisticNewSession.ts` for the full fan-out resolver
  // machinery and draft-alias map. The hook owns:
  //   - `pendingNewSessionRef` (in-flight Promise + fan-out resolvers)
  //   - `draftKeyAliasesRef` (provisional key → real id, used by downstream
  //     `migrateSession` to atomically rekey the draft text + sidebar row)
  const optimisticSession = useOptimisticNewSession();
  const [isCreating, setIsCreating] = useState(false);

  // Bounded frame-coalescer for streaming pi://update events (see
  // src/lib/stream/update-coalescer.ts). The agent emits many chunks per
  // second during streaming; flushing once per animation frame bounds the
  // worst case to ~60 render batches/sec regardless of model cadence, and
  // the hard buffer cap prevents memory growth between frames.
  //
  // Phase 3 — moved into `useAgentSession` so the SSE subscription +
  // coalescer + per-event dispatch live as one cohesive module. App.tsx
  // only declares the per-session editor-text ref the hook reads through
  // (pasteToEditor used to capture a stale closure on the React state
  // snapshot; the ref pattern fixes that latent bug as a side benefit).

  // Ref-synced snapshot of `extensionTextBySession` so the SSE handler
  // inside `useAgentSession` can read the latest per-session editor text
  // without capturing a stale closure on the React state snapshot. The
  // effect below keeps the ref in lock-step with the state.
  const extensionTextBySessionRef = useRef<Record<string, string>>({});
  useEffect(() => {
    extensionTextBySessionRef.current = extensionTextBySession;
  }, [extensionTextBySession]);

  // Forward-declared ref so `useAgentSession` can fire `handleAgentDied`
  // without depending on the closure order below — `handleAgentDied`
  // needs `sessionEvents.resubscribe`, which only exists after the hook
  // call. Updating the ref synchronously each render keeps the
  // one-frame-stale window invisible (the bridge IPC requires piInit
  // before any `agent-died` can fire, so the first render's stub never
  // observes a real event).
  const handleAgentDiedRef = useRef<(payload: { reason: string }) => void>(() => { /* set after handleAgentDied is defined */ });

  // Forward-declared ref for the same reason — `refreshModels` is
  // defined later in the function body, but `useAgentSession` (above)
  // needs a callable prop on first render. The hook reads it through
  // its own internal `refreshModelsRef`, so the stub is only ever
  // consulted in the (impossible) window between mount and the first
  // effect commit.
  const refreshModelsRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Hoisted so `useAgentSession` can take it as a prop on the first
  // render. Bridge-status polling (the bigger effect further down)
  // also closes over it.
  const notifyBridgeUnavailable = useCallback(() => {
    setToast("⚠️ 检测到 Electron bridge 不可用，请重启或重新构建应用。");
  }, []);

  // Hoisted so `useAgentSession` can take it as a prop on the first
  // render. Originally defined after the SSE block; `useAgentSession`
  // listens for `pi://models-update` and calls it.
  const refreshModels = useCallback(async () => {
    try {
      const [list, auth] = await Promise.all([providersList(), piAuthStatus()]);
      const options = flattenModels(list);
      setModels(options);

      // Keep the current selection if it still exists; otherwise pick the first
      // configured provider (or clear when the list becomes empty).
      setCurrentModelId((prev) => {
        if (prev && options.some((o) => o.id === prev)) return prev;
        return options[0]?.id;
      });

      // Unlock the home Composer as soon as a BYOK provider exists (or OAuth).
      setInit((prev) => (prev ? { ...prev, auth } : prev));
    } catch {
      // Non-fatal — the picker keeps its previous list.
    }
  }, []);
  // Keep the forward-declared ref in sync with the eventual definition.
  refreshModelsRef.current = refreshModels;

  /**
   * Phase 3 — subscribe to `pi://*` events + dispatch each one to the
   * right store + reconcile streaming `pi://update` batches. See
   * `src/hooks/useAgentSession.ts` for the full handler set.
   *
   * The hook subscribes on mount; any events that arrive before the
   * user has selected a session are ignored by each handler's
   * `sid !== currentSessionId` guard.
   */
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
    handleAgentDied: (payload) => handleAgentDiedRef.current(payload),
    cwdRef,
    currentModelIdRef,
  });

  // R2.5 — handle `pi://agent-died`. Stable callback so the subscribe block
  // can reference it from the closure. Auto-resubscribes after a short delay
  // so a transient agent crash (e.g. plugin slot panic) recovers without
  // forcing a renderer reload.
  //
  // Phase 3 — resubscribe handle now comes from `useAgentSession`'s
  // returned `{ resubscribe }`, which owns the dispose-then-subscribe
  // dance. No more `resubscribeRef` book-keeping in App.tsx.
  const handleAgentDied = useCallback(({ reason }: { reason: string }) => {
    console.error('[OpenBuddy] Agent thread died:', reason);
    sessionStore.getState().setError(`AI 引擎异常退出：${reason}`);
    reportEvent("agent_died", "error", { reason });
    // Force-finalise the in-flight assistant bubble (was missing before —
    // caused the "你是谁" symptom where the message stayed on the loading
    // row for 8+ hours after a thread crash mid-turn). The auto-resubscribe
    // below will replay history; we just need the orphan LoadingRow gone.
    const focusedSessionId = sessionStore.getState().sessionId;
    if (focusedSessionId) {
      abandonInFlightStream({
        sessionId: focusedSessionId,
        reason: `agent-died: ${reason}`,
      });
    }
    setToast(
      `⚠️ AI 引擎异常退出：${reason}。正在尝试自动恢复…`,
      {
        kind: "error",
        ttlMs: 0,
        id: "agent-died",
        action: {
          label: "立即重连",
          hint: "↵",
          onClick: () => {
            void sessionEvents.resubscribe();
            setToast("已尝试重新连接 AI 引擎。", { kind: "info", ttlMs: 3000, id: "agent-died-resub-attempted" });
          },
        },
      },
    );
    // Best-effort auto-resubscribe after a small back-off so transient
    // crashes (plugin slot panic, immediate restart) don't require the user
    // to click "立即重连".
    setTimeout(() => {
      void sessionEvents.resubscribe();
    }, 1500);
  }, [sessionStore, setToast, sessionEvents]);
  // Keep the forward-declared ref (consumed by `useAgentSession`'s
  // `onAgentDied` handler) in sync with the eventual definition. Done
  // synchronously each render so the hook's handlers always see the
  // latest closure.
  handleAgentDiedRef.current = handleAgentDied;

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  let lastBridgeToastKey: string | null = null;

  // RC4 — vite dev server can restart while the React tree keeps running, in
  // which case window.api becomes a stale wrapper. Poll the bridge status
  // every few seconds so we recover automatically and re-prompt the user
  // with a fresh toast instead of leaving the UI silently broken.
  // R2.5 — toast carries a "重试" action that re-polls + re-runs piInit.
  useEffect(() => {
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
            kind: "warning",
            ttlMs: 0,
            id: "bridge-unavailable",
            action: {
              label: "重试",
              hint: "↵",
              onClick: () => {
                const s = getElectronBridgeStatus();
                if (s.available) {
                  setToast("bridge 已恢复。", { kind: "info", ttlMs: 3000, id: "bridge-unavailable" });
                  lastBridgeToastKey = null;
                } else {
                  setToast(`bridge 仍不可用（${s.reason ?? "unknown"}）。`, { kind: "warning", ttlMs: 4000, id: "bridge-unavailable" });
                }
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
  }, []);

  const openAccountSettings = useCallback(() => {
    setSettingsSection("account");
    setSettingsOpen(true);
    void (async () => {
      try {
        const status = await casdoorStatus();
        setCasdoorSession(status);
        if (status.status === "signed_in") return;
        const result = await casdoorLogin("default");
        setToast(result.ok ? "已打开 Casdoor 企业登录页面" : result.error);
      } catch (error) {
        setToast(String(error).replace(/^Error:\s*/, ""));
      }
    })();
  }, []);

  const openSettings = useCallback(() => {
    setSettingsSection("model");
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    void casdoorStatus().then(setCasdoorSession).catch(() => setCasdoorSession(null));
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenSafe<CasdoorSessionView>("casdoor://auth", (event) => {
      if (!disposed) setCasdoorSession(event.payload);
    }, () => notifyBridgeUnavailable()).then((cleanup) => {
      if (disposed) cleanup?.();
      else unlisten = cleanup ?? undefined;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenSafe<CasdoorLifecycleEvent>("casdoor://lifecycle", async (event) => {
      if (disposed) return;
      if (event.payload.kind === "session-invalidated" || event.payload.kind === "logout" || event.payload.kind === "config-change") {
        setCasdoorSession(null);
      }
      if (event.payload.scopeChanged || !["refresh", "session-invalidated", "config-change"].includes(event.payload.kind)) return;
      useSessionStore.getState().reset();
      useSessionsStore.setState({ independent: [], workspaces: [], workspaceSessions: {}, currentSessionId: null, drafts: {}, expanded: {} });
      setWorkspaces([]);
      try {
        const [independent, ws] = await Promise.all([piListSessions(cwdRef.current), piListWorkspaces()]);
        if (disposed) return;
        useSessionsStore.getState().setIndependent(independent);
        useSessionsStore.getState().setWorkspaces(ws);
        setWorkspaces(ws);
      } catch {
        if (!disposed) setToast("企业会话已刷新，请重新加载工作台数据");
      }
    }, () => notifyBridgeUnavailable()).then((cleanup) => {
      if (disposed) cleanup?.();
      else unlisten = cleanup ?? undefined;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenSafe<{ scope: string }>("openbuddy://workbench-scope", async () => {
      if (disposed) return;
      useSessionStore.getState().reset();
      useSessionsStore.setState({ independent: [], workspaces: [], workspaceSessions: {}, currentSessionId: null, drafts: {}, expanded: {} });
      setWorkspaces([]);
      try {
        const [independent, ws] = await Promise.all([piListSessions(cwdRef.current), piListWorkspaces()]);
        if (disposed) return;
        useSessionsStore.getState().setIndependent(independent);
        useSessionsStore.getState().setWorkspaces(ws);
        setWorkspaces(ws);
      } catch {
        if (!disposed) setToast("工作台租户上下文已切换，请重新加载会话列表");
      }
    }, () => notifyBridgeUnavailable()).then((cleanup) => {
      if (disposed) cleanup?.();
      else unlisten = cleanup ?? undefined;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const attach = (): void => {
      if (cancelled || stop) return;
      const layout = rendererRuntime.context.get("layout") as {
        getSnapshot?: () => { sidebarCollapsed?: boolean };
        subscribe?: (listener: (state: { sidebarCollapsed?: boolean }) => void) => () => void;
      } | undefined;
      if (!layout?.getSnapshot) return;
      const getSnapshot = layout.getSnapshot.bind(layout);
      const sync = (snapshot = getSnapshot()): void => {
        if (!cancelled && typeof snapshot.sidebarCollapsed === "boolean") setSidebarCollapsed(snapshot.sidebarCollapsed);
      };
      sync();
      stop = layout.subscribe?.(sync);
    };
    attach();
    const offLoaded = rendererRuntime.events.on("plugin/loaded", attach);
    const offProfile = rendererRuntime.events.on("profile/loaded", attach);
    return () => {
      cancelled = true;
      offLoaded();
      offProfile();
      stop?.();
    };
  }, [rendererRuntime]);

  useEffect(() => {
    const layout = rendererRuntime.context.get("layout") as { setSidebarCollapsed?: (collapsed: boolean) => void } | undefined;
    layout?.setSidebarCollapsed?.(sidebarCollapsed);
  }, [rendererRuntime, sidebarCollapsed]);

  // R4.3 — sidebar toggle shortcuts. Cmd/Ctrl+B (toggle) or Cmd/Ctrl+\\
  // (also toggle). Matches VS Code's convention. Only fires outside text
  // inputs so users typing in the Composer don't accidentally collapse the
  // sidebar mid-sentence.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Skip if the user is typing in a text-editing context.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (e.key.toLowerCase() === "b" || e.key === "\\") {
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const attach = (): void => {
      if (cancelled || stop) return;
      const theme = rendererRuntime.context.get("theme") as {
        getTheme?: () => { active?: { colorScheme?: string } };
        subscribe?: (listener: (snapshot: { active?: { colorScheme?: string } }) => void) => () => void;
      } | undefined;
      if (!theme?.getTheme) return;
      const getSnapshot = theme.getTheme.bind(theme);
      const sync = (snapshot = getSnapshot()): void => {
        const colorScheme = snapshot.active?.colorScheme;
        if (!cancelled && (colorScheme === "light" || colorScheme === "dark")) setTheme(colorScheme);
      };
      sync();
      stop = theme.subscribe?.(sync);
    };
    attach();
    const offLoaded = rendererRuntime.events.on("plugin/loaded", attach);
    const offProfile = rendererRuntime.events.on("profile/loaded", attach);
    return () => {
      cancelled = true;
      offLoaded();
      offProfile();
      stop?.();
    };
  }, [rendererRuntime, setTheme]);


  /** Re-fetch providers + auth readiness after Settings add/edit/delete.
   *
   * Previously this only updated `models`, so the home Composer still saw
   * `apiReady=false` (from the cold-start `init.auth.ready`) and stayed
   * disabled with "请先配置 API Key" — looking like nothing changed.
   * Also, the first added model was never auto-selected as currentModelId.
   *
   * Phase 3 — hoisted earlier in the function body so
   * `useAgentSession({ refreshModels })` can take it as a stable prop
   * on the first render. See the lifted definition above.
   */

  useEffect(() => {
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

    // Bridge pi spans → OpenBuddy providers so the same console + OTLP sink
    // observes both internal and pi-runtime telemetry. Best-effort: a
    // dropped listener is invisible to the user, not a failure.
    let telemetryUnlisten: (() => void) | null = null;
    void agentOnPiTelemetryEvent((event) => {
      if (!event || typeof event.name !== "string") return;
      reportEvent(event.name, event.level ?? "info", event.props, { ts: event.ts });
    })
      .then((unlisten) => {
        telemetryUnlisten = unlisten;
      })
      .catch(() => {
        /* bridge unavailable — telemetry stays renderer-only */
      });

    // 尝试自动激活 @anthropic-ai/sandbox-runtime(装好包后零改动生效)。
    // 非阻塞:失败(包未安装)静默降级为纯逻辑守卫。
    void import("@/lib/security/sandbox-init")
      .then((m) => m.tryActivateSandbox())
      .then((status) => {
        if (status.activated) {
          console.log(`[OpenBuddy] OS 级沙箱已激活 (@anthropic-ai/sandbox-runtime${status.version ? ` v${status.version}` : ""})`);
        }
      })
      .catch(() => {/* 静默 */});

    (async () => {
      try {
        const result = await piInit();
        // pi rejects an empty cwd ("Path is not absolute"), so every session
        // needs an absolute path. We treat pi's initial cwd as the "inbox":
        // 新建任务 aims at it (⇒ 任务 group), and the user can re-aim a new
        // session at another directory via the Composer workspace picker
        // (⇒ that 空间 node). homeCwd drives the store's group routing.
        cwdRef.current = result.cwd;
        sessionsStore.getState().setHomeCwd(result.cwd);
        setInit(result);
        setCurrentModelId(result.defaultModelId);


        // Sidebar now shows two groups: 任务 (the inbox cwd's sessions) +
        // 空间 (one node per other working directory). Load both up front;
        // 空间 node children are lazy-loaded when a node is expanded.
        const [independent, registry] = await Promise.all([
          piListSessions(result.cwd),
          piListWorkspaceRegistry(),
        ]);
        const ws = registry.items;
        sessionsStore.getState().setIndependent(independent);
        sessionsStore.getState().setWorkspaces(ws);
        setWorkspaces(ws);

        // Restore the last focused session after a renderer reload. The
        // transcript itself remains in Pi's session file; only this pointer
        // is kept in renderer storage so a reload returns to the same chat.
        const persistedActive = readPersistedActiveSession();
        if (persistedActive) {
          let entry = independent.find((item) => item.sessionId === persistedActive.sessionId);
          if (!entry && persistedActive.cwd && persistedActive.cwd !== result.cwd) {
            const workspaceSessions = await piListSessions(persistedActive.cwd);
            sessionsStore.getState().setWorkspaceSessions(persistedActive.cwd, workspaceSessions);
            entry = workspaceSessions.find((item) => item.sessionId === persistedActive.sessionId);
          }
          if (entry) {
            sessionsStore.getState().setCurrent(entry.sessionId);
            sessionStore.getState().setSession(entry.sessionId);
            try {
              await piLoadSession(entry.sessionId, entry.cwd ?? persistedActive.cwd);
              const entries = await agentSessionMessages(entry.sessionId);
              const { messages: history } = sessionEntriesToChatMessages(entries);
              useSessionStore.getState().loadHistoryMessages(entry.sessionId, history as unknown as import("@/stores/session-store").ChatMessage[]);
            } catch (e) {
              // Phase 4: replay-suppression is gone — pi owns history.
              sessionStore.getState().setError(friendlyError(e));
            }
          } else {
            localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
          }
        }

        // Load the model list from ~/.pi/agent/models.json for the picker.
        // Each model becomes one ModelOption; the id is the pi routing slug.
        const providers = await providersList();
        const providerOptions = flattenModels(providers);
        setModels(providerOptions);
        // Provider/model discovery can finish after the first agent:init auth
        // snapshot. Refresh auth readiness before rendering the composer so a
        // configured BYOK provider never leaves the input disabled.
        const refreshedAuth = await piAuthStatus();
        setInit((previous) => previous ? { ...previous, auth: refreshedAuth } : previous);

        // IMPORTANT: pi's initialize response reports `currentModelId` from
        // its internal catalog, which defaults to `pi-build` (the built-in
        // bundled model) when the user's configured custom model (e.g. glm-5
        // via a BYOK [model.*] entry) isn't recognized as a catalog entry.
        // If we trust pi's default blindly, every prompt goes out with
        // modelId="pi-build" and gets rejected by the user's provider
        // (which only knows their custom model id). So: when the user has
        // configured at least one BYOK provider, prefer the first one over
        // pi's reported default. This matches the "set [models] default"
        // intent and makes the out-of-box BYOK experience work.
        if (providerOptions.length > 0) {
          const piDefault = result.defaultModelId;
          const piDefaultIsKnownProvider = providerOptions.some(
            (p) => p.id === piDefault,
          );
          if (!piDefaultIsKnownProvider) {
            // pi's default (likely "pi-build") isn't in our provider list —
            // fall back to the first configured provider so prompts actually
            // reach the user's endpoint.
            setCurrentModelId(providerOptions[0].id);
          }
        }
      } catch (e) {
        const bridge = getElectronBridgeStatus();
        const raw = String(e);
        if (!bridge.available) {
          notifyBridgeUnavailable();
          appLogger.warn("bridge.init.failed", { msg: "bridge.init.failed", reason: bridge.reason ?? "unknown" });
        }
        setInitError(bridge.available ? raw : `Electron bridge unavailable (${bridge.reason})`);
      }
    })();
    // Phase 3 — the SSE subscription + coalescer cleanup moved into
    // `useAgentSession`. This effect's only remaining responsibilities
    // are the telemetry provider setup and the piInit / sidebar /
    // persisted-active-session restore (lines above).
  }, [sessionStore, sessionsStore]);

  const currentSessionId = sessionsStore((s) => s.currentSessionId);
  useEffect(() => {
    setExtensionText(extensionTextBySession[currentSessionId ?? ""] ?? "");
  }, [currentSessionId, extensionTextBySession]);
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
  useEffect(() => {
    try {
      if (!currentSessionId) return;
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify({
        sessionId: currentSessionId,
        cwd: currentEntry?.cwd ?? cwdRef.current,
      } satisfies PersistedActiveSession));
    } catch {
      // Renderer storage is an optional convenience; Pi remains authoritative.
    }
  }, [currentEntry?.cwd, currentSessionId]);

  // H-3: Sidebar sessions refresh. The user can land on the ChatView branch
  // (App.tsx:1926) via three paths — fresh renderer reload, switching sessions,
  // or switching workspaces — and each needs the 任务 + 空间 groups to
  // reflect pi's current disk truth instead of the stale snapshot from init.
  // Workspace nodes already lazy-refresh on expand (handleToggleWorkspace);
  // what was missing was the inbox (independent) list, which only the init
  // path repopulated. Re-fetch both on cwd change with a 200 ms debounce so
  // rapid workspace switching doesn't stampede the IPC.
  const initCwd = init?.cwd ?? "";
  useEffect(() => {
    if (!initCwd) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        try {
          const [list, registry] = await Promise.all([
            piListSessions(initCwd),
            piListWorkspaceRegistry(),
          ]);
          if (cancelled) return;
          sessionsStore.getState().setIndependent(list);
          sessionsStore.getState().setWorkspaces(registry.items);
          setWorkspaces(registry.items);
        } catch (e) {
          appLogger.warn("sidebar.refresh.failed", {
            msg: "sidebar.refresh.failed",
            err: String(e),
          });
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [initCwd, currentSessionId, sessionsStore]);

  const currentTitle = currentEntry?.title || "";
  const streaming = sessionStore((s) => s.streaming);

  // R7.0 — keep `showToast` reference stable across renders. Several panels
  // (EmailPanel, SearchOverlay, etc.) capture `onToast` inside `useCallback`
  // dependency arrays. If the function identity changes on every render,
  // those callbacks invalidate, their `useEffect` re-fires, the IPC fails
  // (e.g. email MCP not connected), the catch path pushes another toast,
  // the queue selector re-renders App, and we end up in an infinite render
  // loop that locks up the UI. `setToast` is already memoized above; the
  // `toastTimer` ref is also stable, so this callback has stable deps.
  const showToast = useCallback(
    (message: string) => {
      setToast(message);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => useToastStore.getState().clear(), 2000);
    },
    [setToast],
  );
  const handlePlaceholder = (label: string) => {
    // Route a few sidebar shortcut buttons to real panels instead of toasts.
    if (label === "用户中心") {
      openAccountSettings();
      return;
    }
    if (label === "通知") {
      // Open the settings → 智能体邮箱（会话通知中心）tab where all pi
      // events are logged.
      openSettings();
      return;
    }
    showToast(`${label} 当前不可用`);
  };
  const handleNavigate = (label: string) => {
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    setPlaceholderView(label);
    sessionsStore.getState().setCurrent(null);
    sessionStore.getState().reset();
    try {
      if (typeof label === "string" && label.startsWith("助理")) window.localStorage.setItem("openbuddy.assistant.activeTab", label);
      else if (typeof label === "string" && !label.startsWith("助理")) window.localStorage.removeItem("openbuddy.assistant.activeTab");
    } catch { /* 忽略存储错误 */ }
  };
  const handleSelectEmailFromSearch = (accountId: string, threadId: string) => {
    localStorage.setItem("openbuddy.email.inbox-target", JSON.stringify({ accountId, threadId }));
    handleNavigate("邮件");
  };
  const handleSelectKnowledgeFromSearch = (entryId: string, url?: string) => {
    localStorage.setItem("openbuddy.knowledge.target", JSON.stringify({ entryId, url }));
    handleNavigate("知识库");
  };

  // Sidebar project node click → open the Projects panel with that project selected.
  const handleOpenProjectFromSidebar = (projectId: string) => {
    useProjectsStore.getState().setActiveProjectId(projectId);
    handleNavigate("项目");
  };

  // Switch to ChatView with a pending id immediately so the user never sees
  // HomePage after pressing Send. The optimistic-session hook sets the
  // focused session in both stores (sidebar + transcript) so ChatView
  // renders instantly; the transcript under `pendingId` is migrated to the
  // real id by the newSessionFlow tail.
  //
  // Phase 2: the post-promise tail (supersede guard, migrateSession × 2,
  // persona wrapping, project registration, piSend) is now delegated to
  // `newSessionFlow` so the four callers (handleSendNew,
  // handleLaunchDiscover, handleStartProject, handleStartProjectConversation)
  // share one implementation. Rollback on error stays here because it has
  // to undo the optimistic store mutations made *before* the IPC resolves.
  const handleSendNew = async (text: string) => {
    if (STREAM_DEBUG) console.log('[OpenBuddy] handleSendNew:', { text, cwd: cwdRef.current, modelId: currentModelId });
    setPlaceholderView(null);
    const { pendingId, promise } = optimisticSession.ensureNewSession(cwdRef.current, currentModelId);
    // Push the user message + start streaming *now* (before the backend
    // returns) so ChatView shows the user's bubble and the LoadingRow
    // immediately.
    sessionStore.getState().pushOptimisticUser(text);
    sessionStore.getState().setStreaming(true);
    sessionsStore.getState().upsert({
      sessionId: pendingId,
      title: deriveTitle(text),
      cwd: cwdRef.current,
      status: "working",
    });
    // Pull the pending expert once (and clear it) BEFORE awaiting the IPC
    // so the optimistic UI shows the expert badge immediately.
    const pendingExpert = usePendingExpertStore.getState().expert;
    if (pendingExpert && pendingExpert.prompt) {
      usePendingExpertStore.getState().clear();
    }
    try {
      await newSessionFlow({
        pendingId,
        promise,
        text,
        cwd: cwdRef.current,
        flowDeps: {
          awaitPendingNewSession: optimisticSession.awaitPendingNewSession,
          ...(pendingExpert && pendingExpert.prompt
            ? {
                persona: {
                  expertId: pendingExpert.expertId,
                  name: pendingExpert.name,
                  source: pendingExpert.source,
                  ...(pendingExpert.avatarLocal !== undefined
                    ? { avatarLocal: pendingExpert.avatarLocal }
                    : {}),
                  prompt: pendingExpert.prompt,
                },
              }
            : {}),
        },
      });
    } catch (e) {
      console.error('[OpenBuddy] handleSendNew error:', e);
      sessionStore.getState().setError(friendlyError(e));
      // Roll back the optimistic UI: drop the bubble + streaming flag
      // and bounce back to HomePage so the user can retry without
      // hanging on a dead LoadingRow.
      sessionStore.getState().popOptimistic();
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().setSession(null);
      sessionsStore.getState().setCurrent(null);
      sessionsStore.getState().remove(pendingId);
      setToast(`创建会话失败：${friendlyError(e)}`);
    }
  };

  const handleSendCurrent = async (text: string) => {
    const traceId = generateTrace();
    const log = withTrace(appLogger, traceId);
    log.info("composer.send.current", { msg: "composer.send.current", sessionId: currentSessionId ?? undefined, textLength: text.length });
    if (!currentSessionId) return handleSendNew(text);
    // Guard against double-send / send-during-streaming. Composer also guards
    // via its `streaming` prop, but that value can be stale within the same
    // render tick; the store flag is the source of truth. A second pushUser +
    // startStreaming would orphan an empty placeholder that never completes.
    if (sessionStore.getState().streaming) return;
    try {
      sessionsStore.getState().upsert({ sessionId: currentSessionId, status: "working" });
      const currentTitle = lookupSessionTitle(currentSessionId);
      if (isPlaceholderTitle(currentTitle)) {
        const derivedTitle = deriveTitle(text);
        sessionsStore.getState().upsert({ sessionId: currentSessionId, title: derivedTitle });
        void piRenameSession(currentSessionId, derivedTitle, cwdRef.current).catch(() => undefined);
      }
      sessionStore.getState().pushOptimisticUser(text);
      sessionStore.getState().setStreaming(true);
      await piSend(currentSessionId, text, { traceId });
      log.info("composer.send.current.dispatched", { msg: "composer.send.current.dispatched", sessionId: currentSessionId });
    } catch (e) {
      log.error("composer.send.current failed", { msg: "composer.send.current.failed", sessionId: currentSessionId, error: e instanceof Error ? e.message : String(e) });
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().popOptimistic();
      sessionsStore.getState().upsert({ sessionId: currentSessionId, status: "failed" });
      if (isElectronBridgeUnavailable(e)) notifyBridgeUnavailable();
    }
  };

  // R1 — content-based send path used when Composer ships
  // content parts (text + image attachments) via the agent:prompt-content IPC.
  const handleSendContent = async (content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }>) => {
    const traceId = generateTrace();
    const log = withTrace(appLogger, traceId);
    const textPart = content.find((c) => c.type === "text");
    const textForLog = textPart?.text ?? "";
    const imageCount = content.filter((c) => c.type === "image").length;
    log.info("composer.send.content", { msg: "composer.send.content", sessionId: currentSessionId ?? undefined, textLength: textForLog.length, imageCount });
    if (!currentSessionId) return handleSendNew(textForLog || "");
    if (sessionStore.getState().streaming) return;
    try {
      sessionsStore.getState().upsert({ sessionId: currentSessionId, status: "working" });
      const currentTitle = lookupSessionTitle(currentSessionId);
      if (isPlaceholderTitle(currentTitle) && textPart?.text) {
        const derivedTitle = deriveTitle(textPart.text);
        sessionsStore.getState().upsert({ sessionId: currentSessionId, title: derivedTitle });
        void piRenameSession(currentSessionId, derivedTitle, cwdRef.current).catch(() => undefined);
      }
      sessionStore.getState().pushOptimisticUser(textForLog);
      sessionStore.getState().setStreaming(true);
      await piSendContent(currentSessionId, content, { traceId, mode: "queue" });
      log.info("composer.send.content.dispatched", { msg: "composer.send.content.dispatched", sessionId: currentSessionId });
    } catch (e) {
      log.error("composer.send.content failed", { msg: "composer.send.content.failed", sessionId: currentSessionId, error: e instanceof Error ? e.message : String(e) });
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().popOptimistic();
      sessionsStore.getState().upsert({ sessionId: currentSessionId, status: "failed" });
      if (isElectronBridgeUnavailable(e)) notifyBridgeUnavailable();
    }
  };

  const handleCancel = async () => {
    if (!currentSessionId) return;
    appLogger.info("composer.cancel", { msg: "composer.cancel", sessionId: currentSessionId });
    try {
      await piCancel(currentSessionId);
    } catch (e) {
      appLogger.error("composer.cancel failed", { msg: "composer.cancel.failed", sessionId: currentSessionId, error: e instanceof Error ? e.message : String(e) });
      sessionStore.getState().setError(friendlyError(e));
      if (isElectronBridgeUnavailable(e)) notifyBridgeUnavailable();
    } finally {
      // Don't rely on the backend emitting a `complete` for the cancel (it may
      // be dropped by routing after a fast switch). Finalize locally so the
      // Composer's stop button and the loading row don't hang. Already-streamed
      // text is kept; only the in-flight flag is cleared. The optimistic user
      // message stays too — the prompt already reached pi and is persisted.
      //
      // Was previously just `setStreaming(false)` — that left the orphan
      // assistant bubble with `complete: false, parts: []` showing a
      // permanent loading row. Use the shared abandon helper so cancel
      // also force-finalises the bubble. Cancel is a user-initiated normal
      // termination, so we mark the session status as "completed" rather
      // than "failed".
      abandonInFlightStream({
        sessionId: currentSessionId,
        reason: "用户取消",
        status: "completed",
      });
    }
  };

  // Topbar title rename — pi's `x.ai/session/rename`. pi broadcasts
  // SessionSummaryGenerated on success (pi://summary → onSummary upserts the
  // same entry); we also upsert optimistically to avoid a flicker while the
  // event round-trips. On failure we rethrow so TopbarTitle reverts its draft.
  const handleRenameTitle = async (newTitle: string) => {
    if (!currentEntry) return;
    try {
      await piRenameSession(currentEntry.sessionId, newTitle, currentEntry.cwd);
      sessionsStore.getState().upsert({
        sessionId: currentEntry.sessionId,
        title: newTitle,
      });
    } catch (e) {
      showToast(`重命名失败：${String(e).replace(/^Error:\s*/, "")}`);
      throw e;
    }
  };

  // Model picker: switch the current session's model via pi's set_model.
  // If there's no session yet, we just remember the choice and apply it in
  // handleSendNew when the session is created.
  const handleModelChange = async (modelId: string) => {
    setCurrentModelId(modelId);
    if (!currentSessionId) return;
    // pi only knows about sessions it has *loaded* into memory. A session
    // picked from the sidebar (pi_list_sessions) isn't loaded until
    // piLoadSession runs, and after an agent restart even a freshly-used
    // session can be gone. set_session_model then fails with
    // "unknown session id". Recover transparently: load the session into the
    // agent (replaying its history) and retry the switch once.
    const trySet = () => piSetModel(currentSessionId, modelId);
    try {
      await trySet();
    } catch (e) {
      const msg = String(e);
      // Incompatible harness is a hard error — loading won't help.
      if (/incompatible|start_new_session/i.test(msg)) {
        showToast("该会话无法切换到此模型，请新建会话");
        return;
      }
      // Session genuinely unknown to pi — load it (with its own cwd) then
      // retry. currentEntry carries the cwd the session belongs to.
      if (/unknown session/i.test(msg)) {
        try {
          await piLoadSession(currentSessionId, currentEntry?.cwd ?? cwdRef.current);
          await trySet();
          return;
        } catch (e2) {
          showToast(`模型切换失败：${String(e2).replace(/^Error:\s*/, "")}`);
          return;
        }
      }
      showToast(`模型切换失败：${msg.replace(/^Error:\s*/, "")}`);
    }
  };

  // Workspace picker: only re-aim the "target cwd" for the NEXT new session.
  // In the two-section model the sidebar already shows every workspace, so we
  // must NOT clear the current transcript or rebuild the list here — picking a
  // directory just decides which group the next 新建任务 lands in (empty =
  // 任务 group, a real dir = that 空间 node).
  // R2.5 — track per-cwd loading state so the sidebar can show a spinner while
  // piCreateWorkspace + piListWorkspaceRegistry round-trip the IPC. Without
  // this the user can't tell whether the click registered (the picker UI
  // stays identical until the registry resolves).
  const [switchingWorkspace, setSwitchingWorkspace] = useState<string | null>(null);
  const handleSelectWorkspace = (newCwd: string) => {
    cwdRef.current = newCwd;
    setSwitchingWorkspace(newCwd);
    void piCreateWorkspace(newCwd)
      .then(() => piListWorkspaceRegistry())
      .then((registry) => {
        sessionsStore.getState().setWorkspaces(registry.items);
        setWorkspaces(registry.items);
      })
      .catch((error) => {
        setToast(`工作空间不可用：${String(error).replace(/^Error:\s*/u, "")}`, { kind: "warning" });
      })
      .finally(() => {
        setSwitchingWorkspace((current) => (current === newCwd ? null : current));
      });
  };

  const handleNewSession = () => {
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    // Clear the placeholder view BEFORE switching focus so the conditional
    // in App's main render resolves to <HomePage /> instead of the stale
    // <PlaceholderPage /> -- without this, clicking "新建任务" while a
    // placeholder (邮件 / 项目 / etc.) is showing would leave us stuck on
    // the placeholder with the HomePage composer hidden behind it.
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(null);
    // Phase 3 — no more eager piNewSession. HomePage's Composer will create
    // the real session on Send via handleSendNew. This keeps the sidebar
    // empty of empty rows when the user just clicks the sidebar button to
    // go back to home without typing.
  };

  /** Navigate to home page without resetting session state (used after expert summon). */
  const handleGoHome = () => {
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(null);
  };

  // 空间节点展开/折叠: 记录展开态, 首次展开时懒加载该 cwd 的子会话。
  const handleToggleWorkspace = async (cwd: string, next: boolean) => {
    sessionsStore.getState().setExpanded(cwd, next);
    if (next && sessionsStore.getState().workspaceSessions[cwd] === undefined) {
      try {
        const list = await piListSessions(cwd);
        sessionsStore.getState().setWorkspaceSessions(cwd, list);
      } catch (e) {
        showToast(`加载空间会话失败：${String(e)}`);
      }
    }
  };

  const handleSelectSession = async (sessionId: string, sessionCwd?: string) => {
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(sessionId);
    // Phase 4 — setSession is just a focus flip; the canonical transcript
    // lives in pi's AgentSession. No replay suppression, no cache hydration.
    sessionStore.getState().setSession(sessionId);
    try {
      // Load with the session's OWN cwd (independent sessions have cwd="").
      // Viewing a 空间 child must NOT re-aim the new-session target directory.
      await piLoadSession(sessionId, sessionCwd ?? "");
      // Historical session switch: pi owns the canonical transcript (Phase 4),
      // so the renderer's transcript mirror was reset by setSession() and
      // would otherwise render an empty chat until live events arrive.
      // Pull persisted entries from pi and project them into ChatMessage[].
      const entries = await agentSessionMessages(sessionId);
      const { messages: history } = sessionEntriesToChatMessages(entries);
      // The projection uses unknown[] for tool-call content; ChatMessage
      // wants the UI ToolCallContent union. Cast at the boundary — the
      // renderer falls back to string when a content type is unknown.
      useSessionStore.getState().loadHistoryMessages(sessionId, history as unknown as import("@/stores/session-store").ChatMessage[]);
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
    }
  };

  // Rewind rewrites the backend history — pi's AgentSession is the source
  // of truth, so we just reload and let pi rehydrate the transcript.
  const handleRewound = async () => {
    const id = sessionStore.getState().sessionId;
    if (!id) return;
    try {
      await piLoadSession(id, cwdRef.current);
      // pi rehydrates AgentSession from JSONL on loadSession; reflect that
      // by re-projecting the persisted entries into the transcript mirror.
      const entries = await agentSessionMessages(id);
      const { messages: history } = sessionEntriesToChatMessages(entries);
      useSessionStore.getState().loadHistoryMessages(id, history as unknown as import("@/stores/session-store").ChatMessage[]);
    } catch (e) {
      sessionStore.getState().setError(friendlyError(e));
    }
  };

  // Fork copies the session to a new id — jump to it so the user sees the
  // branch they just created (and it appears in the sidebar). We also
  // migrate the parent's 👍/👎 + 1-5 star feedback to the fork via
  // useFeedbackStore.renameSession(oldId, newId) so the historical
  // ratings carry over to the new branch (otherwise the rating on every
  // parent message disappears as soon as the user clicks "分叉" and the
  // fork is treated as a brand-new conversation).
  const handleForked = (newId: string) => {
    const cwd = cwdRef.current;
    const oldId = sessionStore.getState().sessionId;
    setPlaceholderView(null);
    sessionsStore.getState().setCurrent(newId);
    sessionsStore.getState().upsert({ sessionId: newId, title: "分叉会话", cwd });
    sessionStore.getState().setSession(newId);
    if (oldId && oldId !== newId) {
      useFeedbackStore.getState().renameSession(oldId, newId);
    }
    void piLoadSession(newId, cwd).catch((e) =>
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
  //
  // Phase 2: the optimistic-id dance + post-promise tail are delegated to
  // `newSessionFlow`. The prompt body composition (role preamble + user
  // question) lives in `composeDiscoverBody`.
  const handleLaunchDiscover = async (prompt: string, agent?: AgentEntry) => {
    const cwd = cwdRef.current;
    const body = composeDiscoverBody(prompt, agent);
    setPlaceholderView(null);
    const { pendingId, promise } = optimisticSession.ensureNewSession(cwd);
    sessionStore.getState().pushOptimisticUser(body);
    sessionStore.getState().setStreaming(true);
    sessionsStore.getState().upsert({
      sessionId: pendingId,
      title: agent ? agent.name : deriveTitle(prompt),
      cwd,
      status: "working",
    });
    try {
      await newSessionFlow({
        pendingId,
        promise,
        text: body,
        cwd,
        flowDeps: { awaitPendingNewSession: optimisticSession.awaitPendingNewSession },
      });
    } catch (e) {
      console.error('[OpenBuddy] handleLaunchDiscover error:', e);
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().popOptimistic();
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().setSession(null);
      sessionsStore.getState().setCurrent(null);
      sessionsStore.getState().remove(pendingId);
      showToast(`启动失败：${friendlyError(e)}`);
    }
  };

  // 进入本地项目：把种子会话瞄到项目关联目录（使其归入对应空间节点），
  // 新建会话并注入项目说明作为种子消息。
  //
  // Phase 2: the optimistic-id dance + post-promise tail (project
  // registration + first-conversation pre-wrap) are delegated to
  // `newSessionFlow`.
  const handleStartProject = async (project: ProjectMeta) => {
    if (project.cwd) {
      cwdRef.current = project.cwd;
    }
    const cwd = cwdRef.current;
    const seed = project.instructions?.trim()
      ? project.instructions
      : `你好，我们开始「${project.name}」项目吧。`;
    setPlaceholderView(null);
    const { pendingId, promise } = optimisticSession.ensureNewSession(cwd);
    sessionStore.getState().pushOptimisticUser(seed);
    sessionStore.getState().setStreaming(true);
    sessionsStore.getState().upsert({
      sessionId: pendingId,
      title: project.name,
      cwd,
      status: "working",
    });
    try {
      await newSessionFlow({
        pendingId,
        promise,
        text: seed,
        cwd,
        flowDeps: {
          awaitPendingNewSession: optimisticSession.awaitPendingNewSession,
          projectSeed: { id: project.id, name: project.name, instructions: project.instructions },
          registerProjectConversation: true,
        },
      });
    } catch (e) {
      console.error('[OpenBuddy] handleStartProject error:', e);
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().popOptimistic();
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().setSession(null);
      sessionsStore.getState().setCurrent(null);
      sessionsStore.getState().remove(pendingId);
      showToast(`启动项目失败：${friendlyError(e)}`);
    }
  };

  // 在项目中新建对话（从侧栏 + 按钮或项目详情页 Composer 触发）。
  // 创建 pi 会话 → 注册到项目 conversations → 打开 ChatView → 可选发送首条消息。
  //
  // Phase 2: project registration + first-conversation pre-wrap delegated
  // to `newSessionFlow`.
  const handleStartProjectConversation = async (projectId: string, message?: string) => {
    const project = useProjectsStore.getState().projects.find((p) => p.id === projectId);
    if (!project) return;
    const cwd = project.cwd || cwdRef.current;
    const title = message ? deriveTitle(message) : `${project.name} 对话`;
    setPlaceholderView(null);
    const { pendingId, promise } = optimisticSession.ensureNewSession(cwd);
    sessionStore.getState().setStreaming(true);
    sessionsStore.getState().upsert({
      sessionId: pendingId,
      title,
      cwd,
      status: message ? "working" : "pending",
    });
    if (message) sessionStore.getState().pushOptimisticUser(message);
    try {
      // For the first conversation in a project, `newSessionFlow` will
      // prepend the project instructions so pi understands the context
      // on the very first turn. Subsequent conversations send the
      // bare message.
      await newSessionFlow({
        pendingId,
        promise,
        text: message ?? "",
        cwd,
        flowDeps: {
          awaitPendingNewSession: optimisticSession.awaitPendingNewSession,
          projectSeed: { id: project.id, name: project.name, instructions: project.instructions },
          registerProjectConversation: true,
        },
      });
    } catch (e) {
      console.error('[OpenBuddy] handleStartProjectConversation error:', e);
      sessionStore.getState().setError(friendlyError(e));
      sessionStore.getState().popOptimistic();
      sessionStore.getState().setStreaming(false);
      sessionStore.getState().setSession(null);
      sessionsStore.getState().setCurrent(null);
      sessionsStore.getState().remove(pendingId);
      showToast(`创建项目对话失败：${friendlyError(e)}`);
    }
  };

  const activeNav = placeholderView ?? (currentSessionId ? "" : "新建任务");

  return (
    <div className={"app" + (IS_MACOS ? " app--macos" : "")}>
      {/* macOS 使用系统原生 Overlay 标题栏(红绿灯 + 原生菜单栏),
          不再渲染自绘 TitleBar;Windows/Linux 保持自绘。 */}
      {!IS_MACOS && (
        <TitleBar onPlaceholder={handlePlaceholder} onShowAbout={() => setAboutOpen(true)} />
      )}
      <div className={"app__body" + (sidebarCollapsed ? " app__body--collapsed" : "")}>
        <ErrorBoundary compact title="侧栏出现错误">
          <Sidebar
            onNewSession={handleNewSession}
            onSelect={handleSelectSession}
            onNavigate={handleNavigate}
            onOpenSettings={openSettings}
            onOpenAccount={openAccountSettings}
            accountLabel={casdoorSession?.status === "signed_in" && casdoorSession.identity ? (casdoorSession.identity.displayName ?? casdoorSession.identity.email ?? casdoorSession.identity.subject) : undefined}
            onToggleCollapse={() => setSidebarCollapsed(true)}
            onToggleWorkspace={handleToggleWorkspace}
            onOpenSearch={() => setSearchOpen(true)}
            onPlaceholder={handlePlaceholder}
            onToast={showToast}
            onOpenProject={handleOpenProjectFromSidebar}
            onStartProjectConversation={handleStartProjectConversation}
            activeNav={activeNav}
          />
        </ErrorBoundary>
        <main id="main-content" className="app__main">
          {/* 全局 topbar 仅对话页需要：会话标题 +（侧栏折叠时）展开/新建。
              首页、助理、自动化等其它页面不占 48px，各自顶栏贴顶即可。
              侧栏折叠且非对话页时，用悬浮按钮提供展开入口。
              注:Electron 只认 data-openbuddy-drag(CSS 的 -webkit-app-region
              不生效);按钮等子元素不是拖拽目标,不影响点击。 */}
          {!placeholderView && currentSessionId ? (
            <header className="main-topbar" data-openbuddy-drag>
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
                <TopbarTitle title={currentTitle} appVersion={APP_VERSION} onRename={handleRenameTitle} />
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
              {/* ChatView 通过 createPortal 将工具图标按钮(WB 风格)送入此槽位,
                  不再单独占用正文一行,输入框因此贴底。 */}
              <div className="main-topbar__right" id="ob-topbar-tools" />
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
              {String(initError).toLowerCase().includes("bridge unavailable")
                ? "Electron preload bridge 未加载或版本不兼容，请完全退出并重新启动 OpenBuddy；若仍失败请使用 View → Toggle Developer Tools 查看 preload 诊断。"
                : "请在「设置 → 模型」配置 Pi provider 的 API Key，或检查 provider endpoint 后重试。"}
            </div>
          ) : !init ? (
            <div className="app__notice">正在本地初始化 agent…</div>
          ) : !init.ok ? (
            <div className="app__notice app__notice--err">
              pi 未就绪:{init.auth.reason ?? "未知原因"}
              <br />
              请在「设置 → 模型」配置 Pi provider 的 API Key。
            </div>
          ) : placeholderView ? (
            <ErrorBoundary compact title="工作台视图出现错误">
              <PlaceholderPage
                label={placeholderView}
                onPlaceholder={handlePlaceholder}
                onNavigate={handleNavigate}
                onGoHome={handleGoHome}
                onStartWithExpert={handleStartWithExpert}
                onToast={showToast}
                cwd={cwdRef.current}
                onSelectWorkspace={handleSelectWorkspace}
                sessionId={currentSessionId ?? undefined}
                onLaunch={handleLaunchDiscover}
                onSend={handleSendNew}
                onSendContent={handleSendContent}
                streaming={streaming}
                apiReady={init.auth.ready}
                onOpenSettings={openSettings}
                modelId={currentModelId}
                models={models}
                onModelChange={handleModelChange}
                onStartProject={handleStartProject}
                onStartProjectConversation={handleStartProjectConversation}
              />
            </ErrorBoundary>
          ) : currentSessionId ? (
            <ErrorBoundary compact title="对话视图出现错误">
              <ChatView
                onSend={handleSendCurrent}
                onSendContent={handleSendContent}
                onCancel={handleCancel}
                modelId={currentModelId}
                models={models}
                onModelChange={handleModelChange}
                cwd={cwdRef.current}
                workspaces={workspaces}
                onSelectWorkspace={handleSelectWorkspace}
                onRewound={handleRewound}
                onForked={handleForked}
                onOpenSession={handleSelectSession}
                onToast={showToast}
                onSelectExpert={handleStartWithExpert}
                onNavigateConnectors={() => setPlaceholderView("专家·技能·连接器")}
              extensionText={extensionText}
              extensionTextNonce={extensionTextNonce}
              extensionUi={extensionUiBySession[currentSessionId ?? ""]}
              />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary compact title="首页出现错误">
              <Suspense fallback={null}>
                <HomePage
                  onSend={handleSendNew}
                  streaming={streaming}
                  apiReady={init.auth.ready}
                  onOpenSettings={openSettings}
                  onPlaceholder={handlePlaceholder}
                  modelId={currentModelId}
                  models={models}
                  onModelChange={handleModelChange}
                  cwd={cwdRef.current}
                  workspaces={workspaces}
                  onSelectWorkspace={handleSelectWorkspace}
                  onSelectExpert={handleStartWithExpert}
                  onNavigateConnectors={() => setPlaceholderView("专家·技能·连接器")}
                  onOpenActivity={() => setPlaceholderView("活动中心")}
                />
              </Suspense>
            </ErrorBoundary>
          )}
        </main>
      </div>
      <Toast entries={toastQueue} onDismiss={dismissToast} />
      {/* P1-01: single Suspense boundary for all lazy overlays/dialogs/panels.
          The fallback is null because each lazy component is only mounted
          when its `open` prop flips true; the tiny async fetch happens in
          the background while the rest of the UI stays interactive. */}
      <Suspense fallback={null}>
        <SearchOverlay
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onSelect={handleSelectSession}
          onSelectEmail={handleSelectEmailFromSearch}
          onSelectProject={handleOpenProjectFromSidebar}
          onSelectAssistant={() => handleNavigate("助理·收件箱")}
          onSelectKnowledge={handleSelectKnowledgeFromSearch}
          currentSessionId={currentSessionId}
          onSelectCalendar={() => handleNavigate("助理·日程")}
        />
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onModelsChanged={refreshModels} initialSection={settingsSection} onOpenEmailPlan={(planId) => { localStorage.setItem("openbuddy.email.processing-plan-target", planId); setSettingsOpen(false); handleNavigate("邮件"); }} />
        <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} init={init} />
        <FolderTrustDialog
          request={trustRequest}
          onResolve={() => setTrustRequest(null)}
          onToast={showToast}
        />
        <TasksPanel refreshSignal={taskRefreshSignal} onToast={showToast} />
      </Suspense>
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
