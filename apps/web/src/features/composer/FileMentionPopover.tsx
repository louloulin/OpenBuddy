import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { artifactsList, filesSearch, type ArtifactInfo } from "@openbuddy/client/agent-client";
import { insertFileMention, mentionToken } from "@openbuddy/chat-core/content-blocks";
import type { FileSearchHit } from "@openbuddy/protocol/files-search";

/**
 * `@` file mention (20261116-pii W1.3). Typing `@` in a task opens a list of the workspace's
 * files: this task's artifacts first, then `files_search` hits (gitignore-aware, fuzzy ranked).
 * Picking one writes `@path` into the prompt; the model opens it with its read tool. Images are
 * referenced by path too: attachments need a native file grant (picker / drop / paste), which a
 * search result cannot give.
 */
export interface FileMentionHandle {
  /** Route a key to the list; true when it was consumed. */
  handleKey: (e: { key: string; preventDefault: () => void }) => boolean;
}

interface Item { path: string; name: string; dir: string; artifact?: boolean; image: boolean }

const MAX_ITEMS = 50;
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function toItem(path: string, artifact = false): Item {
  const slash = path.lastIndexOf("/");
  return { path, name: path.slice(slash + 1), dir: slash > 0 ? path.slice(0, slash) : "", artifact, image: IMAGE.test(path) };
}
/** Workspace-relative `/` path of an artifact (absolute when it lies outside the workspace). */
function relativeTo(cwd: string, path: string): string {
  const p = path.replace(/\\/g, "/");
  const root = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  return p.startsWith(root + "/") ? p.slice(root.length + 1) : p;
}
/** Loose match for the artifact rows (the search results are ranked by the main process). */
function matches(query: string, path: string): boolean {
  const q = query.toLowerCase(), p = path.toLowerCase();
  if (!q || p.includes(q)) return true;
  let at = -1;
  for (const c of q) { at = p.indexOf(c, at + 1); if (at < 0) return false; }
  return true;
}

export const FileMentionPopover = forwardRef<FileMentionHandle, {
  text: string;
  cursor: number;
  cwd?: string;
  /** The task: mentions only work inside one (its workspace is the search root). */
  sessionId?: string;
  disabled?: boolean;
  /** New input text and caret after a pick. */
  onInsert: (text: string, caret: number) => void;
}>(function FileMentionPopover({ text, cursor, cwd, sessionId, disabled, onInsert }, ref) {
  const token = useMemo(() => mentionToken(text, cursor), [text, cursor]);
  const open = !!token && !!cwd && !!sessionId && !disabled;
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [hits, setHits] = useState<FileSearchHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // This task's artifacts, once per opening.
  useEffect(() => {
    if (!open || !sessionId) return;
    let stale = false;
    artifactsList(sessionId).then((list) => { if (!stale) setArtifacts(list.filter((a) => a.exists)); }, () => {});
    return () => { stale = true; };
  }, [open, sessionId]);
  // Search as the query changes (debounced; the main process caches the file list).
  const query = token?.query ?? "";
  useEffect(() => {
    if (!open || !cwd) return;
    let stale = false;
    setState("loading");
    const timer = setTimeout(() => {
      filesSearch(cwd, query).then(
        (result) => { if (!stale) { setHits(result.hits); setState("idle"); } },
        () => { if (!stale) setState("error"); },
      );
    }, 120);
    return () => { stale = true; clearTimeout(timer); };
  }, [open, cwd, query]);

  const items = useMemo(() => {
    if (!cwd) return [] as Item[];
    const recent = [...artifacts].sort((a, b) => b.lastAt - a.lastAt).map((a) => relativeTo(cwd, a.path)).filter((p) => matches(query, p));
    const seen = new Set(recent);
    return [...recent.map((p) => toItem(p, true)), ...hits.filter((h) => !seen.has(h.path)).map((h) => toItem(h.path))].slice(0, MAX_ITEMS);
  }, [artifacts, hits, query, cwd]);

  const visible = open && dismissedAt !== token!.start;
  useEffect(() => setActive(0), [query]);
  useEffect(() => { if (dismissedAt !== null && token?.start !== dismissedAt) setDismissedAt(null); }, [token?.start, dismissedAt]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(".mention-pop__item--active")?.scrollIntoView?.({ block: "nearest" }); }, [active]);

  const pick = (item: Item | undefined) => {
    if (!item || !token) return;
    const next = insertFileMention(text, token, cursor, item.path);
    onInsert(next.text, next.cursor);
  };
  useImperativeHandle(ref, () => ({
    handleKey: (e) => {
      if (!visible) return false;
      if (e.key === "Escape") { e.preventDefault(); setDismissedAt(token!.start); return true; }
      if (!items.length) return false;
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % items.length); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); return true; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(items[Math.min(active, items.length - 1)]); return true; }
      return false;
    },
  }), [visible, items, active, token, text, cursor]);

  if (!visible) return null;
  const firstSearch = items.findIndex((i) => !i.artifact);
  return (
    <div className="mention-pop" role="listbox" aria-label="引用文件">
      <div className="mention-pop__header">引用文件 · ↑↓ 选择 · Enter 插入 · Esc 关闭</div>
      {items.length === 0 ? (
        <div className="mention-pop__empty">{state === "loading" ? "正在查找…" : state === "error" ? "无法列出工作空间的文件" : query ? `没有匹配「${query}」的文件` : "工作空间里还没有文件"}</div>
      ) : (
        <ul className="mention-pop__list" ref={listRef}>
          {items.map((item, idx) => (
            <li key={(item.artifact ? "a:" : "f:") + item.path}>
              {(idx === 0 && item.artifact) || idx === firstSearch ? <div className="mention-pop__group">{item.artifact ? "本任务产物" : "工作空间文件"}</div> : null}
              <button
                type="button"
                role="option"
                aria-selected={idx === active}
                className={"mention-pop__item" + (idx === active ? " mention-pop__item--active" : "")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item)}
                onMouseEnter={() => setActive(idx)}
                title={item.image ? `${item.path}（图片以路径引用，Buddy 会用读取工具查看）` : item.path}
              >
                <span className="mention-pop__name">{item.name}</span>
                {item.dir && <span className="mention-pop__dir">{item.dir}</span>}
                {item.image && <span className="mention-pop__tag">图片</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
