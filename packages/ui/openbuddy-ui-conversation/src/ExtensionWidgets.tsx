/**
 * ExtensionWidgets.tsx — extension-provided UI cards.
 *
 * Phase 5 (UI 差距补齐) sub-item D: 对标 pi-web 的扩展 UI 卡片。渲染扩展通过
 * `extensionUiRequest` 提供的 UI 载荷（标题/正文/动作按钮）。数据来自插件事件
 * 索引（阶段 4）。纯展示组件：输入为 `widgets`（纯数据），输出为卡片列表。
 *
 * 颜色复用 `--wb-*` 令牌，零新 CSS 概念。
 */
import type { ReactNode } from "react";

export type ExtensionWidgetAction = {
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "danger";
};

export interface ExtensionWidget {
  id: string;
  pluginId: string;
  title?: string;
  body?: string;
  /** Optional structured body rendered as a definition list. */
  fields?: Array<{ key: string; value: string }>;
  actions?: ExtensionWidgetAction[];
}

export interface ExtensionWidgetsProps {
  widgets: ExtensionWidget[];
  onAction?: (widgetId: string, actionId: string) => void;
  onDismiss?: (widgetId: string) => void;
  className?: string;
}

export function ExtensionWidgets({ widgets, onAction, onDismiss, className }: ExtensionWidgetsProps) {
  if (widgets.length === 0) return null;

  return (
    <div
      className={"extension-widgets" + (className ? ` ${className}` : "")}
      data-testid="extension-widgets"
    >
      {widgets.map((widget) => (
        <article key={widget.id} className="extension-widgets__card" data-testid={`extension-widget-${widget.id}`}>
          <header className="extension-widgets__header">
            {widget.title ? <h4 className="extension-widgets__title">{widget.title}</h4> : null}
            <span className="extension-widgets__plugin">{widget.pluginId}</span>
            {onDismiss ? (
              <button
                type="button"
                className="extension-widgets__dismiss"
                aria-label="关闭"
                onClick={() => onDismiss(widget.id)}
                data-testid={`extension-widget-dismiss-${widget.id}`}
              >
                ×
              </button>
            ) : null}
          </header>
          {widget.body ? <p className="extension-widgets__body">{widget.body}</p> : null}
          {widget.fields && widget.fields.length > 0 ? (
            <dl className="extension-widgets__fields">
              {widget.fields.map((field) => (
                <div key={field.key} className="extension-widgets__field">
                  <dt>{field.key}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {widget.actions && widget.actions.length > 0 ? (
            <footer className="extension-widgets__actions">
              {widget.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={`extension-widgets__action extension-widgets__action--${action.kind ?? "secondary"}`}
                  onClick={() => onAction?.(widget.id, action.id)}
                  data-testid={`extension-widget-action-${widget.id}-${action.id}`}
                >
                  {action.label}
                </button>
              ))}
            </footer>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/** Render a widget's body as plain text (helper for tests / a11y). */
export function widgetBodyText(widget: ExtensionWidget): string {
  const parts: string[] = [];
  if (widget.title) parts.push(widget.title);
  if (widget.body) parts.push(widget.body);
  if (widget.fields) for (const f of widget.fields) parts.push(`${f.key}: ${f.value}`);
  return parts.join("\n");
}

export function widgetActionLabel(action: ExtensionWidgetAction): ReactNode {
  return action.label;
}
