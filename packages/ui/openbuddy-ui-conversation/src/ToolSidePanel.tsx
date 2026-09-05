/**
 * 右侧统一工作区面板 —— 对齐 WorkBuddy `SidebarNext / DetailPanel`。
 *
 * 在原 3 模式（tool/artifacts/preview）基础上升级为统一工作区：
 *  - ViewSelector 下拉切换视图：产物 / 文件树 / 浏览器 / 变更
 *  - 统一标签页（useUnifiedTabs）：跨视图共享、自动开/关、可拖拽排序、会话持久化
 *  - 可调宽（Sash）+ 钉住左列 + 最大化 + 收起
 *  - 浏览器预览（BrowserPreview，含后退/前进/刷新/外开）
 *  - 文件树（FileTreeView，懒加载目录）
 *
 * 兼容性：保留原导出名 `ToolSidePanel` / `ToolSidePanelMode` 与 ChatView 的 props，
 * 新增内部状态管理视图/标签/宽度。原 "tool" 模式仍用于展示单个工具调用详情。
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ToolCallView } from "@/stores/session-store";
import type { SessionArtifact } from "@/lib/agent/session-artifacts";
import type { FileChange } from "@/lib/files/file-changes";
import { aggregateFileChanges } from "@/lib/files/file-changes";
import type { ChatMessage } from "@/stores/session-store";
import {
  useUnifiedTabs,
  type WorkspaceView,
} from "@/lib/ui/use-unified-tabs";
import { ToolCallDetailBody } from "./ToolCallCard";
import { openLocalPath } from "@/lib/markdown/markdown-host";
import { invoke } from "@/lib/platform/electron-api";
import { IS_MACOS } from "@/lib/platform/platform";
import { ViewSelector, defaultViews } from "@openbuddy/ui-workbench";
import { ArtifactTabsBar } from "@openbuddy/ui-workbench";
import { FileTreeView } from "@openbuddy/ui-workbench";
import { BrowserPreview } from "@openbuddy/ui-workbench";
import {
  WbPinIcon,
  WbUnpinIcon,
  MaximizeIcon,
  RestoreIcon,
  CloseIcon,
  ChevronLeftIcon,
} from "@openbuddy/ui-primitives/icons";

/** 向后兼容：原模式 + 新视图。tool 为单工具详情，其余映射到工作区视图。 */
export type ToolSidePanelMode =
  | "tool"
  | "artifacts"
  | "preview"
  | "fileTree"
  | "browser"
  | "changes";

// ---------- 持久化常量 ----------
const WIDTH_KEY = "tool-side-panel-width";
const NAV_WIDTH_KEY = "tool-side-panel-nav-width";
const DEFAULT_WIDTH = 380;
const DEFAULT_NAV_WIDTH = 200;
const MIN_WIDTH = 280;
const MAX_WIDTH_RATIO = 0.6; // 占视口 60%
const MIN_NAV_WIDTH = 140;
const MAX_NAV_WIDTH = 360;

interface ToolSidePanelProps {
  open: boolean;
  mode: ToolSidePanelMode;
  toolCall?: ToolCallView | null;
  artifacts: SessionArtifact[];
  previewPath?: string | null;
  cwd?: string;
  /** 会话消息（用于聚合文件变更）。 */
  messages?: ChatMessage[];
  /** 会话 id（用于标签页会话隔离）。 */
  sessionId?: string;
  onToast?: (msg: string) => void;
  onClose: () => void;
  onSelectTool: (tc: ToolCallView) => void;
  onSelectArtifact: (a: SessionArtifact) => void;
  onOpenArtifacts: () => void;
  findToolCall?: (id: string) => ToolCallView | undefined;
}

function ToolSidePanelInner({
  open,
  mode,
  toolCall,
  artifacts,
  previewPath,
  cwd,
  messages,
  sessionId,
  onToast,
  onClose,
  onSelectTool,
  onSelectArtifact,
  findToolCall,
}: ToolSidePanelProps) {
  // ---- 视图状态：把外部 mode 映射到内部 WorkspaceView ----
  const [view, setView] = useState<WorkspaceView>("artifacts");
  useEffect(() => {
    if (mode === "artifacts") setView("artifacts");
    else if (mode === "preview") setView("fileTree"); // 单文件预览映射到文件树视图
    else if (mode === "fileTree") setView("fileTree");
    else if (mode === "browser") setView("preview");
    else if (mode === "changes") setView("changes");
    // "tool" 模式不改 view（工具详情在主列覆盖渲染）
  }, [mode]);

  // ---- selection 状态 ----
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | undefined>();
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [browserUrl, setBrowserUrl] = useState<string | undefined>();

  // 文件变更数据。
  const changes = useMemo<FileChange[]>(
    () => (messages ? aggregateFileChanges(messages).files : []),
    [messages],
  );
  const hasChanges = changes.length > 0;

  // ---- 视图切换 ----
  const handleViewChange = useCallback((v: WorkspaceView) => {
    setView(v);
  }, []);

  const handleArtifactSelect = useCallback(
    (id?: string) => {
      setSelectedArtifactId(id);
      if (id) {
        const a = artifacts.find((x) => x.id === id);
        if (a) onSelectArtifact(a);
      }
    },
    [artifacts, onSelectArtifact],
  );

  const handleFileSelect = useCallback(
    (path?: string) => {
      setSelectedFilePath(path);
      if (path) {
        // 复用 onSelectArtifact 把路径包成 SessionArtifact，驱动主列预览。
        onSelectArtifact({
          id: path,
          path,
          kind: "file",
          title: basename(path),
          toolCallId: "",
          status: "completed",
        });
      }
    },
    [onSelectArtifact],
  );

  // ---- 统一标签页 ----
  const tabsApi = useUnifiedTabs({
    resetKey: sessionId,
    enabled: open,
    currentView: view,
    selectedArtifactId,
    selectedFilePath,
    browserUrl,
    artifacts,
    changes,
    onViewChange: handleViewChange,
    onArtifactSelect: handleArtifactSelect,
    onFileSelect: handleFileSelect,
    onBrowserUrlChange: setBrowserUrl,
  });

  // ---- 面板布局状态 ----
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved > 0 ? saved : DEFAULT_WIDTH;
  });
  const [navWidth, setNavWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(NAV_WIDTH_KEY));
    return saved > 0 ? saved : DEFAULT_NAV_WIDTH;
  });
  const [maximized, setMaximized] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);

  // 切换会话时重置 selection（避免跨会话残留）。
  useEffect(() => {
    setSelectedArtifactId(undefined);
    setSelectedFilePath(undefined);
    setBrowserUrl(undefined);
  }, [sessionId]);

  // 持久化宽度。
  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);
  useEffect(() => {
    localStorage.setItem(NAV_WIDTH_KEY, String(navWidth));
  }, [navWidth]);

  const effectiveNavCollapsed = pinned ? false : navCollapsed;

  if (!open) return null;

  const views = defaultViews({ hasChanges });
  // tool 模式：主列渲染工具详情；其余按工作区视图渲染。
  const showToolDetail = mode === "tool";

  return (
    <aside
      className={
        "tool-side-panel" +
        (maximized ? " tool-side-panel--maximized" : "")
      }
      style={
        maximized
          ? undefined
          : { width: `${Math.min(width, window.innerWidth * MAX_WIDTH_RATIO)}px` }
      }
      aria-label="工作区面板"
    >
      {/* 面板左边缘：全宽拖拽（非最大化时）。 */}
      {!maximized && (
        <div
          className="tool-side-panel__edge-sash"
          onPointerDown={(e) => startResizeEdge(e, width, setWidth)}
        />
      )}
      {/* 左导航列 */}
      <div
        className={
          "tool-side-panel__nav" +
          (effectiveNavCollapsed ? " tool-side-panel__nav--collapsed" : "")
        }
        style={
          effectiveNavCollapsed ? undefined : { width: `${navWidth}px` }
        }
      >
        {/* macOS 贴窗口顶边：空白处支持拖动/双击缩放（同 header）。 */}
        <div
          className="tool-side-panel__nav-header"
          {...(IS_MACOS ? { "data-openbuddy-drag": true } : {})}
        >
          <ViewSelector view={view} views={views} onChange={handleViewChange} />
          <button
            type="button"
            className="tool-side-panel__icon-btn"
            onClick={() => setPinned((p) => !p)}
            title={pinned ? "取消钉住" : "钉住左列"}
            aria-label={pinned ? "取消钉住" : "钉住左列"}
            aria-pressed={pinned}
          >
            {pinned ? <WbUnpinIcon size="sm" /> : <WbPinIcon size="sm" />}
          </button>
          {!pinned && (
            <button
              type="button"
              className="tool-side-panel__icon-btn"
              onClick={() => setNavCollapsed((v) => !v)}
              title={navCollapsed ? "展开导航" : "收起导航"}
              aria-label={navCollapsed ? "展开导航" : "收起导航"}
            >
              <ChevronLeftIcon
                size="sm"
                className={navCollapsed ? "tool-side-panel__icon--flip" : ""}
              />
            </button>
          )}
        </div>
        <div className="tool-side-panel__nav-body">
          <NavContent
            view={view}
            artifacts={artifacts}
            changes={changes}
            cwd={cwd}
            selectedArtifactId={selectedArtifactId}
            selectedFilePath={selectedFilePath}
            onArtifactSelect={handleArtifactSelect}
            onFileSelect={handleFileSelect}
            onToast={onToast}
          />
        </div>
      </div>

      {/* Sash：调整左列宽度 */}
      {!effectiveNavCollapsed && (
        <div
          className="tool-side-panel__sash"
          onPointerDown={(e) => startResizeNav(e, navWidth, setNavWidth)}
        />
      )}

      {/* 主内容列 */}
      <div className="tool-side-panel__main">
        {/* macOS 上这行 header 贴窗口顶边（Overlay 标题栏）：空白处需要
            data-openbuddy-drag 才能拖动窗口 / 双击缩放（红绿灯右侧的
            标签条区域）。tab 本身是子元素，不会成为拖拽目标，点击/拖拽
            排序不受影响。Windows 有自绘 TitleBar，不需要。 */}
        <header
          className="tool-side-panel__header"
          {...(IS_MACOS ? { "data-openbuddy-drag": true } : {})}
        >
          <div
            className="tool-side-panel__tabs"
            {...(IS_MACOS ? { "data-openbuddy-drag": true } : {})}
          >
            <ArtifactTabsBar
              tabs={tabsApi.tabs}
              activeTabId={tabsApi.activeTabId}
              onSelect={tabsApi.setActiveTab}
              onClose={tabsApi.closeTab}
              onReorder={tabsApi.reorderTabs}
            />
          </div>
          <div className="tool-side-panel__actions">
            <button
              type="button"
              className="tool-side-panel__icon-btn"
              onClick={() => setMaximized((m) => !m)}
              title={maximized ? "恢复" : "最大化"}
              aria-label={maximized ? "恢复" : "最大化"}
            >
              {maximized ? <RestoreIcon size="sm" /> : <MaximizeIcon size="sm" />}
            </button>
            <button
              type="button"
              className="tool-side-panel__icon-btn"
              onClick={onClose}
              aria-label="关闭面板"
              title="关闭"
            >
              <CloseIcon size="sm" />
            </button>
          </div>
        </header>

        <div className="tool-side-panel__body">
          {showToolDetail ? (
            toolCall ? (
              <ToolCallDetailBody
                tc={toolCall}
                onOpenPath={(path) => {
                  onSelectArtifact({
                    id: path,
                    path,
                    kind: toolCall.kind,
                    title: toolCall.title,
                    toolCallId: toolCall.toolCallId,
                    status: toolCall.status,
                  });
                }}
              />
            ) : (
              <p className="tool-side-panel__empty">在对话中点击工具行查看详情</p>
            )
          ) : (
            <MainContent
              view={view}
              artifacts={artifacts}
              cwd={cwd}
              previewPath={previewPath}
              selectedArtifactId={selectedArtifactId}
              selectedFilePath={selectedFilePath}
              browserUrl={browserUrl}
              onArtifactSelect={(a) => {
                const tc = findToolCall?.(a.toolCallId);
                if (tc) onSelectTool(tc);
                onSelectArtifact(a);
                handleArtifactSelect(a.id);
              }}
              onBrowserUrlChange={setBrowserUrl}
              onOpenOs={(path) => {
                void openLocalPath(path, { cwd, type: "file", onToast });
              }}
              onToast={onToast}
            />
          )}
        </div>
      </div>
    </aside>
  );
}

// ---------- 左导航内容：按视图渲染列表 ----------

function NavContent({
  view,
  artifacts,
  changes,
  cwd,
  selectedArtifactId,
  selectedFilePath,
  onArtifactSelect,
  onFileSelect,
  onToast,
}: {
  view: WorkspaceView;
  artifacts: SessionArtifact[];
  changes: FileChange[];
  cwd?: string;
  selectedArtifactId?: string;
  selectedFilePath?: string;
  onArtifactSelect: (id?: string) => void;
  onFileSelect: (path?: string) => void;
  onToast?: (msg: string) => void;
}) {
  if (view === "artifacts") {
    return (
      <ArtifactsNavList
        artifacts={artifacts}
        selectedId={selectedArtifactId}
        onSelect={(a) => onArtifactSelect(a.id)}
      />
    );
  }
  if (view === "changes") {
    return (
      <ChangesNavList
        changes={changes}
        selectedPath={selectedArtifactId}
        onSelect={(path) => onArtifactSelect(path)}
      />
    );
  }
  if (view === "fileTree") {
    return (
      <FileTreeView
        rootPath={cwd}
        selectedPath={selectedFilePath}
        onFileSelect={(p) => onFileSelect(p)}
        onToast={onToast}
      />
    );
  }
  // preview 视图：导航列显示历史/提示。
  return (
    <div className="tool-side-panel__empty">
      输入网址后在右侧预览。
    </div>
  );
}

function ArtifactsNavList({
  artifacts,
  selectedId,
  onSelect,
}: {
  artifacts: SessionArtifact[];
  selectedId?: string;
  onSelect: (a: SessionArtifact) => void;
}) {
  if (artifacts.length === 0) {
    return (
      <p className="tool-side-panel__empty">
        本会话还没有可展示的文件产物。工具写入/修改文件后会出现在这里。
      </p>
    );
  }
  return (
    <ul className="artifacts-list">
      {artifacts.map((a) => (
        <li key={a.id} className="artifacts-list__item">
          <button
            type="button"
            className={
              "artifacts-list__main" +
              (a.id === selectedId ? " artifacts-list__main--active" : "")
            }
            onClick={() => onSelect(a)}
            title={a.path}
          >
            <span className="artifacts-list__name">{basename(a.path)}</span>
            <span className="artifacts-list__path">{a.path}</span>
            <span className="artifacts-list__meta">
              {a.kind}
              {a.status === "failed" ? " · 失败" : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ChangesNavList({
  changes,
  selectedPath,
  onSelect,
}: {
  changes: FileChange[];
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  if (changes.length === 0) {
    return <p className="tool-side-panel__empty">本会话暂无文件变更。</p>;
  }
  return (
    <ul className="artifacts-list">
      {changes.map((f) => (
        <li key={f.path} className="artifacts-list__item">
          <button
            type="button"
            className={
              "artifacts-list__main" +
              (f.path === selectedPath ? " artifacts-list__main--active" : "")
            }
            onClick={() => onSelect(f.path)}
            title={f.path}
          >
            <span className="artifacts-list__name">{f.name}</span>
            <span className="artifacts-list__path">{f.path}</span>
            <span className="artifacts-list__meta">
              +{f.added} / -{f.removed}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------- 主内容：按视图渲染详情 ----------

function MainContent({
  view,
  artifacts,
  cwd,
  previewPath,
  selectedArtifactId,
  selectedFilePath,
  browserUrl,
  onArtifactSelect,
  onBrowserUrlChange,
  onOpenOs,
  onToast,
}: {
  view: WorkspaceView;
  artifacts: SessionArtifact[];
  cwd?: string;
  previewPath?: string | null;
  selectedArtifactId?: string;
  selectedFilePath?: string;
  browserUrl?: string;
  onArtifactSelect: (a: SessionArtifact) => void;
  onBrowserUrlChange: (url?: string) => void;
  onOpenOs: (path: string) => void;
  onToast?: (msg: string) => void;
}) {
  if (view === "preview") {
    return (
      <BrowserPreview
        url={browserUrl ?? ""}
        onUrlChange={onBrowserUrlChange}
      />
    );
  }
  if (view === "fileTree") {
    const path = selectedFilePath ?? previewPath ?? null;
    if (!path) {
      return <p className="tool-side-panel__empty">选择文件查看内容</p>;
    }
    return (
      <FilePreview path={path} cwd={cwd} onToast={onToast} onOpenOs={() => onOpenOs(path)} />
    );
  }
  if (view === "changes") {
    const path = selectedArtifactId;
    if (!path) {
      return <p className="tool-side-panel__empty">在左侧选择文件查看变更</p>;
    }
    return (
      <FilePreview path={path} cwd={cwd} onToast={onToast} onOpenOs={() => onOpenOs(path)} />
    );
  }
  // artifacts：选中产物时预览其文件。
  if (view === "artifacts") {
    const id = selectedArtifactId;
    if (!id) {
      return (
        <p className="tool-side-panel__empty">在左侧选择产物查看内容</p>
      );
    }
    const a = artifacts.find((x) => x.id === id);
    const path = a?.path ?? previewPath ?? null;
    if (!path) return <p className="tool-side-panel__empty">无文件路径</p>;
    return (
      <div className="tool-side-panel__preview-wrap">
        {a && (
          <button
            type="button"
            className="tool-side-panel__link"
            onClick={() => onArtifactSelect(a)}
            title="查看产生此文件的工具调用"
          >
            查看关联工具
          </button>
        )}
        <FilePreview path={path} cwd={cwd} onToast={onToast} onOpenOs={() => onOpenOs(path)} />
      </div>
    );
  }
  return null;
}

// ---------- FilePreview（保留原实现） ----------

function FilePreview({
  path,
  cwd,
  onToast,
  onOpenOs,
}: {
  path: string;
  cwd?: string;
  onToast?: (msg: string) => void;
  onOpenOs: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setText(null);
    (async () => {
      try {
        const content = await invoke<string>("read_text_file", {
          path,
          cwd: cwd ?? null,
          maxBytes: 256 * 1024,
        });
        if (!cancelled) {
          setText(content);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(String(e).replace(/^Error:\s*/, ""));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, cwd]);

  return (
    <div className="file-preview">
      <div className="file-preview__bar">
        <span className="file-preview__path" title={path}>
          {path}
        </span>
        <button type="button" className="file-preview__open" onClick={onOpenOs}>
          系统打开
        </button>
      </div>
      {loading && <p className="tool-side-panel__empty">加载中…</p>}
      {err && (
        <div className="file-preview__err">
          <p>无法在面板内预览：{err}</p>
          <button
            type="button"
            className="file-preview__open"
            onClick={() => {
              onOpenOs();
              onToast?.("已尝试用系统打开文件");
            }}
          >
            用系统应用打开
          </button>
        </div>
      )}
      {text != null && <pre className="file-preview__body">{text}</pre>}
    </div>
  );
}

// ---------- 工具函数 ----------

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

/** 启动左列宽度拖拽（pointer 事件，松开时持久化由外层 effect 处理）。 */
function startResizeNav(
  e: React.PointerEvent<HTMLDivElement>,
  currentWidth: number,
  setWidth: (w: number) => void,
) {
  e.preventDefault();
  const startX = e.clientX;
  const pointerId = e.pointerId;
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const delta = ev.clientX - startX;
    const next = Math.min(
      Math.max(currentWidth + delta, MIN_NAV_WIDTH),
      MAX_NAV_WIDTH,
    );
    setWidth(next);
  };
  const onEnd = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
}

/** 启动全宽拖拽（面板左边缘，向左拖增大宽度）。 */
function startResizeEdge(
  e: React.PointerEvent<HTMLDivElement>,
  currentWidth: number,
  setWidth: (w: number) => void,
) {
  e.preventDefault();
  const startX = e.clientX;
  const pointerId = e.pointerId;
  const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    // 向左拖（delta 负）→ 宽度变大。
    const delta = ev.clientX - startX;
    const next = Math.min(
      Math.max(currentWidth - delta, MIN_WIDTH),
      maxWidth,
    );
    setWidth(next);
  };
  const onEnd = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
}

/**
 * R1.4 — Memoized side panel. Default shallow comparator works because
 * the parent (ChatView) wires stable callbacks via `useCallback` and
 * passes arrays/objects only when they actually change. When the panel
 * is closed (`open === false`) the inner component returns null, so
 * memo skips reconciliation entirely on parent rerenders.
 *
 * Internal state (width, view, selectedArtifactId, etc.) drives
 * rerenders inside the panel — those are unaffected by the memo
 * wrapper above the inner component.
 */
export const ToolSidePanel = memo(ToolSidePanelInner);
