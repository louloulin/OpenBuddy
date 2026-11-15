import { useContext, useEffect, useRef, useState } from "react";
import { ArrowUp, X, type LucideIcon } from "lucide-react";
import { open as openDialog } from "@openbuddy/client/ipc";
import { getPathForFile } from "@openbuddy/client/ipc";
import { ModelRuntimeContext, ModelSelector, type ModelOption } from "../models/ModelSelector";
import { ThumbImg } from "../../shared/ui/ThumbImg";
import { ContextUsagePill } from "./ContextUsagePill";
import { clipboardSaveImage, type AgentMode } from "@openbuddy/client/agent-client";
import {
  loadInputHistory,
  saveInputHistory,
  pushHistory,
  navigateHistory,
  type InputHistory,
} from "@/features/composer/input-history";
import { WorkspacePicker } from "./WorkspacePicker";
import { PermissionPicker } from "../approvals/PermissionPicker";
import { SlashCommands, slashToken, type SlashCommandsHandle } from "./SlashCommands";
import { InputAddMenu } from "./InputAddMenu";
import {
  collectDroppedPaths,
} from "@/shared/lib/files/drop-utils";
import type { HomeModeId } from "../../shared/content/scenes";
import type { AgentEntry } from "@openbuddy/protocol/dto";
import type { WorkspaceInfo } from "@openbuddy/client/agent-client";

const AGENT_MODES: ReadonlyArray<readonly [AgentMode, string, string]> = [
  ["craft", "做一做", "直接动手：可以读写文件、执行命令"],
  ["plan", "想一想", "先调研并给出计划，确认后再执行（只读）"],
  ["ask", "问一问", "只回答问题，不改文件（只读）"],
];

/**
 * WorkBuddy 风格输入卡片(圆角16):左下 +,右下 Auto 下拉/麦克风/发送;
 * showMeta 时卡片内部底部显示"选择工作空间/默认权限"。
 * showDisclaimer 时卡片下方渲染免责声明行。
 * apiReady=false 时输入禁用,点击卡片引导打开设置。
 */
export function Composer({
  streaming,
  disabled,
  onSend,
  onCancel,
  placeholder,
  apiReady = true,
  onOpenSettings,
  onToast,
  showMeta = false,
  showDisclaimer = false,
  permissionInline = false,
  // Model picker
  modelId,
  models,
  onModelChange,
  // Workspace picker
  cwd,
  workspaces,
  onSelectWorkspace,
  agentMode,
  onAgentModeChange,
  // Seed text (from HomePage chips). Consumed once, then cleared via callback.
  initialText,
  onInitialTextConsumed,
  // 不可编辑的"操作类型"标签(首页选中能力分类时插入),显示在输入框内首行。
  sceneTag,
  onClearSceneTag,
  // 受控填充:externalTextNonce 变化时把 externalText 写入输入框(用于点击模板)。
  externalText,
  externalTextNonce,
  // 按会话持久化的草稿:切换 sessionId 时按 draft 回填,每次输入回写 store。
  // 不传这三者时退化为纯组件内 state(向后兼容旧调用方/测试)。
  draft,
  draftKey,
  onDraftChange,
  onSelectMode,
  onSelectExpert,
  onSelectSkill,
  onNavigateConnectors,
  /** 流式时把「发送」改为「加入待发送队列」(对齐 WorkBuddy message-queue)。
   *  传入后:流式且文本非空时,在停止按钮左侧显示「入队」按钮。 */
  onEnqueue,
  /** Name of the expert currently bound to this session (shown as badge in footer). */
  activeExpertName,
  /** Local avatar path for the expert badge. */
  activeExpertAvatar,
  /** Session id powering the context-usage pill (omit on the home page). */
  usageSessionId,
  usageMsgCount,
}: {
  streaming: boolean;
  disabled?: boolean;
  onSend: (text: string, attachments?: { path: string }[]) => void | Promise<void>;
  onCancel: () => void;
  placeholder?: string;
  apiReady?: boolean;
  onOpenSettings?: () => void;
  /** Unused since pii W0.3 (the toast-only fallbacks are gone); kept so callers need not change. */
  onPlaceholder?: (label: string) => void;
  /** Surface transient feedback (permission rule save errors, etc.). */
  onToast?: (msg: string) => void;
  showMeta?: boolean;
  /** Show "内容由 AI 生成" disclaimer below card (chat page). */
  showDisclaimer?: boolean;
  /** 把权限选择器放进卡片内 footer（+ 之后），匹配 WorkBuddy 本地助理页；为 true 时不再渲染卡片外 meta 行。 */
  permissionInline?: boolean;
  /** Currently selected model id (shown on the model trigger). */
  modelId?: string;
  /** Available models for the picker. */
  models?: ModelOption[];
  onModelChange?: (id: string) => void | Promise<void>;
  /** Currently active working directory. */
  cwd?: string;
  workspaces?: WorkspaceInfo[];
  onSelectWorkspace?: (cwd: string) => void;
  /** 做一做 / 想一想 / 问一问 (shown when onAgentModeChange is given). */
  agentMode?: AgentMode;
  onAgentModeChange?: (mode: AgentMode) => void;
  /** Optional initial text to seed the input (one-shot, then cleared). */
  initialText?: string;
  onInitialTextConsumed?: () => void;
  /**
   * 首页"操作类型"标签(复刻 WorkBuddy 的 scene tag):选中能力分类后插入
   * 到输入框内首行的黑色标签,带图标与 × 删除按钮。发送时作为上下文前缀。
   */
  sceneTag?: { label: string; icon: LucideIcon } | null;
  /** 点击标签 × 时清空该标签(并清空相关输入)。 */
  onClearSceneTag?: () => void;
  /** 受控填充的内容(通常是某个模板对应的完整 prompt)。 */
  externalText?: string;
  /** 递增的 nonce;变化时把 externalText 写入输入框并聚焦。 */
  externalTextNonce?: number;
  /**
   * 持久化草稿:切到某会话时(draftKey 变化)把 draft 回填到输入框。
   * 与 externalText 不同,这是"用户已经敲下的字",回填时不触发 onDraftChange。
   */
  draft?: string;
  /** 草稿作用域标识(通常是 sessionId 或哨兵)。变化时触发回填。 */
  draftKey?: string | number;
  /** 用户输入时回调,父组件据此把草稿写回 store。 */
  onDraftChange?: (text: string) => void;
  /** 加号菜单:选择模式(日常办公/代码开发/设计创意)。 */
  onSelectMode?: (modeId: HomeModeId) => void;
  /** 加号菜单:选择专家。 */
  onSelectExpert?: (agent: AgentEntry) => void;
  /** 加号菜单:选择技能(插入 /skillName)。 */
  onSelectSkill?: (skillName: string) => void;
  /** 加号菜单:跳转到连接器管理面板。 */
  onNavigateConnectors?: () => void;
  /** 流式时把「发送」改为「加入待发送队列」(对齐 WorkBuddy message-queue)。 */
  onEnqueue?: (text: string, attachments?: { path: string }[], mode?: "steer" | "followUp") => void | Promise<void>;
  /** Name of the expert currently bound to this session (shown as badge in footer). */
  activeExpertName?: string;
  /** Local avatar path for the expert badge. */
  activeExpertAvatar?: string;
  /** Session id powering the context-usage pill (omit on the home page). */
  usageSessionId?: string;
  /** Triggers pill re-fetch when messages change. */
  usageMsgCount?: number;
}) {
  const modelControls = useContext(ModelRuntimeContext);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sendError, setSendError] = useState("");
  const [queueMode, setQueueMode] = useState<"steer" | "followUp">("followUp");
  const [queueBusy, setQueueBusy] = useState(false);
  const scopeRef = useRef(draftKey); scopeRef.current = draftKey;
  const validateAttachments = () => {
    const hasImages = attachments.some(path => /\.(png|jpe?g|gif|webp)$/i.test(path));
    if (hasImages && !models?.find(model => model.id === modelId)?.input?.includes("image")) {
      setSendError("当前模型不支持图片输入，请选择支持图片的模型后重试。"); return false;
    }
    return true;
  };
  // 发送前成本预估(对齐 WorkBuddy credit-estimate):纯本地 token 估算。
  // ctxUsed/ctxTotal 由 ContextUsagePill 异步获取,这里不耦合;徽章在占比未知时
  // 仍显示 +N(新增 token),有占比信息时叠加(此处保守不取,避免与 pill 抢请求)。
  // 输入历史(arrow-key recall,对齐 WorkBuddy use-input-history):内存中按发送追加,
  // ↑/↓ 在输入框回溯。draftRef 暂存「回到输入框」时恢复的草稿。
  const histRef = useRef<InputHistory>(loadInputHistory(100));
  const histCursorRef = useRef<number>(histRef.current.items.length);
  const draftRef = useRef<string>("");
  // Attachments, the scene tag and the expert each have their own chip; no second preview row (20261115-ui U4.1).
  const ref = useRef<HTMLTextAreaElement>(null);

  // 统一更新入口:每次写入输入框内容时同步把草稿推给父组件(若启用持久化)。
  // 回填(draftKey 变化)时不走这里,避免把"恢复出来的字"再当成用户输入回写。
  const updateText = (next: string | ((prev: string) => string)) => {
    setText((prev) => {
      const value = typeof next === "function" ? (next as (p: string) => string)(prev) : next;
      onDraftChange?.(value);
      return value;
    });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

  // One-shot seed: when the parent supplies initialText, fill the textarea and
  // focus it so the user can immediately edit/send.
  useEffect(() => {
    if (initialText !== undefined && initialText !== null) {
      updateText(initialText);
      setCursorPos(initialText.length);
      onInitialTextConsumed?.();
      requestAnimationFrame(() => ref.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  // 受控填充:点击模板/切换标签时由父组件驱动,把内容写入输入框并聚焦。
  // 用 nonce 而不是 externalText 本身做依赖,这样连续点同一个模板也能重新触发。
  useEffect(() => {
    if (externalTextNonce === undefined) return;
    const next = externalText ?? "";
    updateText(next); // 同步草稿:模板写入也算当前草稿内容。
    setCursorPos(next.length);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = next.length;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTextNonce]);

  // 持久化草稿回填:切到另一个会话(draftKey 变化)时,把该会话保存的草稿
  // 写回输入框。注意:这里直接用 setText 而非 updateText,因为这是"恢复"
  // 而不是"用户输入",不该触发 onDraftChange 把同样的内容再写一遍 store。
  // 依赖只看 draftKey(通常是 sessionId),draft 值变化不重新触发——否则用户
  // 每敲一个字都会被这个 effect 重置光标。
  useEffect(() => {
    if (draftKey === undefined) return;
    const next = draft ?? "";
    setText(next);
    setCursorPos(next.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);


  const send = () => {
    const t = text.trim();
    // Nothing to send: no text, no attachments (a bare scene tag is not a prompt).
    if (!t && attachments.length === 0) return;
    if (streaming || disabled || !apiReady || modelControls.busy || modelControls.canSend === false) {
      return;
    }
    if (!validateAttachments()) return;
    setSendError("");
    let body = t;
    if (attachments.length > 0) {
      const fileList = attachments.map((p) => `- ${p}`).join("\n");
      body = body
        ? `${body}\n\n相关文件:\n${fileList}`
        : `请查看以下文件:\n${fileList}`;
    }
    // 把"操作类型"标签作为上下文前缀一并发出(后端正文仍是可运行的 prompt)。
    if (sceneTag) {
      body = body ? `【${sceneTag.label}】${body}` : `【${sceneTag.label}】`;
    }
    const sentScope = draftKey;
    try {
      const result = attachments.length ? onSend(body, attachments.map(path => ({ path }))) : onSend(body);
      void Promise.resolve(result).catch(() => {
        if (scopeRef.current !== sentScope) return;
        updateText(previous => previous || t);
        setAttachments(previous => Array.from(new Set([...attachments, ...previous])));
        setSendError("发送失败，已保留输入与附件，请检查错误后重试。");
      });
    } catch { setSendError("发送失败，请检查错误后重试。"); return; }
    // 记入输入历史(arrow-key recall)。
    if (body && body.trim()) {
      histRef.current = pushHistory(loadInputHistory(100), body);
      saveInputHistory(histRef.current);
      histCursorRef.current = histRef.current.items.length;
      draftRef.current = "";
    }
    updateText(""); // 发送后清空输入框,同时把草稿也清掉(否则切回还会带回来)。
    setAttachments([]);
    onClearSceneTag?.();
  };

  const enqueue = async (modeOverride?: "steer" | "followUp") => {
    const textToQueue = text.trim();
    if ((!textToQueue && attachments.length === 0) || disabled || !apiReady || queueBusy || !onEnqueue || !validateAttachments()) return;
    setQueueBusy(true); setSendError("");
    const body = sceneTag ? `【${sceneTag.label}】${textToQueue}` : textToQueue;
    try {
      await onEnqueue(body || "请查看附件", attachments.map(path => ({ path })), modeOverride ?? queueMode);
      updateText(""); setAttachments([]); onClearSceneTag?.();
    } catch { setSendError("入队失败，输入和附件已保留，可重试。"); }
    finally { setQueueBusy(false); }
  };

  const pickFiles = async () => {
    try {
      const selected = await openDialog({ multiple: true });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setAttachments((prev) => {
        const set = new Set(prev);
        paths.forEach((p) => set.add(p));
        return [...set];
      });
    } catch {
    }
  };

  // DOM drop retains File objects; preload resolves their native paths.
  const [dragActive, setDragActive] = useState(false);
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    if (disabled || !apiReady || (streaming && !onEnqueue)) return;
    try {
      const incoming = collectDroppedPaths(Array.from(event.dataTransfer.files, getPathForFile));
      setAttachments(prev => Array.from(new Set([...prev, ...incoming])));
    } catch (error) {
      onToast?.(`无法添加文件：${String(error)}`);
    }
  };

  // Cursor tracking for slash-command autocomplete.
  const [cursorPos, setCursorPos] = useState(0);
  const slashRef = useRef<SlashCommandsHandle>(null);

  const handleSlashPick = (command: string) => {
    // Replace the "/xxx" token (up to cursor) with the picked command + " ".
    const token = slashToken(text, cursorPos);
    if (!token) return;
    const after = text.slice(cursorPos).replace(/^\S*/, "");
    const newBefore = text.slice(0, token.start) + command + " ";
    const next = newBefore + after.replace(/^ /, "");
    updateText(next);
    const newPos = newBefore.length;
    setCursorPos(newPos);
    // Refocus + put caret at the insertion point.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = newPos;
    });
  };

  const showModelPicker = !!onModelChange && !!models;
  const showWorkspacePicker = !!onSelectWorkspace && !!workspaces;

  const composerCls = [
    "wb-composer",
    !apiReady && "wb-composer--disabled",
    showMeta && "wb-composer--home",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={
        "wb-composer-wrap" + (showMeta ? " wb-composer-wrap--home" : "")
      }
    >
      <section
        className={composerCls}
        onDragOver={event => { event.preventDefault(); if (apiReady && !disabled && (!streaming || onEnqueue)) setDragActive(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
        onDrop={handleDrop}
        onClick={() => {
          if (!apiReady) onOpenSettings?.();
        }}
      >
        {!apiReady && (
          <button type="button" className="wb-composer__setup-hint" onClick={event => { event.stopPropagation(); onOpenSettings?.(); }}>
            请先配置 API Key 开始使用
          </button>
        )}

        {sendError && <p role="alert" className="composer-error">{sendError}</p>}

        {/* 拖拽文件落区遮罩(对齐 WorkBuddy drop-zone) */}
        {dragActive && (
          <div className="wb-composer__dropzone" role="status" aria-live="polite">
            <span className="wb-composer__dropzone-text">松开以添加文件到对话</span>
          </div>
        )}

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((path) => (
              <span key={path} className="composer-attachments__chip" title={path}>
                <span className="composer-attachments__chip-name">
                  {path.replace(/\\/g, "/").split("/").pop()}
                </span>
                <button
                  type="button"
                  className="composer-attachments__chip-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAttachments((prev) => prev.filter((p) => p !== path));
                  }}
                  aria-label="移除附件"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* "操作类型"黑色标签(首页选中能力分类后插入,× 可删除) */}
        {sceneTag && (
          <div className="wb-composer__scene-tag" role="group" aria-label={`操作类型 ${sceneTag.label}`}>
            <span className="wb-composer__scene-tag-icon" aria-hidden="true">
              <sceneTag.icon size={14} />
            </span>
            <span className="wb-composer__scene-tag-text">{sceneTag.label}</span>
            <button
              type="button"
              className="wb-composer__scene-tag-remove"
              aria-label={`移除 ${sceneTag.label}`}
              onClick={(e) => {
                e.stopPropagation();
                onClearSceneTag?.();
              }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        )}

        <textarea
          ref={ref}
          className="wb-composer__input"
          rows={1}
          value={text}
          disabled={!apiReady}
          placeholder={
            apiReady
              ? sceneTag
                ? "" // 有操作类型标签时不显示占位文案(匹配 WorkBuddy)
                : placeholder ?? (agentMode === "plan" ? "说说要做什么，Buddy 先调研并给出计划，确认后再动手" : agentMode === "ask" ? "问点什么，Buddy 只回答、不改文件" : "今天帮你做些什么？/ 调用技能与指令，可粘贴截图或拖入文件")
              : ""
          }
          onChange={(e) => {
            updateText(e.target.value);
            setCursorPos(e.target.selectionStart ?? e.target.value.length);
            // 手动输入时把历史游标重置回末尾(回到「输入框」态)。
            histCursorRef.current = histRef.current.items.length;
          }}
          onSelect={(e) =>
            setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? cursorPos)
          }
          onClick={(e) =>
            setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? cursorPos)
          }
          onKeyUp={(e) =>
            setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? cursorPos)
          }
          onPaste={(e) => {
            // 粘贴截图: saved by the main process as a granted attachment (§5.3).
            const hasImage = Array.from(e.clipboardData.items).some((item) => item.kind === "file" && item.type.startsWith("image/"));
            if (!hasImage || disabled || !apiReady) return;
            e.preventDefault();
            void clipboardSaveImage().then((saved) => {
              if (!saved) { onToast?.("剪贴板里没有可用的图片"); return; }
              setAttachments((prev) => Array.from(new Set([...prev, saved.path])));
            }, (error) => onToast?.(`无法粘贴图片：${String(error)}`));
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            // The slash menu (when open) owns ↑↓/Enter/Tab/Esc.
            if (!e.shiftKey && slashRef.current?.handleKey(e)) return;
            if (e.key === "Enter" && !e.shiftKey && !(e.altKey && !streaming)) {
              e.preventDefault();
              // While a reply is running, Enter queues the message instead of doing nothing;
              // Ctrl/Cmd+Enter (or Alt/⌥+Enter) steers the running reply at its next tool step.
              if (streaming && onEnqueue) void enqueue(e.altKey || e.ctrlKey || e.metaKey ? "steer" : undefined);
              else send();
              return;
            }
            // Esc stops the running reply (popovers handled theirs above).
            if (e.key === "Escape" && streaming && onCancel) {
              e.preventDefault();
              onCancel();
              return;
            }
            // 输入历史 arrow-key recall(对齐 WorkBuddy use-input-history)。
            {
              const el = e.target as HTMLTextAreaElement;
              const atFirstLine = el.selectionStart === 0 || text.length === 0;
              const atLastLine = el.selectionStart === text.length;
              // 已在历史导航中(cursor < items.length)时,↑/↓ 持续翻页,不受光标位置约束。
              const navigating = histCursorRef.current < histRef.current.items.length;
              if (e.key === "ArrowUp" && (atFirstLine || navigating)) {
                if (histCursorRef.current === histRef.current.items.length) {
                  draftRef.current = text; // 进入历史前暂存当前草稿
                  // Another composer (home / another chat) may have added prompts since.
                  histRef.current = loadInputHistory(100);
                  histCursorRef.current = histRef.current.items.length;
                }
                const r = navigateHistory(histRef.current, histCursorRef.current, "up", draftRef.current);
                if (r.text !== text) {
                  e.preventDefault();
                  histCursorRef.current = r.cursor;
                  updateText(r.text);
                  requestAnimationFrame(() => {
                    const t = ref.current;
                    if (t) {
                      t.selectionStart = t.selectionEnd = r.text.length;
                    }
                  });
                }
              } else if (e.key === "ArrowDown" && (atLastLine || navigating)) {
                const r = navigateHistory(histRef.current, histCursorRef.current, "down", draftRef.current);
                if (r.cursor !== histCursorRef.current) {
                  e.preventDefault();
                  histCursorRef.current = r.cursor;
                  updateText(r.text);
                  requestAnimationFrame(() => {
                    const t = ref.current;
                    if (t) {
                      t.selectionStart = t.selectionEnd = r.text.length;
                    }
                  });
                }
              }
            }
          }}
        />
        {/* Slash-command autocomplete */}
        <SlashCommands
          ref={slashRef}
          text={text}
          cursor={cursorPos}
          disabled={!apiReady || streaming}
          onPick={handleSlashPick}
        />
        <div className="wb-composer__footer">
          <InputAddMenu
            onPickFiles={pickFiles}
            onSelectMode={onSelectMode}
            onSelectExpert={onSelectExpert}
            onSelectSkill={(name) => {
              onSelectSkill?.(name);
              if (!onSelectSkill) {
                updateText((prev) => {
                  const prefix = prev.endsWith(" ") || prev === "" ? "" : " ";
                  return prev + prefix + `/${name} `;
                });
                requestAnimationFrame(() => ref.current?.focus());
              }
            }}
            onNavigateConnectors={onNavigateConnectors}
          />
          {activeExpertName && (
            <span className="wb-composer__expert-badge" title={`当前专家：${activeExpertName}`}>
              <ThumbImg name={activeExpertName} local={activeExpertAvatar} size={18} shape="circle" />
              {activeExpertName}
            </span>
          )}
          {permissionInline && (
            <PermissionPicker onToast={onToast} />
          )}
          {onAgentModeChange && (
            <div className="composer-mode" role="radiogroup" aria-label="工作方式">
              {AGENT_MODES.map(([mode, label, tip]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={(agentMode ?? "craft") === mode}
                  className={"composer-mode__opt" + ((agentMode ?? "craft") === mode ? " composer-mode__opt--on" : "")}
                  disabled={streaming}
                  onClick={(e) => { e.stopPropagation(); onAgentModeChange(mode); }}
                  data-tip={tip}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="wb-composer__spacer" />
          {usageSessionId && <ContextUsagePill sessionId={usageSessionId} onRefreshSignal={usageMsgCount} />}
          {showModelPicker ? (
            <ModelSelector
              disabled={streaming || disabled}
              modelId={modelId}
              models={models!}
              onModelChange={onModelChange!}
            />
          ) : null /* pii W0.3: no toast-only "Auto" fallback without a model list */}
          {streaming ? (
            <>
              {/* 流式时可加入待发送队列(对齐 WorkBuddy message-queue)。 */}
              {onEnqueue && (text.trim() !== "" || attachments.length > 0) && (
                <div className="composer-queue-mode" role="radiogroup" aria-label="排队模式">
                  {([["followUp", "完成后发送", "当前回复完成后再发送"], ["steer", "立即插话", "在下一个工具步骤插入，引导当前回复"]] as const).map(([mode, label, tip]) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={queueMode === mode}
                      className={"composer-queue-mode__opt" + (queueMode === mode ? " composer-queue-mode__opt--on" : "")}
                      disabled={queueBusy}
                      onClick={(e) => { e.stopPropagation(); setQueueMode(mode); }}
                      data-tip={tip}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {onEnqueue && (text.trim() !== "" || attachments.length > 0) && (
                <button
                  className="wb-composer__send wb-composer__send--enqueue"
                  onClick={(e) => {
                    e.stopPropagation();
                    void enqueue();
                  }}
                  disabled={disabled || !apiReady || queueBusy || modelControls.busy || modelControls.canSend === false}
                  aria-label="加入待发送队列"
                  title={queueMode === "followUp" ? "当前回复完成后继续" : "在下一工具边界引导当前回复"}
                >
                  +
                </button>
              )}
              <button
                className="wb-composer__send wb-composer__send--stop"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                aria-label="停止生成"
              >
                ■
              </button>
            </>
          ) : (
            <button
              className={
                "wb-composer__send" +
                (text.trim() === "" && attachments.length === 0
                  ? " wb-composer__send--empty"
                  : "")
              }
              onClick={(e) => {
                e.stopPropagation();
                send();
              }}
              disabled={disabled || !apiReady || modelControls.busy || modelControls.canSend === false || (text.trim() === "" && attachments.length === 0)}
              aria-label="发送"
              title={!apiReady ? "请先配置 API Key" : "发送消息"}
            >
              <ArrowUp size={18} strokeWidth={2.25} />
            </button>
          )}
        </div>
      </section>
      {/* WB: meta 行在白卡外下方,透明背景,与卡片间距4px(仅首页) */}
      {showMeta && !permissionInline && (
        <div className="wb-composer-meta">
          {showWorkspacePicker ? (
            <WorkspacePicker
              cwd={cwd}
              workspaces={workspaces!}
              onSelectWorkspace={onSelectWorkspace!}
            />
          ) : null /* pii W0.3: no toast-only workspace fallback without a workspace list */}
          <PermissionPicker onToast={onToast} />
        </div>
      )}
      {showDisclaimer && (
        <div className="wb-composer__disclaimer">
          内容由 AI 生成，请核实重要信息
        </div>
      )}
    </div>
  );
}
