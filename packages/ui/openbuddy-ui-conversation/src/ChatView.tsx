import { useEffect, useMemo, useRef, useState, useCallback, useSyncExternalStore } from "react";
// Phase A4 — pull each icon directly from its per-icon ESM module. The
// barrel re-exports ~1500 icons and the bundler would otherwise drag the
// whole tree through the entry chunk even with tree-shaking (lucide-react
// is a single-file barrel by default; only the per-icon paths tree-shake
// reliably with esbuild + Vite 5). The deep modules export the icon as
// their default binding — see `lucide-icons.d.ts`. `.mjs` extension is
// omitted because lucide-react's package.json `main` points at `.js` and
// esbuild/Vite resolve the deeper file by that side-effect anyway.
import { shallow } from "zustand/shallow";
import {
  ChatViewToolbar,
  defaultArtifactsButton,
  defaultBrowserButton,
  defaultFileChangesButton,
  defaultFileTreeButton,
  defaultFindButton,
  defaultPlanButton,
  defaultSubagentButton,
  defaultTeamStatusButton,
} from "./chatview/ChatViewToolbar";
import {
  ChatViewBannerStack,
  type ExtensionUi,
} from "./chatview/ChatViewBannerStack";
import { ChatViewScrollStage } from "./chatview/ChatViewScrollStage";
import { ChatViewFooter } from "./chatview/ChatViewFooter";
import { useChatViewPauseYield } from "./chatview/useChatViewPauseYield";
import { useChatViewStreaming } from "./chatview/useChatViewStreaming";
import { useChatViewRetry } from "./chatview/useChatViewRetry";
import { useChatViewRewind } from "./chatview/useChatViewRewind";
import { useChatViewTimeline } from "./chatview/useChatViewTimeline";
import { useChatViewRevision } from "./chatview/useChatViewRevision";
import { ChatViewEmptyState } from "./chatview/ChatViewEmptyState";
import {
  useChatViewGlobalShortcuts,
  useChatViewShortcuts,
} from "./chatview/useChatViewShortcuts";
import { useSessionStore, type ChatMessage, type ToolCallView } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { createMarkdownHostConfig } from "@/lib/markdown/markdown-host";
import { piListSessions, piSetThinkingLevel, sessionFork } from "@/lib/agent/pi-client";
import { confirm } from "@/lib/platform/electron-api";
import {
  collectSessionArtifacts,
  findToolCall,
  type SessionArtifact,
} from "@/lib/agent/session-artifacts";
import { MessageItem } from "./MessageItem";
import { Composer } from "./Composer";
import type { ComposerProps } from "./Composer";
import { ConversationBody } from "./conversation-slots";
import {
  ConversationViewOutlet,
  ConversationViewTabs,
  useConversationViews,
} from "./conversation-view";
import { PlanPanel } from "@openbuddy/ui-automation";
import { PermissionInlineCard } from "@openbuddy/ui-dialogs";
import { QuestionInlineCard } from "./QuestionInlineCard";
import { ToolSidePanel, type ToolSidePanelMode } from "./ToolSidePanel";
import { FindBar } from "./FindBar";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";
import { SubagentPanel } from "@openbuddy/ui-collaboration";
import { useMessageQueueStore } from "@/stores/message-queue-store";
import {
  VirtualizedMessageList,
  shouldUseVirtualList,
} from "./VirtualizedMessageList";
import type { TimelineNode } from "@/lib/ui/timeline-utils";
import { useSubagentStore } from "@/stores/subagent-store";
import { useQuestionStore } from "@/stores/question-store";
import { usePermissionStore } from "@/stores/permission-store";

import type { ModelOption, ThinkingLevel } from "@openbuddy/ui-workbench";
import type { AgentEntry } from "@openbuddy/shared-types";
import type { WorkspaceInfo } from "@/lib/agent/pi-client";
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
  onSendContent?: (
    content: Array<
      | { type: "text"; text: string }
      | { type: "image"; mediaType: string; data: string; name?: string }
      | { type: "file"; mediaType: string; data: string; name?: string }
    >,
  ) => void | Promise<void>;
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
  onSelectMode?: (modeId: string) => void;
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
  onOpenSettings?: () => void;
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
  // Plan5 Phase A.1 — turnStartRef 由 useChatViewStreaming 接管。
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
  // P0-4 — 会话视图切换。Plan5 A.1 refactor 之前 ChatView 已经持有这个状态 +
  // ConversationViewTabs 接线,后把 activeView 写死成 "live",导致
  // result/content 这两个新组件化视图变成死代码。这里补回去:0 插件时 views
  // 长度为 0、切换器不渲染,完全等价于原状 —— 行为契约与改造前逐字一致(分册 05 R5)。
  const [activeView, setActiveView] = useState<string>("live");
  const conversationViews = useConversationViews();


  // R92 — 子代理面板走 `placeholder.subagent` 槽,插件可整体替换。

  const [SubagentPanelImpl] = useSlotComponents("placeholder.subagent");

  const SubagentPanelResolved = (SubagentPanelImpl ?? SubagentPanel) as typeof SubagentPanel;
  const [teamsOpen, setTeamsOpen] = useState(false);
  // Plan5 Phase A.1 — pause/yield 抽到 useChatViewPauseYield hook。
  // 行为与改造前完全一致;既有 yield/Resume+Continue/toast 文案与调用顺序不变。
  const {
    yielded,
    handlePause,
    handleResume,
    handleResumeAndContinue,
  } = useChatViewPauseYield({
    sessionId,
    streaming,
    onCancel,
    onSend,
    onToast,
  });

  // Plan5 Phase A.1 — scrollRef 仍由 ChatView 持有(对外要挂到 <div>)。
  const scrollRef = useRef<HTMLDivElement>(null);
  // Plan5 Phase A.1 — Scroll / jump-to-bottom / unread-count 抽到 useChatViewStreaming。
  const {
    turnStartRef,
    unreadCount,
    setUnreadCount,
    pinnedRef,
    handleJumpToBottom,
  } = useChatViewStreaming({
    streaming,
    streamingMessageId,
    scrollRef,
    messages,
  });
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


  // ---- 消息级"重试":回溯到最后一条用户 prompt 并重新发送（重新生成回复） ----
  // Plan5 Phase A.1 — retry 抽到 useChatViewRetry hook(行为逐字等价)。
  const {
    retrying,
    handleRetry,
    handleRetryLast,
    handleRetryRef,
    messagesRef,
  } = useChatViewRetry({
    sessionId,
    streaming,
    readOnlySubagent,
    messages,
    onSend,
    onRewound,
    onToast,
  });

  // Plan5 — revision / inline-edit / quick-prompt handlers + composer
  // seed signals are owned by useChatViewRevision. ChatView only reads
  // the resulting callbacks and forwards them to MessageItem / Composer.
  const {
    resendText,
    resendNonce,
    setResendText,
    setResendNonce,
    setEditResendOriginId,
    handleStepRevision,
    handleEditResend,
    handleInlineResend,
    handleEditAssistantMessage,
    handleResendAfterAssistantEdit,
    handleQuickPrompt,
  } = useChatViewRevision({ handleRetryRef });

  // Plan5 B.10 — 消息级"从此重发":把 rewindPoints 拉一次并解析成
  // `messageId → promptIndex`,下发给 MessageItem 的 MessageRewindMenu。
  // 与 useChatViewRetry 共用同一套 rewind IPC 语义,只是目标从"最后一条"
  // 变成"用户点的那一条"。
  const {
    promptIndexByMessageId,
    handleRewindTo,
  } = useChatViewRewind({
    sessionId,
    streaming,
    readOnlySubagent,
    messages,
    onSend,
    onRewound,
    onToast,
  });

  // Plan5 B.10 — 消息级"从此处分叉"。`RewindBar` 里已有同一套
  // `sessionFork(sessionId, cwd)` + 确认弹窗流程;这里把同样的语义下放到
  // 单条消息,复用 `onForked` 让宿主导航到新会话。
  const handleForkRequest = useCallback(async () => {
    if (!sessionId || streaming || readOnlySubagent) return;
    const ok = await confirm("从此处分叉此会话？", {
      tone: "warning",
      description: "会复制到新会话，原会话保留。",
    });
    if (!ok) return;
    try {
      const newId = await sessionFork(sessionId, cwd);
      onToast?.(`已分叉到新会话 ${newId.slice(0, 8)}`);
      onForked?.(newId);
    } catch (e) {
      onToast?.(`分叉失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [sessionId, streaming, readOnlySubagent, cwd, onToast, onForked]);

  // ---- Phase 2/3: tool detail + artifacts side panel ----
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<ToolSidePanelMode>("tool");
  const [activeTool, setActiveTool] = useState<ToolCallView | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  // R2.5 — workspace switch loading flag. Drives the WorkspacePicker's
  // spinner overlay; non-null while a switch is in flight (preventing
  // double-clicks during the IPC round-trip).
  const [switchingWorkspace, setSwitchingWorkspace] = useState<string | null>(null);

  // Phase A5 — stable callback so `<Composer>`'s React.memo wrapper can
  // actually skip re-renders. The previous inline arrow recreated the
  // function on every ChatView render, defeating the memo every time any
  // selector in the dep array changed (which is constantly during a turn).
  const handleComposerWorkspaceChange = useCallback(
    (next: string) => {
      // R2.5 — flip the loading flag while the parent is running the
      // workspace switch IPC. The flag is cleared whether the switch
      // succeeds or fails so a hung IPC doesn't wedge the UI.
      setSwitchingWorkspace(next);
      if (!onSelectWorkspace) return;
      Promise.resolve(onSelectWorkspace(next))
        .catch(() => {
          /* parent surfaces its own toast */
        })
        .finally(() => setSwitchingWorkspace(null));
    },
    [onSelectWorkspace],
  );

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


  // P0-5 — 会话内待处理项数量,下发给 `conversation.approvals`(list 追加区)。
  // **复用既有 store**,不新建状态容器:`question-store` / `permission-store`
  // 就是上面 `QuestionInlineCard` / `PermissionInlineCard` 用的那两份数据源。
  // 读 `queues` 整体(而非单条)是因为插件需要的是「还有几项待处理」——
  // zustand 默认按引用比较,`queues` 仅在请求/清除时换引用,不会造成额外重渲染。
  const questionQueues = useQuestionStore((s) => s.queues);
  const permissionQueues = usePermissionStore((s) => s.queues);
  const pendingApprovalCount =
    (sessionId ? (questionQueues[sessionId]?.length ?? 0) : 0) +
    (sessionId ? (permissionQueues[sessionId]?.length ?? 0) : 0);
  // 有待处理提问/权限时,agent 无法自行继续 —— 这就是“被阻住”的准确含义。
  const blockedOnApproval = pendingApprovalCount > 0;

  // R1.2: Virtualization is enabled when the user opts in via
  // `localStorage["openbuddy.virtual-list"] = "1"` OR the timeline has
  // ≥ VIRTUAL_THRESHOLD nodes. Off by default — the existing flat
  // render path is the default, so regression risk for the main user
  // is zero until the flag is enabled.




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
  // memo comparator sees a stable identity. The body reads messages
  // through messagesRef (kept current by the useEffect above) so the
  // function reference itself only changes when sessionId flips —
  // streaming deltas no longer invalidate the comparator.
  const findToolCallStable = useCallback(
    (id: string) => findToolCall(messagesRef.current, id),
    [sessionId],
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

  // Plan5 Phase A.1 — timeline + 消息节点渲染抽到 useChatViewTimeline。
  const { timeline, renderTimelineNode } = useChatViewTimeline({
    messages,
    streaming,
    streamingMessageId,
    markdownConfig,
    cwd,
    sessionId,
    onToast,
    handleOpenTool,
    handleEditResend,
    setEditResendOriginId,
    handleStepRevision,
    handleInlineResend,
    handleEditAssistantMessage,
    handleResendAfterAssistantEdit,
    handleRetry,
    turnStartRef,
    findOpen,
    findHits,
    findCurrent,
    promptIndexByMessageId,
    onRewindTo: handleRewindTo,
    allowFork: !readOnlySubagent,
    onForkFromHere: sessionId
      ? () => { void handleForkRequest(); }
      : undefined,
  });

  const useVirtualList = useMemo(
    () => shouldUseVirtualList(timeline.length),
    [timeline.length],
  );

  // R1.2: Render a single timeline node — used by both the flat
  // timeline.map (default) and the VirtualizedMessageList (opt-in).
  // Stable across renders as long as its captured deps are stable;
  // // Phase A3 — `messages` is intentionally NOT in the dep array. The
  // closure only needs the count (for `isLastAssistant`) and a stable
  // signal that the trailing assistant bubble is the same one. Both
  // are primitive and survive streaming deltas that mutate `messages`
  // in place; the previous `messages` dep forced a fresh callback
  // (and therefore a fresh JSX subtree) every time any part of any
  // message changed during a turn.
  const messagesLength = messages.length;


  // R6.5 — Pin-aware auto-follow (DeepSeek ChatView pattern).
  //
  // Naive scroll-on-every-mutation forces the user back to the end even
  // when they have deliberately scrolled up to read prior context. We
  // instead track whether the user is "pinned to bottom" (within
  // PIN_THRESHOLD px of the bottom) and only auto-scroll when pinned.
  // When not pinned and new content arrives, surface a floating
  // "jump to bottom" button so the user can opt in without losing
  // their place.
  // 会话内查找:Ctrl/Cmd+F 打开;当前命中滚入视野。
  // Plan5 Phase A.1/B.6 — 键盘关注点抽到 useChatViewShortcuts:
  //   - Ctrl/Cmd+F → 打开查找(仅在有消息时,与改造前一致)
  //   - Escape(查找打开时)→ 关闭查找并清空命中
  // 行为逐字等价;`?` / Ctrl+/ 由 App 顶层挂载的 <ChatShortcutOverlay /> 承接。
  const { handleKeyDown: handleChatViewKeyDown } = useChatViewShortcuts({
    onToggleFind: () => setFindOpen(true),
    onCloseFind: () => {
      setFindOpen(false);
      setFindHits([]);
      setFindCurrent(null);
    },
    findOpen,
    hasMessages: messages.length > 0,
  });
  // 全局监听(改造前的 window listener 语义:无需焦点即可触发)。
  useChatViewGlobalShortcuts({
    enabled: messages.length > 0,
    onOpenFind: () => setFindOpen(true),
  });
  useEffect(() => {
    if (!findCurrent) return;
    const node = scrollRef.current?.querySelector(
      `[data-msg-id="${findCurrent}"]`,
    );
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [findCurrent]);
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

  // Plan5 Phase A.1 — 工具按钮集群抽到 ChatViewToolbar。
  // 视觉与 button 顺序与改造前完全一致;所有原 data-tip / aria-label / aria-pressed
  // 通过 ToolButtonDescriptor 透传给 ChatViewToolbar 内的 ToolButton。
  const toolButtons = [
    defaultPlanButton({
      planCount: plan?.entries.length ?? 0,
      planCompleted: plan?.entries.filter((e) => e.status === "completed").length ?? 0,
      active: planOpen,
      onClick: () => setPlanOpen((v) => !v),
    }),
    defaultArtifactsButton({
      artifactCount: artifacts.length,
      active: panelOpen && panelMode === "artifacts",
      onClick: () => {
        if (panelOpen && panelMode === "artifacts") setPanelOpen(false);
        else handleOpenArtifacts();
      },
    }),
    defaultFindButton({
      active: findOpen,
      hasMessages: messages.length > 0,
      onClick: () => setFindOpen((v) => !v),
    }),
    defaultFileChangesButton({
      active: fileChangesOpen,
      hasMessages: messages.length > 0,
      onClick: () => setFileChangesOpen((v) => !v),
    }),
    defaultSubagentButton({
      active: subagentsOpen,
      hasMessages: messages.length > 0,
      onClick: () => setSubagentsOpen((v) => !v),
    }),
    defaultTeamStatusButton({
      active: teamsOpen,
      hasMessages: messages.length > 0,
      onClick: () => setTeamsOpen((v) => !v),
    }),
    defaultFileTreeButton({
      active: panelOpen && panelMode === "fileTree",
      hasWorkspace: !!cwd,
      onClick: () => {
        if (panelOpen && panelMode === "fileTree") setPanelOpen(false);
        else {
          setPanelMode("fileTree");
          setPanelOpen(true);
        }
      },
    }),
    defaultBrowserButton({
      active: panelOpen && panelMode === "browser",
      onClick: () => {
        if (panelOpen && panelMode === "browser") setPanelOpen(false);
        else {
          setPanelMode("browser");
          setPanelOpen(true);
        }
      },
    }),
  ];

  // 输入区的 props 打成一包:内置 <Composer> 与内核 `conversation.composer` 槽的
  // 实现收到的是**同一份**契约 —— 插件可以只包一层,把剩余 props 原样转发回去,
  // 不必自己重新发明一套输入区 API。字段与接线前逐个对应(callbacks 仍由 ChatView
  // 的 useCallback 稳定,所以 Composer 的 memo 行为不变)。
  const composerProps: ComposerProps = {
    streaming,
    disabled: readOnlySubagent,
    onSend,
    onSendContent,
    onEnqueue: sessionId ? handleComposerEnqueue : undefined,
    onCancel,
    modelId,
    models,
    onModelChange,
    cwd,
    workspaces,
    onSelectWorkspace: handleComposerWorkspaceChange,
    workspaceLoading: switchingWorkspace !== null,
    showDisclaimer: true,
    permissionInline: true,
    thinkingLevel,
    onThinkingChange: handleThinkingChange,
    onToast,
    draft,
    draftKey: sessionId ?? undefined,
    onDraftChange: sessionId ? handleComposerDraftChange : undefined,
    externalText: resendText,
    externalTextNonce: resendNonce,
    onSelectMode,
    onSelectExpert,
    onNavigateConnectors,
    activeExpertName,
    activeExpertAvatar,
    usageSessionId: sessionId ?? undefined,
    usageMsgCount: messages.length,
    extensionText,
    extensionTextNonce,
  };

  return (
    <div
      className={"chatview" + (panelOpen ? " chatview--with-panel" : "")}
      // Plan5 Phase A.1/B.6 — 容器内快捷键(Ctrl/Cmd+F 打开查找,Esc 关闭)。
      // 全局 `?` / Ctrl+/ 由 App 顶层的 <ChatShortcutOverlay /> 承接。
      onKeyDown={handleChatViewKeyDown}
    >
      <div className="chatview__main">
        {/* Plan5 Phase A.1 — 横幅堆叠由 ChatViewBannerStack 接管。
            渲染顺序、className、data-testid 与改造前完全一致(快照测试覆盖)。 */}
        <ChatViewBannerStack
          extensionUi={extensionUi as ExtensionUi | undefined}
          error={error}
          canRetry={!!(sessionId && !streaming && messagesRef.current.some((m) => m.role === "user"))}
          onRetry={handleRetryLast}
          onCloseError={() => useSessionStore.getState().setError(null)}
          planMode={planMode}
          plan={plan ?? undefined}
          onPlanExit={() => {/* parent owns planMode toggle — wired in App.tsx */}}
          onToast={onToast}
        />
        {/* 会话工具按钮:WB 风格纯图标,portal 进顶栏右侧槽位(不占正文一行);
            顶栏未挂载时回退为正文内的图标行(由 ChatViewToolbar 内部处理)。 */}
        <ChatViewToolbar
          topbarHost={topbarHost}
          buttons={toolButtons}
          messages={messages}
          onShareDone={onToast}
        />
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
        <ChatViewScrollStage
          scrollRef={scrollRef}
          sessionTitle={sessionRecord?.title}
          readOnlySubagent={readOnlySubagent}
          fileChangesOpen={fileChangesOpen}
          subagentsOpen={subagentsOpen}
          teamsOpen={teamsOpen}
          timeline={timeline}
          renderNode={renderTimelineNode}
          sessionId={sessionId ?? undefined}
          streaming={streaming}
          useVirtualList={useVirtualList}
          messages={messages}
          cwd={cwd}
          onOpenSession={onOpenSession}
          activeView={activeView}
          conversationViews={conversationViews}
          conversationViewTabs={
            conversationViews.length > 0 ? (
              <ConversationViewTabs
                active={activeView}
                views={conversationViews}
                onChange={setActiveView}
              />
            ) : null
          }
          emptyState={
            <ChatViewEmptyState onPickPrompt={handleQuickPrompt} />
          }
          timelineList={
            useVirtualList ? (
              <VirtualizedMessageList
                timeline={timeline as TimelineNode[]}
                scrollRef={scrollRef as React.RefObject<HTMLElement>}
                renderItem={renderTimelineNode}
              />
            ) : (
              timeline.map((node, index) => renderTimelineNode({ node, index }))
            )
          }
          SubagentPanelImpl={SubagentPanelResolved as React.ComponentType<{
            messages: ChatMessage[];
            cwd?: string;
            onOpenSession?: (sessionId: string, cwd?: string) => void | Promise<void>;
          }>}
          unreadCount={unreadCount}
          onJumpToBottom={handleJumpToBottom}
        />
        {/* Pinned footer — composer + yield/permission cards always sit at
            the bottom of `chatview__main`, not at the bottom of the
            transcript. */}
        <ChatViewFooter
          sessionId={sessionId}
          streaming={streaming}
          readOnlySubagent={readOnlySubagent}
          yielded={yielded}
          onResume={handleResume}
          onResumeAndContinue={handleResumeAndContinue}
          onPause={handlePause}
          pendingApprovalCount={pendingApprovalCount}
          blockedOnApproval={blockedOnApproval}
          composerProps={composerProps}
          cwd={cwd}
          onRewound={onRewound}
          onForked={onForked}
          onToast={onToast}
          onSend={onSend}
        />
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
