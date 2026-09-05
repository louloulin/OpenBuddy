/**
 * ExtensionStatusBar.tsx — extension/plugin status strip.
 *
 * Phase 5 (UI 差距补齐) sub-item C: 对标 pi-web 的扩展状态条。显示已加载插件
 * 与加载失败插件的状态。数据来自 `plugin/loaded` / `plugin/failed` 事件索引
 * （阶段 4 已把插件事件索引到 sessionEventLog）。
 *
 * 纯展示组件：输入为 `extensions`（纯数据），输出为状态条。颜色复用 `--wb-*`
 * 令牌，零新 CSS 概念。
 */
import type { ReactNode } from "react";

export type ExtensionStatus = "loaded" | "failed" | "unloaded";

export interface ExtensionStatusEntry {
  id: string;
  name?: string;
  status: ExtensionStatus;
  error?: string;
}

export interface ExtensionStatusBarProps {
  /** Extension status entries (loaded / failed / unloaded). */
  extensions: ExtensionStatusEntry[];
  /** Called when the user clicks a failed extension to retry/inspect. */
  onInspect?: (id: string) => void;
  className?: string;
}

export function ExtensionStatusBar({ extensions, onInspect, className }: ExtensionStatusBarProps) {
  const loaded = extensions.filter((e) => e.status === "loaded").length;
  const failed = extensions.filter((e) => e.status === "failed").length;
  const unloaded = extensions.filter((e) => e.status === "unloaded").length;

  return (
    <div
      className={"extension-status-bar" + (className ? ` ${className}` : "")}
      role="status"
      aria-label="扩展状态"
      data-testid="extension-status-bar"
    >
      <span className="extension-status-bar__summary" data-testid="extension-status-summary">
        {extensions.length === 0
          ? "无扩展"
          : `${loaded} 已加载${failed ? ` · ${failed} 失败` : ""}${unloaded ? ` · ${unloaded} 未加载` : ""}`}
      </span>
      {failed > 0 && (
        <ul className="extension-status-bar__list" data-testid="extension-status-failed">
          {extensions
            .filter((e) => e.status === "failed")
            .map((e) => (
              <li key={e.id} className="extension-status-bar__item">
                <button
                  type="button"
                  className="extension-status-bar__item-button"
                  title={e.error ?? e.name ?? e.id}
                  onClick={() => onInspect?.(e.id)}
                  data-testid={`extension-status-failed-${e.id}`}
                >
                  {statusIcon(e.status)}
                  <span>{e.name ?? e.id}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function statusIcon(status: ExtensionStatus): ReactNode {
  switch (status) {
    case "loaded":
      return <span className="extension-status-bar__dot extension-status-bar__dot--ok" aria-hidden="true" />;
    case "failed":
      return <span className="extension-status-bar__dot extension-status-bar__dot--err" aria-hidden="true" />;
    case "unloaded":
      return <span className="extension-status-bar__dot extension-status-bar__dot--off" aria-hidden="true" />;
  }
}
