/**
 * 产物独立阅读 (B3d): a focused, full-window reader for one artifact. It shares the workbench's
 * version counter, so an `agent://artifacts` refresh updates both places to the same bytes.
 * A deleted file still reads: the latest checkpoint body is shown with a clear 已删除 banner.
 */
import { useEffect, useState } from "react";
import { CloseIcon } from "@openbuddy/ui/icon/icons/index";
import { pathStat, type ArtifactInfo } from "@openbuddy/client/agent-client";
import { ArtifactPreview, useFileContent, type PreviewMode } from "./ArtifactPreview";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { openArtifactWindow } from "@openbuddy/client/api/native";
import { ArtifactFallbackBody, useArtifactFallback } from "./ArtifactFallback";
import { ArtifactShare } from "./ArtifactShare";
import { benchKind, formatSize, isTextKind, KIND_LABEL } from "./bench-kind";

export function ArtifactReader({ path, sessionId, info, version, onClose, onToast }: {
  path: string;
  sessionId: string;
  info?: ArtifactInfo;
  version: number;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const kind = benchKind(path);
  const name = path.split(/[\\/]/).pop() ?? path;
  const [mode, setMode] = useState<PreviewMode>("rendered");
  const [shareOpen, setShareOpen] = useState(false);
  /** 版本历史 (G3-2): the checkpoint timeline of this file. */
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Removed while the reader is open (B3d): switch to the checkpoint body live. */
  const [vanished, setVanished] = useState(false);
  const loaded = useFileContent(path, kind, version);
  const gone = info?.exists === false || vanished || (!!loaded?.error && /ENOENT|no such file/i.test(loaded.error));
  const fallback = useArtifactFallback(sessionId, path, gone, version);

  useEffect(() => {
    setVanished(false);
    let alive = true;
    const probe = async () => {
      try {
        const stat = await pathStat(path);
        if (alive && stat?.exists === false) setVanished(true);
      } catch { /* keep the current state */ }
    };
    void probe();
    const timer = window.setInterval(() => { void probe(); }, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !shareOpen) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, shareOpen]);

  const stamp = fallback.at ? new Date(fallback.at).toLocaleString() : "";
  const meta = [
    gone ? "已删除 · 显示最后保存的版本" : info?.status === "created" ? "新建" : "已修改",
    stamp,
    KIND_LABEL[kind],
    formatSize(info?.size),
  ].filter(Boolean).join(" · ");

  return (
    <div className="bench-reader-overlay" role="dialog" aria-modal="true" aria-label={`独立阅读 ${name}`}
      onClick={(event) => { if (event.target === event.currentTarget && !shareOpen) onClose(); }}>
      <section className="bench-reader">
        <header className="bench-reader__bar">
          <div className="bench-reader__title">
            <span className="bench-reader__name" title={path}>{name}</span>
            <span className="bench-reader__meta">{meta}</span>
          </div>
          <div className="bench-reader__actions">
            <button type="button" className="bench-btn" onClick={() => setHistoryOpen((open) => !open)}>版本历史</button>
            {/* G3-3: 双屏阅读——把这个产物放到独立窗口。 */}
            <button
              type="button"
              className="bench-btn"
              onClick={() => void openArtifactWindow(sessionId, path).catch((error) => onToast(`无法打开独立窗口：${String(error).replace(/^Error:\s*/, "")}`))}
            >在新窗口打开</button>
            <button type="button" className="bench-btn" onClick={() => setShareOpen(true)}>分享</button>
            <button type="button" className="bench-icon" aria-label="关闭独立阅读" data-tip="关闭" onClick={onClose}>
              <CloseIcon size={16} />
            </button>
          </div>
        </header>
        {gone && <div className="bench-reader__banner" role="status">文件已不在磁盘上。下面是最后保存的版本，仍可复制或另存。</div>}
        <div className="bench-reader__body">
          {gone ? (
            <ArtifactFallbackBody path={path} state={fallback} />
          ) : loaded?.error ? (
            <div className="bench-empty">
              <div className="bench-empty__title">无法读取这个文件</div>
              <div className="bench-empty__hint">{loaded.error}</div>
            </div>
          ) : (
            <ArtifactPreview path={path} version={version} mode={mode} onModeChange={setMode} onSelectText={isTextKind(kind) ? () => {} : undefined} />
          )}
        </div>
      </section>
      {historyOpen && (
        <aside className="bench-reader__history" aria-label="版本历史">
          <VersionHistoryPanel sessionId={sessionId} path={path} onToast={onToast} />
        </aside>
      )}
      {shareOpen && <ArtifactShare path={path} available={!gone} onClose={() => setShareOpen(false)} onToast={onToast} />}
    </div>
  );
}
