import { useCallback, useEffect, useState } from "react";
import { GitBranch, Plus, Trash2 } from "lucide-react";
import { worktreeCreate, worktreeList, worktreeRemove, type WorktreeRow } from "@openbuddy/client/api/files";

/**
 * 工作树 (G4-5)：给代码项目开一份隔离的 git worktree。
 *
 * 数据全部来自真实 git 命令（`worktree_list/create/remove`）；不是 git 仓库时
 * 面板直说，不给假按钮。创建后可以复制路径，把任务开在那份工作树里。
 */
export function WorktreeTab({ cwd, onToast }: { cwd?: string; onToast?: (msg: string) => void }) {
  const [rows, setRows] = useState<WorktreeRow[]>([]);
  const [gitRepo, setGitRepo] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cwd) { setGitRepo(false); return; }
    try {
      const result = await worktreeList(cwd);
      setGitRepo(result.gitRepo);
      setRows(result.worktrees);
      setError(null);
    } catch (failure) {
      setGitRepo(false);
      setError(String(failure).replace(/^Error:\s*/, ""));
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!cwd || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await worktreeCreate(cwd, name.trim());
      setName("");
      onToast?.("工作树已创建");
      await load();
    } catch (failure) {
      setError(String(failure).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (path: string) => {
    if (!cwd) return;
    setBusy(true);
    try {
      await worktreeRemove(cwd, path);
      onToast?.("工作树已移除");
      await load();
    } catch (failure) {
      setError(String(failure).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  if (gitRepo === false) {
    return <div className="pd-empty">这个项目不是 git 仓库，工作树只对 git 项目可用。</div>;
  }

  return (
    <div className="pd-worktree">
      <div className="pd-worktree__add">
        <input
          className="pd-worktree__input"
          value={name}
          placeholder="新工作树名字，例如 feature-login"
          aria-label="工作树名字"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void create(); }}
        />
        <button type="button" className="pd-btn pd-btn--primary" disabled={busy || !name.trim()} onClick={() => void create()}>
          <Plus size={14} /> 新建工作树
        </button>
      </div>
      {error && <p className="pd-worktree__error" role="alert">{error}</p>}
      {rows.length === 0 ? (
        <div className="pd-empty">还没有工作树。</div>
      ) : (
        <ul className="pd-worktree__list">
          {rows.map((row) => (
            <li className="pd-worktree__row" key={row.path}>
              <GitBranch size={14} aria-hidden />
              <div className="pd-worktree__meta">
                <span className="pd-worktree__branch">{row.branch ?? (row.bare ? "bare" : "游离 HEAD")}</span>
                <code className="pd-worktree__path" title={row.path}>{row.path}</code>
              </div>
              {row.main ? (
                <span className="pd-worktree__tag">主工作区</span>
              ) : (
                <button type="button" className="pd-btn" disabled={busy} onClick={() => void remove(row.path)} aria-label={`移除工作树 ${row.branch ?? row.path}`}>
                  <Trash2 size={14} /> 移除
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
