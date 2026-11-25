import { useCallback, useEffect, useMemo, useState } from "react";
import { openPath, revealInFolder } from "@openbuddy/client/api/files";
import { artifactsWorkspaceList, type WorkspaceArtifact } from "@openbuddy/client/api/artifacts";
import { formatFileSize, inferFileTypeFromExt, relativeTime } from "@/shared/lib/files/file-utils";

/**
 * 任务成果聚合 (G3-5)：把**当前工作区里各个任务**的产物汇总成一张表。
 *
 * 数据来自真实命令 `artifacts_workspace_list`：host 直接读各会话磁盘上的 checkpoint
 * 索引，不要求这些会话处于加载状态（引擎只在活动会话里挂内存产物）。
 * 只读，不复制文件。点一行用默认应用打开，或到文件夹里定位。
 */

export function TaskArtifactsTab({
  cwd,
  searchQuery,
  typeFilter,
  onToast,
}: {
  cwd?: string;
  searchQuery: string;
  typeFilter: string;
  onToast?: (message: string) => void;
}) {
  const [rows, setRows] = useState<WorkspaceArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cwd) { setRows([]); return; }
    setLoading(true);
    setError(null);
    try {
      setRows(await artifactsWorkspaceList(cwd));
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter(({ path, sessionTitle }) => {
      if (query && !`${path} ${sessionTitle}`.toLowerCase().includes(query)) return false;
      if (typeFilter === "all") return true;
      const type = inferFileTypeFromExt(path, false);
      if (typeFilter === "other") return !["document", "markdown", "spreadsheet", "image", "code", "pdf"].includes(type);
      return type === typeFilter;
    });
  }, [rows, searchQuery, typeFilter]);

  const open = async (path: string) => {
    try {
      await openPath(path);
    } catch {
      onToast?.("无法用默认应用打开这个文件（可能已被移动或删除）");
    }
  };
  const reveal = async (path: string) => {
    try {
      await revealInFolder(path);
    } catch {
      onToast?.("无法在文件夹中定位这个文件");
    }
  };

  if (!cwd) return <div className="myfiles-empty"><p>这个任务没有工作空间</p></div>;
  if (loading) return <div className="myfiles-empty"><p>正在汇总任务成果…</p></div>;
  if (error) return <div className="myfiles-empty"><p>无法读取任务成果：{error}</p></div>;
  if (!rows.length) {
    return (
      <div className="myfiles-empty">
        <p>还没有任务成果</p>
        <span>任务里由 Buddy 写出或修改的文件会出现在这里。</span>
      </div>
    );
  }

  return (
    <div className="myfiles-table">
      <div className="myfiles-table-head">
        <span className="myfiles-col-name">文件</span>
        <span className="myfiles-col-type">来源任务</span>
        <span className="myfiles-col-time">最近修改</span>
        <span className="myfiles-col-size">大小</span>
      </div>
      {filtered.map(({ path, sessionTitle, lastAt, size, exists }) => (
        <div className="myfiles-row" key={path}>
          <span className="myfiles-col-name">
            <button type="button" className="myfiles-link" onClick={() => void open(path)} title={path}>
              {path.split(/[\\/]/).pop()}
            </button>
            {!exists && <span className="myfiles-row-note">已删除</span>}
          </span>
          <span className="myfiles-col-type" title={sessionTitle}>{sessionTitle}</span>
          <span className="myfiles-col-time" title={lastAt ? new Date(lastAt).toLocaleString() : ""}>
            {lastAt ? relativeTime(lastAt) : "—"}
          </span>
          <span className="myfiles-col-size">
            {formatFileSize(size ?? 0)}
            <button type="button" className="myfiles-link myfiles-link--quiet" onClick={() => void reveal(path)}>定位</button>
          </span>
        </div>
      ))}
      {filtered.length === 0 && <div className="myfiles-empty"><p>没有匹配的任务成果</p></div>}
    </div>
  );
}
