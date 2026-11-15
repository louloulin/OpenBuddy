import { useExtensionUiStore } from "@/features/approvals/state/extension-ui-store";
import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useSessionStore, type ToolCallView } from "@/features/chat/state/session-store";
import { useSessionsStore } from "@/features/sessions/state/sessions-store";
import { createMarkdownHostConfig } from "@openbuddy/markdown/markdown-host";
import { agentForkSession, agentRegenerate, rewindExecute, rewindPoints, agentSteer, agentFollowUp } from "@openbuddy/client/agent-client";
import { findToolCall } from "@openbuddy/chat-core/session-artifacts";
import type { ArtifactInfo } from "@openbuddy/client/agent-client";
import { useArtifactsStore, selectArtifacts, selectArtifactsVersion } from "@/features/workbench/state/artifacts-store";
import { Workbench, type BenchTarget } from "../workbench/Workbench";
import { filesTouchedBy, revertToolCalls } from "../workbench/revert";
import { ArtifactsContext, type ArtifactsApi } from "./ArtifactCards";
import { appConfirm, appConfirmWithOption } from "../../shared/ui/AppDialog";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { invoke } from "@openbuddy/client/ipc";
import { parseUserText, baseName, withModeInstruction } from "@openbuddy/chat-core/user-text";
import { Composer } from "../composer/Composer";
import { UserNode, NoticeRow } from "./chat-view/rows";
import { useStableCallback, useTopbarSlot } from "./chat-view/hooks";
import { useSessionMode } from "./chat-view/use-session-mode";
import { STICK_THRESHOLD, ANCHOR_GAP, RENDER_WINDOW, charsOf, blocksOf, nodeIds } from "./chat-view/transcript-metrics";
import { PermissionInlineCard } from "../approvals/PermissionDialog";
import { QuestionInlineCard } from "../approvals/QuestionInlineCard";
import { FindBar, isFindHit } from "./FindBar";
import { ShareMenu } from "./ShareMenu";
import { QueuePanel } from "../composer/QueuePanel";
import { usePiQueueStore } from "@/features/composer/state/pi-queue-store";
import { buildNodes } from "@openbuddy/chat-core/turns";
import { openLightbox } from "@openbuddy/ui/ImageLightbox";
import { matchShortcut } from "@/shared/lib/shortcuts";
import { TurnView } from "./TurnView";
import { ErrorCard } from "./ErrorCard";
import { PromptHistory } from "./PromptHistory";
import { ArrowDown } from "lucide-react";
import { FolderIcon, PanelIcon, SearchIcon } from "@openbuddy/ui/icon/icons/index";
import type { ModelOption } from "../models/ModelSelector";
import type { HomeModeId } from "../../shared/content/scenes";
import type { AgentEntry } from "@openbuddy/protocol/dto";
import type { WorkspaceInfo } from "@openbuddy/client/agent-client";

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
  const toast = useStableCallback((msg: string) => onToast?.(msg));
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
  // Opening a 200-turn session used to mount every turn (≈1s to interactive). Render the newest
  // RENDER_WINDOW nodes; older ones mount when scrolled near the top (or when find / 提问历史
  // jumps to them). Derived per session so the first render is already windowed.
  const [win, setWin] = useState<{ sid: string | null; start: number }>({ sid: null, start: 0 });
  const tailStart = Math.max(0, nodes.length - RENDER_WINDOW);
  if (nodes.length > 0 && win.sid !== sessionId) setWin({ sid: sessionId, start: tailStart });
  const start = win.sid === sessionId ? Math.min(win.start, tailStart) : tailStart;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const toolbarSlot = useTopbarSlot();

  const [findOpen, setFindOpen] = useState(false);
  const [findHits, setFindHits] = useState<string[]>([]);
  const [findCurrent, setFindCurrent] = useState<string | null>(null);

  const setDraft = useSessionsStore((s) => s.setDraft);
  // Read once per session switch: the Composer only consumes `draft` when `draftKey`
  // changes, and subscribing would re-render the whole chat on every keystroke (§3 budget).
  const draft = useMemo(() => (sessionId ? useSessionsStore.getState().drafts[sessionId] ?? "" : ""), [sessionId]);
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
  const handleRetry = useStableCallback(async () => {
    if (!sessionId || streaming) return;
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    if (!(await maybeRevertAfter(lastUser, "重新生成这个回答？"))) return;
    try {
      await agentRegenerate(sessionId);
    } catch (e) {
      onToast?.(`重新生成失败：${friendlyError(e)}`);
    }
  });

  // 编辑提问 (in place): drop that prompt and everything after it, then resend the
  // edited text — or put it back in the composer when files must be re-attached.
  const handleEditFrom = useStableCallback(async (messageId: string, text: string, resend: boolean) => {
    if (!sessionId || streaming) return;
    const ordinal = messages.filter((m) => m.role === "user" && !m.meta?.pending).findIndex((m) => m.id === messageId);
    if (!(await maybeRevertAfter(messages.findIndex((m) => m.id === messageId), "从这条提问重新开始？"))) return;
    try {
      const points = await rewindPoints(sessionId);
      const point = ordinal >= 0 ? points[ordinal] : undefined;
      if (!point) { putInComposer(text); onToast?.("无法从这条消息重新开始，已放回输入框"); return; }
      const { editorText } = await rewindExecute(sessionId, point.entryId);
      await onRewound?.();
      if (resend) await sendWithMode(text);
      else putInComposer(text || parseUserText(editorText).text);
    } catch (e) {
      onToast?.(`编辑失败：${friendlyError(e)}`);
    }
  });

  const handleFork = useStableCallback(async () => {
    if (!sessionId) return;
    try {
      onForked?.(await agentForkSession(sessionId));
      onToast?.("已分叉为新任务");
    } catch (e) {
      onToast?.(`分叉失败：${friendlyError(e)}`);
    }
  });

  // ---- 工作台 (right panel): artifacts / files / changes / step detail ----
  const [panelOpen, setPanelOpen] = useState(false);
  const [benchFocus, setBenchFocus] = useState<BenchTarget>({ kind: "list" });
  const [activeTool, setActiveTool] = useState<ToolCallView | null>(null);
  const artifacts = useArtifactsStore(selectArtifacts(sessionId));
  const artifactsVersion = useArtifactsStore(selectArtifactsVersion(sessionId));
  const refreshArtifacts = useStableCallback(() => { if (sessionId) void useArtifactsStore.getState().refresh(sessionId); });
  // Refresh whenever a turn settles (catches missed events). Opening a session is
  // handled by App once the engine has loaded it (asking earlier only fails).
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming && sessionId) refreshArtifacts();
    wasStreaming.current = streaming;
  }, [sessionId, streaming, refreshArtifacts]);
  useEffect(() => {
    if (!activeTool) return;
    const fresh = findToolCall(messages, activeTool.toolCallId);
    if (fresh && fresh !== activeTool) setActiveTool(fresh);
  }, [messages, activeTool]);
  useEffect(() => {
    setPanelOpen(false);
    setActiveTool(null);
    setBenchFocus({ kind: "list" });
    setFindOpen(false);
  }, [sessionId]);
  const showBench = useCallback((target: BenchTarget) => {
    setBenchFocus(target);
    setPanelOpen(true);
  }, []);
  const handleOpenTool = useCallback((tc: ToolCallView) => {
    setActiveTool(tc);
    showBench({ kind: "tool" });
  }, [showBench]);
  const handleOpenArtifacts = useCallback(() => showBench({ kind: "list" }), [showBench]);
  // Ctrl/Cmd+\ toggles the panel (§5.10).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchShortcut(e, "togglePanel")) {
        e.preventDefault();
        setPanelOpen((open) => { if (!open) setBenchFocus({ kind: "list" }); return !open; });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const revertTurn = useStableCallback(async (toolCallIds: string[], files: ArtifactInfo[]) => {
    if (!sessionId || streaming) return;
    const names = files.map((f) => f.path.split(/[\\/]/).pop()).join("、");
    const ok = await appConfirm({ title: `撤销本轮对 ${files.length} 个文件的改动？`, message: `${names}\n每个文件当前的内容会先留存为一个版本，可以再还原回来。新建的文件会移到废纸篓。`, confirmLabel: "撤销改动" });
    if (ok) await revertToolCalls(sessionId, toolCallIds, { onToast: toast, onChanged: refreshArtifacts });
  });
  /**
   * Before regenerating / editing from message `index`: if later turns changed
   * files, offer to put them back too (checked by default, §9-D7).
   * Returns false when the user cancelled.
   */
  const maybeRevertAfter = async (index: number, title: string): Promise<boolean> => {
    if (!sessionId || index < 0) return true;
    const ids = messages.slice(index).flatMap((m) => m.parts).flatMap((p) => (p.kind === "tool_call" ? [p.toolCall.toolCallId] : []));
    const files = filesTouchedBy(artifacts, ids);
    if (!files.length) return true;
    const choice = await appConfirmWithOption({
      title,
      message: "之后的回答修改过文件。",
      confirmLabel: "继续",
      checkbox: { label: `同时还原这之后的文件改动（${files.length} 个文件）`, checked: true },
    });
    if (!choice.ok) return false;
    if (choice.checked) await revertToolCalls(sessionId, ids, { onToast: toast, onChanged: refreshArtifacts });
    return true;
  };
  // ---- 做一做 / 想一想 / 问一问 (§5.3, D6): the host keeps and restores it per branch (pii W0.5) ----
  const sessionMode = useSessionMode(sessionId, toast);
  const mode = sessionMode.mode;
  const changeMode = useStableCallback(sessionMode.changeMode);
  // Slash commands (/compact, /skill:…) are interpreted by the app, never wrapped.
  const sendWithMode = useStableCallback((text: string, attachments?: { path: string }[]) => onSend(text.trimStart().startsWith("/") ? text : withModeInstruction(text, mode), attachments));
  const lastUser = useMemo(() => messages.findLast((m) => m.role === "user"), [messages]);
  const lastUserId = lastUser?.id ?? "";
  const [planDismissed, setPlanDismissed] = useState("");
  const planReady = !streaming && !error && mode === "plan" && lastUser?.meta?.mode === "plan" && lastNodeIsTurn && planDismissed !== lastUserId;
  const runPlan = useStableCallback(async () => {
    await changeMode("craft");
    await onSend("按上面的计划执行。");
  });

  const artifactsApi = useMemo<ArtifactsApi>(() => ({
    all: artifacts,
    open: (path) => showBench({ kind: "file", path }),
    openChanges: (path) => showBench({ kind: "changes", path }),
    openList: () => showBench({ kind: "list" }),
    revert: (ids, files) => void revertTurn(ids, files),
  }), [artifacts, showBench, revertTurn]);
  const relPath = useCallback((path: string) => (cwd && path.startsWith(cwd) ? path.slice(cwd.length).replace(/^[\\/]/, "") : path), [cwd]);
  const handleAddToChat = useStableCallback((path: string) => {
    const current = sessionId ? useSessionsStore.getState().drafts[sessionId] ?? "" : "";
    putInComposer(`${current}${current && !current.endsWith(" ") ? " " : ""}\`${relPath(path)}\` `);
  });
  // 选中文字 → 让 Buddy 改这段 / 批注: quote it into the composer with the file reference.
  const handleAskEdit = useStableCallback((path: string, selected: string, mode: "edit" | "comment") => {
    const quote = selected.trim().split("\n").slice(0, 40).map((l) => `> ${l}`).join("\n");
    const head = mode === "edit" ? `请修改 \`${relPath(path)}\` 中的这段内容：` : `关于 \`${relPath(path)}\` 中的这段：`;
    const current = sessionId ? useSessionsStore.getState().drafts[sessionId] ?? "" : "";
    putInComposer(`${current ? current + "\n\n" : ""}${head}\n${quote}\n\n${mode === "edit" ? "修改要求：" : "批注："}`);
  });

  const markdownConfig = useMemo(() => createMarkdownHostConfig({ cwd, sessionId, onToast: toast }), [cwd, sessionId, toast]);

  // ---- scrolling: follow new content only while the reader is at the bottom ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  /** A prompt was just sent: keep it at the top while its reply fills the view. */
  const anchorRef = useRef(false);
  /** Ignore scroll events caused by our own smooth scroll. */
  const autoScrollUntil = useRef(0);
  const [showJump, setShowJump] = useState(false);
  // "N 条新内容" on the jump button: paragraphs / steps that arrived while scrolled up (U3.7).
  // Counted only over the tail since the button appeared, so long sessions stay cheap.
  const seenRef = useRef({ index: 0, blocks: 0, chars: 0 });
  useEffect(() => {
    if (showJump) return;
    const index = Math.max(0, messages.length - 1);
    seenRef.current = { index, blocks: messages[index] ? blocksOf(messages[index]) : 0, chars: messages[index] ? charsOf(messages[index]) : 0 };
  }, [showJump, messages]);
  const { unseen, grew } = useMemo(() => {
    if (!showJump) return { unseen: 0, grew: false };
    const { index, blocks, chars } = seenRef.current;
    const tail = messages.slice(index);
    return {
      unseen: Math.max(0, tail.reduce((n, m) => n + blocksOf(m), 0) - blocks),
      // The current block (a long code block or table) grew without a new paragraph.
      grew: tail.length > 1 || tail.reduce((n, m) => n + charsOf(m), 0) > chars,
    };
  }, [showJump, messages]);
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
    // Nothing anchored and no padding left: skip the layout reads entirely.
    if (!anchorRef.current && (spacer.style.height === "" || spacer.style.height === "0px")) return;
    let height = 0;
    const prompts = el.querySelectorAll<HTMLElement>('[data-role="user"]');
    const prompt = prompts[prompts.length - 1];
    if (anchorRef.current && prompt) {
      const box = el.getBoundingClientRect();
      const promptTop = prompt.getBoundingClientRect().top - box.top + el.scrollTop;
      const contentEnd = spacer.getBoundingClientRect().top - box.top + el.scrollTop;
      const tail = el.scrollHeight - contentEnd - spacer.offsetHeight;
      height = Math.max(0, Math.round(el.clientHeight - (contentEnd - promptTop) - tail - ANCHOR_GAP));
      // The reply outgrew the view: normal follow-the-bottom from here on.
      if (height === 0) anchorRef.current = false;
    }
    if (spacer.style.height !== `${height}px`) spacer.style.height = `${height}px`;
  }, []);
  /** 提问历史: bring one prompt into view and flash it. */
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const jumpToMessage = useCallback((messageId: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const target = [...root.querySelectorAll<HTMLElement>("[data-msg-ids]")].find((el) => (el.dataset.msgIds ?? "").split(" ").includes(messageId));
    if (!target) {
      // Not mounted yet (older than the render window): mount it, then jump.
      const index = nodesRef.current.findIndex((n) => nodeIds(n).includes(messageId));
      if (index >= 0) { setWin((w) => ({ ...w, start: Math.min(w.start, Math.max(0, index - 2)) })); setPendingJump(messageId); }
      return;
    }
    stickRef.current = false;
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    target.classList.remove("msg-wrap--flash");
    void target.offsetWidth;
    target.classList.add("msg-wrap--flash");
    window.setTimeout(() => target.classList.remove("msg-wrap--flash"), 1600);
  }, []);
  useLayoutEffect(() => {
    if (!pendingJump) return;
    setPendingJump(null);
    jumpToMessage(pendingJump);
  }, [pendingJump, start, jumpToMessage]);
  /** Images in answers open large; ←/→ steps through the ones in the same turn (U3.6). */
  const onImageClick = useCallback((e: React.MouseEvent) => {
    const img = e.target instanceof HTMLImageElement ? e.target : null;
    if (!img || !img.closest(".markdown-body") || img.closest("a")) return;
    const scope = img.closest("[data-msg-ids]") ?? img.parentElement;
    const all = [...(scope?.querySelectorAll<HTMLImageElement>(".markdown-body img") ?? [img])];
    openLightbox(all.map((x) => ({ src: x.currentSrc || x.src, alt: x.alt })), Math.max(0, all.indexOf(img)));
  }, []);
  /** Mount `count` more older nodes, keeping what is on screen where it is. */
  const prependFrom = useRef<number | null>(null);
  const loadEarlier = useCallback(() => {
    const el = scrollRef.current;
    if (el) prependFrom.current = el.scrollHeight - el.scrollTop;
    setWin((w) => ({ ...w, start: Math.max(0, w.start - RENDER_WINDOW) }));
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const fromBottom = prependFrom.current;
    prependFrom.current = null;
    if (el && fromBottom !== null) el.scrollTop = el.scrollHeight - fromBottom;
  }, [start]);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = moreRef.current;
    if (!root || !sentinel || start === 0 || typeof IntersectionObserver === "undefined") return;
    // Re-created per window so a sentinel that stays in range keeps loading.
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadEarlier(); }, { root, rootMargin: "800px 0px 0px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [start, loadEarlier]);
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
      if (matchShortcut(e, "find") && messages.length > 0) {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [messages.length]);
  useEffect(() => {
    if (!findCurrent) return;
    const index = nodesRef.current.findIndex((n) => nodeIds(n).includes(findCurrent));
    if (index >= 0 && index < start) { setWin((w) => ({ ...w, start: Math.max(0, index - 2) })); return; }
    const node = scrollRef.current?.querySelector(`[data-msg-ids~="${findCurrent}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [findCurrent, start]);

  // Turns far from the end skip layout and paint until scrolled near (long sessions stay fast).
  const settledClass = (index: number) => (index < nodes.length - 4 ? " msg-wrap--settled" : "");
  const findClass = (ids: string[]) => {
    if (!findOpen || !ids.some((id) => isFindHit(findHits, id))) return "";
    return ids.includes(findCurrent ?? "") ? " msg-wrap--find-current" : " msg-wrap--find-hit";
  };
  // Tool rows that render their own approval card; the footer shows the rest.
  const inlineToolIds = useMemo(() => new Set(messages.flatMap((m) => m.parts.flatMap((p) => (p.kind === "tool_call" ? [p.toolCall.toolCallId] : [])))), [messages]);
  const workspaceLabel = !cwd ? "" : cwd === homeCwd ? "默认空间" : baseName(cwd);
  const panelActive = panelOpen;

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
      {messages.length > 0 && <ShareMenu messages={messages} title={activeEntry?.title} onDone={onToast} sessionId={sessionId ?? undefined} />}
      <button
        type="button"
        className={"main-topbar__btn" + (panelActive ? " main-topbar__btn--active" : "")}
        onClick={() => (panelActive ? setPanelOpen(false) : handleOpenArtifacts())}
        aria-label={panelActive ? "收起右侧栏" : "展开右侧栏"}
        data-tip={panelActive ? "收起工作台 (Ctrl/Cmd+\\)" : `产物与文件${artifacts.length ? `（${artifacts.length}）` : ""} (Ctrl/Cmd+\\)`}
      >
        <PanelIcon size="md" />
        {!panelActive && artifacts.length > 0 && <span className="main-topbar__count">{artifacts.length}</span>}
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
        <div className="chatview__scroll" ref={scrollRef} onScroll={onScroll} onClick={onImageClick}>
          <ArtifactsContext.Provider value={artifactsApi}>
          <div className="chatview__inner">
            {start > 0 && (
              <div ref={moreRef} className="chatview__more">
                <button type="button" className="chatview__more-btn" onClick={loadEarlier}>显示更早的对话（还有 {start} 条）</button>
              </div>
            )}
            {nodes.slice(start).map((node, offset) => {
              const index = start + offset;
              if (node.kind === "notice") return <NoticeRow key={node.key} message={node.message} />;
              if (node.kind === "user") {
                return (
                  <div key={node.key} className={"msg-wrap" + settledClass(index) + findClass([node.message.id])} data-msg-ids={node.message.id} data-role="user">
                    <UserNode message={node.message} editable={!streaming} onEditFrom={handleEditFrom} onToast={toast} />
                  </div>
                );
              }
              const ids = node.messages.map((m) => m.id);
              const isLast = index === lastTurnIndex && lastNodeIsTurn;
              return (
                <div key={node.key} className={"msg-wrap" + settledClass(index) + findClass(ids)} data-msg-ids={ids.join(" ")}>
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
                    onToast={toast}
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
          </ArtifactsContext.Provider>
        </div>
        <div className="chatview__footer">
          {/* Anchored to the footer's top edge, so a taller footer (approval, plan bar, queue) never covers it. */}
          {showJump && (
            <button type="button" className={"chatview__jump" + (streaming ? " chatview__jump--live" : "") + (unseen > 0 || grew ? " chatview__jump--count" : "")} onClick={() => jumpToBottom(true)} aria-label={unseen > 0 ? `回到最新（${unseen} 条新内容）` : grew ? "回到最新（有新内容）" : "回到最新"} data-tip={unseen > 0 || grew ? undefined : "回到底部"}>
              <ArrowDown size={16} strokeWidth={2} />
              {(unseen > 0 || grew) && <span className="chatview__jump-count">{unseen > 0 ? `${unseen} 条新内容` : "有新内容"}</span>}
            </button>
          )}
          <PermissionInlineCard sessionId={sessionId} cwd={cwd} exclude={inlineToolIds} />
          <QuestionInlineCard sessionId={sessionId} />
          {extensionUi && (extensionUi.title || extensionUi.working || Object.keys(extensionUi.status).length > 0 || Object.keys(extensionUi.widgets).length > 0) && (
            <aside className="extension-status" aria-label="扩展状态">
              {extensionUi.title && <strong>{extensionUi.title}</strong>}
              {extensionUi.working && <p role="status">{extensionUi.working}</p>}
              {Object.entries(extensionUi.status).map(([key, text]) => <p key={key} role="status">{text}</p>)}
              {Object.entries(extensionUi.widgets).filter(([key]) => !extensionUi.below?.[key]).map(([key, lines]) => (
                <div key={key} className="extension-widget">{lines.map((line, i) => <div key={i} className="extension-widget__line">{line || "\u00a0"}</div>)}</div>
              ))}
            </aside>
          )}
          {sessionId && <QueuePanel key={sessionId} sessionId={sessionId} onEdit={putInComposer} />}
          {planReady && (
            <div className="plan-bar" role="region" aria-label="计划已就绪">
              <span className="plan-bar__text">计划已就绪，确认后 Buddy 会切换到「做一做」开始执行。</span>
              <button type="button" className="bench-btn" onClick={() => setPlanDismissed(lastUserId)}>继续完善</button>
              <button type="button" className="bench-btn bench-btn--primary" onClick={() => void runPlan()}>按计划执行</button>
            </div>
          )}
          <Composer
            streaming={streaming}
            onSend={sendWithMode}
            agentMode={mode}
            onAgentModeChange={sessionId ? changeMode : undefined}
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
          {extensionUi?.below && Object.keys(extensionUi.below).length > 0 && (
            <aside className="extension-status extension-status--below" aria-label="扩展信息">
              {Object.keys(extensionUi.below).map((key) => extensionUi.widgets[key] && (
                <div key={key} className="extension-widget">{extensionUi.widgets[key].map((line, i) => <div key={i} className="extension-widget__line">{line || "\u00a0"}</div>)}</div>
              ))}
            </aside>
          )}
        </div>
      </div>

      {panelOpen && sessionId && (
        <Workbench
          key={sessionId}
          sessionId={sessionId}
          cwd={cwd}
          artifacts={artifacts}
          version={artifactsVersion}
          toolCall={activeTool}
          focus={benchFocus}
          onClose={() => setPanelOpen(false)}
          onRefresh={refreshArtifacts}
          onAddToChat={handleAddToChat}
          onAskEdit={handleAskEdit}
          onToast={toast}
        />
      )}
    </div>
  );
}
