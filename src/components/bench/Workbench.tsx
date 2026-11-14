import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactInfo } from "@/lib/agent-client";
import type { ToolCallView } from "@/stores/session-store";
import { IS_MACOS } from "@/lib/platform";
import { ToolCallDetailBody } from "../ToolCallCard";
import { FileTreeView } from "../workspace-panel/FileTreeView";
import { CloseIcon, MaximizeIcon, RestoreIcon } from "@/foundation/components/Icon/icons";
import { ArtifactViewer } from "./ArtifactViewer";
import { ChangesView } from "./ChangesView";
import { KIND_GLYPH, KIND_LABEL, benchKind, formatSize } from "./bench-kind";

/**
 * 右侧工作台 (20261115-ui §5.5): 产物 list, one tab per opened file, the
 * workspace file tree, 变更 (diffs + restore) and a step's detail.
 * Replaces ToolSidePanel, whose "产物" counted files that were only read.
 */
export type BenchTarget =
  | { kind: "list" }
  | { kind: "files" }
  | { kind: "changes"; path?: string }
  | { kind: "tool" }
  | { kind: "file"; path: string };

type TabId = "list" | "files" | "changes" | "tool" | `file:${string}`;

const WIDTH_KEY = "openbuddy.bench.width";
const MIN_WIDTH = 340;
const MAX_RATIO = 0.7;
const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

function readWidth(): number {
  try { const saved = Number(localStorage.getItem(WIDTH_KEY)); if (saved >= MIN_WIDTH) return saved; } catch { /* storage unavailable */ }
  return 520;
}

function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return new Date(ms).toLocaleDateString();
}

export function Workbench({ sessionId, cwd, artifacts, version, toolCall, focus, onClose, onRefresh, onAddToChat, onAskEdit, onToast }: {
  sessionId: string;
  cwd?: string;
  artifacts: ArtifactInfo[];
  /** Bumped on every `agent://artifacts` for this session. */
  version: number;
  toolCall: ToolCallView | null;
  /** What to show; a new object (same content) re-focuses it. */
  focus: BenchTarget;
  onClose: () => void;
  onRefresh: () => void;
  onAddToChat: (path: string) => void;
  onAskEdit: (path: string, selected: string, mode: "edit" | "comment") => void;
  onToast: (msg: string) => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<TabId>("list");
  const [changesPath, setChangesPath] = useState<string | null>(null);
  const [width, setWidth] = useState(readWidth);
  const [full, setFull] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const [filesSeen, setFilesSeen] = useState(false);
  useEffect(() => { if (active === "files") setFilesSeen(true); }, [active]);

  const openFile = useCallback((path: string) => {
    setFiles((list) => (list.includes(path) ? list : [...list, path]));
    setActive(`file:${path}`);
  }, []);

  useEffect(() => {
    if (focus.kind === "file") openFile(focus.path);
    else if (focus.kind === "changes") { setChangesPath(focus.path ?? null); setActive("changes"); }
    else setActive(focus.kind);
  }, [focus, openFile]);

  useEffect(() => { try { localStorage.setItem(WIDTH_KEY, String(Math.round(width))); } catch { /* ignore */ } }, [width]);

  const byPath = useMemo(() => new Map(artifacts.map((a) => [a.path, a])), [artifacts]);
  const tabs = useMemo<{ id: TabId; label: string; title?: string; closable?: boolean; badge?: number }[]>(() => [
    // Singletons first so they never scroll away behind open files.
    { id: "list", label: "产物", badge: artifacts.length || undefined },
    { id: "files", label: "文件" },
    { id: "changes", label: "变更", badge: artifacts.length || undefined },
    ...(toolCall ? [{ id: "tool" as TabId, label: "步骤详情", closable: true }] : []),
    ...files.map((p) => ({ id: `file:${p}` as TabId, label: baseName(p), title: p, closable: true })),
  ], [artifacts.length, files, toolCall]);

  const closeTab = useCallback((id: TabId) => {
    const index = tabs.findIndex((t) => t.id === id);
    if (id.startsWith("file:")) setFiles((list) => list.filter((p) => `file:${p}` !== id));
    if (active === id) setActive(tabs[index - 1]?.id ?? "list");
    if (id === "tool") setActive("list");
  }, [tabs, active]);

  // Ctrl+Tab cycles tabs; Esc leaves fullscreen. Only while focus is in the panel
  // (or nowhere), so the composer and dialogs keep their own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inside = rootRef.current?.contains(document.activeElement) || document.activeElement === document.body;
      if (!inside) return;
      if (e.key === "Escape" && full && !(e.target as HTMLElement)?.closest?.("textarea, input")) { e.preventDefault(); setFull(false); return; }
      if (e.key === "Tab" && e.ctrlKey) {
        e.preventDefault();
        const i = tabs.findIndex((t) => t.id === active);
        const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
        if (next) setActive(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, active, full]);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = width;
    const id = e.pointerId;
    document.body.classList.add("bench-resizing");
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      setWidth(Math.min(Math.max(start - (ev.clientX - startX), MIN_WIDTH), window.innerWidth * MAX_RATIO));
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      document.body.classList.remove("bench-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const activeFile = active.startsWith("file:") ? active.slice(5) : null;
  useEffect(() => {
    rootRef.current?.querySelector(".bench-tab--active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);
  const drag = IS_MACOS ? { "data-window-drag-region": true } : {};

  return (
    <aside
      ref={rootRef}
      className={"bench" + (full ? " bench--full" : "")}
      style={full ? undefined : { width: `${Math.min(width, window.innerWidth * MAX_RATIO)}px` }}
      aria-label="工作台"
    >
      {!full && <div className="bench__sash" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="调整宽度" />}
      <header className="bench__head" {...drag}>
        <div className="bench__tabs" role="tablist" aria-label="工作台标签" {...drag}>
          {tabs.map((t) => (
            <div key={t.id} className={"bench-tab" + (active === t.id ? " bench-tab--active" : "") + (t.closable ? " bench-tab--closable" : "")}>
              <button
                type="button"
                role="tab"
                aria-selected={active === t.id}
                className="bench-tab__btn"
                title={t.title ?? t.label}
                onClick={() => setActive(t.id)}
                onAuxClick={(e) => { if (e.button === 1 && t.closable) closeTab(t.id); }}
              >
                <span className="bench-tab__label">{t.label}</span>
                {t.badge ? <span className="bench-tab__badge">{t.badge}</span> : null}
              </button>
              {t.closable && (
                <button type="button" className="bench-tab__close" aria-label={`关闭 ${t.label}`} onClick={() => closeTab(t.id)}>
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="bench__actions">
          <button type="button" className="bench-icon" onClick={() => setFull((v) => !v)} aria-label={full ? "退出全屏" : "全屏"} data-tip={full ? "退出全屏 (Esc)" : "全屏"}>
            {full ? <RestoreIcon size="sm" /> : <MaximizeIcon size="sm" />}
          </button>
          <button type="button" className="bench-icon" onClick={onClose} aria-label="关闭工作台" data-tip="关闭 (Ctrl/Cmd+\)">
            <CloseIcon size="sm" />
          </button>
        </div>
      </header>
      <div className="bench__body">
        {active === "list" && <ArtifactList artifacts={artifacts} cwd={cwd} onOpen={openFile} onChanges={(p) => { setChangesPath(p); setActive("changes"); }} />}
        {activeFile && (
          <ArtifactViewer
            key={activeFile}
            path={activeFile}
            sessionId={sessionId}
            info={byPath.get(activeFile)}
            version={version}
            onChanged={onRefresh}
            onAddToChat={onAddToChat}
            onAskEdit={onAskEdit}
            onShowChanges={(p) => { setChangesPath(p); setActive("changes"); }}
            onToast={onToast}
          />
        )}
        {/* 文件 is a singleton: stays mounted once opened so expanded folders survive tab switches. */}
        {filesSeen && cwd && (
          <div className="bench-files" hidden={active !== "files"}><FileTreeView rootPath={cwd} selectedPath={activeFile ?? undefined} onFileSelect={openFile} onToast={onToast} /></div>
        )}
        {active === "files" && !cwd && (
          <div className="bench-empty"><div className="bench-empty__title">这个任务没有工作空间</div><div className="bench-empty__hint">选择一个文件夹作为工作空间后，这里会显示它的文件。</div></div>
        )}
        {active === "changes" && (
          <ChangesView sessionId={sessionId} artifacts={artifacts} focusPath={changesPath} version={version} onOpen={openFile} onChanged={onRefresh} onToast={onToast} />
        )}
        {active === "tool" && toolCall && (
          <div className="bench-tool"><ToolCallDetailBody tc={toolCall} cwd={cwd} onOpenPath={openFile} /></div>
        )}
      </div>
    </aside>
  );
}

/** 产物: every file this task wrote or edited, newest first. */
function ArtifactList({ artifacts, cwd, onOpen, onChanges }: { artifacts: ArtifactInfo[]; cwd?: string; onOpen: (path: string) => void; onChanges: (path: string) => void }) {
  if (!artifacts.length) {
    return (
      <div className="bench-empty">
        <div className="bench-empty__title">还没有产物</div>
        <div className="bench-empty__hint">Buddy 在这个任务里新建或修改的文件会出现在这里，可以直接预览、编辑、查看变更和还原。只读取过的文件不算产物。</div>
      </div>
    );
  }
  const dirOf = (p: string) => {
    const dir = p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));
    if (cwd && (dir === cwd || dir.startsWith(cwd + "/") || dir.startsWith(cwd + "\\"))) return dir.slice(cwd.length + 1) || "工作空间";
    return dir;
  };
  return (
    <ul className="bench-list" aria-label="产物列表">
      {artifacts.map((a) => {
        const kind = benchKind(a.path);
        return (
          <li key={a.path} className={"bench-item" + (a.exists ? "" : " bench-item--gone")}>
            <button type="button" className="bench-item__main" onClick={() => onOpen(a.path)} title={a.path}>
              <span className={`bench-item__icon bench-item__icon--${kind}`} title={KIND_LABEL[kind]} aria-hidden>{KIND_GLYPH[kind]}</span>
              <span className="bench-item__text">
                <span className="bench-item__name">{baseName(a.path)}</span>
                <span className="bench-item__meta">
                  <span className={"bench-chip bench-chip--" + a.status}>{a.status === "created" ? "新建" : "修改"}</span>
                  {!a.exists && <span className="bench-chip bench-chip--gone">已删除</span>}
                  {a.applied && <span className="bench-chip">从回答应用</span>}
                  {(a.added > 0 || a.removed > 0) && <span><span className="diff__stats-add">+{a.added}</span> <span className="diff__stats-del">−{a.removed}</span></span>}
                  {a.size !== undefined && <span>{formatSize(a.size)}</span>}
                  <span className="bench-item__dir">{dirOf(a.path)}</span>
                </span>
              </span>
              <span className="bench-item__time">{relTime(a.lastAt)}</span>
            </button>
            <button type="button" className="bench-btn bench-btn--ghost" onClick={() => onChanges(a.path)}>变更</button>
          </li>
        );
      })}
    </ul>
  );
}
