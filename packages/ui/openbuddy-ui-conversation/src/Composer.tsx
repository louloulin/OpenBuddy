import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useComposerAttachments } from "./composer/use-composer-attachments";
import { MentionPicker } from "./MentionPicker";
import { Mic, X, type LucideIcon } from "lucide-react";
import type { ElectronWindowApi } from "@/lib/platform/electron-api";
import { ChevronDownIcon } from "@openbuddy/ui-primitives/icons";
import { ModelSelector, type ModelOption, type ThinkingLevel } from "@openbuddy/ui-workbench";
import { ThumbImg } from "@openbuddy/ui-experts";
import { ContextUsagePill } from "./ContextUsagePill";
import { estimateSendCost } from "@/lib/billing/token-estimate";
import {
  blocks,
  assemblePrompt,
  blockLabel,
} from "@/lib/markdown/content-blocks";
import {
  createInputHistory,
  type InputHistory,
} from "@/lib/ui/input-history";
import { WorkspacePicker } from "@openbuddy/ui-shell";
import { PermissionPicker } from "@openbuddy/ui-shared";
import { SlashCommands } from "@openbuddy/ui-workbench";
import { InputAddMenu } from "./InputAddMenu";


import { toggleVoice as toggleVoiceImpl, type VoiceRecognition } from "./composer/voice-recognition";
import { readImageFile as readImageFileImpl, pickFiles as pickFilesImpl, pickImages as pickImagesImpl } from "./composer/send-payload";
import { send as sendImpl, enqueue as enqueueImpl } from "./composer/send";
import { useExtensionText } from "./composer/use-extension-text";
import { usePopovers } from "./composer/use-popovers";
import { usePluginSlots } from "./composer/use-plugin-slots";
import { useInputHistory } from "./composer/use-input-history";
import { PluginToolbar } from "./composer/PluginToolbar";
import { ActionButtons } from "./composer/ActionButtons";

import type { AgentEntry } from "@openbuddy/shared-types";
import type { WorkspaceInfo } from "@/lib/agent/pi-client";

/** Single attachment bundled into a `piSendContent` prompt. The renderer
 *  converts dropped/pasted files into base64 once at attach time so the IPC
 *  payload is a deterministic shape.
 *
 *  Two flavours: `image` (png/jpeg/webp/gif, ≤16MB) and `file` (PDF /
 *  plain text / markdown / json / xml / docx, ≤8MB). `file` attachments
 *  are forwarded to the LLM as a single base64 part; the agent side
 *  parses the type and either inlines the text content or hands the
 *  binary to its own reader. */
export type ImageAttachment = {
  id: string;
  /** MIME type. For images: image/{png,jpeg,webp,gif}. For documents:
   *  application/pdf, text/plain, text/markdown, application/json,
   *  application/xml, or application/vnd.openxmlformats-officedocument.wordprocessingml.document. */
  mediaType: string;
  data: string;
  name?: string;
  /** "image" for visual models, "file" for documents. The composer emits
   *  one piSendContent part per attachment; the IPC contract maps both
   *  to the same Anthropic `image` block today, but the discriminator
   *  lets us route PDFs to a base64-PDF reader later without breaking
   *  the wire format. */
  kind: "image" | "file";
};

/**
 * WorkBuddy 风格输入卡片(圆角16):左下 +,右下 Auto 下拉/麦克风/发送;
 * showMeta 时卡片内部底部显示"选择工作空间/默认权限"。
 * showDisclaimer 时卡片下方渲染免责声明行。
 * apiReady=false 时输入禁用,点击卡片引导打开设置。
 */
export function ComposerInner({
  streaming,
  disabled,
  onSend,
  /** R1 — content-based send (text + image parts). */
  onSendContent,
  onCancel,
  placeholder,
  apiReady = true,
  onOpenSettings,
  onPlaceholder,
  onToast,
  showMeta = false,
  showDisclaimer = false,
  permissionInline = false,
  // Model picker
  modelId,
  models,
  onModelChange,
  // Reasoning level (merged into the model picker, WB-style)
  thinkingLevel,
  onThinkingChange,
  // Workspace picker
  cwd,
  workspaces,
  onSelectWorkspace,
  /** R2.5 — true while piCreateWorkspace + piListWorkspaceRegistry round-trip.
   *  Surfaces a spinner on the picker so the click feels acknowledged. */
  workspaceLoading,
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
  extensionText,
  extensionTextNonce,
}: {
  streaming: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  /** R1 — content-based send (text + image parts). When provided AND there
   *  are images attached, the composer calls this instead of onSend(text).
   *  This is the Codex/WorkBuddy-style image attachment path. */
  onSendContent?: (
    content: Array<
      | { type: "text"; text: string }
      | { type: "image"; mediaType: string; data: string; name?: string }
      | { type: "file"; mediaType: string; data: string; name?: string }
    >,
  ) => void | Promise<void>;
  onCancel: () => void;
  placeholder?: string;
  apiReady?: boolean;
  onOpenSettings?: () => void;
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
  onModelChange?: (id: string) => void;
  /** Currently active working directory. */
  cwd?: string;
  workspaces?: WorkspaceInfo[];
  onSelectWorkspace?: (cwd: string) => void;
  /** R2.5 — true while piCreateWorkspace + piListWorkspaceRegistry round-trip.
   *  Surfaces a spinner on the picker so the click feels acknowledged. */
  workspaceLoading?: boolean;
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
  /** 当前推理档位;与模型选择器合并展示(WB "✓均衡" 标签)。 */
  thinkingLevel?: ThinkingLevel;
  /** 切换推理档位(直连 piSetThinkingLevel 由父组件实现)。 */
  onThinkingChange?: (level: ThinkingLevel) => void;
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
  onSelectMode?: (modeId: string) => void;
  /** 加号菜单:选择专家。 */
  onSelectExpert?: (agent: AgentEntry) => void;
  /** 加号菜单:选择技能(插入 /skillName)。 */
  onSelectSkill?: (skillName: string) => void;
  /** 加号菜单:跳转到连接器管理面板。 */
  onNavigateConnectors?: () => void;
  /** 流式时把「发送」改为「加入待发送队列」(对齐 WorkBuddy message-queue)。 */
  onEnqueue?: (text: string) => void;
  /** Name of the expert currently bound to this session (shown as badge in footer). */
  activeExpertName?: string;
  /** Local avatar path for the expert badge. */
  activeExpertAvatar?: string;
  /** Session id powering the context-usage pill (omit on the home page). */
  usageSessionId?: string;
  /** Triggers pill re-fetch when messages change. */
  usageMsgCount?: number;
  /** Text supplied by a Pi extension through the Electron UI bridge. */
  extensionText?: string;
  extensionTextNonce?: number;
}) {
  const [text, setText] = useState("");
  // Phase 3 wiring: state extracted to useComposerAttachments hook (state only this step).
  //   后续 step 会把 readImageFile / pickFiles / pickImages / drag 逐步迁出。
  const { attachments, setAttachments, images, setImages, dragActive } = useComposerAttachments({ onToast });
  // Mirror `text` into a ref so updateText can read the latest value when
  // given a functional updater, without making onDraftChange side effects
  // happen inside React's setText callback. Functional updaters must be
  // pure (StrictMode invokes them twice, and they run during the render
  // phase) so Zustand subscribers like HomePage's `s.drafts[HOME_DRAFT_KEY]`
  // reject the resulting setState with "Cannot update a component while
  // rendering a different component" — see sessions-store.ts:134.
  const textRef = useRef<string>("");
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  // 发送前成本预估(对齐 WorkBuddy credit-estimate):纯本地 token 估算。
  // ctxUsed/ctxTotal 由 ContextUsagePill 异步获取,这里不耦合;徽章在占比未知时
  // 仍显示 +N(新增 token),有占比信息时叠加(此处保守不取,避免与 pill 抢请求)。
  const cost = useMemo(() => estimateSendCost(text), [text]);
  // 输入历史(arrow-key recall,对齐 WorkBuddy use-input-history):内存中按发送追加,
  // ↑/↓ 在输入框回溯。draftRef 暂存「回到输入框」时恢复的草稿。
  const histRef = useRef<InputHistory>(createInputHistory(50));
  const histCursorRef = useRef<number>(0);
  const draftRef = useRef<string>("");
  // 多块提示预览(对齐 WorkBuddy content-blocks):把当前引用(expert/attachments/
  // sceneTag)组装成块,显示为 chip 行 + 组装后的预览(便于用户确认最终发送内容)。
  const blockList = useMemo(() => {
    const list = [];
    if (activeExpertName) list.push(blocks.expert({ name: activeExpertName, path: "", scope: "local", raw: "" }));
    if (sceneTag) list.push(blocks.skill(sceneTag.label));
    for (const p of attachments) list.push(blocks.file(p));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExpertName, sceneTag, attachments]);
  const hasRefs = blockList.length > 0;
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<VoiceRecognition | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // 统一更新入口:每次写入输入框内容时同步把草稿推给父组件(若启用持久化)。
  // 回填(draftKey 变化)时不走这里,避免把"恢复出来的字"再当成用户输入回写。
  // onDraftChange 在 setText 外面触发:React 的 setState updater 是纯函数
  // (StrictMode 下会被调多次,且在 render 阶段执行),在 updater 里调 Zustand
  // 的 setDraft 会同步走 HomePage 的订阅者,触发 "Cannot update a component
  // (HomePage) while rendering a different component (Composer)"。
  const updateText = (next: string | ((prev: string) => string)) => {
    const value =
      typeof next === "function"
        ? (next as (p: string) => string)(textRef.current)
        : next;
    textRef.current = value;
    setText(value);
    onDraftChange?.(value);
  };



  // Voice input: use the browser's SpeechRecognition API (Electron-compatible's WebView2/
  // WKWebView support it on most systems). On languages where the API isn't
  // exposed (older webviews, no microphone permission), we surface a toast.
  // pi has a voice crate but doesn't expose it over ACP, so this is the
  // lightest path that works today.
  // toggleVoice was a ~100-line inline function with two code paths
  // (provider-agnostic registry + Web Speech fallback); phase-3 split moved
  // the body to `./composer/voice-recognition`. This wrapper preserves the
  // existing call shape (button onClick={() => toggleVoice()}).
  const toggleVoice = () =>
    toggleVoiceImpl({
      listening,
      setListening,
      recognitionRef,
      updateText,
      onToast,
      onPlaceholder,
    });

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort?.();
    };
  }, []);

  // readImageFile / pickFiles / pickImages were 50 + 14 + 40 inline lines
  // respectively; phase-3 split moved them to `./composer/send-payload`.
  // Thin wrappers below preserve the call shape used in the onPaste handler
  // and in the InputAddMenu's onPickFiles/onPickImages props.
  const readImageFile = (file: File) => readImageFileImpl(file, onToast);

  // send / enqueue were ~80 + ~10 inline lines; phase-3 split moved the
  // bodies to `./composer/send`. These wrappers preserve the call shape
  // (button onClick) by delegating to the extracted implementation with
  // the local state.
  const send = () =>
    sendImpl({
      text, attachments, images, sceneTag, pluginCommands,
      streaming, disabled, apiReady,
      onSend, onSendContent, onEnqueue, onClearSceneTag, onToast,
      setAttachments, setImages, setCursorPos, updateText,
      histRef, histCursorRef, draftRef,
    });
  const enqueue = () =>
    enqueueImpl({
      text, attachments, images, sceneTag, pluginCommands,
      streaming, disabled, apiReady,
      onSend, onSendContent, onEnqueue, onClearSceneTag, onToast,
      setAttachments, setImages, setCursorPos, updateText,
      histRef, histCursorRef, draftRef,
    });

  const pickFiles = async () => pickFilesImpl(setAttachments);
  const pickImages = async () => pickImagesImpl(setImages, onToast);


  const ph = (label: string) => onPlaceholder?.(label);
  // Plugin slot wiring (contributions, slots, toolbar actions, command payloads)
  // used to live inline here (~40 lines); phase-3 split moved it into the
  // `usePluginSlots` hook. `ph` stays local because it's invoked from JSX
  // (`onClick={() => ph("...")}`) and would otherwise need to round-trip
  // through the hook's return value.
  const { pluginComposerContributions, pluginComposerSlots, pluginToolbarActions, pluginCommands } = usePluginSlots();

  // Cursor tracking for slash-command autocomplete.
  const [cursorPos, setCursorPos] = useState(0);
  // The 5 useEffects that sync the textarea with externally-driven text
  // sources (autosize, extensionText, initialText, externalText, draftKey)
  // used to live inline here; phase-3 split moved them into the
  // `useExtensionText` hook. Lives after setCursorPos declaration so all
  // dependencies are in scope.
  useExtensionText({
    ref, text, setText, setCursorPos,
    initialText, onInitialTextConsumed,
    extensionText, extensionTextNonce,
    externalText, externalTextNonce,
    draft, draftKey, updateText,
  });
  // R1 - @-mention picker state, anchor rect, slash detection, and the two
  // pick-handlers used to live inline here (~110 lines); phase-3 split moved
  // them into the `usePopovers` hook.
  const { mention, setMention, anchorRect, handleMentionSelect, handleSlashPick, slashVisible } = usePopovers({
    ref, text, cursorPos, apiReady, streaming, disabled, updateText, setCursorPos,
  });

  // The onKeyDown handler for the textarea (Enter → send + ↑/↓ arrow-key recall)
  // used to live inline here (~45 lines); phase-3 split moved it into the
  // `useInputHistory` hook. Lives after `usePopovers` so `slashVisible` is
  // in scope, and after `send` is declared so the hook can call it.
  const { onKeyDown: onTextareaKeyDown } = useInputHistory({
    ref, text, cursorPos, updateText, slashVisible,
    histRef, histCursorRef, draftRef, onSend: send,
  });

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
      <section className={composerCls}>
        {!apiReady && (
          <button
            type="button"
            className="wb-composer__setup-hint"
            onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpenSettings?.();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onOpenSettings?.();
            }}
          >
            {/* R30 — 这块是覆盖整张卡片的**点击热区**(点哪儿都跳到设置)。
                以前它同时把「请先配置 API Key 开始使用」再画一遍,而它
                `inset: 0` + 垂直居中,文字正好压在输入区与底栏的接缝上
                (实测文字 y≈390–405,底栏从 410 开始),而 textarea 的
                placeholder 已经写着同一句话(y≈352)→ 同一句提示出现两次
                还叠在底栏上。文字改成 sr-only:读屏仍能念出按钮名,视觉
                上只留 placeholder 那一处。 */}
            <span className="wb-sr-only">请先配置 API Key 开始使用</span>
          </button>
        )}

        {/* 拖拽文件落区遮罩(对齐 WorkBuddy drop-zone) */}
        {dragActive && (
          <div className="wb-composer__dropzone" role="status" aria-live="polite">
            <span className="wb-composer__dropzone-text">松开以添加文件到对话</span>
          </div>
        )}

        {/* 多块提示预览(对齐 WorkBuddy content-blocks):引用块 chip 行 */}
        {hasRefs && (
          <div className="composer-blocks" title={assemblePrompt(blockList)}>
            {blockList.map((b) => (
              <span key={b.id} className="composer-blocks__chip">
                {blockLabel(b)}
              </span>
            ))}
          </div>
        )}

        {/* Attachment chips (file paths) */}
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

        {/* R1 — image attachment chips with thumbnail preview. Real bytes
            are stored in `images` state and shipped via piSendContent. */}
        {images.length > 0 && (
          <div className="composer-image-attachments" role="list" aria-label="图片附件">
            {images.map((img) => (
              <span
                key={img.id}
                className="composer-image-attachments__chip"
                title={img.name ?? img.mediaType}
                role="listitem"
              >
                <img
                  className="composer-image-attachments__thumb"
                  src={`data:${img.mediaType};base64,${img.data}`}
                  alt={img.name ?? "pasted image"}
                />
                <span className="composer-image-attachments__name">
                  {img.name ?? "pasted image"}
                </span>
                <button
                  type="button"
                  className="composer-image-attachments__remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    setImages((prev) => prev.filter((p) => p.id !== img.id));
                  }}
                  aria-label="移除图片"
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
          disabled={disabled || !apiReady}
          placeholder={
            apiReady
              ? sceneTag
                ? "" // 有操作类型标签时不显示占位文案(匹配 WorkBuddy)
                : placeholder ?? "今天帮你做些什么? @ 引用对话文件,/ 调用技能与指令"
              : "请先配置 API Key 开始使用"
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
          onPaste={(e) => {
            // R0.8: Intercept image/* items from the clipboard so that pasting
            // a screenshot is no longer silently dropped. We synthesize a
            // Markdown image placeholder with the original file name when
            // available; full image-upload pipeline is tracked separately.
            //
            // R2: Accept any file kind that `readImageFile` (now
            // `readAttachmentFile`) accepts — image/* OR document/* types
            // (PDF, plain text, markdown, csv, html, xml, json, yaml, docx).
            // Documents skip the placeholder-text path (they ride through
            // `piSendContent` as `type:"file"` parts instead of being
            // inlined into the prompt body).
            const fileItem = Array.from(e.clipboardData.items ?? []).find(
              (it) => it.kind === "file" && (it.type.startsWith("image/") || /^(application\/pdf|text\/(plain|markdown|csv|html|xml)|application\/(json|xml|yaml)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))$/i.test(it.type)),
            );
            if (fileItem) {
              e.preventDefault();
              const file = fileItem.getAsFile();
              if (!file) return;
              void readImageFile(file).then((att) => {
                if (!att) return;
                setImages((prev) => [...prev, att]);
                // Image attachments keep the legacy Markdown placeholder so
                // the user sees something appear in the textarea even
                // though the real bytes ride through `piSendContent`.
                // Documents do not need a placeholder — they show up as a
                // chip in `.composer-image-attachments` and ship as
                // base64 alongside the user's prompt.
                if (att.kind !== "file") {
                  const ph = att.name ? `![pasted image: ${att.name}]()` : "![pasted image]()";
                  const start = ref.current?.selectionStart ?? text.length;
                  const end = ref.current?.selectionEnd ?? text.length;
                  const next = text.slice(0, start) + ph + text.slice(end);
                  updateText(next);
                  const caret = start + ph.length;
                  setCursorPos(caret);
                  requestAnimationFrame(() => {
                    if (ref.current) {
                      ref.current.focus();
                      ref.current.selectionStart = ref.current.selectionEnd = caret;
                    }
                  });
                }
              });
              return;
            }
            const eventText = e.clipboardData.getData("text/plain");
            const el = e.currentTarget;
            const start = el.selectionStart ?? text.length;
            const end = el.selectionEnd ?? text.length;
            e.preventDefault();
            const insert = (pasted: string) => {
              if (pasted.length === 0) return;
              const next = text.slice(0, start) + pasted + text.slice(end);
              updateText(next);
              const caret = start + pasted.length;
              setCursorPos(caret);
              requestAnimationFrame(() => {
                if (ref.current) {
                  ref.current.focus();
                  ref.current.selectionStart = ref.current.selectionEnd = caret;
                }
              });
            };
            const nativeReadText = (window as unknown as { api?: ElectronWindowApi }).api?.clipboard?.readText;
            if (typeof nativeReadText !== "function") {
              insert(eventText);
              return;
            }
            void nativeReadText().then((nativeText) => insert(nativeText || eventText)).catch(() => insert(eventText));
          }}
          onClick={(e) =>
            setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? cursorPos)
          }
          onKeyUp={(e) =>
            setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? cursorPos)
          }
          onKeyDown={onTextareaKeyDown}
        />
        {/* R1 - @-mention picker. Floats above the composer when the user
            is typing an @ token. The picker handles its own keyboard nav
            (up/down/enter/esc) via a window-level listener. */}
        <MentionPicker
          open={mention !== null}
          query={mention?.query ?? ""}
          cwd={cwd ?? ""}
          anchorRect={anchorRect}
          onSelect={handleMentionSelect}
          onDismiss={() => setMention(null)}
        />
        {/* Slash-command autocomplete */}
        <SlashCommands
          text={text}
          cursor={cursorPos}
          pluginCommands={pluginCommands}
          onPick={handleSlashPick}
          anchorRect={anchorRect}
        />
        <div className="wb-composer__footer">
          <InputAddMenu
            onPickFiles={pickFiles}
            onPickImages={pickImages}
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
          <PluginToolbar
            contributions={pluginComposerContributions as never}
            slots={pluginComposerSlots as never}
            toolbarActions={pluginToolbarActions as never}
            updateText={updateText}
            textareaRef={ref}
            onPlaceholder={ph}
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
          {/* R8.24 — Composer keyboard hint chip (PI-Desktop MessageMeta parity).
              Visible at-a-glance reminder for the two most-used keys: Enter to
              send, Shift+Enter to insert a newline. The chip lives on the
              left side of the footer so it stays visually anchored to the
              text area, not the action buttons. On phones the chip is
              hidden via @media (max-width: 540px) since typing shortcuts
              differ on touch. */}
          <span
            className="wb-composer__hint"
            data-testid="composer-hint"
            aria-label="Enter 发送，Shift 加 Enter 换行"
          >
            <kbd className="wb-composer__hint-key">Enter</kbd>
            <span className="wb-composer__hint-sep" aria-hidden="true">·</span>
            <span className="wb-composer__hint-label">发送</span>
            <span className="wb-composer__hint-divider" aria-hidden="true">/</span>
            <kbd className="wb-composer__hint-key">Shift+Enter</kbd>
            <span className="wb-composer__hint-sep" aria-hidden="true">·</span>
            <span className="wb-composer__hint-label">换行</span>
          </span>
          <div className="wb-composer__spacer" />
          {/* 发送前成本预估徽章(对齐 WorkBuddy credit-estimate):纯本地 token 估算。
              仅在估算值有意义(≥100 token)时显示 —— 否则「+7」这类零头会紧贴
              模型选择器形成噪音,且 WorkBuddy 在该位置本就不渲染任何徽章。 */}
          {text.trim() && cost.newTokens >= 100 && (
            <span
              className={"wb-composer__cost wb-composer__cost--" + cost.severity}
              title={`预计新增约 ${cost.newTokens} token${
                cost.projectedPct > 0 ? ` · 占上下文 ${cost.projectedPct}%` : ""
              }`}
            >
              {cost.label}
            </span>
          )}
          {usageSessionId && <ContextUsagePill sessionId={usageSessionId} onRefreshSignal={usageMsgCount} />}
          {showModelPicker ? (
            <ModelSelector
              modelId={modelId}
              models={models!}
              onModelChange={onModelChange!}
              thinkingLevel={thinkingLevel}
              onThinkingChange={onThinkingChange}
            />
          ) : (
            <button
              className="wb-composer__model"
              onClick={(e) => {
                e.stopPropagation();
                ph("模型选择");
              }}
            >
              Auto <ChevronDownIcon size="sm" />
            </button>
          )}
          <button
            className={
              "wb-composer__tool" + (listening ? " wb-composer__tool--active" : "")
            }
            onClick={(e) => {
              e.stopPropagation();
              toggleVoice();
            }}
            aria-label="语音输入"
            title={listening ? "正在聆听…点击停止" : "语音输入"}
          >
            <Mic size={16} />
          </button>
          <ActionButtons
            streaming={streaming}
            apiReady={apiReady}
            disabled={disabled}
            text={text}
            attachmentCount={attachments.length}
            listening={listening}
            onEnqueue={onEnqueue ? () => enqueue() : undefined}
            onSend={send}
            onCancel={onCancel}
          />
        </div>
      </section>
      {/* WB: meta 行在白卡外下方,透明背景,与卡片间距4px。permissionInline 时
          权限选择器已在卡片 footer 内,meta 行只补 WorkspacePicker(工作空间)。 */}
      {showMeta && (
        <div className="wb-composer-meta">
          {showWorkspacePicker ? (
            <WorkspacePicker
              cwd={cwd}
              workspaces={workspaces!}
              onSelectWorkspace={onSelectWorkspace!}
              loading={workspaceLoading}
            />
          ) : (
            <button className="wb-composer-meta__btn" onClick={() => ph("选择工作空间")}>
              选择工作空间 <ChevronDownIcon size="sm" />
            </button>
          )}
          {!permissionInline && <PermissionPicker onToast={onToast} />}
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

// SpeechRecognition types + getSpeechRecognitionCtor + ensureWebSpeechAsrRegistered
// live in `./composer/voice-recognition` (phase-3 split; canonical declaration
// there). The duplicates were never removed from Composer.tsx (half-done P0 split
// per `docs/plan/06-roadmap.md` P0-1); phase-3 cleanup removes them.

/**
 * R1.3 — Memoized Composer. Default shallow compare on the prop bag.
 * Most useful during streaming, when ChatView rerenders on every
 * coalesced chunk but Composer's externally-driven props (streaming,
 * disabled, modelId, models, workspaces, callbacks) are stable across
 * renders. Internal state (text, attachments, listening, selections)
 * still drives rerenders normally — typing in the textarea re-renders
 * as before. The wrapper skips the *external* reconciliation overhead
 * (≈ 30 inline closures and 12 derived values being recomputed each
 * pass).
 *
 * Callbacks from ChatView are now stabilized via useCallback (R1.3),
 * so the default comparator's reference check actually skips work.
 */
export const Composer = memo(ComposerInner);

/**
 * 内置 Composer 的 props 契约。
 *
 * 导出它是为了让"替换输入区"的插件拿到**同一份**契约:内核
 * `conversation.composer` 槽的实现会收到与内置组件完全相同的 props
 * (见 `conversation-slots.tsx`),所以插件可以只包一层、把剩余 props 原样
 * 转发给内置 Composer —— 不需要自己重新发明一套输入区 API。
 */
export type ComposerProps = Parameters<typeof ComposerInner>[0];
