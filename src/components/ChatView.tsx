import { useExtensionUiStore } from "@/stores/extension-ui-store";
import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useSessionStore, type ToolCallView } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { createMarkdownHostConfig } from "@/lib/markdown-host";
import { agentForkSession, agentRegenerate, rewindExecute, rewindPoints, agentSteer, agentFollowUp } from "@/lib/agent-client";
import { collectSessionArtifacts, findToolCall, type SessionArtifact } from "@/lib/session-artifacts";
import { friendlyError } from "@/lib/error-format";
import { invoke } from "@/lib/ipc";
import { parseUserText, baseName } from "@/lib/user-text";
import { Composer } from "./Composer";
import { PermissionInlineCard } from "./PermissionDialog";
import { QuestionInlineCard } from "./QuestionInlineCard";
import { ToolSidePanel, type ToolSidePanelMode } from "./ToolSidePanel";
import { FindBar, isFindHit } from "./FindBar";
import { ShareMenu } from "./ShareMenu";
import { QueuePanel } from "./QueuePanel";
import { usePiQueueStore } from "@/stores/pi-queue-store";
import { buildNodes } from "./chat/turns";
import { TurnView } from "./chat/TurnView";
import { UserBubble } from "./chat/UserBubble";
import { ErrorCard } from "./chat/ErrorCard";
import { PromptHistory } from "./chat/PromptHistory";
import { ArrowDown } from "lucide-react";
import { FolderIcon, PanelIcon, SearchIcon } from "@/foundation/components/Icon/icons";
import type { ModelOption } from "./ModelSelector";
import type { HomeModeId } from "./home-scenes";
import type { AgentEntry } from "@/lib/types";
import type { WorkspaceInfo } from "@/lib/agent-client";

/** Pixels from the bottom within which the transcript keeps following new content. */
const STICK_THRESHOLD = 80;
/** Space kept above a just-sent prompt once it is scrolled to the top. */
const ANCHOR_GAP = 16;

/** Find the App top bar's right slot (rendered by App before ChatView mounts). */
function useTopbarSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setSlot(document.getElementById("chat-topbar-slot")); }, []);
  return slot;
}

/** Center chat column: grouped turns + composer; tools for the conversation live in the top bar. */
export function ChatView({
  onSend,
  onCancel,
  modelId,
  models,
  onModelChange,
  cwd,
  workspaces,
  onSelectWorkspace,
  onRewound,
  onForked,
  onToast,
  onSelectMode,
  onSelectExpert,
  onNavigateConnectors,
}: {
  onSend: (text: string, attachments?: { path: string }[]) => void | Promise<void>;
  onCancel: () => void;
  modelId?: string;
  models?: ModelOption[];
  onModelChange?: (id: string) => void | Promise<void>;
  cwd?: string;
  workspaces?: WorkspaceInfo[];
  onSelectWorkspace?: (cwd: string) => void;
  /** History was rewritten by the engine — rebuild the transcript. */
  onRewound?: () => void | Promise<void>;
  /** Fork created a new session id — navigate to it. */
  onForked?: (newSessionId: string) => void;
  onToast?: (msg: string) => void;
  onSelectMode?: (modeId: HomeModeId) => void;
  onSelectExpert?: (agent: AgentEntry) => void;
  onNavigateConnectors?: () => void;
}) {
  const messages = useSessionStore((s) => s.messages);
  const streaming = useSessionStore((s) => s.streaming);
  const error = useSessionStore((s) => s.error);
  const retry = useSessionStore((s) => s.retry);
  const compacting = useSessionStore((s) => s.compacting);
  const turnStartedAt = useSessionStore((s) => s.turnStartedAt);
  const sessionId = useSessionStore((s) => s.sessionId);
  const homeCwd = useSessionsStore((s) => s.homeCwd);
  const extensionUi = useExtensionUiStore(state => sessionId ? state.sessions[sessionId] : undefined);
  const nodes = useMemo(() => buildNodes(messages), [messages]);
  const lastTurnIndex = useMemo(() => nodes.map((n) => n.kind).lastIndexOf("turn"), [nodes]);
  const lastNodeIsTurn = nodes.at(-1)?.kind === "turn";
  const toolbarSlot = useTopbarSlot();

  const [findOpen, setFindOpen] = useState(false);
  const [findHits, setFindHits] = useState<string[]>([]);
  const [findCurrent, setFindCurrent] = useState<string | null>(null);

  const setDraft = useSessionsStore((s) => s.setDraft);
  const draft = useSessionsStore((s) => (sessionId ? s.drafts[sessionId] ?? "" : ""));
  const activeEntry = useSessionsStore((s) => {
    if (!sessionId) return undefined;
    return s.independent.find((x) => x.sessionId === sessionId)
      ?? Object.values(s.workspaceSessions).flat().find((x) => x.sessionId === sessionId);
  });

  // Text pushed into the composer (编辑重发 / extension setEditorText).
  const [resendText, setResendText] = useState<string | undefined>(undefined);
  const [resendNonce, setResendNonce] = useState(0);
  const putInComposer = useCallback((text: string) => {
    setResendText(text);
    setResendNonce((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!extensionUi?.editor || !sessionId) return;
    const editor = extensionUi.editor;
    const current = useSessionsStore.getState().drafts[sessionId] ?? "";
    putInComposer(editor.action === "paste" ? current + editor.text : editor.text);
  }, [extensionUi?.editor, sessionId, putInComposer]);

  // 重新生成: the engine branches before the last prompt and sends it again.
  const handleRetry = useCallback(async () => {
    if (!sessionId || streaming) return;
    try {
      await agentRegenerate(sessionId);
    } catch (e) {
      onToast?.(`重新生成失败：${friendlyError(e)}`);
    }
  }, [sessionId, streaming, onToast]);

  // 编辑提问 (in place): drop that prompt and everything after it, then resend the
  // edited text — or put it back in the composer when files must be re-attached.
  const handleEditFrom = useCallback(async (messageId: string, text: string, resend: boolean) => {
    if (!sessionId || streaming) return;
    const ordinal = messages.filter((m) => m.role === "user" && !m.meta?.pending).findIndex((m) => m.id === messageId);
    try {
      const points = await rewindPoints(sessionId);
      const point = ordinal >= 0 ? points[ordinal] : undefined;
      if (!point) { putInComposer(text); onToast?.("无法从这条消息重新开始，已放回输入框"); return; }
      const { editorText } = await rewindExecute(sessionId, point.entryId);
      await onRewound?.();
      if (resend) await onSend(text);
      else putInComposer(text || parseUserText(editorText).text);
    } catch (e) {
      onToast?.(`编辑失败：${friendlyError(e)}`);
    }
  }, [sessionId, streaming, messages, putInComposer, onRewound, onSend, onToast]);

  const handleFork = useCallback(async () => {
    if (!sessionId) return;
    try {
      onForked?.(await agentForkSession(sessionId));
      onToast?.("已分叉为新任务");
    } catch (e) {
      onToast?.(`分叉失败：${friendlyError(e)}`);
    }
  }, [sessionId, onForked, onToast]);

  // ---- right panel (tool detail / artifacts / files / changes) ----
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<ToolSidePanelMode>("tool");
  const [activeTool, setActiveTool] = useState<ToolCallView | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const artifacts = useMemo(() => collectSessionArtifacts(messages), [messages]);
  useEffect(() => {
    if (!activeTool) return;
    const fresh = findToolCall(messages, activeTool.toolCallId);
    if (fresh && fresh !== activeTool) setActiveTool(fresh);
  }, [messages, activeTool]);
  useEffect(() => {
    setPanelOpen(false);
    setActiveTool(null);
    setPreviewPath(null);
    setFindOpen(false);
  }, [sessionId]);
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

  const markdownConfig = useMemo(() => createMarkdownHostConfig({ cwd, sessionId, onToast }), [cwd, sessionId, onToast]);

  // ---- scrolling: follow new content only while the reader is at the bottom ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  /** A prompt was just sent: keep it at the top while its reply fills the view. */
  const anchorRef = useRef(false);
  /** Ignore scroll events caused by our own smooth scroll. */
  const autoScrollUntil = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || performance.now() < autoScrollUntil.current) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stickRef.current = atBottom;
    setShowJump(!atBottom);
  }, []);
  /**
   * Grok-style anchoring: pad the end of the transcript so that "scrolled to the
   * bottom" puts the newest prompt at the top of the view. The reply grows into
   * the padding (nothing moves); once it outgrows the view the usual
   * follow-the-bottom behaviour takes over.
   */
  const fitSpacer = useCallback(() => {
    const el = scrollRef.current;
    const spacer = spacerRef.current;
    if (!el || !spacer) return;
    let height = 0;
    const prompts = el.querySelectorAll<HTMLElement>('[data-role="user"]');
    const prompt = prompts[prompts.length - 1];
    if (anchorRef.current && prompt) {
      const box = el.getBoundingClientRect();
      const promptTop = prompt.getBoundingClientRect().top - box.top + el.scrollTop;
      const contentEnd = spacer.getBoundingClientRect().top - box.top + el.scrollTop;
      const tail = el.scrollHeight - contentEnd - spacer.offsetHeight;
      height = Math.max(0, Math.round(el.clientHeight - (contentEnd - promptTop) - tail - ANCHOR_GAP));
    }
    if (spacer.style.height !== `${height}px`) spacer.style.height = `${height}px`;
  }, []);
  /** 提问历史: bring one prompt into view and flash it. */
  const jumpToMessage = useCallback((messageId: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const target = [...root.querySelectorAll<HTMLElement>("[data-msg-ids]")].find((el) => (el.dataset.msgIds ?? "").split(" ").includes(messageId));
    if (!target) return;
    stickRef.current = false;
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    target.classList.remove("msg-wrap--flash");
    void target.offsetWidth;
    target.classList.add("msg-wrap--flash");
    window.setTimeout(() => target.classList.remove("msg-wrap--flash"), 1600);
  }, []);
  const jumpToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (smooth && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setShowJump(false);
  }, []);
  // A new prompt from the user glides to the top of the view; its reply streams in below.
  const pendingCount = messages.filter((m) => m.meta?.pending).length;
  const lastPending = useRef(0);
  useLayoutEffect(() => {
    const grew = pendingCount > lastPending.current;
    lastPending.current = pendingCount;
    if (!grew) return;
    anchorRef.current = true;
    fitSpacer();
    autoScrollUntil.current = performance.now() + 450;
    jumpToBottom(true);
  }, [pendingCount, fitSpacer, jumpToBottom]);
  useEffect(() => {
    anchorRef.current = false;
    fitSpacer();
    stickRef.current = true;
    jumpToBottom();
  }, [sessionId, fitSpacer, jumpToBottom]);
  useLayoutEffect(() => {
    fitSpacer();
    if (stickRef.current && performance.now() >= autoScrollUntil.current) jumpToBottom();
  }, [messages, error, retry, compacting, fitSpacer, jumpToBottom]);
  // Content can grow after render (markdown, images): refit and keep following while stuck.
  useEffect(() => {
    const el = scrollRef.current;
    const inner = el?.firstElementChild;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      fitSpacer();
      if (stickRef.current && performance.now() >= autoScrollUntil.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitSpacer]);

  // ---- in-conversation search (Ctrl/Cmd+F) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && messages.length > 0) {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [messages.length]);
  useEffect(() => {
    if (!findCurrent) return;
    const node = scrollRef.current?.querySelector(`[data-msg-ids~="${findCurrent}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [findCurrent]);

  const findClass = (ids: string[]) => {
    if (!findOpen || !ids.some((id) => isFindHit(findHits, id))) return "";
    return ids.includes(findCurrent ?? "") ? " msg-wrap--find-current" : " msg-wrap--find-hit";
  };
  // Tool rows that render their own approval card; the footer shows the rest.
  const inlineToolIds = useMemo(() => new Set(messages.flatMap((m) => m.parts.flatMap((p) => (p.kind === "tool_call" ? [p.toolCall.toolCallId] : [])))), [messages]);
  const workspaceLabel = !cwd ? "" : cwd === homeCwd ? "默认空间" : baseName(cwd);
  const panelActive = panelOpen && panelMode !== "tool";

  const toolbar = (
    <div className="chat-toolbar">
      {workspaceLabel && (
        <button
          type="button"
          className="chat-toolbar__workspace"
          onClick={() => { if (cwd) void invoke("reveal_in_folder", { path: cwd, cwd }).catch(() => onToast?.("无法打开文件夹")); }}
          data-tip={cwd}
          aria-label={`工作空间：${workspaceLabel}（在文件夹中显示）`}
        >
          <FolderIcon size={14} />
          <span>{workspaceLabel}</span>
        </button>
      )}
      <button type="button" className={"main-topbar__btn" + (findOpen ? " main-topbar__btn--active" : "")} onClick={() => setFindOpen((v) => !v)} aria-label="在对话中搜索" data-tip="搜索 (Ctrl/Cmd+F)" disabled={!messages.length}>
        <SearchIcon size="md" />
      </button>
      <PromptHistory messages={messages} onJump={jumpToMessage} />
      {messages.length > 0 && <ShareMenu messages={messages} title={activeEntry?.title} onDone={onToast} />}
      <button
        type="button"
        className={"main-topbar__btn" + (panelActive ? " main-topbar__btn--active" : "")}
        onClick={() => (panelActive ? setPanelOpen(false) : handleOpenArtifacts())}
        aria-label={panelActive ? "收起右侧栏" : "展开右侧栏"}
        data-tip={panelActive ? "收起右侧栏" : `产物与文件${artifacts.length ? `（${artifacts.length}）` : ""}`}
      >
        <PanelIcon size="md" />
      </button>
    </div>
  );

  return (
    <div className={"chatview" + (panelOpen ? " chatview--with-panel" : "")}>
      {toolbarSlot && createPortal(toolbar, toolbarSlot)}
      <div className="chatview__main">
        <FindBar
          messages={messages}
          open={findOpen}
          onClose={() => { setFindOpen(false); setFindHits([]); setFindCurrent(null); }}
          onHitsChange={setFindHits}
          onActiveChange={setFindCurrent}
        />
        <div className="chatview__scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="chatview__inner">
            {nodes.map((node, index) => {
              if (node.kind === "notice") {
                const label = node.message.meta?.notice === "compaction" ? "上下文已压缩" : node.message.meta?.notice === "branch" ? "已切换到其他分支" : node.message.meta?.notice === "bash" ? "命令" : "提示";
                return (
                  <div key={node.key} className="chat-notice" data-msg-ids={node.message.id}>
                    <span className="chat-notice__label">{label}</span>
                    {node.message.meta?.notice === "bash" && node.message.parts[0]?.kind === "text" && <pre className="chat-notice__body">{node.message.parts[0].text}</pre>}
                  </div>
                );
              }
              if (node.kind === "user") {
                return (
                  <div key={node.key} className={"msg-wrap" + findClass([node.message.id])} data-msg-ids={node.message.id} data-role="user">
                    <UserBubble message={node.message} onToast={onToast} onEdit={streaming ? undefined : (text, resend) => handleEditFrom(node.message.id, text, resend)} />
                  </div>
                );
              }
              const ids = node.messages.map((m) => m.id);
              const isLast = index === lastTurnIndex && lastNodeIsTurn;
              return (
                <div key={node.key} className={"msg-wrap" + findClass(ids)} data-msg-ids={ids.join(" ")}>
                  <TurnView
                    messages={node.messages}
                    user={node.user}
                    running={streaming && isLast}
                    isLast={isLast}
                    sessionId={sessionId ?? ""}
                    cwd={cwd}
                    markdownConfig={markdownConfig}
                    retry={isLast ? retry : null}
                    compacting={isLast ? compacting : null}
                    turnStartedAt={isLast ? turnStartedAt : null}
                    error={isLast ? error : null}
                    onOpenTool={handleOpenTool}
                    onRetry={isLast && !streaming ? handleRetry : undefined}
                    onFork={!streaming ? handleFork : undefined}
                    onToast={onToast}
                  />
                </div>
              );
            })}
            {/* Manual /compact runs outside a turn. */}
            {compacting && !streaming && (
              <div className="chat-compacting" role="status"><span className="ob-shining-text">正在压缩上下文…</span></div>
            )}
            {/* Errors before any reply exists (send rejected, load failed). */}
            {error && !streaming && !lastNodeIsTurn && (
              <div className="msg-wrap"><ErrorCard error={error} onToast={onToast} onRetry={nodes.some((n) => n.kind === "user") ? handleRetry : undefined} /></div>
            )}
            <div ref={spacerRef} className="chatview__spacer" aria-hidden="true" />
          </div>
        </div>
        {showJump && (
          <button type="button" className={"chatview__jump" + (streaming ? " chatview__jump--live" : "")} onClick={() => jumpToBottom(true)} aria-label="回到最新" data-tip={streaming ? "有新内容" : "回到底部"}>
            <ArrowDown size={16} strokeWidth={2} />
          </button>
        )}
        <div className="chatview__footer">
          <PermissionInlineCard sessionId={sessionId} cwd={cwd} exclude={inlineToolIds} />
          <QuestionInlineCard sessionId={sessionId} />
          {extensionUi && (extensionUi.title || extensionUi.working || Object.keys(extensionUi.status).length > 0 || Object.keys(extensionUi.widgets).length > 0) && (
            <aside className="extension-status" aria-label="扩展状态">
              {extensionUi.title && <strong>{extensionUi.title}</strong>}
              {extensionUi.working && <p role="status">{extensionUi.working}</p>}
              {Object.entries(extensionUi.status).map(([key, text]) => <p key={key} role="status">{text}</p>)}
              {Object.entries(extensionUi.widgets).map(([key, lines]) => <pre key={key}>{lines.join("\n")}</pre>)}
            </aside>
          )}
          {sessionId && <QueuePanel key={sessionId} sessionId={sessionId} />}
          <Composer
            streaming={streaming}
            onSend={onSend}
            onEnqueue={sessionId ? async (text, attachments, mode) => {
              const actual = await (mode === "steer" ? agentSteer : agentFollowUp)(sessionId, text, attachments);
              usePiQueueStore.getState().apply(sessionId, actual);
            } : undefined}
            onCancel={onCancel}
            modelId={modelId}
            models={models}
            onModelChange={onModelChange}
            cwd={cwd}
            workspaces={workspaces}
            onSelectWorkspace={onSelectWorkspace}
            showDisclaimer
            permissionInline
            onToast={onToast}
            draft={draft}
            draftKey={sessionId ?? undefined}
            onDraftChange={sessionId ? (t) => setDraft(sessionId, t) : undefined}
            externalText={resendText}
            externalTextNonce={resendNonce}
            onSelectMode={onSelectMode}
            onSelectExpert={onSelectExpert}
            onNavigateConnectors={onNavigateConnectors}
            activeExpertName={activeEntry?.expertName}
            activeExpertAvatar={activeEntry?.expertAvatar}
            usageSessionId={sessionId ?? undefined}
            usageMsgCount={streaming ? undefined : messages.length}
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
        onClose={() => setPanelOpen(false)}
        onSelectTool={(tc) => { setActiveTool(tc); setPreviewPath(null); setPanelMode("tool"); setPanelOpen(true); }}
        onSelectArtifact={handleSelectArtifact}
        onOpenArtifacts={handleOpenArtifacts}
        findToolCall={(id) => findToolCall(messages, id)}
      />
    </div>
  );
}
