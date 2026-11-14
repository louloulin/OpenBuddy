import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, ExternalLink, Pencil, Save, X } from "lucide-react";
import { invoke, save as saveDialog } from "@openbuddy/client/ipc";
import { artifactSave, checkpointList, checkpointRead, checkpointRestore, exportTextFile, type ArtifactInfo, type CheckpointRecord } from "@openbuddy/client/agent-client";
import { copyText } from "@/lib/clipboard";
import { friendlyError } from "@/lib/error-format";
import { appConfirm } from "../AppDialog";
import { ArtifactPreview, useFileContent, type PreviewMode } from "./ArtifactPreview";
import { DiffBlock } from "./DiffBlock";
import { benchKind, formatSize, isTextKind, KIND_LABEL } from "./bench-kind";

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const SOURCE_LABEL: Record<CheckpointRecord["source"], string> = { tool: "Buddy 修改", user: "你的编辑", restore: "还原前", apply: "从回答应用" };

/** One artifact tab: title bar with actions, then preview / editor / versions. */
export function ArtifactViewer({ path, sessionId, info, version, onChanged, onAddToChat, onAskEdit, onShowChanges, onToast }: {
  path: string;
  sessionId: string;
  info?: ArtifactInfo;
  /** Bumped when the file changes (agent writes, restores). */
  version: number;
  onChanged: () => void;
  onAddToChat: (path: string) => void;
  onAskEdit: (path: string, selected: string, mode: "edit" | "comment") => void;
  onShowChanges: (path: string) => void;
  onToast: (msg: string) => void;
}) {
  const kind = benchKind(path);
  const name = path.split(/[\\/]/).pop() ?? path;
  const [mode, setMode] = useState<PreviewMode>("rendered");
  const [view, setView] = useState<"preview" | "edit" | "versions">("preview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setView("preview"); setSelected(""); }, [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const openDefault = () => invoke("open_path", { path }).catch((e) => onToast(`无法打开：${friendlyError(e)}`));
  const reveal = () => invoke("reveal_in_folder", { path }).catch(() => onToast("无法打开文件夹"));
  const copyContent = async () => {
    try {
      const text = await invoke<string>("read_text_file", { path, maxBytes: 8 * 1024 * 1024 });
      await copyText(text);
      onToast(kind === "markdown" ? "已复制 Markdown" : "已复制内容");
    } catch (e) { onToast(`复制失败：${friendlyError(e)}`); }
  };
  const saveAs = async () => {
    try {
      const target = await saveDialog({ title: "另存为", defaultPath: name });
      if (!target) return;
      const text = await invoke<string>("read_text_file", { path, maxBytes: 16 * 1024 * 1024 });
      await exportTextFile(target, text);
      onToast("已另存");
    } catch (e) { onToast(`另存失败：${friendlyError(e)}`); }
  };
  const status = info ? (info.exists ? (info.status === "created" ? "新建" : "修改") : "已删除") : "";
  /** Known to be gone (reverted / deleted): don't try to read it. */
  const gone = info?.exists === false;
  const stats = info && (info.added || info.removed) ? `+${info.added} −${info.removed}` : "";

  const menu: Array<{ label: string; run: () => void; hidden?: boolean }> = [
    { label: "用默认应用打开", run: () => void openDefault() },
    { label: "在文件夹中显示", run: () => void reveal() },
    { label: "复制路径", run: () => void copyText(path).then(() => onToast("已复制路径")) },
    { label: "加入对话", run: () => onAddToChat(path) },
    { label: kind === "markdown" ? "复制 Markdown" : "复制内容", run: () => void copyContent(), hidden: !isTextKind(kind) },
    { label: "另存为…", run: () => void saveAs(), hidden: !isTextKind(kind) },
    { label: "版本历史", run: () => setView("versions") },
    { label: "查看变更", run: () => onShowChanges(path), hidden: !info },
  ];

  return (
    <div className="bench-viewer">
      <div className="bench-viewer__bar">
        <div className="bench-viewer__title" title={path}>
          <span className="bench-viewer__name">{name}</span>
          <span className="bench-viewer__meta">
            {[status, stats, KIND_LABEL[kind], formatSize(info?.size)].filter(Boolean).join(" · ")}
          </span>
        </div>
        {view === "edit" ? null : (
          <>
            {isTextKind(kind) && !gone && (
              <button type="button" className="bench-btn" onClick={() => setView("edit")} aria-label="编辑"><Pencil size={14} /> 编辑</button>
            )}
            {!gone && <button type="button" className="bench-icon" onClick={() => void openDefault()} aria-label="用默认应用打开" data-tip="用默认应用打开"><ExternalLink size={15} /></button>}
            <div className="bench-menu" ref={menuRef}>
              <button type="button" className="bench-icon" onClick={() => setMenuOpen((v) => !v)} aria-label="更多操作" aria-expanded={menuOpen} data-tip="更多"><MoreHorizontal size={16} /></button>
              {menuOpen && (
                <div className="bench-menu__pop ob-pop" role="menu">
                  {menu.filter((m) => !m.hidden).map((m) => (
                    <button key={m.label} type="button" role="menuitem" onClick={() => { setMenuOpen(false); m.run(); }}>{m.label}</button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {selected && view === "preview" && (
        <div className="bench-selection" role="toolbar" aria-label="选中内容">
          <span className="bench-selection__count">已选中 {selected.length} 字</span>
          <button type="button" className="bench-btn bench-btn--primary" onClick={() => { onAskEdit(path, selected, "edit"); setSelected(""); }}>让 Buddy 改这段</button>
          <button type="button" className="bench-btn" onClick={() => { onAskEdit(path, selected, "comment"); setSelected(""); }}>批注</button>
          <button type="button" className="bench-icon" onClick={() => setSelected("")} aria-label="取消选择"><X size={14} /></button>
        </div>
      )}
      <div className="bench-viewer__body">
        {view === "edit" ? (
          <ArtifactEditor path={path} sessionId={sessionId} onClose={() => setView("preview")} onSaved={onChanged} onToast={onToast} />
        ) : view === "versions" ? (
          <VersionList path={path} sessionId={sessionId} onBack={() => setView("preview")} onRestored={onChanged} onToast={onToast} />
        ) : gone ? (
          <div className="bench-empty">
            <div className="bench-empty__title">文件已不在磁盘上</div>
            <div className="bench-empty__hint">它可能被还原、移动或删除了。修改前后的内容都留在版本历史里，可以从那里找回。</div>
            <div className="bench-empty__actions"><button type="button" className="bench-btn" onClick={() => setView("versions")}>打开版本历史</button></div>
          </div>
        ) : (
          <ArtifactPreview path={path} version={version} mode={mode} onModeChange={setMode} onSelectText={isTextKind(kind) ? setSelected : undefined} />
        )}
      </div>
    </div>
  );
}

/** Plain-text editor with save state; saving goes through the checkpointed artifact_save. */
function ArtifactEditor({ path, sessionId, onClose, onSaved, onToast }: { path: string; sessionId: string; onClose: () => void; onSaved: () => void; onToast: (msg: string) => void }) {
  const loaded = useFileContent(path, "text", 0);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Content as last saved from here (the file on disk). */
  const [base, setBase] = useState<string | null>(null);
  const original = base ?? loaded?.text ?? "";
  const value = draft ?? original;
  const dirty = draft !== null && draft !== original;

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await artifactSave(sessionId, path, value);
      // Stay in the editor (Ctrl/Cmd+S is pressed mid-edit); the state shows 已保存.
      setBase(value);
      setDraft(null);
      onSaved();
    } catch (e) {
      onToast(`保存失败：${friendlyError(e)}`);
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, sessionId, path, value, onToast, onSaved]);

  const leave = async () => {
    if (dirty && !(await appConfirm({ title: "放弃未保存的修改？", confirmLabel: "放弃", danger: true }))) return;
    onClose();
  };

  if (!loaded) return <div className="bench-skeleton"><span /><span /><span /></div>;
  if (loaded.error) return <div className="bench-empty"><div className="bench-empty__title">无法读取这个文件</div><div className="bench-empty__hint">{loaded.error}</div></div>;
  return (
    <div className="bench-editor">
      <div className="bench-editor__bar">
        <span className={"bench-editor__state" + (dirty ? " bench-editor__state--dirty" : "")}>{dirty ? "未保存" : "已保存"}</span>
        <span className="bench-editor__hint">Ctrl/Cmd+S 保存 · 保存前会自动留存旧版本</span>
        <button type="button" className="bench-btn" onClick={() => void leave()}>{dirty ? "取消" : "完成"}</button>
        <button type="button" className="bench-btn bench-btn--primary" disabled={!dirty || saving} onClick={() => void save()}><Save size={14} /> 保存</button>
      </div>
      <textarea
        className="bench-editor__input"
        value={value}
        spellCheck={false}
        aria-label={`编辑 ${path.split(/[\\/]/).pop()}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = el;
            const next = value.slice(0, a) + "  " + value.slice(b);
            setDraft(next);
            requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
          }
        }}
      />
    </div>
  );
}

/** Snapshots of one file: what each change did, and restore to before it. */
function VersionList({ path, sessionId, onBack, onRestored, onToast }: { path: string; sessionId: string; onBack: () => void; onRestored: () => void; onToast: (msg: string) => void }) {
  const [records, setRecords] = useState<CheckpointRecord[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ before: string; after: string } | null>(null);
  const load = useCallback(() => {
    checkpointList(sessionId, path).then((list) => setRecords([...list].sort((a, b) => b.at - a.at)), () => setRecords([]));
  }, [sessionId, path]);
  useEffect(load, [load]);

  const show = async (record: CheckpointRecord) => {
    if (open === record.id) { setOpen(null); return; }
    setOpen(record.id);
    setDiff(null);
    const read = async (hash: string | null) => (hash ? (await checkpointRead(sessionId, hash)).text ?? "（二进制内容）" : "");
    try { setDiff({ before: await read(record.before), after: await read(record.after) }); } catch (e) { onToast(`读取版本失败：${friendlyError(e)}`); }
  };
  const restore = async (record: CheckpointRecord) => {
    const undo = record.source === "restore";
    const ok = await appConfirm({
      title: undo ? "撤销这次还原，回到还原前的内容？" : record.before ? "还原到这次修改之前？" : "这次修改新建了该文件，还原会把它移到废纸篓",
      message: "当前内容会先留存为一个版本，可以再还原回来。",
      confirmLabel: undo ? "撤销还原" : "还原",
    });
    if (!ok) return;
    try { await checkpointRestore(sessionId, path, record.before); onToast("已还原"); onRestored(); load(); } catch (e) { onToast(`还原失败：${friendlyError(e)}`); }
  };

  return (
    <div className="bench-versions">
      <div className="bench-versions__head">
        <button type="button" className="bench-btn" onClick={onBack}>← 返回预览</button>
        <span className="bench-versions__title">版本历史</span>
      </div>
      {!records ? <div className="bench-skeleton"><span /><span /></div> : records.length === 0 ? (
        <div className="bench-empty"><div className="bench-empty__title">还没有版本记录</div><div className="bench-empty__hint">Buddy 修改文件或你在这里保存时，会自动留存修改前的内容。</div></div>
      ) : (
        <ol className="bench-versions__list">
          {records.map((r) => (
            <li key={r.id} className="bench-version">
              <div className="bench-version__row">
                <button type="button" className="bench-version__main" onClick={() => void show(r)} aria-expanded={open === r.id}>
                  <span className="bench-version__time">{clock(r.at)}</span>
                  <span className="bench-version__source">{SOURCE_LABEL[r.source]}{r.before === null ? " · 新建" : ""}</span>
                  {r.skipped && <span className="bench-version__skip">文件过大，未留存</span>}
                </button>
                {!r.skipped && (r.source !== "restore" || r.before !== null) && (
                  <button type="button" className="bench-btn" onClick={() => void restore(r)}>{r.source === "restore" ? "撤销这次还原" : "还原到此前"}</button>
                )}
              </div>
              {open === r.id && (diff ? <DiffBlock before={diff.before} after={diff.after} /> : <div className="bench-skeleton"><span /></div>)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
