import { useEffect, useRef, useState } from "react";
import type { ExpertCenterCatalog, ExpertRootInfo } from "@openbuddy/protocol/experts";
import { expertsDefaultRoot, expertsListRoots, expertsOpenDir, expertsSetRoots } from "@openbuddy/client/agent-client";
import { DeleteIcon, FolderOpenIcon } from "@openbuddy/ui/icon/icons/index";
import { errorText } from "./expert-model";

interface Props {
  catalog: ExpertCenterCatalog;
  /** Native directory picker (owned by the tab, which holds the dialog bridge). */
  onPickDir: () => Promise<string | undefined>;
  onChanged: () => void;
  onClose: () => void;
  onToast?: (message: string) => void;
}

/**
 * 专家来源: where the catalog comes from — built-ins, 我的专家 (`<pi>/agents`), the trusted
 * project's `.pi/agents`, and library directories the user adds (read-only, can be imported).
 */
export function ExpertSources({ catalog, onPickDir, onChanged, onClose, onToast }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [roots, setRoots] = useState<ExpertRootInfo[]>(catalog.roots);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void expertsListRoots().then(setRoots).catch(() => {}); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const update = async (next: string[], done: string) => {
    setBusy(true);
    try {
      setRoots(await expertsSetRoots(next));
      onToast?.(done);
      onChanged();
    } catch (e) {
      onToast?.(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    const dir = await onPickDir();
    if (dir) await update([...roots.map((r) => r.path), dir], "已添加专家目录");
  };
  const open = (path: string) => void expertsOpenDir(path).catch((e) => onToast?.(errorText(e)));
  /** 我的专家's folder only exists after the first save; experts_default_root creates it. */
  const openUserDir = () => void expertsDefaultRoot().then(expertsOpenDir).catch((e) => onToast?.(errorText(e)));

  return (
    <div className="ec-modal-overlay" ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="ec-modal ex-sources" role="dialog" aria-label="专家来源">
        <button className="ec-modal-close" onClick={onClose} aria-label="关闭">×</button>
        <div className="ec-modal-title">专家来源</div>
        <p className="ex-hint">专家中心合并以下来源；同名（同 id）的专家按从上到下的顺序生效。</p>
        <ul className="ex-source-list">
          <li>
            <div className="ex-source-main"><b>我的专家</b><code title={catalog.userDir}>{catalog.userDir}</code></div>
            <button type="button" className="ec-source-btn" onClick={openUserDir}><FolderOpenIcon size="sm" /><span>打开</span></button>
          </li>
          <li>
            <div className="ex-source-main">
              <b>当前项目</b>
              <code>{catalog.projectDir ?? "未打开项目"}</code>
              {catalog.projectDir && <span className={`ex-badge${catalog.projectTrusted ? "" : " ex-badge--warn"}`}>{catalog.projectTrusted ? "已信任，已读取" : "未信任，不读取"}</span>}
            </div>
          </li>
          {roots.map((r) => (
            <li key={r.path}>
              <div className="ex-source-main">
                <b>专家库</b><code title={r.path}>{r.path}</code>
                <span className={`ex-badge${r.exists && !r.error ? "" : " ex-badge--warn"}`}>{!r.exists ? "目录不存在" : `${r.count} 位专家${r.error ? ` · ${r.error}` : ""}`}</span>
              </div>
              {r.exists && <button type="button" className="ec-source-btn" onClick={() => open(r.path)}><FolderOpenIcon size="sm" /><span>打开</span></button>}
              <button type="button" className="ec-my-del" aria-label={`移除 ${r.path}`} disabled={busy}
                onClick={() => update(roots.filter((x) => x.path !== r.path).map((x) => x.path), "已移除专家目录")}><DeleteIcon size="sm" /></button>
            </li>
          ))}
          <li><div className="ex-source-main"><b>内置专家</b><span className="ex-hint">OpenBuddy 自带，只读，可复制后修改</span></div></li>
        </ul>
        <button type="button" className="um-btn" disabled={busy} onClick={add}><FolderOpenIcon size="sm" /><span>添加专家目录…</span></button>
        {catalog.problems.length > 0 && (
          <div className="ex-problems">
            <div className="ec-modal-section-title">无法读取的文件（{catalog.problems.length}）</div>
            {catalog.problems.slice(0, 8).map((p) => <div key={p.path} className="ex-problem"><code>{p.path}</code><span>{p.error}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}
