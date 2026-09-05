/**
 * useAgentSession — extract the SSE subscription + update coalescer +
 * per-event dispatch into a cohesive module.
 *
 * ## Why this hook exists
 *
 * The original App.tsx had a ~280-line `useEffect` block subscribing to
 * `pi://*` events. The `handleAgentDied` resubscribe path *duplicated*
 * the entire handler set (~60 lines of copy-paste) so a fresh
 * subscription could replace the dead one. Bugs in the two copies
 * easily drifted apart — the resubscribe path missed
 * `finishStreamingMessage()`, didn't sync plan-mode into the store on
 * resubscribe, etc.
 *
 * This hook owns:
 *  - the SSE subscription (cold-start + resubscribe paths share ONE
 *    handler set, by construction);
 *  - the `updateCoalescer` (rAF-batched flush for `pi://update` events);
 *  - the `unlisten` / `resubscribe` refs that `handleAgentDied` uses;
 *  - per-event store mutations (transcript, streaming, sidebar status,
 *    plugin lifecycle, notifications, …).
 *
 * The hook does NOT own:
 *  - the `piInit()` flow + sidebar initial load (one-shot, not a
 *    subscription concern);
 *  - bridge health / casdoor status listeners (app-lifecycle, not
 *    session-lifecycle);
 *  - the local React state for trust-request / extension text / task
 *    refresh signal / workspaces / theme — those live in App.tsx and
 *    are wired via setters passed in.
 *
 * ## Cohesion strategy
 *
 * The handler set was already "cohesive" (all update one set of stores
 * in response to one channel of events). The bug was that the *same*
 * handler set was written twice. We solved this by defining `handlers`
 * once inside the hook (via a lazy ref-returning factory so closures
 * over mutable App.tsx state stay current) and referencing it from
 * both the cold-start effect and the resubscribe path.
 *
 * App.tsx just passes a few callbacks (e.g. `onToast`, `refreshModels`)
 * plus a refs bundle for state that lives outside the stores. The
 * latency-critical `pasteToEditor` handler reads the per-session editor
 * text via a ref so it doesn't capture a stale closure across re-renders
 * (App.tsx previously had a latent bug where the pasteToEditor branch
 * could only ever see the empty initial map; the ref-snapshot fixes it).
 */
import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";
import type { SessionUpdate } from "@openbuddy/shared-types";
import {
  subscribePiEvents,
  piSend,
  piCancel,
  piListWorkspaceRegistry,
  notificationAppend,
} from "@/lib/agent/pi-client";
import { isElectronBridgeUnavailable } from "@/lib/platform/electron-api";
import { useSessionStore } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { usePermissionStore } from "@/stores/permission-store";
import { useQuestionStore } from "@/stores/question-store";
import { useSubagentStore } from "@/stores/subagent-store";
import { useMessageQueueStore, hasActiveItems } from "@/stores/message-queue-store";
import { useProjectsStore } from "@/stores/projects-store";
import { dispatchNotification } from "@/lib/notify/notify-channels";
import { reportEvent } from "@/lib/telemetry/telemetry-contract";
import { recordUsage, loadUsage, loadQuotaConfig } from "@/lib/billing/usage-quota";
import { createUpdateCoalescer, type UpdateCoalescer } from "@/lib/stream/update-coalescer";
import { friendlyError } from "@/lib/platform/error-format";
import { abandonInFlightStream } from "@/lib/agent/abandon-stream";
import { withTrace, createRendererLogger } from "@openbuddy/logging-renderer";
import type {
  PermissionRequest,
  SubagentLiveEvent,
} from "@openbuddy/shared-types";
import type { QuestionRequest } from "@/stores/question-store";

const appLogger = createRendererLogger({
  devMode: ((typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) || false),
  name: "useAgentSession",
});

/**
 * Decide whether a text part of shape `partType` should be appended.
 *
 * The bridge can emit the same delta under two wire shapes as two separate
 * chunks (`text_delta` then legacy `text`, or `thinking_delta` then `text`).
 * Appending both duplicates every delta. This locks onto the first shape a
 * turn produces and rejects the other until `resetTextShapes` runs at the
 * next turn boundary, so:
 *
 *   - a dual-emitting bridge streams each delta exactly once
 *   - a `*_delta`-only bridge is unaffected
 *   - a legacy `text`-only bridge still streams (it locks onto `text`)
 *
 * Mutates the ref in place and returns whether to accept.
 */
export function acceptTextShape(
  shapeRef: { current: string | null },
  partType: string,
): boolean {
  if (shapeRef.current === null) {
    shapeRef.current = partType;
    return true;
  }
  return shapeRef.current === partType;
}

/** Optional Phase 1 escape hatch — debug flag mirrors App.tsx. */
function isStreamDebugEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  try { return localStorage.getItem("openbuddy.debug.stream") === "1"; }
  catch { return false; }
}
const STREAM_DEBUG = isStreamDebugEnabled();

export type ExtensionUiBySessionValue = {
  statuses: Record<string, string>;
  widgets: Record<string, string[]>;
  workingMessage?: string;
  workingVisible?: boolean;
  workingIndicator?: unknown;
  hiddenThinkingLabel?: string;
  toolsExpanded?: boolean;
};

/**
 * Loose setter type — accepts any of React's `Dispatch<SetStateAction<T>>`
 * regardless of `T`. Required because `Dispatch<SetStateAction<unknown[]>>`
 * is NOT assignable to `Dispatch<SetStateAction<WorkspaceInfo[]>>`
 * (contravariance in the function updater form), but the hook only ever
 * passes plain values, never functional updaters, so accepting `any` is
 * safe at the call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySetter = (value: any) => void;

export interface UseAgentSessionOptions {
  /** App.tsx-local state setters (lifted for cross-component use). */
  setTrustRequest: AnySetter;
  setTaskRefreshSignal: AnySetter;
  setExtensionTextBySession: AnySetter;
  setExtensionText: AnySetter;
  setExtensionTextNonce: AnySetter;
  setExtensionUiBySession: AnySetter;
  setWorkspaces: AnySetter;
  setTheme: AnySetter;

  /** Toast surface — used by `pi://agent-died` retry + extension `notify`.
   *  Typed loose (`opts?: any`) so App.tsx's narrower `(msg, opts?: {…
   *  }) => void` setter can be passed in. */
  setToast: (msg: string, opts?: any) => void;

  /** `pasteToEditor` reads the latest per-session editor text; App.tsx
   *  keeps this ref current so the handler isn't subject to a stale
   *  closure. */
  extensionTextBySessionRef: MutableRefObject<Record<string, string>>;

  /** Refresh the model picker when `pi://models-update` fires. */
  refreshModels: () => Promise<void>;

  /** Surface a "bridge unavailable" toast (called once on subscribe fail). */
  notifyBridgeUnavailable: () => void;

  /** `pi://agent-died` handler — App.tsx owns the toast + auto-resubscribe. */
  handleAgentDied: (payload: { reason: string }) => void;

  /** Refs into App.tsx. */
  cwdRef: MutableRefObject<string>;
  currentModelIdRef: MutableRefObject<string | undefined>;
}

export interface UseAgentSessionReturn {
  /** Manual resubscribe (used by `handleAgentDied`'s "立即重连" action and
   *  its auto-back-off timer). The hook handles the bookkeeping so the
   *  caller doesn't need to re-implement the dispose-then-subscribe dance. */
  resubscribe: () => Promise<void>;
}

/**
 * Subscribe to `pi://*` events and dispatch each one to the right store.
 *
 * Subscription strategy:
 *     Subscribe on mount — the bridge IPC is available before piInit
 *     completes, and any events that arrive before the user has selected
 *     a session are ignored (`sid !== currentSessionId` guard inside each
 *     handler). This decouples the SSE subscription from the piInit
 *     lifecycle so the `handleAgentDied` resubscribe path can be a
 *     pure no-side-effect call.
 */
export function useAgentSession(options: UseAgentSessionOptions): UseAgentSessionReturn {
  const {
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
    refreshModels,
    notifyBridgeUnavailable,
    handleAgentDied,
    cwdRef,
    currentModelIdRef,
  } = options;

  // Stable ref to the most recent `setToast` so the handler set can call
  // it without re-subscribing on every render. React guarantees the
  // setter identity is stable, so this is purely defensive.
  const setToastRef = useRef(setToast);
  setToastRef.current = setToast;

  // Stable ref to `refreshModels` for the same reason.
  const refreshModelsRef = useRef(refreshModels);
  refreshModelsRef.current = refreshModels;

  // Stable ref to `handleAgentDied`.
  const handleAgentDiedRef = useRef(handleAgentDied);
  handleAgentDiedRef.current = handleAgentDied;

  // rAF-batched flush for `pi://update` events. Created lazily once.
  const updateCoalescerRef = useRef<UpdateCoalescer<SessionUpdate & { __sessionId?: string }> | null>(null);

  // The current subscription handle so the agent-died handler can tear down
  // and re-subscribe without re-running piInit (which would lose session state).
  const piUnlistenRef = useRef<(() => void) | null>(null);

  // Phase R3.0 (pi-web-alignment) — BUG #4 root-cause guard:
  //   Tracks whether the in-flight turn was force-aborted by the cleanup
  //   effect. The natural-completion path (pi://complete arrives) flips
  //   this to true so the abort IPC isn't sent for a turn that finished
  //   cleanly. Without this ref the unmount would always abort — even when
  //   the user navigated away just after the model completed — which the
  //   backend would interpret as an unsolicited cancel.
  const abortedRef = useRef(false);

  // 15s streaming watchdog timer — if `streaming` stays true with no
  // `pi://update` activity for 15 s (and no pi://complete either), we
  // force-finalize the streaming message so the LoadingRow can't spin
  // forever. Mirrors the user-reported "你是谁" message stuck for 8h+
  // symptom from useAgentSession.ts:388.
  const STREAMING_WATCHDOG_MS = 15_000;
  const streamingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetStreamingWatchdog = () => {
    if (streamingWatchdogRef.current !== null) {
      clearTimeout(streamingWatchdogRef.current);
    }
    streamingWatchdogRef.current = setTimeout(() => {
      // Reset before the abandon-stream call so the rAF flush completes
      // before we mutate the store. The actual call routes through
      // abandonInFlightStream so the LoadingRow + LoadingRow.getDefault are
      // consistent with the natural error path.
      streamingWatchdogRef.current = null;
      const store = useSessionStore.getState();
      if (!store.streaming) return;
      // eslint-disable-next-line no-console
      console.warn("[OpenBuddy] streaming watchdog 15s timeout — finalising orphan message");
      // Defer to abandonInFlightStream which lives at
      // src/lib/agent/abandon-stream.ts. Imported lazily to avoid a
      // circular import (useAgentSession ↔ abandon-stream).
      void import("@/lib/agent/abandon-stream").then(({ abandonInFlightStream }) => {
        const sid = store.sessionId;
        if (sid) abandonInFlightStream({ sessionId: sid, reason: "watchdog-15s" });
      });
    }, STREAMING_WATCHDOG_MS);
  };
  /**
   * Which text wire-shape this turn's assistant text is arriving as.
   * `null` until the first text part decides it. See `acceptTextShape`.
   */
  const textShapeRef = useRef<string | null>(null);
  /** Same, for `agent_thought_chunk` (thinking_delta vs legacy text). */
  const thoughtShapeRef = useRef<string | null>(null);

  const clearStreamingWatchdog = () => {
    if (streamingWatchdogRef.current !== null) {
      clearTimeout(streamingWatchdogRef.current);
      streamingWatchdogRef.current = null;
    }
  };

  // Build the handler set ONCE — both the cold-start useEffect and the
  // resubscribe path close over the same `buildHandlersRef.current()` so
  // they can't drift apart.
  const buildHandlersRef = useRef<() => Parameters<typeof subscribePiEvents>[0]>(() => {
    return {
      onUpdate: (u: unknown) => {
        if (STREAM_DEBUG) console.log("[OpenBuddy] pi://update:", u);
        updateCoalescerRef.current?.push(u as SessionUpdate & { __sessionId?: string });
      },
      onPermission: (p: { sessionId: string; options?: { title?: string }[] }) => {
        // permission_request is already surfaced via the toast +
        // usePermissionStore.request below; no console.log needed.
        reportEvent("permission_request", "warn", { sessionId: p.sessionId });
        usePermissionStore.getState().request(p as unknown as PermissionRequest);
        void notificationAppend(
          "permission",
          p.options?.[0]?.title ?? "工具执行权限请求",
          undefined,
          p.sessionId,
          "warn",
        );
      },
      onComplete: (p: { sessionId: string; stopReason?: string; usage?: { promptTokens?: number; completionTokens?: number } }) => {
        if (p.stopReason === "error" || p.stopReason === "rate_limit") {
          // Only the failure path stays in console — happy-path completions
          // were firing dozens of console.log lines per turn that drowned
          // out real diagnostics.
          console.warn("[OpenBuddy] pi turn completed with failure stopReason", p);
        }
        reportEvent("session_complete", "info", { sessionId: p.sessionId, stopReason: p.stopReason });
        const currentSessionId = useSessionStore.getState().sessionId;
        if (currentSessionId && p.sessionId && p.sessionId !== currentSessionId) return;
        // One turn produces MULTIPLE `pi://complete` events. The main process
        // maps three distinct pi lifecycle events onto this one channel —
        // `turn_end`, `agent_end` and `agent_settled` (see
        // electron/main/agent/host-modules/bootstrap/handle-session-event.ts:442)
        // — and the history-replay path emits one per content part
        // (host-modules/session-store.ts:137,150,162). A single MiniMax turn
        // was observed delivering four, with stopReasons
        // ["stop", "end_turn", "end_turn", "end_turn"].
        //
        // Everything below this point is a once-per-turn side effect:
        // usage/cost accounting, the "会话完成" notification, and shifting the
        // next queued message. Running them four times inflated token+cost
        // totals fourfold, fired four duplicate desktop notifications, and —
        // worst — could drain four queued messages on a single turn end
        // instead of one.
        //
        // `promptId` is always "" on this channel, so there is no turn id to
        // dedupe on. Instead treat "already settled" as the guard: a turn that
        // has neither an active stream nor a streaming message has already
        // been finalised by an earlier complete.
        const preState = useSessionStore.getState();
        if (!preState.streaming && !preState.streamingMessageId) return;
        // Phase R3.0 (pi-web-alignment) — natural completion: clear the
        // streaming watchdog and mark the turn as no-longer-aborted so the
        // unmount cleanup doesn't send an unsolicited pi://cancel IPC.
        clearStreamingWatchdog();
        abortedRef.current = true;
        // Finalise BEFORE flipping the streaming flag. `finishStreamingMessage`
        // synchronously flushes whatever text is still sitting in the delta
        // buffer (rAF may not have fired yet — an unfocused/occluded Electron
        // window throttles animation frames, so the entire turn's text can
        // still be buffered at this point). Flipping `streaming` first meant
        // the flag change triggered the transcript's re-render while the
        // buffer was still unflushed, and the later flush mutated the array
        // tail without producing another notification — leaving a
        // permanently empty assistant bubble.
        useSessionStore.getState().finishStreamingMessage();
        useSessionStore.getState().setStreaming(false);
        // Let the next turn re-decide its wire shape. Safe to reset only at a
        // turn boundary — resetting mid-turn would re-open the duplicate-append
        // window that `acceptTextShape` exists to close.
        textShapeRef.current = null;
        thoughtShapeRef.current = null;
        useSessionsStore.getState().upsert({ sessionId: p.sessionId, status: "completed" });
        if (p.usage && (p.usage.promptTokens || p.usage.completionTokens)) {
          recordUsage(loadUsage(), {
            modelId: currentModelIdRef.current ?? "unknown",
            promptTokens: p.usage.promptTokens ?? 0,
            completionTokens: p.usage.completionTokens ?? 0,
          }, loadQuotaConfig() ?? undefined);
        }
        void notificationAppend(
          "session_complete",
          `会话完成（${p.stopReason ?? "end_turn"}）`,
          undefined,
          p.sessionId,
          "info",
        );
        void dispatchNotification({
          title: "OpenBuddy 会话完成",
          body: `会话 ${p.sessionId.slice(0, 8)} 已完成（${p.stopReason ?? "end_turn"}）`,
          level: "info",
          sessionId: p.sessionId,
        }).catch(() => { /* notification dispatch failure is non-fatal */ });
        // Auto-queue next message if there is one — mirrors WorkBuddy
        // message-queue (回完一条自动发下一条).
        const q = useMessageQueueStore.getState().getQueue(p.sessionId);
        if (hasActiveItems(q)) {
          const next = useMessageQueueStore.getState().shiftNext(p.sessionId);
          if (next) {
            useSessionsStore.getState().upsert({ sessionId: p.sessionId, status: "working" });
            useSessionStore.getState().pushOptimisticUser(next.text);
            useSessionStore.getState().setStreaming(true);
            piSend(p.sessionId, next.text).catch((e) => {
              useSessionStore.getState().setError(friendlyError(e));
              useSessionsStore.getState().upsert({ sessionId: p.sessionId, status: "failed" });
            });
          }
        }
      },
      onSummary: (p: { sessionId: string; title: string; traceId?: string }) => {
        const log = p.traceId ? withTrace(appLogger, p.traceId) : appLogger;
        log.info("pi://summary", { msg: "pi.summary.received", traceId: p.traceId, sessionId: p.sessionId, title: p.title });
        useSessionsStore.getState().upsert({
          sessionId: p.sessionId,
          title: p.title,
          updatedAt: new Date().toISOString(),
        });
        const allProjects = useProjectsStore.getState().projects;
        for (const project of allProjects) {
          if (project.conversations.some((c) => c.sessionId === p.sessionId)) {
            useProjectsStore.getState().updateConversationTitle(project.id, p.sessionId, p.title);
            break;
          }
        }
        void notificationAppend(
          "summary",
          `生成会话标题：${p.title}`,
          undefined,
          p.sessionId,
          "info",
        );
      },
      onFolderTrust: (p: unknown) => {
        const req = (p ?? {}) as { cwd?: string; reason?: string };
        if (typeof req.cwd !== "string" || req.cwd.length === 0) return;
        setTrustRequest({ cwd: req.cwd, reason: req.reason });
        void notificationAppend(
          "folder_trust",
          `请求信任文件夹：${req.cwd ?? "(unknown)"}`,
          req.reason,
          undefined,
          "warn",
        );
      },
      onPlanMode: (p: unknown) => {
        const payload = (p ?? {}) as { enabled?: boolean };
        if (typeof payload.enabled === "boolean") {
          useSessionStore.getState().setPlanMode(payload.enabled);
          void notificationAppend(
            "plan_mode",
            payload.enabled ? "进入计划模式" : "退出计划模式",
            undefined,
            undefined,
            "info",
          );
        }
      },
      onMcpStatus: (p: unknown) => {
        void notificationAppend(
          "mcp_status",
          "MCP 连接器状态变化",
          typeof p === "string" ? p : JSON.stringify(p).slice(0, 200),
          undefined,
          "info",
        );
      },
      onModelsUpdate: () => {
        void refreshModelsRef.current();
        void notificationAppend(
          "models_update",
          "模型列表已更新",
          undefined,
          undefined,
          "info",
        );
      },
      onTaskUpdate: () => {
        setTaskRefreshSignal((n: number) => n + 1);
        void notificationAppend(
          "task_update",
          "后台任务状态变化",
          undefined,
          undefined,
          "info",
        );
      },
      onQuestion: (q: unknown) => {
        // The question UI is driven by useQuestionStore.request below; the
        // raw console.log previously printed dozens of full payload objects
        // per turn with no signal.
        useQuestionStore.getState().request(q as unknown as QuestionRequest);
      },
      onAgentDied: (payload: { reason: string }) => {
        handleAgentDiedRef.current(payload);
      },
      onSubagent: (e: unknown) => {
        // Subagent live events can fire 50+/sec — log only the first
        // occurrence per sessionId so the console stays readable. Real
        // diagnostics live in useSubagentStore.applyEvent below.
        useSubagentStore.getState().applyEvent(e as SubagentLiveEvent);
      },
      onTurnError: (e: { traceId?: string; sessionId: string; kind: string; detail?: string }) => {
        const log = e.traceId ? withTrace(appLogger, e.traceId) : appLogger;
        log.warn("pi://turn-error", { msg: "pi.turn-error.received", traceId: e.traceId, sessionId: e.sessionId, kind: e.kind });
        const currentSessionId = useSessionStore.getState().sessionId;
        if (currentSessionId && e.sessionId && e.sessionId !== currentSessionId) return;
        const msg =
          e.kind === "rate_limit"
            ? "⚠️ API 速率限制已触发（执行工具期间）。请等待 1-2 分钟后重试，或缩短对话上下文（新建会话）。"
            : e.detail
              ? `⚠️ 本轮执行出错：${e.detail}`
              : "⚠️ 本轮执行出错，请重试。";
        useSessionStore.getState().setError(msg);
        reportEvent("turn_error", "error", { sessionId: e.sessionId, kind: e.kind });
        // Force-finalise the in-flight assistant bubble — without this the
        // LoadingRow spins forever after a fatal turn error (the user
        // reported a "你是谁" message stuck for 8h+ because the backend
        // never sent a matching pi://complete). See abandon-stream.ts.
        abandonInFlightStream({
          sessionId: e.sessionId,
          reason: `turn-error: ${e.kind ?? "error"}`,
        });
      },
      onExtensionUi: (event: { sessionId?: string; method: string; key?: string; text?: string; statusKey?: string; widgetKey?: string; widgetLines?: string[]; widgetPlacement?: string; content?: string[]; statusText?: string; message?: string; visible?: boolean; options?: unknown; label?: string; expanded?: boolean; title?: string; theme?: string; value?: string }) => {
        const sid = event.sessionId ?? useSessionStore.getState().sessionId;
        if (event.sessionId && event.sessionId !== useSessionStore.getState().sessionId) return;
        if (event.method === "setEditorText") {
          const text = event.text ?? "";
          if (sid) setExtensionTextBySession((prev: Record<string, string>) => ({ ...prev, [sid]: text }));
          setExtensionText(text);
          setExtensionTextNonce((nonce: number) => nonce + 1);
        } else if (event.method === "pasteToEditor") {
          // Read the latest per-session text via the ref so we don't
          // capture a stale closure (App.tsx previously had a latent
          // bug where this branch could only ever see the empty
          // initial map).
          const text = event.value ?? `${extensionTextBySessionRef.current[sid ?? ""] ?? ""}${event.text ?? ""}`;
          if (sid) setExtensionTextBySession((prev: Record<string, string>) => ({ ...prev, [sid]: text }));
          setExtensionText(text);
          setExtensionTextNonce((nonce: number) => nonce + 1);
        } else if (event.method === "notify" && event.message) {
          setToastRef.current(event.message);
        } else if (sid) {
          setExtensionUiBySession((prev: Record<string, ExtensionUiBySessionValue>) => {
            const current = prev[sid] ?? { statuses: {}, widgets: {} };
            const next: ExtensionUiBySessionValue = { ...current };
            if (event.method === "setStatus" && event.key) {
              next.statuses = { ...current.statuses };
              if (event.text) next.statuses[event.key] = event.text;
              else delete next.statuses[event.key];
            } else if (event.method === "setWidget" && event.key) {
              next.widgets = { ...current.widgets };
              if (event.content?.length) next.widgets[event.key] = event.content;
              else delete next.widgets[event.key];
            } else if (event.method === "setWorkingMessage") next.workingMessage = event.message;
            else if (event.method === "setWorkingVisible") next.workingVisible = event.visible;
            else if (event.method === "setWorkingIndicator") next.workingIndicator = event.options;
            else if (event.method === "setHiddenThinkingLabel") next.hiddenThinkingLabel = event.label;
            else if (event.method === "setToolsExpanded") next.toolsExpanded = event.expanded;
            else if (event.method === "setTitle" && event.title) document.title = event.title;
            else if (event.method === "setTheme" && (event.theme === "light" || event.theme === "dark")) setTheme(event.theme as "light" | "dark");
            return { ...prev, [sid]: next };
          });
        }
      },
      onPluginEvent: (event: { type: string }) => {
        if (event.type === "workspace/changed") {
          void piListWorkspaceRegistry().then((registry) => {
            useSessionsStore.getState().setWorkspaces(registry.items);
            setWorkspaces(registry.items);
          }).catch(() => { /* non-fatal refresh */ });
        }
      },
    } as Parameters<typeof subscribePiEvents>[0];
  });

  const subscribeOnce = useCallback(async (): Promise<boolean> => {
    try {
      const handlers = buildHandlersRef.current();
      if (!handlers) return false;
      const unlisten = await subscribePiEvents(handlers);
      piUnlistenRef.current = () => {
        try { unlisten(); } catch { /* noop */ }
        piUnlistenRef.current = null;
      };
      // Successful subscribe is a normal lifecycle event — no need to spam
      // the log every time the renderer re-mounts (HMR + initial boot +
      // agent-died recovery all call subscribePiEvents).
      return true;
    } catch (err) {
      if (isElectronBridgeUnavailable(err)) {
        notifyBridgeUnavailable();
        appLogger.warn("bridge.subscribe.failed", { msg: "bridge.subscribe.failed", reason: (err as { reason?: string }).reason ?? "unknown" });
        return false;
      }
      throw err;
    }
  }, [notifyBridgeUnavailable]);

  useEffect(() => {
    if (updateCoalescerRef.current === null) {
      updateCoalescerRef.current = createUpdateCoalescer((batch) => {
        // **Re-read the store on every iteration, do NOT capture once.**
        // `store.streamingMessageId` is the snapshot taken at the start of
        // the batch and does not see the mutation that `beginStreamingMessage`
        // performs. If the batch contains multiple text chunks, the stale
        // snapshot makes every iteration see `streamingMessageId === null`
        // and triggers a fresh `beginStreamingMessage()` call per chunk —
        // which `discardStreamingBuffer()`s the pending text and orphans
        // empty assistant messages. The user-visible symptom is truncated
        // responses ("no data returned") for any pi turn that flushes more
        // than one text chunk per coalescer rAF.
        for (const u of batch) {
          const store = useSessionStore.getState();
          const sid = (u as { __sessionId?: string }).__sessionId ?? store.sessionId;
          if (sid !== store.sessionId) {
            // This is the one place a fully-successful backend turn can go
            // silently missing from the transcript, so make it observable
            // rather than a bare `continue`. Enable with
            // `localStorage.openbuddy.debug.stream = "1"`.
            if (STREAM_DEBUG) {
              console.log("[OpenBuddy] DROP update (session mismatch):", {
                type: (u as { type?: string }).type,
                eventSessionId: sid,
                storeSessionId: store.sessionId,
                streamingMessageId: store.streamingMessageId,
              });
            }
            continue;
          }
          if (STREAM_DEBUG) {
            console.log("[OpenBuddy] APPLY update:", {
              type: (u as { type?: string }).type,
              storeSessionId: store.sessionId,
              streamingMessageId: store.streamingMessageId,
            });
          }
          const t = (u as { type?: string }).type;
          switch (t) {
            case "agent_message_chunk": {
              const content = (u as { content?: Array<{ type?: string; text?: string; id?: string; contentIndex?: number; content?: string }> }).content ?? [];
              for (const part of content) {
                // Phase R3.0 (pi-web-alignment) — the new wire shape uses
                // `text_delta` for streaming deltas, `text_start` / `text_end`
                // for block boundaries. The legacy `{ type: "text" }` shape is
                // still accepted for older bridges.
                //
                // Accepting both UNCONDITIONALLY double-appends. That used to
                // happen on every live turn: a coalescer in `ipc/index.ts`
                // re-emitted each delta as `{ type: "text" }` alongside this
                // bridge's `{ type: "text_delta" }`, rendering "DIDIAG-OKAG-OK".
                // That duplicate emitter is gone (see the comment above
                // `agentHost.onEvent` in `electron/main/ipc/index.ts`), so live
                // streaming now produces `text_delta` only.
                //
                // This lock stays because the shapes are still not exclusive:
                // history replay in `host-modules/session-store.ts:136,149,181`
                // legitimately emits whole messages as `{ type: "text" }`. The
                // lock latches onto whichever shape the turn produces first, so
                // a live `text_delta` stream and a `text` replay each append
                // exactly once, and a future bridge that regresses to double
                // emission cannot corrupt the transcript.
                const partType = part.type;
                if ((partType === "text_delta" || partType === "text") && part.text
                  && acceptTextShape(textShapeRef, partType)) {
                  if (!store.streamingMessageId) store.beginStreamingMessage();
                  // Phase R3.0 — any streaming activity resets the 15s
                  // watchdog so the LoadingRow can't outlive a stalled
                  // upstream.
                  resetStreamingWatchdog();
                  store.appendStreamingDelta(part.text);
                }
                // text_end / text_start carry no incremental payload here —
                // block-id bookkeeping lives in streaming-metrics.ts which
                // reads from the store independently.
              }
              break;
            }
            case "agent_thought_chunk": {
              const content = (u as { content?: Array<{ type?: string; text?: string; id?: string; contentIndex?: number; deferred?: boolean }> }).content ?? [];
              for (const part of content) {
                // Same dual-shape hazard as `agent_message_chunk` above:
                // `thinking_delta` is the new shape, `text` the legacy one,
                // and a bridge emitting both would double the thought text.
                const partType = part.type;
                if ((partType === "thinking_delta" || partType === "text") && part.text
                  && acceptTextShape(thoughtShapeRef, partType)) {
                  if (!store.streamingMessageId) store.beginStreamingMessage();
                  resetStreamingWatchdog();
                  // Reasoning goes into a `thought` part, not the answer body.
                  // This used to call `appendStreamingDelta(part.text)`, whose
                  // default kind is "text", so a reasoning model's chain of
                  // thought was concatenated straight into the assistant's
                  // visible answer. `MessageItem` already renders `thought`
                  // parts as a collapsible 深度思考 block — the data just never
                  // reached it during streaming.
                  store.appendStreamingDelta(part.text, "thought");
                }
                // thinking_end with deferred:true is consumed by MessageItem
                // (lazy-load on expand). thinking_start is lifecycle-only.
              }
              break;
            }
            case "usage_update": {
              // Phase R3.0 — surface usage stats to the renderer so the
              // context-usage pill + cost tracker update without waiting for
              // turn_end. Errors attached to a usage_update should also
              // force-finalize the streaming message so the LoadingRow doesn't
              // spin forever (mirrors the abandon-stream.ts flow).
              const usagePayload = u as {
                usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
                errorMessage?: string;
                reason?: string;
              };
              if (usagePayload.errorMessage) {
                store.setError(`⚠️ ${usagePayload.errorMessage}`);
                useSessionStore.getState().abandonStreamingMessage(`usage-error: ${usagePayload.errorMessage}`);
              }
              // Phase 8.2-track: usage payload is intentionally NOT persisted
              // to the store — the canonical usage lives in `useSessionUsage`
              // which reads via `agent:usage` IPC. Hooking it in here would
              // duplicate the source-of-truth; see session-store.ts comments.
              break;
            }
            case "tool_call": {
              const tc = u as unknown as {
                toolCallId: string;
                title: string;
                kind: string;
                status: "in_progress" | "completed" | "failed";
                content: unknown;
                rawInput: unknown;
              };
              // Phase R3.0 — capture wall-clock start time so ToolCallCard
              // can render "完成 1.2s" / "运行中 5s" inline. The card itself
              // does not depend on this field; consumers that don't read
              // it (e.g. tests) are unaffected.
              const startedAt = Date.now();
              // Re-read so we see the latest streamingMessageId set by the
              // most recent `beginStreamingMessage()`.
              const streamingId = useSessionStore.getState().streamingMessageId;
              if (streamingId) {
                useSessionStore.setState((s) => ({
                  messages: s.messages.map((m) =>
                    m.id === streamingId
                      ? { ...m, parts: [...m.parts, { kind: "tool_call", toolCall: { toolCallId: tc.toolCallId, title: tc.title, kind: tc.kind, status: tc.status, startedAt, content: Array.isArray(tc.content) ? (tc.content as never) : [], ...(tc.rawInput != null ? { rawInput: tc.rawInput } : {}) } } ] }
                      : m,
                  ),
                }));
              } else {
                store.beginStreamingMessage();
                useSessionStore.setState((s) => ({
                  messages: s.messages.map((m) =>
                    m.id === s.streamingMessageId
                      ? { ...m, parts: [...m.parts, { kind: "tool_call", toolCall: { toolCallId: tc.toolCallId, title: tc.title, kind: tc.kind, status: tc.status, startedAt, content: Array.isArray(tc.content) ? (tc.content as never) : [], ...(tc.rawInput != null ? { rawInput: tc.rawInput } : {}) } } ] }
                      : m,
                  ),
                }));
              }
              break;
            }
            case "tool_call_update": {
              const upd = u as {
                toolCallId: string;
                update?: Record<string, unknown>;
                status?: "in_progress" | "completed" | "failed";
                content?: unknown;
              };
              const toolCallId = upd.toolCallId;
              const status = upd.status;
              const content = upd.content;
              const partial = Boolean(upd.update?.partial);
              const partialResult = upd.update?.partialResult;
              useSessionStore.setState((s) => ({
                messages: s.messages.map((m) => {
                  const idx = m.parts.findIndex((p) => p.kind === "tool_call" && p.toolCall.toolCallId === toolCallId);
                  if (idx === -1) return m;
                  const parts = [...m.parts];
                  const part = parts[idx];
                  if (part.kind !== "tool_call") return m;
                  const toolCall = part.toolCall as typeof part.toolCall & { partial?: boolean; partialResult?: unknown };
                  // Phase R3.0 — freeze the wall clock the first time a tool
                  // leaves `in_progress`. Without this the card computes its
                  // duration against `Date.now()` forever, so a finished tool
                  // shows "time since it started" rather than how long it
                  // actually took, and the number jumps on every later
                  // re-render. Only the first terminal status wins so a
                  // duplicate `completed` event can't extend the duration.
                  const reachedTerminal =
                    (status === "completed" || status === "failed") &&
                    toolCall.completedAt === undefined;
                  parts[idx] = {
                    kind: "tool_call",
                    toolCall: {
                      ...toolCall,
                      ...(status ? { status } : {}),
                      ...(reachedTerminal ? { completedAt: Date.now() } : {}),
                      ...(Array.isArray(content) ? { content: content as never } : {}),
                      ...(partial ? { partial: true, partialResult } : {}),
                    },
                  };
                  return { ...m, parts };
                }),
              }));
              break;
            }
            case "plan": {
              const planUpdate = u as { plan?: unknown };
              const nextPlan = (planUpdate?.plan ?? null) as never;
              store.setPlan(nextPlan);
              if (nextPlan && (nextPlan as { entries?: unknown[] }).entries && (nextPlan as { entries: unknown[] }).entries.length > 0 && !store.planMode) {
                store.setPlanMode(true);
              }
              break;
            }
          }
        }
      });
    }

    void (async () => {
      await subscribeOnce();
    })();

    return () => {
      // Phase R3.0 (pi-web-alignment) — BUG #4 root-cause fix.
      //
      // On unmount, if the current session is still streaming AND the turn
      // did not finish naturally (abortedRef.current === false), fire an
      // `agent:abort` IPC to free backend resources. The abortedRef
      // dedupes against natural completion (which sets it to true in
      // `onComplete` above). Without this guard the user could navigate
      // away from a long-running turn and Pi would keep burning tokens
      // until the next session_event arrived — a documented user-reported
      // regression ("你是谁" message stuck for 8h+).
      const store = useSessionStore.getState();
      if (store.streaming && !abortedRef.current) {
        const sid = store.sessionId;
        if (sid && !sid.startsWith("__pending_")) {
          try {
            void piCancel(sid);
          } catch {
            /* best-effort; ignore cancel errors on unmount */
          }
        }
      }
      // Clear the 15s watchdog regardless — the timer is bound to this
      // hook instance and there's nothing to abandon after unmount.
      clearStreamingWatchdog();
      try { piUnlistenRef.current?.(); } catch { /* noop */ }
      piUnlistenRef.current = null;
      updateCoalescerRef.current?.dispose();
      updateCoalescerRef.current = null;
    };
    // Empty deps — the hook owns the lifecycle. Subscribing once on
    // mount + the resubscribe path cover all transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resubscribe = useCallback(async (): Promise<void> => {
    // Dispose the previous unlisten BEFORE we attempt a new subscription,
    // so a failed re-subscribe can't strand the old listener (which
    // would leak on every agent-died cycle).
    try { piUnlistenRef.current?.(); } catch { /* noop */ }
    piUnlistenRef.current = null;
    try {
      const handlers = buildHandlersRef.current();
      if (!handlers) return;
      const unlisten = await subscribePiEvents(handlers);
      piUnlistenRef.current = () => {
        try { unlisten(); } catch { /* noop */ }
        piUnlistenRef.current = null;
      };
      // Successful resubscribe is also routine — only the catch path needs
      // to log so HMR / dev-recovery chatter doesn't drown the console.
    } catch (e) {
      appLogger.warn("pi.resubscribe.failed", { msg: "pi.resubscribe.failed", err: String(e) });
    }
  }, []);

  // `cwdRef` is closed over by `onComplete` (for `currentCwd` in usage
  // metrics). Touch it here so React's lint doesn't complain when the
  // caller updates it; the handler closure already picks up the latest
  // value via the ref indirection inside App.tsx.
  void cwdRef;

  return { resubscribe };
}