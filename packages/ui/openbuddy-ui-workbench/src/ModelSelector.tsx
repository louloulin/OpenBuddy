import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, Settings2 } from "lucide-react";

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
 */
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
}

/**
 * 推理档位(对齐 WorkBuddy 的"✓均衡"合并标签):与模型共用一个下拉,
 * 触发器显示 `档位 (模型名)`。值对齐 pi 的 ThinkingLevel。
 */
export type ThinkingLevel = "off" | "low" | "medium" | "high";

const THINKING_OPTIONS: ReadonlyArray<{ value: ThinkingLevel; label: string; title: string }> = [
  { value: "off", label: "关", title: "关闭推理" },
  { value: "low", label: "轻", title: "轻度推理" },
  { value: "medium", label: "均衡", title: "均衡推理(默认)" },
  { value: "high", label: "深度", title: "深度推理" },
];

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
  onOpenSettings,
  thinkingLevel,
  onThinkingChange,
}: {
  /** Currently selected model id (displayed on the trigger). */
  modelId?: string;
  models: ModelOption[];
  onModelChange: (id: string) => void;
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

  // Outside click + Escape close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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
        if (activeIndex >= 0 && activeIndex < total) {
          if (activeIndex < models.length) {
            onModelChange(models[activeIndex].id);
            setOpen(false);
            triggerRef.current?.focus();
          } else if (hasThinking) {
            // 档位切换不关菜单:用户常想连续调整模型+档位,看得见勾选移动。
            onThinkingChange(THINKING_OPTIONS[activeIndex - models.length].value);
          }
        }
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
  const modelLabel = current?.label || current?.id || modelId || "";
  const thinkOpt = hasThinking
    ? THINKING_OPTIONS.find((o) => o.value === thinkingLevel) ?? THINKING_OPTIONS[2]
    : null;
  // WB 合并标签:`✓均衡 (Deepseek-V4-Pro)`;无模型配置时只显示档位。
  const triggerLabel = thinkOpt
    ? modelLabel
      ? `${thinkOpt.label} (${modelLabel})`
      : thinkOpt.label
    : modelLabel || "Auto";

  return (
    <div className="model-selector" ref={rootRef}>
      <button
        id={triggerId}
        ref={triggerRef}
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
      {open && (
        <ul
          id={menuId}
          className="model-selector__menu"
          role="listbox"
          aria-labelledby={triggerId}
          aria-activedescendant={activeId}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          ref={(node) => {
            // Auto-focus the menu when opened so keyboard users land inside
            // the listbox without an extra Tab press.
            if (node && open) node.focus({ preventScroll: true });
          }}
        >
          {models.length === 0 && (
            <li className="model-selector__empty" role="presentation">
              <span>未配置模型</span>
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
                aria-selected={isActive}
                className={
                  "model-selector__item" +
                  (isActive ? " model-selector__item--active" : "") +
                  (isFocused ? " model-selector__item--focused" : "")
                }
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => {
                  onModelChange(m.id);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
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
                <span className="model-selector__item-id">{m.id}</span>
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
                    aria-selected={isActive}
                    className={
                      "model-selector__item" +
                      (isActive ? " model-selector__item--active" : "") +
                      (isFocused ? " model-selector__item--focused" : "")
                    }
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => onThinkingChange?.(opt.value)}
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
        </ul>
      )}
    </div>
  );
}