import { useEffect, useMemo, useRef, useState, useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Bot, FileDiff, FolderTree, Globe, ListTodo, Package, Search, Users } from "lucide-react";
import { shallow } from "zustand/shallow";
import { PauseIcon } from "@openbuddy/ui-primitives/icons";
import { useSessionStore, type ToolCallView } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { createMarkdownHostConfig } from "@/lib/markdown/markdown-host";
import { piListSessions, piSetThinkingLevel, rewindExecute, rewindPoints } from "@/lib/agent/pi-client";
import {
  collectSessionArtifacts,
  findToolCall,
  type SessionArtifact,
} from "@/lib/agent/session-artifacts";
import { MessageItem } from "./MessageItem";
import { Composer } from "./Composer";
import { PlanPanel } from "@openbuddy/ui-automation";
import { RewindBar } from "./RewindBar";
import { PermissionInlineCard } from "@openbuddy/ui-dialogs";
import { QuestionInlineCard } from "./QuestionInlineCard";
import { ToolSidePanel, type ToolSidePanelMode } from "./ToolSidePanel";
import { FindBar, isFindHit } from "./FindBar";
import { FileChangesPanel } from "./FileChangesPanel";
import { SubagentPanel } from "@openbuddy/ui-collaboration";
import { TeamStatusView } from "@openbuddy/ui-workbench";
import { ShareMenu } from "@openbuddy/ui-workbench";
import { QueuePanel } from "@openbuddy/ui-automation";
import { PlanModeBanner } from "@openbuddy/ui-shell";
import { useMessageQueueStore } from "@/stores/message-queue-store";
import {
  VirtualizedMessageList,
  shouldUseVirtualList,
} from "./VirtualizedMessageList";
import { buildTimeline, type TimelineNode } from "@/lib/ui/timeline-utils";
import { formatPiError } from "@/lib/platform/error-format";
import { useSubagentStore } from "@/stores/subagent-store";
import {
  requestYield,
  confirmYielded,
  clearYield,
  isYielded,
  createYieldStore,
} from "@/lib/ui/yield-state";
import type { ModelOption, ThinkingLevel } from "@openbuddy/ui-workbench";
import type { HomeModeId } from "@openbuddy/ui-shared";
import type { AgentEntry } from "@openbuddy/shared-types";
import type { WorkspaceInfo } from "@/lib/agent/pi-client";
import { StatusIndicator } from "@/components/StatusIndicator";
import { getRendererPluginRuntime } from "@/lib/runtime/renderer-plugin-runtime";
import type { DeepSeekSessionListSnapshot } from "@openbuddy/renderer-host";

const EMPTY_RENDERER_SESSION_SNAPSHOT: DeepSeekSessionListSnapshot = {
  items: [],
  byId: {},
  current: undefined,
  state: "idle",
  phase: "pending",
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
  subagentBreadcrumb: [],
  error: undefined,
};

/** Center chat column: scrollable message list + composer pinned at bottom. */

/** Format a millisecond duration as WorkBuddy-style "Xs / Xm Ys". */
function formatElapsed(ms: number): string {
  if (ms < 1000) return "已完成";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `已完成 ${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `已完成 ${minutes}m ${seconds}s`;
}
export function ChatView({
  onSend,
  onSendContent,
  onCancel,
  modelId,
  models,
  onModelChange,
  cwd,
  workspaces,
  onSelectWorkspace,
  onRewound,
  onForked,
  onOpenSession,
  onToast,
  onSelectMode,
  onSelectExpert,
  onNavigateConnectors,
  extensionText,
  extensionTextNonce,
  extensionUi,
}: {
  onSend: (text: string) => void;
  /** R1 — content-based send (text + image parts). When provided, the
   *  Composer uses it instead of onSend(text) whenever the user has image
   *  attachments. Falls back to onSend(text) for text-only input. */
  onSendContent?: (content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }>) => void | Promise<void>;
  onCancel: () => void;
  modelId?: string;
  models?: ModelOption[];
  onModelChange?: (id: string) => void;
  cwd?: string;
  workspaces?: WorkspaceInfo[];
  onSelectWorkspace?: (cwd: string) => void;
  /** Rewind rewrote backend history — reload the transcript. */
  onRewound?: () => void;
  /** Fork created a new session id — navigate to it. */
  onForked?: (newSessionId: string) => void;
  /** Focus a Pi-backed session selected from the Harness subagent catalog. */
  onOpenSession?: (sessionId: string, cwd?: string) => void | Promise<void>;
  /** Surface transient feedback from the rewind/fork toolbar. */
  onToast?: (msg: string) => void;
  onSelectMode?: (modeId: HomeModeId) => void;
  onSelectExpert?: (agent: AgentEntry) => void;
  onNavigateConnectors?: () => void;
  extensionText?: string;
  extensionTextNonce?: number;
  extensionUi?: {
    statuses: Record<string, string>;
    widgets: Record<string, string[]>;
    workingMessage?: string;
    workingVisible?: boolean;
    workingIndicator?: unknown;
    hiddenThinkingLabel?: string;
    toolsExpanded?: boolean;
  };
}) {
  // P0-07: Custom equality — only re-render ChatView when the message list
  // *structure* changes (length or last message id). Streaming deltas
  // mutate the last message's `parts` reference but keep length+last-id
  // stable; the streaming MessageItem re-renders on its own via memo.
  // Cuts ChatView re-renders from ~60/s (one per coalesced flush) to
  // ~1/turn-start during streaming.
  // The equality below compares the last entry by REFERENCE, not by `id`.
  //
  // Comparing by `id` looks like a cheap win but silently breaks live
  // streaming: `mergeStreamingDelta` appends text to the *same* message id
  // without changing the array length, so an id-based compare reports
  // "unchanged" for every delta and Zustand never notifies this component.
  // The old comment here claimed the streaming `MessageItem` would
  // "re-render on its own via memo" — it can't. `MessageItem` receives its
  // message as a prop and memoizes on `prev.message === next.message`
  // (MessageItem.tsx:335), so a stale array from this selector pins the
  // whole transcript. A single-assistant-message turn then renders as an
  // empty bubble with the LoadingRow spinning forever.
  //
  // Reference-comparing the tail keeps the useful part of the optimization
  // (unrelated store writes still don't re-render the transcript) while
  // letting content mutations through. The per-delta render cost stays
  // bounded because `appendStreamingDelta` already coalesces deltas to one
  // store write per frame, and `MessageItem`'s memo still keeps the other
  // N-1 rows from re-rendering.
  const messages = useSessionStore(
    (s) => s.messages,
    (a, b) =>
      a === b ||
      (a.length === b.length &&
        (a.length === 0 || a[a.length - 1] === b[b.length - 1])),
  );
  const streaming = useSessionStore((s) => s.streaming);
  const streamingMessageId = useSessionStore((s) => s.streamingMessageId);
  const error = useSessionStore((s) => s.error);
  const plan = useSessionStore((s) => s.plan);
  const sessionId = useSessionStore((s) => s.sessionId);
  // R — chat status timing (mirror WorkBuddy "已完成 Xs" header chip).
  // Captures the wall-clock span of the most recent assistant turn so the
  // status pill can render "已完成 1s / 12s / 1m 5s" alongside the boolean
  // 完成态. Reset whenever a new session is loaded or a fresh prompt is sent.
  const [lastTurnMs, setLastTurnMs] = useState<number | null>(null);
  const prevStreamingRef = useRef<boolean>(false);
  const turnStartRef = useRef<number | null>(null);
  // R6.7 — cumulative session wall-clock elapsed. Ticks every second once
  // the session has at least one message so the status pill can show a
  // `· 共 Xm Ys` suffix alongside the per-turn `已完成 Xs` chip.
  const [sessionElapsedMs, setSessionElapsedMs] = useState<number | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (streaming && !prevStreamingRef.current) {
      turnStartRef.current = Date.now();
    } else if (!streaming && prevStreamingRef.current && turnStartRef.current !== null) {
      setLastTurnMs(Date.now() - turnStartRef.current);
      turnStartRef.current = null;
    }
    prevStreamingRef.current = streaming;
  }, [streaming]);
  // Tick the cumulative timer once per second while the session has any
  // messages. Cheap (single setState/interval, no per-frame work) and
  // lets the pill render the live wall-clock duration without forcing a
  // parent-level re-render.
  useEffect(() => {
    if (messages.length === 0 || !sessionId) {
      sessionStartedAtRef.current = null;
      setSessionElapsedMs(null);
      return;
    }
    if (sessionStartedAtRef.current === null) {
      sessionStartedAtRef.current = Date.now();
    }
    const tick = () => {
      const startedAt = sessionStartedAtRef.current;
      if (startedAt !== null) setSessionElapsedMs(Date.now() - startedAt);
    };
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [messages.length, sessionId]);
  useEffect(() => {
    setLastTurnMs(null);
    turnStartRef.current = null;
    prevStreamingRef.current = false;
    sessionStartedAtRef.current = null;
    setSessionElapsedMs(null);
  }, [sessionId]);
  // R1 — plan-mode toggle (Codex/Claude Code-style persistent plan banner).
  // Independent from panelMode because the banner is always-on when active
  // (we don't want it to disappear behind a side panel toggle).
  const [planMode, setPlanMode] = useState(false);
  // Expose setter so App.tsx (or any sibling) can flip plan mode externally.
  useEffect(() => {
    const w = window as Window & { __openbuddySetPlanMode?: (v: boolean) => void };
    w.__openbuddySetPlanMode = setPlanMode;
    return () => {
      delete w.__openbuddySetPlanMode;
    };
  }, []);
  const [piSubagentMode, setPiSubagentMode] = useState<"one-shot" | "continuable" | undefined>();
  const rendererRuntime = getRendererPluginRuntime();
  const rendererSessionSnapshot = useSyncExternalStore(
    (listener) => {
      const service = rendererRuntime.context.get("sessions") as {
        list?: { subscribe?: (callback: () => void) => () => void };
      } | undefined;
      return service?.list?.subscribe?.(listener) ?? (() => undefined);
    },
    () => {
      const service = rendererRuntime.context.get("sessions") as {
        list?: { getSnapshot?: () => DeepSeekSessionListSnapshot };
      } | undefined;
      return service?.list?.getSnapshot?.() ?? EMPTY_RENDERER_SESSION_SNAPSHOT;
    },
    () => EMPTY_RENDERER_SESSION_SNAPSHOT,
  );
  const sessionRecord = sessionId ? rendererSessionSnapshot.byId[sessionId] : undefined;
  useEffect(() => {
    // Reset synchronously when the focused session changes so we never
    // carry the previous session's subagentMode into the new one (which
    // would mark a freshly-forked session as a read-only subagent for the
    // brief window before piListSessions resolves and freeze the input).
    setPiSubagentMode(undefined);
    if (!sessionId || sessionId.startsWith("__pending_")) {
      // Skip the IPC during the optimistic-placeholder window — the
      // pending id isn't known to the backend yet, and the real id will
      // arrive within a few frames. Avoids a wasted piListSessions round
      // trip on every new session.
      return;
    }
    let disposed = false;
    void piListSessions(cwd ?? "").then((items) => {
      if (!disposed) setPiSubagentMode(items.find((item) => item.sessionId === sessionId)?.subagentMode);
    }).catch(() => {
      if (!disposed) setPiSubagentMode(undefined);
    });
    return () => { disposed = true; };
  }, [cwd, sessionId]);
  const oneShotCatalogEntry = sessionId
    ? Object.values(rendererSessionSnapshot.subagentsByParent).some((catalog) =>
        catalog.entries.some((entry) => entry.kind === "child" && entry.id === sessionId && entry.mode === "one-shot"),
      )
    : false;
  const readOnlySubagent = piSubagentMode === "one-shot"
    || sessionRecord?.subagentMode === "one-shot"
    || oneShotCatalogEntry
    || (rendererSessionSnapshot.currentAddress?.childSessionId === sessionId
      && rendererSessionSnapshot.currentAddress.mode === "one-shot");
  // 会话内查找(对齐 WorkBuddy chat-search)。
  const [findOpen, setFindOpen] = useState(false);
  const [findHits, setFindHits] = useState<string[]>([]);
  const [findCurrent, setFindCurrent] = useState<string | null>(null);
  // 文件变更聚合面板(对齐 WorkBuddy file-changes-panel)。
  const [fileChangesOpen, setFileChangesOpen] = useState(false);
  // 子代理运行时面板(对齐 WorkBuddy team-runtime)。
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  // pause/yield(对齐 WorkBuddy session:requestYield):软暂停,保留会话上下文。
  const [yieldStore, setYieldStore] = useState<Record<string, ReturnType<typeof createYieldStore>>["k"]>(() => createYieldStore());
  const yielded = sessionId ? isYielded(yieldStore, sessionId) : false;
  const handlePause = useCallback(() => {
    if (!sessionId || !streaming) return;
    setYieldStore((s) => requestYield(s, sessionId));
    // pi 无原生 yield,用 cancel 软停止(保留会话);yield 状态在 complete 后确认。
    onCancel();
  }, [sessionId, streaming, onCancel]);
  const handleResume = useCallback(() => {
    if (!sessionId) return;
    setYieldStore((s) => clearYield(s, sessionId));
    onToast?.("已恢复(可继续发送消息)");
  }, [sessionId, onToast]);
  /** 恢复并重新触发 agent:清除 yield 状态 + 发送「请继续」让 agent 接着生成。
   *  形成完整闭环(暂停 → 显式恢复并续跑),区别于仅清状态的「恢复」。 */
  const handleResumeAndContinue = useCallback(() => {
    if (!sessionId) return;
    setYieldStore((s) => clearYield(s, sessionId));
    onSend("请继续。");
    onToast?.("已恢复并继续生成");
  }, [sessionId, onSend, onToast]);

  // R6.5 — Scroll to bottom when the user clicks the floating jump button.
  // We force scroll, then mark pinnedRef=true so subsequent streaming
  // deltas continue to follow until the user scrolls up again.
  const handleJumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setUnreadCount(0);
  }, []);
  // 按会话持久化的输入草稿:切到本会话时回填,每次输入回写 store。
  // 选 setDraft 的稳定引用做回调,避免 sessionId 变化时让 Composer 收到新函数。
  const setDraft = useSessionsStore((s) => s.setDraft);
  const draft = useSessionsStore((s) =>
    sessionId ? s.drafts[sessionId] ?? "" : ""
  );
  // Read the expert name + avatar bound to the current session (for the composer badge).
  // Combined into ONE selector so the O(N) scan across `independent` + every
  // workspace cache runs at most once per store update, not twice (was costing
  // a `find` on every messages streaming delta since the store fires on each
  // chunk). Combined with `shallow` equality so the returned {name, avatar}
  // object doesn't trigger a re-render when nothing about THIS session's
  // expert changed (default Object.is would re-render on every store tick).
  const { activeExpertName, activeExpertAvatar } = useSessionsStore(
    (s) => {
      if (!sessionId) return { activeExpertName: undefined, activeExpertAvatar: undefined };
      const entry =
        s.independent.find((x) => x.sessionId === sessionId) ??
        Object.values(s.workspaceSessions).flat().find((x) => x.sessionId === sessionId);
      return {
        activeExpertName: entry?.expertName,
        activeExpertAvatar: entry?.expertAvatar,
      };
    },
    shallow,
  );
  const [planOpen, setPlanOpen] = useState(false);

  // ---- 消息"编辑重发":把消息文本回填到输入框 ----
  const [resendText, setResendText] = useState<string | undefined>(undefined);
  const [resendNonce, setResendNonce] = useState(0);
  const handleEditResend = useCallback((text: string) => {
    if (!text.trim()) return;
    setResendText(text);
    setResendNonce((n) => n + 1);
  }, []);

  // ---- 消息级"重试":回溯到最后一条用户 prompt 并重新发送（重新生成回复） ----
  const [retrying, setRetrying] = useState(false);
  // Read the current `messages` array through a ref so handleRetry's identity
  // stays stable across streaming deltas — otherwise every ChatView re-render
  // would invalidate the React.memo on MessageItem.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const handleRetry = useCallback(async () => {
    if (!sessionId || streaming || retrying || readOnlySubagent) return;
    // Find the last user message text via the ref to avoid re-creating
    // handleRetry on every delta.
    const snapshot = messagesRef.current;
    const lastUserMsg = [...snapshot].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      onToast?.("没有可重试的消息");
      return;
    }
    const userText = lastUserMsg.parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join("\n");
    if (!userText.trim()) return;

    setRetrying(true);
    try {
      const points = await rewindPoints(sessionId);
      if (points.length === 0) {
        onToast?.("没有可回退的点，无法重试");
        return;
      }
      const lastPoint = points.reduce((a, b) =>
        b.promptIndex > a.promptIndex ? b : a,
      );
      await rewindExecute(sessionId, lastPoint.promptIndex, "conversation", true);
      onRewound?.();
      onSend(userText);
    } catch (e) {
      onToast?.(`重试失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setRetrying(false);
    }
  }, [sessionId, streaming, retrying, readOnlySubagent, onSend, onRewound, onToast]);

  /** R6.6 — error-banner retry. Lighter-weight than handleRetry (no
   *  rewind): the error banner typically surfaces session-level failures
   *  (e.g. agent:init errors, IPC bridge drops) where a fresh send is the
   *  natural recovery action. Reuses messagesRef so it stays stable across
   *  streaming deltas. */
  const handleRetryLast = useCallback(() => {
    if (!sessionId || streaming) return;
    const snapshot = messagesRef.current;
    const lastUserMsg = [...snapshot].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      onToast?.("没有可重试的消息");
      return;
    }
    const userText = lastUserMsg.parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join("\n");
    if (!userText.trim()) return;
    // Clear the error so the banner does not linger over the new turn.
    useSessionStore.getState().setError(null);
    onSend(userText);
  }, [sessionId, streaming, onSend, onToast]);

  // ---- Phase 2/3: tool detail + artifacts side panel ----
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<ToolSidePanelMode>("tool");
  const [activeTool, setActiveTool] = useState<ToolCallView | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  // R2.5 — workspace switch loading flag. Drives the WorkspacePicker's
  // spinner overlay; non-null while a switch is in flight (preventing
  // double-clicks during the IPC round-trip).
  const [switchingWorkspace, setSwitchingWorkspace] = useState<string | null>(null);

  // Artifacts only depend on tool-call parts — text-only chunk deltas
  // (the bulk of streaming updates) shouldn't trigger a full rescan.
  // Fingerprint on (message count, last tool-call id + status) is a cheap
  // proxy: it changes iff a new tool call landed or one finished.
  const artifactFingerprint = useMemo(() => {
    let lastToolKey = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      for (let j = m.parts.length - 1; j >= 0; j--) {
        const p = m.parts[j];
        if (p.kind === "tool_call") {
          lastToolKey = `${m.parts.length}:${p.toolCall.toolCallId}:${p.toolCall.status}`;
          break;
        }
      }
      if (lastToolKey) break;
    }
    return `${messages.length}|${lastToolKey}`;
  }, [messages]);
  const artifacts = useMemo(() => collectSessionArtifacts(messages), [artifactFingerprint, messages]);

  // R0.4: Memoize the timeline build so it does not run on every render;
  // it only needs to re-run when the messages reference changes.
  const timeline = useMemo(() => buildTimeline(messages), [messages]);

  // R1.2: Virtualization is enabled when the user opts in via
  // `localStorage["openbuddy.virtual-list"] = "1"` OR the timeline has
  // ≥ VIRTUAL_THRESHOLD nodes. Off by default — the existing flat
  // render path is the default, so regression risk for the main user
  // is zero until the flag is enabled.
  const useVirtualList = useMemo(
    () => shouldUseVirtualList(timeline.length),
    [timeline.length],
  );

  // R1.2: Render a single timeline node — used by both the flat
  // timeline.map (default) and the VirtualizedMessageList (opt-in).
  // Defined later in the component (after markdownConfig / handlers)
  // so the JSX in this comment block doesn't shadow the actual
  // implementation. Kept as a forward reference for readability.

  // Keep active tool fresh when streaming updates status/content.
  useEffect(() => {
    if (!activeTool) return;
    const fresh = findToolCall(messages, activeTool.toolCallId);
    if (fresh && fresh !== activeTool) setActiveTool(fresh);
  }, [messages, activeTool]);

  // Close panel when switching sessions.
  useEffect(() => {
    setPanelOpen(false);
    setActiveTool(null);
    setPreviewPath(null);
  }, [sessionId]);

  // Auto-open subagent panel when a subagent starts running.
  const liveSubagentCount = useSubagentStore((s) =>
    sessionId ? s.getForSession(sessionId).filter((a) => a.status === "running").length : 0,
  );
  useEffect(() => {
    if (liveSubagentCount > 0) setSubagentsOpen(true);
  }, [liveSubagentCount]);

  const handleOpenTool = useCallback((tc: ToolCallView) => {
    setActiveTool(tc);
    setPreviewPath(null);
    setPanelMode("tool");
    setPanelOpen(true);
  }, []);

  const handleSelectArtifact = useCallback((a: SessionArtifact) => {
    setPreviewPath(a.path);
    setPanelMode("preview");
    setPanelOpen(true);
  }, []);

  const handleOpenArtifacts = useCallback(() => {
    setPanelMode("artifacts");
    setPanelOpen(true);
  }, []);

  // Stable wrapper around the imported findToolCall so ToolSidePanel's
  // memo comparator sees a stable identity. The body is recomputed each
  // call (so messages/activeTool changes are still reflected) but the
  // function reference itself only changes when sessionId flips.
  const findToolCallStable = useCallback(
    (id: string) => findToolCall(messages, id),
    [messages, sessionId],
  );

  // R1.3 — Stabilize the inline callbacks passed to Composer and
  // ToolSidePanel. Without these, every ChatView render produced fresh
  // closures, busting React.memo on the receiving components and
  // re-running the full Composer render (which is a 1000-line tree).
  const handleClosePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const handleComposerEnqueue = useCallback(
    (text: string) => {
      if (!sessionId) return;
      useMessageQueueStore.getState().enqueue(sessionId, text);
      onToast?.("已加入待发送队列");
    },
    [sessionId, onToast],
  );

  const handleComposerDraftChange = useCallback(
    (text: string) => {
      if (!sessionId) return;
      setDraft(sessionId, text);
    },
    [sessionId, setDraft],
  );

  const markdownConfig = useMemo(
    () =>
      createMarkdownHostConfig({
        cwd,
        sessionId,
        onToast,
      }),
    // `onToast` is intentionally excluded: App.tsx passes a fresh closure each
    // render. Including it would re-create `markdownConfig` (and every inner
    // MarkdownConfig field) on every ChatView render — which used to bust the
    // Markdown `components` memo and re-run the full remark/rehype/sanitize
    // pipeline on every streaming chunk. The Markdown layer now reads the
    // inner callbacks from a stable snapshot, so we can keep this cheap.
    [cwd, sessionId],
  );

  // R1.2: Render a single timeline node — used by both the flat
  // timeline.map (default) and the VirtualizedMessageList (opt-in).
  // Stable across renders as long as its captured deps are stable;
  // messages / streaming / findOpen are captured by reference.
  const renderTimelineNode = useCallback(
    ({ node, index: _index }: { node: TimelineNode; index: number }) => {
      if (node.kind === "date-divider") {
        return (
          <div key={node.key} className="timeline-divider timeline-divider--date">
            {node.label}
          </div>
        );
      }
      if (node.kind === "model-divider") {
        return (
          <div key={node.key} className="timeline-divider timeline-divider--model">
            {node.label}
          </div>
        );
      }
      const m = node.message;
      const idx = node.index;
      const isLastAssistant =
        m.role === "assistant" && idx === messages.length - 1;
      const findCls =
        findOpen && isFindHit(findHits, m.id)
          ? m.id === findCurrent
            ? " msg-wrap--find-current"
            : " msg-wrap--find-hit"
          : "";
      return (
        <div key={m.id} className={"msg-wrap" + findCls} data-msg-id={m.id}>
          <MessageItem
            message={m}
            streaming={streaming && m.id === streamingMessageId}
            markdownConfig={markdownConfig}
            cwd={cwd}
            sessionId={sessionId ?? undefined}
            onToast={onToast}
            onOpenTool={handleOpenTool}
            onEditResend={handleEditResend}
            onRetry={
              isLastAssistant && !streaming && m.complete ? handleRetry : undefined
            }
          />
        </div>
      );
    },
    [
      messages,
      streaming,
      streamingMessageId,
      markdownConfig,
      cwd,
      sessionId,
      onToast,
      handleOpenTool,
      handleEditResend,
      handleRetry,
      findOpen,
      findHits,
      findCurrent,
    ],
  );

  // R6.5 — Pin-aware auto-follow (DeepSeek ChatView pattern).
  //
  // Naive scroll-on-every-mutation forces the user back to the end even
  // when they have deliberately scrolled up to read prior context. We
  // instead track whether the user is "pinned to bottom" (within
  // PIN_THRESHOLD px of the bottom) and only auto-scroll when pinned.
  // When not pinned and new content arrives, surface a floating
  // "jump to bottom" button so the user can opt in without losing
  // their place.
  const PIN_THRESHOLD = 32; // px — roughly one line of body text
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const recomputePinned = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
      // Going back to bottom resets the unread badge.
      if (pinnedRef.current) setUnreadCount(0);
    };
    recomputePinned();
    el.addEventListener("scroll", recomputePinned, { passive: true });
    // ResizeObserver catches content reflow that didn't fire a scroll event
    // (text-append collapses, image load, virtualizer settle, etc.). Guarded
    // for jsdom (jsdom < 27 doesn't ship ResizeObserver) and any SSR shim.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => recomputePinned());
      ro.observe(el);
    }
    return () => {
      el.removeEventListener("scroll", recomputePinned);
      ro?.disconnect();
    };
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      // Track how many streaming deltas landed while the user was reading.
      // The badge shows the count and clears on next pin or on click.
      setUnreadCount((c) => c + 1);
    }
  }, [messages]);

  // 会话内查找:Ctrl/Cmd+F 打开;当前命中滚入视野。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        if (messages.length > 0) {
          e.preventDefault();
          setFindOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [messages.length]);
  useEffect(() => {
    if (!findCurrent) return;
    const node = scrollRef.current?.querySelector(
      `[data-msg-id="${findCurrent}"]`,
    );
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [findCurrent]);
  // 流式结束后确认 yield(yielding → yielded,显示「已暂停」横幅)。
  useEffect(() => {
    if (!sessionId) return;
    if (!streaming) {
      setYieldStore((s) => confirmYielded(s, sessionId));
    }
  }, [sessionId, streaming]);

  // 推理档位:并入模型选择器(WB "✓均衡" 标签)。会话切换时回默认档。
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  useEffect(() => {
    setThinkingLevel("medium");
  }, [sessionId]);
  const handleThinkingChange = useCallback(
    (next: ThinkingLevel) => {
      if (next === thinkingLevel) return;
      const prev = thinkingLevel;
      setThinkingLevel(next); // optimistic
      if (!sessionId) return;
      piSetThinkingLevel(sessionId, next).catch(() => {
        setThinkingLevel(prev);
        onToast?.("推理档位切换失败");
      });
    },
    [sessionId, thinkingLevel, onToast],
  );

  // WB 风格:工具按钮以图标 portal 进 main-topbar 右侧槽位,不再占正文一行。
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbarHost(document.getElementById("ob-topbar-tools"));
  }, []);

  const toolButtons = (
    <>
      {plan && plan.entries.length > 0 && (
        <ToolButton
          icon={<ListTodo size={15} strokeWidth={1.75} />}
          label={`执行计划 ${plan.entries.filter((e) => e.status === "completed").length}/${plan.entries.length}`}
          active={planOpen}
          onClick={() => setPlanOpen((v) => !v)}
        />
      )}
      {artifacts.length > 0 && (
        <ToolButton
          icon={<Package size={15} strokeWidth={1.75} />}
          label={`本会话产物 (${artifacts.length})`}
          active={panelOpen && panelMode === "artifacts"}
          onClick={() => {
            if (panelOpen && panelMode === "artifacts") setPanelOpen(false);
            else handleOpenArtifacts();
          }}
        />
      )}
      {messages.length > 0 && (
        <ToolButton
          icon={<Search size={15} strokeWidth={1.75} />}
          label="在当前对话中查找 (Ctrl/Cmd+F)"
          active={findOpen}
          onClick={() => setFindOpen((v) => !v)}
        />
      )}
      {messages.length > 0 && (
        <ToolButton
          icon={<FileDiff size={15} strokeWidth={1.75} />}
          label="本会话文件变更"
          active={fileChangesOpen}
          onClick={() => setFileChangesOpen((v) => !v)}
        />
      )}
      {messages.length > 0 && (
        <ToolButton
          icon={<Bot size={15} strokeWidth={1.75} />}
          label="子代理运行时"
          active={subagentsOpen}
          onClick={() => setSubagentsOpen((v) => !v)}
        />
      )}
      {messages.length > 0 && (
        <ToolButton
          icon={<Users size={15} strokeWidth={1.75} />}
          label="团队状态"
          active={teamsOpen}
          onClick={() => setTeamsOpen((v) => !v)}
        />
      )}
      {cwd && (
        <ToolButton
          icon={<FolderTree size={15} strokeWidth={1.75} />}
          label="工作区文件树"
          active={panelOpen && panelMode === "fileTree"}
          onClick={() => {
            if (panelOpen && panelMode === "fileTree") setPanelOpen(false);
            else {
              setPanelMode("fileTree");
              setPanelOpen(true);
            }
          }}
        />
      )}
      <ToolButton
        icon={<Globe size={15} strokeWidth={1.75} />}
        label="网页预览"
        active={panelOpen && panelMode === "browser"}
        onClick={() => {
          if (panelOpen && panelMode === "browser") setPanelOpen(false);
          else {
            setPanelMode("browser");
            setPanelOpen(true);
          }
        }}
      />
      {messages.length > 0 && <ShareMenu messages={messages} onDone={onToast} />}
    </>
  );

  return (
    <div className={"chatview" + (panelOpen ? " chatview--with-panel" : "")}>
      <div className="chatview__main">
        {extensionUi && Object.keys(extensionUi.widgets).length > 0 && (
          <div className="chatview__extension-widgets" aria-label="Pi 扩展组件">
            {Object.entries(extensionUi.widgets).map(([key, lines]) => (
              <div className="chatview__extension-widget" key={key}>
                {lines.map((line) => <div key={line}>{line}</div>)}
              </div>
            ))}
          </div>
        )}
        {extensionUi && Object.keys(extensionUi.statuses).length > 0 && (
          <div className="chatview__extension-status" aria-label="Pi 扩展状态">
            {Object.values(extensionUi.statuses).join(" · ")}
          </div>
        )}
        {extensionUi?.workingVisible && (
          <div className="chatview__extension-working" role="status" aria-label="Pi 扩展工作状态">
            <span className="chatview__extension-working-dot" aria-hidden="true" />
            <span>{extensionUi.workingMessage || extensionUi.hiddenThinkingLabel || "Pi 扩展正在工作"}</span>
            {extensionUi.toolsExpanded && <span className="chatview__extension-working-tools">工具已展开</span>}
          </div>
        )}
        {/* R4.2 — provider / connection / rate-limit indicator. Always
            mounted so screen-reader users get a live region even when
            no toasts are active. */}
        <StatusIndicator connection="unknown" />

        {error && (
          <div className="chatview__error-banner" role="alert">
            <span className="chatview__error-icon" aria-hidden="true">⚠</span>
            <span className="chatview__error-text" style={{ whiteSpace: "pre-wrap" }}>
              {formatPiError(error) ?? error}
            </span>
            {sessionId && !streaming && messagesRef.current.some((m) => m.role === "user") && (
              <button
                className="chatview__error-retry"
                onClick={handleRetryLast}
                aria-label="重试最后一条消息"
                title="重试最后一条消息"
                data-testid="chatview-error-retry"
              >
                ↻ 重试
              </button>
            )}
            <button
              className="chatview__error-close"
              onClick={() => useSessionStore.getState().setError(null)}
              aria-label="关闭错误提示"
              title="关闭"
            >
              ×
            </button>
          </div>
        )}
        {/* R1 — Plan mode persistent banner. Shows the current plan steps
            inline so the user can approve / reject without opening the
            side panel. */}
        {planMode && (
          <PlanModeBanner
            plan={plan}
            visible={planMode}
            onExit={() => {/* parent owns planMode toggle — wired in App.tsx */}}
            onToast={onToast}
          />
        )}
        {/* 会话工具按钮:WB 风格纯图标,portal 进顶栏右侧槽位(不占正文一行);
            顶栏未挂载时回退为正文内的图标行。 */}
        {topbarHost ? (
          createPortal(
            <div className="chatview__toolbar" role="toolbar" aria-label="会话工具">
              {toolButtons}
            </div>,
            topbarHost,
          )
        ) : (
          <div className="chatview__toolbar chatview__toolbar--fallback" role="toolbar" aria-label="会话工具">
            {toolButtons}
          </div>
        )}
        {planOpen && (
          <div className="chatview__plan-panel">
            <PlanPanel
              sessionId={sessionId ?? undefined}
              onSend={onSend}
              onToast={onToast}
            />
          </div>
        )}
        <FindBar
          messages={messages}
          open={findOpen}
          onClose={() => {
            setFindOpen(false);
            setFindHits([]);
            setFindCurrent(null);
          }}
          onHitsChange={setFindHits}
          onActiveChange={setFindCurrent}
        />
        <div className="chatview__scroll" ref={scrollRef}>
          <div className="chatview__inner">
            {messages.length > 0 && sessionRecord?.title && (
              <h1 className="chatview__title" title={sessionRecord.title}>
                {sessionRecord.title}
              </h1>
            )}
            {messages.length > 0 && (
              <div
                className={
                  "chatview__status" +
                  (streaming ? " chatview__status--streaming" : "")
                }
                role="status"
                aria-live="polite"
              >
                <span
                  className="chatview__status-dot"
                  aria-hidden="true"
                />
                <span className="chatview__status-text">
                  {streaming
                    ? "正在生成…"
                    : lastTurnMs !== null
                    ? formatElapsed(lastTurnMs)
                    : "已完成"}
                </span>
                {sessionElapsedMs !== null && sessionElapsedMs >= 30_000 && (
                  <span
                    className="chatview__status-total"
                    aria-label="会话累计耗时"
                    title="会话累计耗时"
                    data-testid="chatview-status-total"
                  >
                    · 共 {formatElapsed(sessionElapsedMs)}
                  </span>
                )}
              </div>
            )}
            {readOnlySubagent && (
              <div className="subagent-readonly-banner" role="status">
                单次子代理仅支持查看历史记录
              </div>
            )}
            {fileChangesOpen && (
              <FileChangesPanel messages={messages} />
            )}
            {subagentsOpen && (
              <SubagentPanel
                messages={messages}
                cwd={cwd}
                onOpenSession={onOpenSession}
              />
            )}
            {teamsOpen && (
              <TeamStatusView messages={messages} />
            )}
            {timeline.length === 0 ? (
              <div className="chatview__empty-state" role="status">
                <div className="chatview__empty-state-icon" aria-hidden="true">✨</div>
                <h2 className="chatview__empty-state-title">开始一段新的对话</h2>
                <p className="chatview__empty-state-subtitle">
                  OpenBuddy 帮你调度专家 / 技能 / 连接器,在下方输入框描述你的任务即可。
                </p>
                <p className="chatview__empty-state-hint">
                  按 <kbd>?</kbd> 查看全部快捷键,<kbd>/</kbd> 调用技能与指令,<kbd>@</kbd> 引用对话文件。
                </p>
                <ul className="chatview__empty-state-tags" aria-label="可用能力">
                  <li className="chatview__empty-state-tag">助理</li>
                  <li className="chatview__empty-state-tag">项目</li>
                  <li className="chatview__empty-state-tag">专家 / 技能 / 连接器</li>
                  <li className="chatview__empty-state-tag">自动化</li>
                  <li className="chatview__empty-state-tag">资料库</li>
                </ul>
              </div>
            ) : useVirtualList ? (
              <VirtualizedMessageList
                timeline={timeline}
                scrollRef={scrollRef as React.RefObject<HTMLElement>}
                renderItem={renderTimelineNode}
              />
            ) : (
              timeline.map((node, index) => renderTimelineNode({ node, index }))
            )}
          </div>
          {/* R6.5 — Floating "jump to bottom" button. Visible only when
              the user has scrolled away from the end and new content
              has arrived (unreadCount > 0). Clicking scrolls to bottom
              and resets pinnedRef via the scroll handler. */}
          {unreadCount > 0 && (
            <button
              type="button"
              className="chatview__jump-bottom"
              onClick={handleJumpToBottom}
              aria-label={`跳到末尾,有 ${unreadCount} 条新消息`}
              title="回到末尾"
            >
              <span aria-hidden="true">↓</span>
              <span className="chatview__jump-bottom-badge">{unreadCount}</span>
            </button>
          )}
        </div>
        {/* Pinned footer — composer + yield/permission cards always sit at
            the bottom of `chatview__main`, not at the bottom of the
            transcript. */}
        <div className="chatview__footer">
          {/* Inline permission / question cards: session-scoped, never block sidebar. */}
          <PermissionInlineCard sessionId={sessionId} />
          <QuestionInlineCard sessionId={sessionId} />
          {/* pause/yield:已暂停横幅 + 恢复按钮(对齐 WorkBuddy session:requestYield)。 */}
          {yielded && (
            <div className="yield-banner" role="status">
              <span>已暂停(会话上下文已保留)</span>
              <div className="yield-banner__actions">
                <button
                  type="button"
                  className="yield-banner__resume"
                  onClick={handleResume}
                  title="仅恢复,不触发新回复(可继续输入)"
                >
                  恢复
                </button>
                <button
                  type="button"
                  className="yield-banner__resume yield-banner__resume--primary"
                  onClick={handleResumeAndContinue}
                  title="恢复并发送「请继续」让 agent 接着生成"
                >
                  恢复并继续
                </button>
              </div>
            </div>
          )}
          {/* 流式时提供「暂停」按钮(软停止,区别于停止按钮的硬取消)。 */}
          {sessionId && streaming && !yielded && (
            <button
              type="button"
              className="chatview__pause-btn"
              onClick={handlePause}
              title="暂停生成(保留会话,可继续)"
            >
              <PauseIcon size="sm" style={{ verticalAlign: "text-bottom" }} /> 暂停
            </button>
          )}
          {/* Rewind / fork: 会话级工具，放在输入框正上方（不再漂浮到左上角挡标题栏）。 */}
          {sessionId && !streaming && !readOnlySubagent && (
            <RewindBar
              sessionId={sessionId}
              cwd={cwd}
              onRewound={onRewound}
              onForked={onForked}
              onToast={onToast}
            />
          )}
          {/* 消息队列(对齐 WorkBuddy message-queue):流式时可继续排队 prompt。
              非流式时面板为空(QueuePanel 内部 queue.length===0 直接 return null)。 */}
          {sessionId && !readOnlySubagent && (
            <QueuePanel sessionId={sessionId} onSendNow={(t) => onSend(t)} />
          )}
          <Composer
            streaming={streaming}
            disabled={readOnlySubagent}
            onSend={onSend}
            onSendContent={onSendContent}
            onEnqueue={sessionId ? handleComposerEnqueue : undefined}
            onCancel={onCancel}
            modelId={modelId}
            models={models}
            onModelChange={onModelChange}
            cwd={cwd}
            workspaces={workspaces}
            onSelectWorkspace={(next) => {
              // R2.5 — flip the loading flag while the parent is running
              // the workspace switch IPC. The flag is cleared whether the
              // switch succeeds or fails so a hung IPC doesn't wedge the UI.
              setSwitchingWorkspace(next);
              if (!onSelectWorkspace) return;
              Promise.resolve(onSelectWorkspace(next))
                .catch(() => { /* parent surfaces its own toast */ })
                .finally(() => setSwitchingWorkspace(null));
            }}
            workspaceLoading={switchingWorkspace !== null}
            showDisclaimer
            permissionInline
            thinkingLevel={thinkingLevel}
            onThinkingChange={handleThinkingChange}
            onToast={onToast}
            draft={draft}
            draftKey={sessionId ?? undefined}
            onDraftChange={sessionId ? handleComposerDraftChange : undefined}
            externalText={resendText}
            externalTextNonce={resendNonce}
            onSelectMode={onSelectMode}
            onSelectExpert={onSelectExpert}
            onNavigateConnectors={onNavigateConnectors}
            activeExpertName={activeExpertName}
            activeExpertAvatar={activeExpertAvatar}
            usageSessionId={sessionId ?? undefined}
            usageMsgCount={messages.length}
            extensionText={extensionText}
            extensionTextNonce={extensionTextNonce}
          />
        </div>
      </div>

      <ToolSidePanel
        open={panelOpen}
        mode={panelMode}
        toolCall={activeTool}
        artifacts={artifacts}
        previewPath={previewPath}
        cwd={cwd}
        messages={messages}
        sessionId={sessionId ?? undefined}
        onToast={onToast}
        onClose={handleClosePanel}
        onSelectTool={handleOpenTool}
        onSelectArtifact={handleSelectArtifact}
        onOpenArtifacts={handleOpenArtifacts}
        findToolCall={findToolCallStable}
      />
    </div>
  );
}

function ToolButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"chatview__tool-btn" + (active ? " chatview__tool-btn--active" : "")}
      aria-label={label}
      aria-pressed={active}
      data-tip={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
