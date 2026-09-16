import { useCallback, useEffect, useRef, useState } from "react";
import { EditToolIcon } from "@openbuddy/ui-primitives/icons";
import { TopbarStatusChip, type TopbarStatusTone } from "./TopbarStatusChip";

/**
 * Editable conversation title for the main topbar — mirrors WorkBuddy's
 * `workbuddy-topbar` title interaction:
 *   - default: plain title text; a pencil button fades in on hover;
 *   - click pencil → the title swaps to an <input> with the text selected;
 *   - Enter / blur commits (empty or unchanged = no-op), Esc cancels.
 *
 * `onRename` should persist the title (pi's x.ai/session/rename) and update
 * the sessions store; on rejection the draft reverts to the current title.
 *
 * Phase B 增补（全部可选，不传即与旧行为逐字节一致）：
 *   - `breadcrumb` → 标题前的浅色路径（如 ["项目","调研","周报"]，超过 3 段
 *     折叠成 `首段 / … / 末段`）；
 *   - `status` + `detail` → 标题后渲染一枚 <TopbarStatusChip>。
 */
export function TopbarTitle({
  title,
  onRename,
  appVersion,
  status,
  detail,
  breadcrumb,
  editable = true,
}: {
  title: string;
  onRename: (newTitle: string) => Promise<void>;
  /**
   * 控制标题旁边「编辑」铅笔按钮是否显示。首页 / 占位页没有
   * 真实会话时关闭,避免出现「编辑 OpenBuddy」这种无意义触点。
   */
  editable?: boolean;
  /**
   * Optional app version pill rendered next to the conversation title
   * (mirrors WorkBuddy's "WorkBuddy v5.4.7" header chip). When omitted
   * no badge is rendered — callers should pass `APP_VERSION` from
   * `@/lib/platform/app-version`.
   */
  appVersion?: string;
  /** 会话 / 任务状态；传入时才渲染状态胶囊。 */
  status?: TopbarStatusTone;
  /** 状态胶囊的次要文案（模型名、队列长度等）。 */
  detail?: string;
  /** 标题前的路径面包屑。 */
  breadcrumb?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track external title updates (e.g. pi's LLM-generated summary arriving
  // via pi://summary) while we're not editing.
  useEffect(() => {
    if (!editing) setValue(title);
  }, [title, editing]);

  // Focus + select-all on entering edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!title) return;
      setValue(title);
      setEditing(true);
    },
    [title],
  );

  const commit = useCallback(async () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== title) {
      try {
        await onRename(trimmed);
      } catch {
        setValue(title); // revert the draft; the store keeps the old title
      }
    }
  }, [value, title, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commit();
      } else if (e.key === "Escape") {
        setEditing(false);
        setValue(title);
      }
    },
    [commit, title],
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="main-topbar__title-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span className="main-topbar__title-area">
      <TopbarBreadcrumb segments={breadcrumb} />
      <span className="main-topbar__title" title={title || "未命名会话"}>
        {title || "未命名会话"}
      </span>
      {title && editable && (
        <button
          className="main-topbar__title-edit"
          type="button"
          aria-label="编辑标题"
          data-tip="编辑标题"
          onClick={startEdit}
        >
          <EditToolIcon size="sm" />
        </button>
      )}
      {status && <TopbarStatusChip tone={status} label={statusLabel(status)} detail={detail} />}
      {appVersion && (
        <span
          className="main-topbar__version-pill"
          title={`OpenBuddy 版本 ${appVersion}`}
          aria-label={`OpenBuddy 版本 ${appVersion}`}
        >
          v{appVersion}
        </span>
      )}
    </span>
  );
}

const STATUS_LABEL: Record<TopbarStatusTone, string> = {
  ready: "就绪",
  working: "生成中",
  paused: "已暂停",
  offline: "离线",
  error: "出错",
};

function statusLabel(tone: TopbarStatusTone): string {
  return STATUS_LABEL[tone] ?? tone;
}

/**
 * 面包屑：默认全量展示；超过 3 段时折叠成 `首段 / … / 末段`，避免长路径把
 * 标题挤出顶栏（cabinet 的 viewer-breadcrumb 也用同样的折叠策略）。
 * 最后一段带 `aria-current="page"`。
 */
function TopbarBreadcrumb({ segments }: { segments?: string[] }) {
  const parts = (segments ?? []).filter((s) => s && s.trim().length > 0);
  if (parts.length === 0) return null;
  const shown = parts.length > 3 ? [parts[0], "…", parts[parts.length - 1]] : parts;

  return (
    <nav className="main-topbar__breadcrumb" aria-label="路径">
      {shown.map((part, i) => {
        const isLast = i === shown.length - 1;
        return (
          <span key={`${part}-${i}`} className="main-topbar__breadcrumb-part">
            {i > 0 && (
              <span className="main-topbar__breadcrumb-sep" aria-hidden>
                /
              </span>
            )}
            <span
              className="main-topbar__breadcrumb-label"
              aria-current={isLast ? "page" : undefined}
              title={part}
            >
              {part}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
