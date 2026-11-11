import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { PauseIcon } from "@/foundation/components/Icon/icons";
import { useSessionStore, type ToolCallView } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { createMarkdownHostConfig } from "@/lib/markdown-host";
import { rewindExecute, rewindPoints } from "@/lib/agent-client";
import {
  collectSessionArtifacts,
  findToolCall,
  type SessionArtifact,
} from "@/lib/session-artifacts";
import { MessageItem } from "./MessageItem";
import { Composer } from "./Composer";
import { PlanPanel } from "./PlanPanel";
import { RewindBar } from "./RewindBar";
import { PermissionInlineCard } from "./PermissionDialog";
import { QuestionInlineCard } from "./QuestionInlineCard";
import { ToolSidePanel, type ToolSidePanelMode } from "./ToolSidePanel";
import { FindBar, isFindHit } from "./FindBar";
import { FileChangesPanel } from "./FileChangesPanel";
import { SubagentPanel } from "./SubagentPanel";
import { TeamStatusView } from "./TeamStatusView";
import { ShareMenu } from "./ShareMenu";
import { QueuePanel } from "./QueuePanel";
import { WorkspacePicker } from "./WorkspacePicker";
import { useMessageQueueStore } from "@/stores/message-queue-store";
import { buildTimeline } from "@/lib/timeline-utils";
import { formatAgentError } from "@/lib/error-format";
import { useSubagentStore } from "@/stores/subagent-store";
import {
  requestYield,
  confirmYielded,
  clearYield,
  isYielded,
  createYieldStore,
} from "@/lib/yield-state";
import type { ModelOption } from "./ModelSelector";
import type { HomeModeId } from "./home-scenes";
import type { AgentEntry } from "@/lib/types";
import type { WorkspaceInfo } from "@/lib/agent-client";

/** Center chat column: scrollable message list + composer pinned at bottom. */
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
  onSend: (text: string) => void;
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
  /** Surface transient feedback from the rewind/fork toolbar. */
  onToast?: (msg: string) => void;
  onSelectMode?: (modeId: HomeModeId) => void;
  onSelectExpert?: (agent: AgentEntry) => void;
  onNavigateConnectors?: () => void;
}) {
  const messages = useSessionStore((s) => s.messages);
  const streaming = useSessionStore((s) => s.streaming);
  const streamingMessageId = useSessionStore((s) => s.streamingMessageId);
  const error = useSessionStore((s) => s.error);
  const plan = useSessionStore((s) => s.plan);
  const sessionId = useSessionStore((s) => s.sessionId);
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
  // 按会话持久化的输入草稿:切到本会话时回填,每次输入回写 store。
  // 选 setDraft 的稳定引用做回调,避免 sessionId 变化时让 Composer 收到新函数。
  const setDraft = useSessionsStore((s) => s.setDraft);
  const draft = useSessionsStore((s) =>
    sessionId ? s.drafts[sessionId] ?? "" : ""
  );
  // Read the expert name + avatar bound to the current session (for the composer badge).
  const activeExpertName = useSessionsStore((s) => {
    if (!sessionId) return undefined;
    const entry = s.independent.find((x) => x.sessionId === sessionId)
      ?? Object.values(s.workspaceSessions).flat().find((x) => x.sessionId === sessionId);
    return entry?.expertName;
  });
  const activeExpertAvatar = useSessionsStore((s) => {
    if (!sessionId) return undefined;
    const entry = s.independent.find((x) => x.sessionId === sessionId)
      ?? Object.values(s.workspaceSessions).flat().find((x) => x.sessionId === sessionId);
    return entry?.expertAvatar;
  });
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
  const handleRetry = useCallback(async () => {
    if (!sessionId || streaming || retrying) return;
    // Find the last user message text.
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
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
      // Rewind the conversation to the last user prompt (conversation only —
      // don't touch files), which drops the assistant turn we're regenerating.
      const points = await rewindPoints(sessionId);
      if (points.length === 0) {
        // Nothing to rewind — bailing here is important: without a rewind we
        // would just append a duplicate user turn on top of the old one.
        onToast?.("没有可回退的点，无法重试");
        return;
      }
      // Pick the latest point explicitly by promptIndex — don't rely on the
      // points array being sorted ascending (the order isn't documented).
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
  }, [sessionId, streaming, retrying, messages, onSend, onRewound, onToast]);

  // ---- Phase 2/3: tool detail + artifacts side panel ----
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<ToolSidePanelMode>("tool");
  const [activeTool, setActiveTool] = useState<ToolCallView | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const artifacts = useMemo(() => collectSessionArtifacts(messages), [messages]);

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

  const markdownConfig = useMemo(
    () =>
      createMarkdownHostConfig({
        cwd,
        sessionId,
        onToast,
      }),
    [cwd, sessionId, onToast],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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

  return (
    <div className={"chatview" + (panelOpen ? " chatview--with-panel" : "")}>
      <div className="chatview__main">
        {error && (
          <div className="chatview__error-banner" role="alert">
            <span className="chatview__error-text" style={{ whiteSpace: "pre-wrap" }}>
              {formatAgentError(error) ?? error}
            </span>
            <button
              className="chatview__error-close"
              onClick={() => useSessionStore.getState().setError(null)}
              aria-label="dismiss"
            >
              ×
            </button>
          </div>
        )}
        {/* Workspace indicator / switcher (对齐 WorkBuddy 顶栏工作目录切换)。 */}
        {cwd && workspaces && onSelectWorkspace && (
          <div className="chatview__workspace-bar">
            <WorkspacePicker
              cwd={cwd}
              workspaces={workspaces}
              onSelectWorkspace={onSelectWorkspace}
            />
          </div>
        )}
        {/* Plan toggle: floating button on the right when there's a plan. */}
        {plan && plan.entries.length > 0 && (
          <>
            <button
              className={`chatview__plan-toggle ${planOpen ? "chatview__plan-toggle--active" : ""}`}
              onClick={() => setPlanOpen((v) => !v)}
              title="执行计划"
            >
              计划 {plan.entries.filter((e) => e.status === "completed").length}/
              {plan.entries.length}
            </button>
            {planOpen && (
              <div className="chatview__plan-panel">
                <PlanPanel
                  sessionId={sessionId ?? undefined}
                  onSend={onSend}
                  onToast={onToast}
                />
              </div>
            )}
          </>
        )}

        {/* Artifacts entry — always available when there are outputs. */}
        {artifacts.length > 0 && (
          <button
            type="button"
            className={
              "chatview__artifacts-toggle" +
              (panelOpen && panelMode === "artifacts"
                ? " chatview__artifacts-toggle--active"
                : "")
            }
            onClick={() => {
              if (panelOpen && panelMode === "artifacts") {
                setPanelOpen(false);
              } else {
                handleOpenArtifacts();
              }
            }}
            title="本会话产物"
          >
            产物 {artifacts.length}
          </button>
        )}

        {/* 会话内查找入口 + 查找条(对齐 WorkBuddy chat-search)。 */}
        {messages.length > 0 && (
          <button
            type="button"
            className={
              "chatview__artifacts-toggle" +
              (findOpen ? " chatview__artifacts-toggle--active" : "")
            }
            onClick={() => setFindOpen((v) => !v)}
            title="在当前对话中查找 (Ctrl/Cmd+F)"
          >
            查找
          </button>
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

        {/* 文件变更聚合入口(对齐 WorkBuddy file-changes-panel)。 */}
        {messages.length > 0 && (
          <button
            type="button"
            className={
              "chatview__artifacts-toggle" +
              (fileChangesOpen ? " chatview__artifacts-toggle--active" : "")
            }
            onClick={() => setFileChangesOpen((v) => !v)}
            title="本会话文件变更"
          >
            变更
          </button>
        )}
        {/* 文件树入口(对齐 WorkBuddy fileTree 视图)：打开工作区面板的文件树视图。 */}
        {cwd && (
          <button
            type="button"
            className={
              "chatview__artifacts-toggle" +
              (panelOpen && panelMode === "fileTree"
                ? " chatview__artifacts-toggle--active"
                : "")
            }
            onClick={() => {
              if (panelOpen && panelMode === "fileTree") {
                setPanelOpen(false);
              } else {
                setPanelMode("fileTree");
                setPanelOpen(true);
              }
            }}
            title="工作区文件树"
          >
            文件树
          </button>
        )}
        {/* 浏览器预览入口(对齐 WorkBuddy preview 视图)：打开工作区面板的浏览器视图。 */}
        <button
          type="button"
          className={
            "chatview__artifacts-toggle" +
            (panelOpen && panelMode === "browser"
              ? " chatview__artifacts-toggle--active"
              : "")
          }
          onClick={() => {
            if (panelOpen && panelMode === "browser") {
              setPanelOpen(false);
            } else {
              setPanelMode("browser");
              setPanelOpen(true);
            }
          }}
          title="网页预览"
        >
          浏览器
        </button>
        {/* 分享 / 导出本会话(对齐 WorkBuddy share:*)。 */}
        {messages.length > 0 && (
          <ShareMenu messages={messages} onDone={onToast} />
        )}

        <div className="chatview__scroll" ref={scrollRef}>
          <div className="chatview__inner">
            {fileChangesOpen && (
              <FileChangesPanel messages={messages} />
            )}
            {subagentsOpen && (
              <SubagentPanel messages={messages} />
            )}
            {teamsOpen && (
              <TeamStatusView messages={messages} />
            )}
            {buildTimeline(messages).map((node) => {
              // 时间线分隔符(对齐 WorkBuddy message-timeline):日期/模型切换分隔。
              // 当前 ChatMessage 无 modelId/createdAt,无分隔符时仅渲染消息节点。
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
              // 重试只对最后一条 assistant 消息开放（重试中间消息没有语义）。
              const isLastAssistant =
                m.role === "assistant" && idx === messages.length - 1;
              // 会话内查找:命中容器高亮(当前命中更深一层)。
              const findCls = findOpen && isFindHit(findHits, m.id)
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
                      false && isLastAssistant && !streaming && m.complete
                        ? handleRetry
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
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
          {/* 消息队列(对齐 WorkBuddy message-queue):流式时可继续排队 prompt。
              非流式时面板为空(QueuePanel 内部 queue.length===0 直接 return null)。 */}
          {sessionId && (
            <QueuePanel sessionId={sessionId} onSendNow={(t) => onSend(t)} />
          )}
          <Composer
            streaming={streaming}
            onSend={onSend}
            onEnqueue={
              sessionId
                ? (text) => {
                    useMessageQueueStore.getState().enqueue(sessionId, text);
                    onToast?.("已加入待发送队列");
                  }
                : undefined
            }
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
            onDraftChange={
              sessionId ? (t) => setDraft(sessionId, t) : undefined
            }
            externalText={resendText}
            externalTextNonce={resendNonce}
            onSelectMode={onSelectMode}
            onSelectExpert={onSelectExpert}
            onNavigateConnectors={onNavigateConnectors}
            activeExpertName={activeExpertName}
            activeExpertAvatar={activeExpertAvatar}
            usageSessionId={sessionId ?? undefined}
            usageMsgCount={messages.length}
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
        onSelectTool={(tc) => {
          setActiveTool(tc);
          setPreviewPath(null);
          setPanelMode("tool");
          setPanelOpen(true);
        }}
        onSelectArtifact={handleSelectArtifact}
        onOpenArtifacts={handleOpenArtifacts}
        findToolCall={(id) => findToolCall(messages, id)}
      />
    </div>
  );
}
