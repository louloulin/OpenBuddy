/**
 * useGitStatus —— 「变更」视图的 git 工作区状态。
 *
 * 数据来自主进程 `git:status`(porcelain 解析在主进程做,渲染层只消费结构化结果)。
 * cwd 为空 / 工作区不是 git 仓库 / 未授权 时分别有明确状态,面板据此降级,
 * 不把异常抛给用户。
 */
import { useCallback, useEffect, useState } from "react";

import { invoke } from "@/lib/platform/electron-api";

export interface GitStatusEntry {
  /** porcelain X(暂存区)状态码。 */
  x: string;
  /** porcelain Y(工作区)状态码。 */
  y: string;
  path: string;
  origPath?: string;
}

export interface GitStatusState {
  isRepo: boolean;
  branch: string;
  entries: GitStatusEntry[];
}

export interface UseGitStatusResult {
  status: GitStatusState | null;
  /** 加载中(首屏 / 手动刷新)。 */
  loading: boolean;
  /** 失败原因(非仓库不算失败,由 status.isRepo 表达)。 */
  error: string | null;
  reload: () => Promise<void>;
}

export function useGitStatus(cwd: string | undefined, enabled: boolean): UseGitStatusResult {
  const [status, setStatus] = useState<GitStatusState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled || !cwd) return;
    setLoading(true);
    try {
      const result = (await invoke("git:status", { cwd })) as GitStatusState;
      setStatus(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, loading, error, reload };
}
