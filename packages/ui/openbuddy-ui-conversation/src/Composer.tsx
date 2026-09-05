import { memo, useEffect, useMemo, useRef, useState, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MentionPicker } from "./MentionPicker";
import { Mic, X, type LucideIcon } from "lucide-react";
import { open as openDialog, type ElectronWindowApi } from "@/lib/platform/electron-api";
import { getCurrentWebview } from "@/lib/platform/electron-api";
import { ChevronDownIcon, SendPlaneIcon } from "@openbuddy/ui-primitives/icons";
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
  pushHistory,
  navigateHistory,
  type InputHistory,
} from "@/lib/ui/input-history";
import { WorkspacePicker } from "@openbuddy/ui-shell";
import { PermissionPicker } from "@openbuddy/ui-shared";
import { SlashCommands } from "@openbuddy/ui-workbench";
import { InputAddMenu } from "./InputAddMenu";
import { useRendererContributions, useRendererSlot } from "@/lib/runtime/renderer-plugin-runtime";
import { RendererSlotView } from "@openbuddy/ui-workbench";
import {
  collectDroppedPaths,
  isDragHovering,
  isDragDrop,
  type DragDropEvent,
} from "@/lib/files/drop-utils";
import {
  registerAsrProvider,
  getActiveAsr,
  createWebSpeechAsrProvider,
} from "@/lib/agent/voice-contract";
import type { HomeModeId } from "@openbuddy/ui-shared";
import type { AgentEntry } from "@openbuddy/shared-types";
import type { WorkspaceInfo } from "@/lib/agent/pi-client";

/** Image attachment bundled into a `piSendContent` prompt. The renderer
 *  converts dropped/pasted images into base64 once at attach time so the
 *  IPC payload is a deterministic shape. */
export type ImageAttachment = {
  /** Stable id so React keys don't churn on re-render. */
  id: string;
  /** MIME type — only image/{png,jpeg,webp,gif} are accepted. */
  mediaType: string;
  /** Base64-encoded image data (no data: URL prefix). */
  data: string;
  /** Original file name (for display only). */
  name?: string;
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
  onSendContent?: (content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }>) => void | Promise<void>;
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
  onSelectMode?: (modeId: HomeModeId) => void;
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
  const [attachments, setAttachments] = useState<string[]>([]);
  // R1 — inline image attachments (paste / drop). Stored as base64 so they
  // round-trip through piSendContent without re-reading the original file.
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const imagesRef = useRef<ImageAttachment[]>([]);
  useEffect(() => { imagesRef.current = images; }, [images]);
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

  useEffect(() => {
    if (extensionTextNonce === undefined) return;
    updateText(extensionText ?? "");
    setCursorPos((extensionText ?? "").length);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    });
    // The nonce deliberately controls repeated identical extension updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensionTextNonce]);

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
    // 切到任意会话都尝试把光标放进输入框,这样 fork / 新会话后用户
    // 直接敲字就行,不用先点一下输入框(对刚分叉出的新会话尤其重要——
    // 见 ChatView.readOnlySubagent 在 piSubagentMode 异步收敛前的处理)。
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || el.disabled) return;
      el.focus();
      el.selectionStart = el.selectionEnd = next.length;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Voice input: use the browser's SpeechRecognition API (Electron-compatible's WebView2/
  // WKWebView support it on most systems). On languages where the API isn't
  // exposed (older webviews, no microphone permission), we surface a toast.
  // pi has a voice crate but doesn't expose it over ACP, so this is the
  // lightest path that works today.
  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    // 优先走 provider-agnostic 注册表(对齐 WorkBuddy asr:* 契约):外部 provider
    // 注册后优先级更高,否则回落到内建 Web Speech。
    ensureWebSpeechAsrRegistered();
    const provider = getActiveAsr();
    if (provider) {
      let finalText = "";
      const stop = provider.listen("zh-CN", {
        onInterim: (interim) => {
          updateText((prev) => {
            const base = finalText || prev;
            return interim ? base + interim : base;
          });
        },
        onFinal: (text) => {
          finalText += text;
          updateText((prev) => (finalText ? finalText : prev));
        },
        onError: (reason) => {
          setListening(false);
          const msg = reason === "not-allowed"
            ? "未授予麦克风权限"
            : `语音识别错误：${reason}`;
          onToast?.(msg);
        },
        onEnd: () => setListening(false),
      });
      // 用 recognitionRef 持有 stop 句柄,与既有「再次点击停止」逻辑兼容。
      recognitionRef.current = {
        lang: "zh-CN",
        interimResults: true,
        continuous: false,
        start: () => {},
        stop,
      } as VoiceRecognition;
      setListening(true);
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      onToast?.("当前环境不支持语音输入（需要 WebView2/WKWebView）");
      onPlaceholder?.("语音输入");
      return;
    }
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      updateText((prev) => {
        // Replace the trailing interim segment each time so the user sees
        // live transcription without duplicating finalized text.
        const base = finalText || prev;
        return interim ? base + interim : base;
      });
    };
    rec.onerror = (e: SpeechRecognitionErrorEventLike) => {
      setListening(false);
      const msg = e.error === "not-allowed"
        ? "未授予麦克风权限"
        : `语音识别错误：${e.error}`;
      onToast?.(msg);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      onToast?.("无法启动语音识别");
    }
  };

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort?.();
    };
  }, []);

  /** Read a File (from paste/drop/picker) and convert it to an ImageAttachment
   *  that piSendContent can ship through the agent prompt. Returns null when
   *  the file is not a supported image MIME type or exceeds 16 MB. */
  const readImageFile = (file: File): Promise<ImageAttachment | null> => {
    return new Promise((resolve) => {
      if (!file.type.startsWith("image/")) return resolve(null);
      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) return resolve(null);
      if (file.size > 16 * 1024 * 1024) {
        onToast?.("图片过大(>16MB),已拒绝");
        return resolve(null);
      }
      const reader = new FileReader();
      reader.onerror = () => {
        onToast?.("读取图片失败");
        resolve(null);
      };
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") return resolve(null);
        // result is a data URL like "data:image/png;base64,XXXX"; strip the
        // prefix so the IPC payload is just the raw base64.
        const comma = result.indexOf(",");
        if (comma === -1) return resolve(null);
        const data = result.slice(comma + 1);
        resolve({
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          mediaType: file.type,
          data,
          name: file.name || undefined,
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const send = () => {
    const t = text.trim();
    // 允许空消息发送，或者需要有附件
    if (streaming || disabled || !apiReady) return;
    // Append attachment paths to the prompt text so pi's read_file tool can
    // pick them up (ACP image/audio needs agent-declared capabilities we
    // don't model yet; ResourceLink behavior is unverified — text is safest).
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
    // R1 — when there are inline image attachments, prefer the content-based
    // IPC so the model receives the actual image bytes instead of a path
    // string. Path-only attachments still flow through onSend(text) with the
    // existing "相关文件" prefix so the existing tools/read_file path keeps
    // working.
    if (imagesRef.current.length > 0 && onSendContent) {
      const textPart = body || "请查看以下图片";
      const content: Array<
        { type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }
      > = [{ type: "text", text: textPart }];
      for (const img of imagesRef.current) {
        content.push({ type: "image", mediaType: img.mediaType, data: img.data, ...(img.name ? { name: img.name } : {}) });
      }
      // Path attachments get appended as text the agent can resolve.
      if (attachments.length > 0) {
        const fileList = attachments.map((p) => `- ${p}`).join("\n");
        content[0] = { type: "text", text: `${textPart}\n\n相关文件:\n${fileList}` };
      }
      void Promise.resolve(onSendContent(content)).catch((e) => {
        console.error("onSendContent failed", e);
        onToast?.(`发送失败:${e instanceof Error ? e.message : String(e)}`);
      });
    } else {
      onSend(body || "你好");
    }
    // 记入输入历史(arrow-key recall)。
    if (body && body.trim()) {
      histRef.current = pushHistory(histRef.current, body);
      histCursorRef.current = histRef.current.items.length;
      draftRef.current = "";
    }
    updateText(""); // 发送后清空输入框,同时把草稿也清掉(否则切回还会带回来)。
    setAttachments([]);
    setImages([]);
    onClearSceneTag?.();
  };

  /** 流式时入队(对齐 WorkBuddy message-queue):文本非空才入队。 */
  const enqueue = () => {
    const t = text.trim();
    if (!t || disabled || !apiReady) return;
    let body = t;
    if (sceneTag) body = body ? `【${sceneTag.label}】${body}` : `【${sceneTag.label}】`;
    onEnqueue?.(body);
    updateText("");
    setAttachments([]);
    onClearSceneTag?.();
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
      // dialog plugin not available in non-Electron-compatible env (vitest) — no-op.
    }
  };

  /** R1 — open the OS file picker scoped to image MIME types. The user can
   *  still attach non-image files via "添加文件"; this entry is the explicit
   *  "I want a vision model to look at this" affordance (Codex-style). */
  const pickImages = async () => {
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      // Resolve each path to a File via fetch. The preload bridge returns
      // a file:// URL we can fetch in the renderer. In test environments
      // (no Electron) fetch will reject — we surface a toast and continue.
      for (const p of paths) {
        try {
          // Use a fetch with file:// to read the bytes; this is supported
          // when the page is loaded from a file:// origin or has the
          // necessary permission via Electron.
          const fileUrl = p.startsWith("file:") ? p : `file://${p}`;
          const resp = await fetch(fileUrl);
          const blob = await resp.blob();
          const ext = p.split(".").pop()?.toLowerCase() ?? "";
          const mime = blob.type || (ext === "jpg" ? "image/jpeg" : `image/${ext}`);
          const file = new File([blob], p.split(/[\\/]/).pop() ?? "image", { type: mime });
          const img = await readImageFile(file);
          if (img) setImages((prev) => [...prev, img]);
        } catch (err) {
          onToast?.(`无法读取图片:${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch {
      // dialog plugin not available in non-Electron-compatible env (vitest) — no-op.
    }
  };

  // ---------- 拖拽文件附件(对齐 WorkBuddy drop-zone)----------
  // Electron-compatible webview 的 DOM onDrop 拿不到本地文件绝对路径(只给 File blob),
  // 必须用原生 drag-drop 事件。enter/over 显示遮罩;drop 收集路径并入附件;
  // leave 隐藏遮罩。非 Electron-compatible 环境(vitest)getCurrentWebview 会抛错,安全降级。
  const [dragActive, setDragActive] = useState(false);
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    try {
      const webview = getCurrentWebview();
      webview
        .onDragDropEvent((event) => {
          // Electron-compatible 把 DragDropEvent 包在 Event<T>.payload 里。
          const e = event.payload as DragDropEvent;
          if (isDragDrop(e)) {
            const incoming = collectDroppedPaths(e.paths);
            if (incoming.length > 0) {
              setAttachments((prev) => {
                const seen = new Set(prev);
                const out = [...prev];
                for (const p of incoming) {
                  if (!seen.has(p)) {
                    seen.add(p);
                    out.push(p);
                  }
                }
                return out;
              });
            }
            setDragActive(false);
          } else {
            setDragActive(isDragHovering(e));
          }
        })
        .then((un) => {
          if (cancelled) {
            // 组件已卸载,立刻解绑。
            try { un(); } catch { /* noop */ }
          } else {
            unlisten = un;
          }
        })
        .catch(() => {
          /* 非 Electron-compatible 环境无此事件 — 静默降级 */
        });
    } catch {
      /* getCurrentWebview 在非 Electron-compatible 环境抛错 — 静默降级 */
    }
    return () => {
      cancelled = true;
      if (unlisten) {
        try { unlisten(); } catch { /* noop */ }
      }
    };
  }, []);

  const ph = (label: string) => onPlaceholder?.(label);
  const pluginComposerContributions = useRendererContributions("composer");
  const pluginComposerSlots = useRendererSlot("conversation.input.dock");

  // Cursor tracking for slash-command autocomplete.
  const [cursorPos, setCursorPos] = useState(0);
  // R1 - @-mention picker state. `mention` is null when the picker is closed.
  // The query is the text after the most recent `@` token at the cursor.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const mentionRef = useRef(mention);
  useEffect(() => { mentionRef.current = mention; }, [mention]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!mentionRef.current) return;
      const fn = (window as Window & { __openbuddyMentionKeyDown?: (e: KeyboardEvent) => void }).__openbuddyMentionKeyDown;
      if (fn) fn(e);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  // Is the user currently typing a "/xxx" command? Drives SlashCommands menu.
  const wordBeforeCursor = (() => {
    const before = text.slice(0, cursorPos);
    const m = before.match(/\/[\w-]*$/);
    return m ? m[0] : "";
  })();
  const slashVisible = wordBeforeCursor.length > 0 && apiReady && !streaming;

  // R1 - detect @-mention trigger at the cursor. We look back from the
  // cursor for an `@` that is at the start of a token (preceded by
  // whitespace or BOF) and capture the text after it as the query.
  useEffect(() => {
    if (!apiReady || streaming) {
      if (mention) setMention(null);
      return;
    }
    const before = text.slice(0, cursorPos);
    // Match an @ that is at the start of a token and not part of an email.
    const m = before.match(/(^|\s)@([\w./\\-]*)$/);
    if (m) {
      const query = m[2];
      const at = before.lastIndexOf("@", cursorPos);
      setMention({ start: at, query });
    } else {
      if (mention) setMention(null);
    }
    // We intentionally do not depend on `mention` to avoid loops; the effect
    // reads/writes it through a ref-like pattern via the conditional check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, cursorPos, apiReady, streaming]);

  // R1 - select a mention: replace the `@query` token with `@<path> `.
  const handleMentionSelect = useCallback((hit: import("@/lib/agent/pi-client").OpenBuddyWorkspaceHit) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(cursorPos);
    const inserted = `@${hit.path} `;
    const next = before + inserted + after;
    updateText(next);
    const newCursor = before.length + inserted.length;
    setCursorPos(newCursor);
    setMention(null);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        ref.current.selectionStart = ref.current.selectionEnd = newCursor;
      }
    });
  }, [mention, text, cursorPos, updateText]);

  const handleSlashPick = (command: string) => {
    // Replace the "/xxx" fragment (up to cursor) with the picked command + " ".
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const newBefore = before.replace(/\/[\w-]*$/, command + " ");
    const next = newBefore + after;
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
            请先配置 API Key 开始使用
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
            const imageItem = Array.from(e.clipboardData.items ?? []).find(
              (it) => it.kind === "file" && it.type.startsWith("image/")
            );
            if (imageItem) {
              e.preventDefault();
              const file = imageItem.getAsFile();
              if (!file) return;
              void readImageFile(file).then((img) => {
                if (!img) return;
                setImages((prev) => [...prev, img]);
                // Mirror the old placeholder text so the user sees something
                // appear in the textarea even though the real bytes ride
                // through onSendContent.
                const ph = img.name ? `![pasted image: ${img.name}]()` : "![pasted image]()";
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
            const nativeReadText = (window as Window & { api?: ElectronWindowApi }).api?.clipboard?.readText;
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              if (slashVisible) {
                return;
              }
              e.preventDefault();
              send();
              return;
            }
            // 输入历史 arrow-key recall(对齐 WorkBuddy use-input-history)。
            // 仅在未组合输入(中文输入法)且非 slash 菜单可见时响应。
            if (!slashVisible && !e.nativeEvent.isComposing) {
              const el = e.target as HTMLTextAreaElement;
              const atFirstLine = el.selectionStart === 0 || text.length === 0;
              const atLastLine = el.selectionStart === text.length;
              // 已在历史导航中(cursor < items.length)时,↑/↓ 持续翻页,不受光标位置约束。
              const navigating = histCursorRef.current < histRef.current.items.length;
              if (e.key === "ArrowUp" && (atFirstLine || navigating)) {
                if (histCursorRef.current === histRef.current.items.length) {
                  draftRef.current = text; // 进入历史前暂存当前草稿
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
        {/* R1 - @-mention picker. Floats above the composer when the user
            is typing an @ token. The picker handles its own keyboard nav
            (up/down/enter/esc) via a window-level listener. */}
        <MentionPicker
          open={mention !== null}
          query={mention?.query ?? ""}
          cwd={cwd ?? ""}
          anchor={{ top: -340, left: 0 }}
          onSelect={handleMentionSelect}
          onDismiss={() => setMention(null)}
        />
        {/* Slash-command autocomplete */}
        <SlashCommands
          text={text}
          cursor={cursorPos}
          onPick={handleSlashPick}
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
          {pluginComposerContributions.map((contribution) => {
            const payload = contribution.payload;
            // 与侧栏贡献一致:payload.hidden 的占位条目只保留 id,不渲染。
            if (payload.hidden === true) return null;
            const label = payload.label ?? payload.title ?? contribution.id;
            return (
              <button
                key={contribution.id}
                type="button"
                className="wb-composer__plugin-action"
                title={payload.description ?? label}
                onClick={(event) => {
                  event.stopPropagation();
                  if (payload.insertText !== undefined) {
                    updateText((prev) => {
                      const prefix = prev === "" || prev.endsWith(" ") ? "" : " ";
                      return prev + prefix + payload.insertText;
                    });
                    requestAnimationFrame(() => ref.current?.focus());
                  }
                  if (payload.placeholder) ph(payload.placeholder);
                  if (typeof payload.onActivate === "function") payload.onActivate();
                }}
              >
                {label}
              </button>
            );
          })}
          {pluginComposerSlots.map((entry) => (
            <RendererSlotView key={String(entry.options.id ?? entry.options.key ?? entry.options.name)} entry={entry} className="wb-composer__plugin-action" />
          ))}
          {activeExpertName && (
            <span className="wb-composer__expert-badge" title={`当前专家：${activeExpertName}`}>
              <ThumbImg name={activeExpertName} local={activeExpertAvatar} size={18} shape="circle" />
              {activeExpertName}
            </span>
          )}
          {permissionInline && (
            <PermissionPicker onToast={onToast} />
          )}
          <div className="wb-composer__spacer" />
          {/* 发送前成本预估徽章(对齐 WorkBuddy credit-estimate):纯本地 token 估算,
              仅在文本非空时显示。不依赖计费后端(BYOK 无计费通道)。 */}
          {text.trim() && (
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
          {streaming ? (
            <>
              {/* 流式时可加入待发送队列(对齐 WorkBuddy message-queue)。 */}
              {onEnqueue && text.trim() !== "" && (
                <button
                  className="wb-composer__send wb-composer__send--enqueue"
                  onClick={(e) => {
                    e.stopPropagation();
                    enqueue();
                  }}
                  disabled={disabled || !apiReady}
                  aria-label="加入待发送队列"
                  title="加入待发送队列(agent 完成后自动发送)"
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
                // R6.8 — 停止按钮必须永远可点。即便 apiReady=false / disabled=true,
                // 用户面对"AI 卡死但 UI 整体还能动"时,这是唯一的逃生口。
                // 取消本身不依赖 apiReady(走 piCancel 单独的 IPC 通道)。
                disabled={false}
                aria-label="停止生成"
                title="停止生成(若 AI 长时间无响应,可强制中断)"
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
              // R0.8: disable send when there's no content AND no attachments,
              // when disabled by parent (e.g. api not ready), or while streaming.
              disabled={
                (text.trim() === "" && attachments.length === 0) ||
                disabled ||
                streaming
              }
              onClick={(e) => {
                e.stopPropagation();
                send();
              }}
              aria-label="发送"
              title={!apiReady ? "请先配置 API Key" : "发送消息"}
            >
              <SendPlaneIcon size="md" />
            </button>
          )}
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

// ---------- SpeechRecognition minimal typing ----------
// The browser SpeechRecognition API isn't in the TS DOM lib by default, and
// vendor prefixes vary. We type only the surface we use and resolve the ctor
// defensively at runtime.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface VoiceRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: (e: SpeechRecognitionEventLike) => void;
  onerror: (e: SpeechRecognitionErrorEventLike) => void;
  onend: () => void;
}
type VoiceRecognitionCtor = new () => VoiceRecognition;

function getSpeechRecognitionCtor(): VoiceRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: VoiceRecognitionCtor;
    webkitSpeechRecognition?: VoiceRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * 注册内建 Web Speech ASR provider 到 voice-contract 注册表(provider-agnostic,
 * 对齐 WorkBuddy `asr:*` 契约)。外部 provider(如云端 STT)注册后会因其更高
 * 优先级而被优先使用。仅在首次调用时注册一次。
 */
let webSpeechAsrRegistered = false;
function ensureWebSpeechAsrRegistered(): void {
  if (webSpeechAsrRegistered) return;
  webSpeechAsrRegistered = true;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return;
  registerAsrProvider(
    createWebSpeechAsrProvider({
      isAvailable: () => getSpeechRecognitionCtor() !== null,
      createRecognition: (lang) => {
        const rec = new Ctor();
        rec.lang = lang;
        rec.interimResults = true;
        rec.continuous = false;
        return rec as never;
      },
    }),
  );
}

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
