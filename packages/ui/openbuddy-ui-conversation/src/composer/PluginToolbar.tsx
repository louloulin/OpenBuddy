/**
 * composer/PluginToolbar — the three plugin button loops in the Composer's footer.
 *
 * Goal mu7rpkze-gc769z / phase3-composer-split. The three `.map(...)` loops
 * (renderer-slot contributions, renderer-slot views, and the data-driven
 * `composer.toolbar.action` slot actions) used to live inline in
 * `Composer.tsx` (~52 lines). Phase-3 split moved them into this small
 * sub-component so the orchestrator file stays under the 800-line cap.
 *
 * Each button honours the WorkBuddy convention: `event.stopPropagation()`
 * (so the click doesn't bubble to the surrounding textarea / card),
 * `updateText(prev + prefix + snippet)` for inserts (with a single-space
 * separator if the buffer is non-empty and doesn't end in space), and
 * `requestAnimationFrame(() => ref.current?.focus())` to restore the
 * caret after the insert lands.
 */
import { RendererSlotView } from "@openbuddy/ui-workbench";

export interface PluginToolbarContribution {
  id: string;
  payload: {
    hidden?: boolean;
    label?: string;
    title?: string;
    description?: string;
    insertText?: string;
    placeholder?: string;
    onActivate?: () => void;
  };
}

export interface PluginToolbarAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
  insertText?: string;
  placeholder?: string;
  onClick?: (ctx: { insertText: (text: string) => void }) => void;
  onActivate?: () => void;
}

export interface PluginToolbarSlotEntry {
  /** The renderer component to mount (RendererSlotView's `entry.component`). */
  component: React.ComponentType<unknown>;
  options: {
    id?: string;
    key?: string;
    name?: string;
  };
}

export interface PluginToolbarProps {
  contributions: readonly PluginToolbarContribution[];
  slots: readonly PluginToolbarSlotEntry[];
  toolbarActions: readonly PluginToolbarAction[];
  /** Mutator that also syncs the persisted draft. */
  updateText: (next: string | ((prev: string) => string)) => void;
  /** Textarea ref — used to restore focus after an insert. */
  textareaRef: { current: HTMLTextAreaElement | null };
  /** Local placeholder callback (was `ph(label)` in the inline JSX). */
  onPlaceholder?: (label: string) => void;
}

export function PluginToolbar(props: PluginToolbarProps) {
  const { contributions, slots, toolbarActions, updateText, textareaRef, onPlaceholder } = props;
  return (
    <>
      {contributions.map((contribution) => {
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
                requestAnimationFrame(() => textareaRef.current?.focus());
              }
              if (payload.placeholder) onPlaceholder?.(payload.placeholder);
              if (typeof payload.onActivate === "function") payload.onActivate();
            }}
          >
            {label}
          </button>
        );
      })}
      {slots.map((entry) => (
        <RendererSlotView
          key={String(entry.options.id ?? entry.options.key ?? entry.options.name)}
          entry={entry}
          className="wb-composer__plugin-action"
        />
      ))}
      {/* 微内核 `composer.toolbar.action` slot 的插件按钮。第三方插件通过
          plugin-sdk 的 api.registerSlot 注册，无需打包 React 组件。 */}
      {toolbarActions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="wb-composer__plugin-action"
          title={action.description ?? action.label}
          onClick={(event) => {
            event.stopPropagation();
            const insert = (snippet: string) => {
              updateText((prev) => {
                const prefix = prev === "" || prev.endsWith(" ") ? "" : " ";
                return prev + prefix + snippet;
              });
              requestAnimationFrame(() => textareaRef.current?.focus());
            };
            if (action.insertText !== undefined) insert(action.insertText);
            if (action.placeholder) onPlaceholder?.(action.placeholder);
            action.onClick?.({ insertText: insert });
            action.onActivate?.();
          }}
        >
          {action.icon ? <span aria-hidden="true">{action.icon}</span> : null}
          {action.label}
        </button>
      ))}
    </>
  );
}