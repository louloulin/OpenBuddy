import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { shortModelLabel } from "../../openbuddy-ui-shared/src/model-label";
import { ChevronDown, Check, Settings2, Trash2 } from "lucide-react";

/**
 * Model picker dropdown for the Composer. Shows the current model id on a
 * trigger button; clicking (or pressing Enter/Space/↓) opens a listbox menu
 * listing every available model. Selecting one calls onModelChange.
 *
 * R2.1 — full a11y:
 *   - trigger: aria-haspopup="listbox", aria-expanded, aria-controls
 *   - menu: role="listbox" with aria-activedescendant + id
 *   - keyboard: ↑/↓ to move, Home/End to jump, Enter to select, Esc to close
 *   - empty state distinguishes "未配置模型" + a "前往设置" affordance
 *   - Type-ahead: typing jumps to the option whose label starts with the letter
 *
 * plan1030 §5.2.1 — 菜单 portal 到 body + position:fixed(对齐 R8.61
 * MentionPicker 的契约):composer 卡片及外层托盘有 `overflow:hidden`,菜单
 * 向上展开时首行会被卡片顶边裁掉;portal 出去后不再受祖先裁剪链影响。
 * 注意 outside-close 必须豁免 portal 菜单内的 mousedown,否则菜单先关闭、
 * 行点击永远落空(经典 portal dropdown bug,等价于"切换完全不可用")。
 */
/**
 * Capability hint surfaced as a small chip next to each model in the
 * dropdown. Provider-declared (or inferred conservatively from apiBackend
 * when omitted) so the UI never claims a capability we can't verify.
 * B.7 alignment — users can tell at a glance whether a model supports
 * vision / tools / reasoning before attaching an image or invoking a tool.
 */
export type CapabilityHint = "vision" | "tools" | "reasoning" | "json_mode" | "streaming";

export interface ModelOption {
  id: string;
  label?: string;
  /** Optional provider kind, used to group/sort models in the dropdown. */
  providerKind?: string;
  /** Optional provider id this model belongs to. */
  providerId?: string;
  /**
   * Wire protocol the provider speaks. Drives the badge in the dropdown so
   * users can tell at a glance whether a model is OpenAI Chat-Completions,
   * OpenAI Responses, or Anthropic Messages. Mirrors pi's ApiBackend enum.
   */
  apiBackend?: "chat_completions" | "responses" | "messages";
  /**
   * Optional explicit capability declaration. When omitted, `inferCapabilities`
   * derives a conservative set from `apiBackend` + the model id.
   */
  capabilities?: CapabilityHint[];
}

/**
 * Conservative capability inference — better to under-promise than mislead.
 *   - messages (Anthropic) → vision + tools + reasoning + json_mode
 *   - responses (OpenAI Responses) → vision + tools + json_mode
 *   - chat_completions or missing → fall back to id-pattern matching
 */
export function inferCapabilities(m: ModelOption): CapabilityHint[] {
  if (m.capabilities && m.capabilities.length > 0) return m.capabilities;
  const id = (m.id + " " + (m.label ?? "")).toLowerCase();
  const out: CapabilityHint[] = [];
  if (m.apiBackend === "messages") {
    out.push("vision", "tools", "reasoning", "json_mode");
    return out;
  }
  if (m.apiBackend === "responses") {
    out.push("vision", "tools", "json_mode");
    return out;
  }
  if (/gpt-4|gpt-5|o3|o4|claude|gemini|grok|qwen-vl|deepseek-vl|llava|vision|vl/i.test(id)) {
    out.push("vision");
  }
  if (/gpt-4|gpt-5|o3|o4|claude|gemini|grok|qwen|function[-_ ]?calling|tools/i.test(id)) {
    out.push("tools");
  }
  if (/o3|o4|deepseek-r1|reasoning|claude.*opus|claude.*sonnet.*4|qwen.*qwen|thinking/i.test(id)) {
    out.push("reasoning");
  }
  if (/gpt-4|gpt-3\.5|claude|gemini/i.test(id)) {
    out.push("json_mode");
  }
  return out;
}

/**
 * 推理档位(对齐 WorkBuddy 的"✓均衡"合并标签):与模型共用一个下拉,
 * 触发器显示 `档位 (模型名)`。值对齐 pi 的 ThinkingLevel。
 */
export type ThinkingLevel = "off" | "low" | "medium" | "high";

/** 没有可用模型时的统一文案:下拉空态与触发器共用,避免两处各写一份。 */
const EMPTY_LABEL = "未配置模型";

const THINKING_OPTIONS: ReadonlyArray<{ value: ThinkingLevel; label: string; title: string }> = [
  { value: "off", label: "关", title: "关闭推理" },
  { value: "low", label: "轻", title: "轻度推理" },
  { value: "medium", label: "均衡", title: "均衡推理(默认)" },
  { value: "high", label: "深度", title: "深度推理" },
];

/** Human-friendly label for a capability chip. */
const CAPABILITY_LABEL: Record<CapabilityHint, { label: string; title: string }> = {
  vision: { label: "视觉", title: "支持图像/视觉输入" },
  tools: { label: "工具", title: "支持函数调用 / 工具" },
  reasoning: { label: "推理", title: "支持推理档位(慢但更准)" },
  json_mode: { label: "JSON", title: "支持结构化 JSON 输出" },
  streaming: { label: "流式", title: "支持增量流式输出" },
};

/** Human-friendly label for the wire-protocol badge. */
function apiBackendLabel(apiBackend: ModelOption["apiBackend"]): string | null {
  switch (apiBackend) {
    case "chat_completions":
      return "Chat Completions";
    case "responses":
      return "OpenAI Responses";
    case "messages":
      return "Anthropic Messages";
    default:
      return null;
  }
}

/**
 * Generate a stable, human-readable typeahead key per option. Falls back to
 * the raw id when no label is present.
 */
function optionKey(m: ModelOption): string {
  return (m.label || m.id).toLowerCase();
}

export function ModelSelector({
  modelId,
  models,
  onModelChange,
  onModelDelete,
  onOpenSettings,
  thinkingLevel,
  onThinkingChange,
}: {
  /** Currently selected model id (displayed on the trigger). */
  modelId?: string;
  models: ModelOption[];
  onModelChange: (id: string) => void;
  /**
   * plan1030 §5.2.1 — 行级删除:提供后每个模型行尾出现删除按钮(悬停/键盘
   * Delete 触发),调用方负责确认与持久化。不提供则不渲染删除入口。
   */
  onModelDelete?: (model: ModelOption) => void;
  /**
   * Optional callback invoked when the user clicks "前往设置" in the empty
   * state — typically opens the model picker in Settings. R2.1 lets the
   * picker escalate to the settings surface instead of being a dead end.
   */
  onOpenSettings?: () => void;
  /** 当前推理档位;提供后下拉追加"推理档位"分区、触发器合并显示。 */
  thinkingLevel?: ThinkingLevel;
  /** 切换推理档位;不提供则只选模型(WB 合并标签关闭)。 */
  onThinkingChange?: (level: ThinkingLevel) => void;
}) {
  const hasThinking = typeof onThinkingChange === "function";
  const hasDelete = typeof onModelDelete === "function";
  const baseId = useId();
  const menuId = `${baseId}-menu`;
  const triggerId = `${baseId}-trigger`;
  // 扁平索引空间:前 models.length 项是模型,其后是推理档位;分区标题不占索引。
  const total = models.length + (hasThinking ? THINKING_OPTIONS.length : 0);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [typeahead, setTypeahead] = useState("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  // portal 菜单的 fixed 定位锚点:打开时对 trigger 取一次视口坐标。
  const [anchor, setAnchor] = useState<{ bottom: number; right: number } | null>(null);

  // Active option index — defaults to the currently selected model so the
  // menu opens with focus on the user's current pick (predictable for
  // keyboard users who tab through and press Enter without thinking).
  const defaultActive = useMemo(() => {
    if (!modelId) return 0;
    const idx = models.findIndex((m) => m.id === modelId);
    return idx >= 0 ? idx : 0;
  }, [modelId, models]);

  // Reset active index when the menu toggles or the model list changes.
  useEffect(() => {
    if (open) {
      setActiveIndex(total > 0 ? defaultActive : -1);
      setTypeahead("");
    }
  }, [open, defaultActive, total]);

  // portal 菜单的 fixed 定位锚点:打开时对 trigger 取一次视口坐标。
  // useLayoutEffect:锚点必须在浏览器绘制前就位,否则菜单会先闪现在
  // (0,0) 再跳到正确位置。
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ bottom: window.innerHeight - rect.top + 6, right: window.innerWidth - rect.right });
  }, [open]);

  // Outside click + Escape close. portal 菜单在 rootRef 之外,必须豁免 ——
  // mousedown 先于 click,不豁免会让菜单在行点击落地前就被关闭。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Type-ahead: buffer keystrokes for 500ms then jump to the first option
  // whose label starts with the buffer (case-insensitive). Mirrors the WAI-
  // ARIA combobox keyboard pattern.
  const handleTypeahead = useCallback(
    (key: string) => {
      if (key.length !== 1 || !/[a-z0-9]/i.test(key)) return;
      const next = (typeahead + key).toLowerCase();
      setTypeahead(next);
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = setTimeout(() => setTypeahead(""), 500);
      const idx = models.findIndex((m) => optionKey(m).startsWith(next));
      if (idx >= 0) setActiveIndex(idx);
    },
    [typeahead, models],
  );

  const activeId = activeIndex >= 0 ? `${menuId}-opt-${activeIndex}` : undefined;

  const onTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      // Focus last option so the user can navigate backwards.
      setActiveIndex(Math.max(0, models.length - 1));
    } else if (/[a-z0-9]/i.test(e.key)) {
      // Type-ahead works even when the menu is closed — open + jump.
      e.preventDefault();
      setOpen(true);
      handleTypeahead(e.key);
    }
  };

  // 选中第 idx 个 option(模型在前、推理档位在后)。键盘 Enter/Space 与鼠标
  // 点击共用这一份逻辑 —— 鼠标点击通过 <ul> 上的事件委托派发过来,
  // 因为 role="option" 的 <li> 本身不该带 onClick:listbox 用的是
  // aria-activedescendant,焦点始终停在 <ul> 上(option 不能单独 tab),
  // 键盘契约由下面的 onMenuKey 完整承担。
  const selectIndex = (idx: number) => {
    if (idx < 0 || idx >= total) return;
    if (idx < models.length) {
      onModelChange(models[idx].id);
      setOpen(false);
      triggerRef.current?.focus();
    } else if (hasThinking) {
      // 档位切换不关菜单:用户常想连续调整模型+档位,看得见勾选移动。
      onThinkingChange(THINKING_OPTIONS[idx - models.length].value);
    }
  };

  const onMenuClick = (e: React.MouseEvent<HTMLUListElement>) => {
    // 行尾删除按钮自带 onClick(stopPropagation),走到这里说明目标不是按钮;
    // 再防御一次,避免未来有人忘写 stopPropagation 时误触发选中。
    if ((e.target as HTMLElement).closest("[data-model-delete]")) return;
    const li = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-option-index]");
    // 空态行 / 「推理档位」标题行没有 data-option-index,不该触发选中;
    // closest 还会越过 <ul> 往上找,所以再确认一次命中在菜单内。
    if (!li || !e.currentTarget.contains(li)) return;
    selectIndex(Number(li.dataset.optionIndex));
  };

  const onMenuKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (total === 0) return;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % total);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? total - 1 : i - 1));
        break;
      }
      case "Home": {
        e.preventDefault();
        setActiveIndex(0);
        break;
      }
      case "End": {
        e.preventDefault();
        setActiveIndex(total - 1);
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        selectIndex(activeIndex);
        break;
      }
      case "Delete":
      case "Backspace": {
        // 键盘删除:仅对模型行生效(档位行没有删除语义)。删除后菜单保持
        // 打开 —— 用户常要连续清理多个模型;列表收窄由父组件刷新 models。
        if (!hasDelete || activeIndex < 0 || activeIndex >= models.length) return;
        e.preventDefault();
        onModelDelete(models[activeIndex]);
        break;
      }
      case "Escape": {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      }
      case "Tab": {
        // Tab closes the menu but lets focus escape (standard combobox).
        setOpen(false);
        break;
      }
      default:
        handleTypeahead(e.key);
    }
  };

  const current = models.find((m) => m.id === modelId);
  // 只在**真的匹配到条目**时用它的标签。此前这里在匹配不到时会回退到上游传进来的
  // `modelId` 原值,而一个 provider 都没配置时上游塞的是占位 id(实测渲染出字面量
  // "unknown/unknown") —— 用户会以为存在这么个模型。下拉里本来就有正确的空态
  // (「未配置模型」+ 前往设置),触发器应当和它一致。
  // 触发按钮只显示模型短名(custom_* 内部前缀剥掉,审计 A5);完整 id
  // 放在 trigger 的 title 里。
  const rawModelLabel = current?.label || current?.id || (models.length === 0 ? "" : modelId || "");
  const modelLabel = shortModelLabel(rawModelLabel) || rawModelLabel;
  const thinkOpt = hasThinking
    ? THINKING_OPTIONS.find((o) => o.value === thinkingLevel) ?? THINKING_OPTIONS[2]
    : null;
  // WB 合并标签:`✓均衡 (Deepseek-V4-Pro)`;无模型配置时只显示档位。
  const triggerLabel = thinkOpt
    ? modelLabel
      ? `${thinkOpt.label} (${modelLabel})`
      : thinkOpt.label
    : modelLabel || (models.length === 0 ? EMPTY_LABEL : "Auto");

  return (
    <div className="model-selector" ref={rootRef}>
      <button
        id={triggerId}
        ref={triggerRef}
        title={rawModelLabel || undefined}
        className="model-selector__trigger"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
      >
        {thinkOpt && <Check size={12} strokeWidth={2} className="model-selector__think-check" />}
        <span className="model-selector__label">{triggerLabel}</span>
        <ChevronDown size={14} strokeWidth={1.75} className="model-selector__arrow" />
      </button>
      {open && anchor && createPortal(
        <ul
          id={menuId}
          className="model-selector__menu"
          role="listbox"
          aria-labelledby={triggerId}
          aria-activedescendant={activeId}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          onClick={onMenuClick}
          style={{
            // plan1030 §5.2.1 — fixed + portal,脱离 composer 的 overflow/层叠
            // 上下文;向上展开(菜单在 footer,下方是屏幕底)。
            position: "fixed",
            bottom: anchor.bottom,
            right: anchor.right,
            top: "auto",
            left: "auto",
            maxHeight: "min(320px, 46vh)",
            zIndex: 1100,
          }}
          ref={(node) => {
            menuRef.current = node;
            // Auto-focus the menu when opened so keyboard users land inside
            // the listbox without an extra Tab press.
            if (node && open) node.focus({ preventScroll: true });
          }}
        >
          {models.length === 0 && (
            <li className="model-selector__empty" role="presentation">
              <span>{EMPTY_LABEL}</span>
              {onOpenSettings ? (
                <button
                  type="button"
                  className="model-selector__empty-action"
                  onClick={() => {
                    setOpen(false);
                    onOpenSettings();
                  }}
                >
                  <Settings2 size={12} strokeWidth={1.75} />
                  前往设置
                </button>
              ) : null}
            </li>
          )}
          {models.map((m, idx) => {
            const isActive = m.id === modelId;
            const isFocused = idx === activeIndex;
            return (
              <li
                key={m.id}
                id={`${menuId}-opt-${idx}`}
                role="option"
                data-option-index={idx}
                aria-selected={isActive}
                className={
                  "model-selector__item" +
                  (isActive ? " model-selector__item--active" : "") +
                  (isFocused ? " model-selector__item--focused" : "")
                }
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <span className="model-selector__item-label">{m.label || m.id}</span>
                {apiBackendLabel(m.apiBackend) && (
                  <span
                    className={"model-selector__item-protocol model-selector__item-protocol--" + m.apiBackend}
                    title={`Wire protocol: ${m.apiBackend}`}
                  >
                    {apiBackendLabel(m.apiBackend)}
                  </span>
                )}
                {inferCapabilities(m).slice(0, 3).map((cap) => {
                  const meta = CAPABILITY_LABEL[cap];
                  return (
                    <span
                      key={cap}
                      className={"model-selector__item-cap model-selector__item-cap--" + cap}
                      title={meta.title}
                      data-cap={cap}
                    >
                      {meta.label}
                    </span>
                  );
                })}
                <span className="model-selector__item-id">{m.id}</span>
                {hasDelete && (
                  <button
                    type="button"
                    className="model-selector__item-delete"
                    data-model-delete
                    aria-label={`删除模型 ${m.label || m.id}`}
                    title={`删除模型 ${m.label || m.id}(Delete 键删除当前高亮行)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onModelDelete?.(m);
                    }}
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                )}
                {isActive && <Check size={14} className="model-selector__check" />}
              </li>
            );
          })}
          {hasThinking && (
            <>
              <li className="model-selector__section" role="presentation">
                推理档位
              </li>
              {THINKING_OPTIONS.map((opt, ti) => {
                const idx = models.length + ti;
                const isActive = opt.value === thinkingLevel;
                const isFocused = idx === activeIndex;
                return (
                  <li
                    key={opt.value}
                    id={`${menuId}-opt-${idx}`}
                    role="option"
                    data-option-index={idx}
                    aria-selected={isActive}
                    className={
                      "model-selector__item" +
                      (isActive ? " model-selector__item--active" : "") +
                      (isFocused ? " model-selector__item--focused" : "")
                    }
                    onMouseEnter={() => setActiveIndex(idx)}
                    title={opt.title}
                  >
                    <span className="model-selector__item-label">{opt.label}</span>
                    <span className="model-selector__item-id">{opt.title}</span>
                    {isActive && <Check size={14} className="model-selector__check" />}
                  </li>
                );
              })}
            </>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}