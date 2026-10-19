/**
 * GitPanel —— 「变更」视图的 git 部分(parity 阶段 2.2 / chat UI 计划批 5)。
 *
 * 此前「变更」视图只有从会话消息聚合出的近似 diff(哪些文件被工具改过),
 * 没有真实 git 状态。这里接入主进程 `git:*` 通道:
 *   - GitSection:提交框 + 已暂存/未暂存/未跟踪三段列表 + 暂存/取消暂存 + 最近提交;
 *   - GitDiffView:选中文件的 unified diff(未暂存 → 已暂存 → 无差异三级回退)。
 *
 * 降级:不是 git 仓库 / 未授权 / 无 cwd 时,面板显示明确原因并保留会话变更列表,
 * 不把异常抛给用户。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { invoke } from "@/lib/platform/electron-api";
import { useLocale } from "@openbuddy/ui-locale/client";
import type { GitStatusEntry, GitStatusState } from "./use-git-status";

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitSectionProps {
  cwd?: string;
  /** 当前选中的路径(用于高亮)。 */
  selectedPath?: string;
  onSelect: (path: string) => void;
  onToast?: (msg: string) => void;
  /** git 工作区状态(由面板层统一拉取,避免各处重复 invoke)。 */
  status: GitStatusState | null;
  loading: boolean;
  error: string | null;
  onReload: () => void | Promise<void>;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function statusCode(entry: GitStatusEntry): string {
  return `${entry.x}${entry.y}`.replace(/\s/g, "");
}

/** porcelain 两列:暂存区有变更 / 工作区有变更。 */
function isStaged(entry: GitStatusEntry): boolean {
  return entry.x !== " " && entry.x !== "?";
}

function isUntracked(entry: GitStatusEntry): boolean {
  return entry.x === "?" && entry.y === "?";
}

function isUnstaged(entry: GitStatusEntry): boolean {
  return !isUntracked(entry) && entry.y !== " ";
}

export function GitSection({
  cwd,
  selectedPath,
  onSelect,
  onToast,
  status,
  loading,
  error,
  onReload,
}: GitSectionProps) {
  const locale = useLocale();
  // 翻译函数通过 ref 取(useLocale() 返回的对象身份每次渲染都变)。
  const translateRef = useRef(locale.t);
  translateRef.current = locale.t;
  const t = useCallback(
    (key: string, params?: Record<string, unknown>) => translateRef.current(key, params),
    [],
  );

  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [commits, setCommits] = useState<GitLogEntry[] | null>(null);

  const entries = status?.entries ?? [];
  const staged = entries.filter(isStaged);
  const unstaged = entries.filter(isUnstaged);
  const untracked = entries.filter(isUntracked);

  const loadLog = useCallback(async () => {
    if (!cwd) return;
    try {
      const result = (await invoke("git:log", { cwd, limit: 20 })) as { commits: GitLogEntry[] };
      setCommits(result.commits ?? []);
    } catch (e) {
      setCommits([]);
      onToast?.(t("git.logFailed", { error: String(e).replace(/^Error:\s*/, "") }));
    }
  }, [cwd, onToast, t]);

  const handleStage = useCallback(
    async (entry: GitStatusEntry, unstage: boolean) => {
      if (!cwd) return;
      setBusyPath(entry.path);
      try {
        await invoke("git:stage", { cwd, paths: [entry.path], unstage });
        await onReload();
      } catch (e) {
        onToast?.(t("git.stageFailed", { error: String(e).replace(/^Error:\s*/, "") }));
      } finally {
        setBusyPath(null);
      }
    },
    [cwd, onToast, onReload, t],
  );

  const handleCommit = useCallback(async () => {
    if (!cwd) return;
    const trimmed = message.trim();
    if (!trimmed) {
      onToast?.(t("git.commitEmpty"));
      return;
    }
    if (staged.length === 0) {
      onToast?.(t("git.commitNoStaged"));
      return;
    }
    setCommitting(true);
    try {
      const result = (await invoke("git:commit", { cwd, message: trimmed })) as { hash: string };
      setMessage("");
      await onReload();
      await loadLog();
      onToast?.(t("git.commitOk", { hash: result.hash ?? "" }));
    } catch (e) {
      onToast?.(t("git.commitFailed", { error: String(e).replace(/^Error:\s*/, "") }));
    } finally {
      setCommitting(false);
    }
  }, [cwd, loadLog, message, onReload, onToast, staged.length, t]);

  if (!cwd) return null;
  if (error) {
    return <p className="tool-side-panel__empty">{t("git.loadFailed", { error })}</p>;
  }
  if (status && !status.isRepo) {
    return <p className="tool-side-panel__empty">{t("git.notRepo")}</p>;
  }

  const renderRow = (entry: GitStatusEntry, stagedSide: boolean) => (
    <li key={`${entry.x}${entry.y}:${entry.path}`} className="artifacts-list__item">
      <button
        type="button"
        className={
          "artifacts-list__main" +
          (entry.path === selectedPath ? " artifacts-list__main--active" : "")
        }
        onClick={() => onSelect(entry.path)}
        title={entry.path}
      >
        <span className="artifacts-list__name">{basename(entry.path)}</span>
        <span className="artifacts-list__path">{entry.path}</span>
        <span className="artifacts-list__meta">
          {statusCode(entry)}
          {entry.origPath ? ` · ${basename(entry.origPath)}` : ""}
        </span>
      </button>
      <button
        type="button"
        className="artifacts-list__open"
        disabled={busyPath === entry.path}
        onClick={() => void handleStage(entry, stagedSide)}
        title={stagedSide ? t("git.unstage") : t("git.stage")}
      >
        {stagedSide ? t("git.unstageShort") : t("git.stageShort")}
      </button>
    </li>
  );

  return (
    <div className="git-panel">
      <div className="git-panel__commit">
        <textarea
          className="git-panel__message"
          value={message}
          rows={2}
          placeholder={t("git.commitPlaceholder")}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="git-panel__commit-row">
          <span className="git-panel__branch" title={t("git.branch")}>
            {status?.branch || "—"}
          </span>
          <button
            type="button"
            className="git-panel__commit-btn"
            disabled={committing || staged.length === 0}
            onClick={() => void handleCommit()}
          >
            {committing ? t("git.committing") : t("git.commit")}
          </button>
        </div>
      </div>

      {loading && entries.length === 0 ? (
        <p className="tool-side-panel__empty">{t("git.loading")}</p>
      ) : (
        <>
          <section className="git-panel__group" aria-label={t("git.staged")}>
            <header className="git-panel__group-head">
              <span>{t("git.staged")}</span>
              <span className="git-panel__count">{staged.length}</span>
            </header>
            {staged.length === 0 ? (
              <p className="git-panel__empty">{t("git.noStaged")}</p>
            ) : (
              <ul className="artifacts-list">{staged.map((e) => renderRow(e, true))}</ul>
            )}
          </section>

          <section className="git-panel__group" aria-label={t("git.unstaged")}>
            <header className="git-panel__group-head">
              <span>{t("git.unstaged")}</span>
              <span className="git-panel__count">{unstaged.length}</span>
            </header>
            {unstaged.length === 0 ? (
              <p className="git-panel__empty">{t("git.noUnstaged")}</p>
            ) : (
              <ul className="artifacts-list">{unstaged.map((e) => renderRow(e, false))}</ul>
            )}
          </section>

          {untracked.length > 0 && (
            <section className="git-panel__group" aria-label={t("git.untracked")}>
              <header className="git-panel__group-head">
                <span>{t("git.untracked")}</span>
                <span className="git-panel__count">{untracked.length}</span>
              </header>
              <ul className="artifacts-list">{untracked.map((e) => renderRow(e, false))}</ul>
            </section>
          )}

          <section className="git-panel__group" aria-label={t("git.recentCommits")}>
            <header className="git-panel__group-head">
              <button
                type="button"
                className="git-panel__group-toggle"
                onClick={() => {
                  if (commits) {
                    setCommits(null);
                    return;
                  }
                  void loadLog();
                }}
              >
                {t("git.recentCommits")}
              </button>
            </header>
            {commits && commits.length === 0 ? (
              <p className="git-panel__empty">{t("git.noCommits")}</p>
            ) : (
              commits &&
              commits.map((c) => (
                <div key={c.hash} className="git-panel__commit-row-item" title={`${c.hash} ${c.subject}`}>
                  <span className="git-panel__commit-hash">{c.shortHash}</span>
                  <span className="git-panel__commit-subject">{c.subject}</span>
                </div>
              ))
            )}
          </section>

          <button
            type="button"
            className="git-panel__refresh"
            onClick={() => {
              void onReload();
              void loadLog();
            }}
          >
            {t("git.refresh")}
          </button>
        </>
      )}
    </div>
  );
}

export interface GitDiffViewProps {
  path: string;
  cwd?: string;
  onToast?: (msg: string) => void;
}

/**
 * 单文件 diff 视图。未暂存 diff 为空时回退到已暂存 diff(两者都空 = 该文件
 * 与 HEAD 一致,提示「无差异」)。
 */
export function GitDiffView({ path, cwd, onToast }: GitDiffViewProps) {
  const locale = useLocale();
  const translateRef = useRef(locale.t);
  translateRef.current = locale.t;
  const t = useCallback(
    (key: string, params?: Record<string, unknown>) => translateRef.current(key, params),
    [],
  );

  const [patch, setPatch] = useState<string | null>(null);
  const [scope, setScope] = useState<"unstaged" | "staged" | "none">("none");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!cwd) return;
    void (async () => {
      try {
        const unstaged = (await invoke("git:diff", { cwd, path, staged: false })) as {
          patch: string;
        };
        if (cancelled) return;
        if (unstaged.patch && unstaged.patch.trim()) {
          setPatch(unstaged.patch);
          setScope("unstaged");
          setError(null);
          return;
        }
        const staged = (await invoke("git:diff", { cwd, path, staged: true })) as {
          patch: string;
        };
        if (cancelled) return;
        if (staged.patch && staged.patch.trim()) {
          setPatch(staged.patch);
          setScope("staged");
        } else {
          setPatch("");
          setScope("none");
        }
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(String(e).replace(/^Error:\s*/, ""));
        setPatch(null);
        onToast?.(t("git.diffFailed", { error: String(e).replace(/^Error:\s*/, "") }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, path, onToast, t]);

  if (error) {
    return <p className="tool-side-panel__empty">{t("git.diffFailed", { error })}</p>;
  }
  if (patch === null) {
    return <p className="tool-side-panel__empty">{t("git.loading")}</p>;
  }
  const label = scope === "staged" ? t("git.staged") : t("git.unstaged");
  return (
    <div className="git-diff">
      <div className="git-diff__bar">
        <span className="git-diff__path" title={path}>
          {path}
        </span>
        {scope !== "none" && <span className="git-diff__scope">{label}</span>}
      </div>
      <pre className="git-diff__patch">{patch || t("git.noDiff")}</pre>
    </div>
  );
}
