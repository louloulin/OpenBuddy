import { useCallback, useEffect, useState } from "react";
import { invoke } from "@openbuddy/client/ipc";
import { checkpointList, checkpointRead, checkpointRestore, type ArtifactInfo } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { appConfirm } from "../../shared/ui/AppDialog";
import { DiffBlock } from "./DiffBlock";
import { benchKind, isTextKind } from "./bench-kind";
import { revertToolCalls } from "./revert";

type FileDiff = { before: string | null; current: string; baseHash: string | null; hasSnapshot: boolean };

/** 变更: every file this task changed, first version vs now, with restore. */
export function ChangesView({ sessionId, artifacts, focusPath, version, onOpen, onChanged, onToast }: {
  sessionId: string;
  artifacts: ArtifactInfo[];
  focusPath?: string | null;
  version: number;
  onOpen: (path: string) => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(focusPath ?? artifacts[0]?.path ?? null);
  const [diffs, setDiffs] = useState<Record<string, FileDiff | "loading" | { error: string }>>({});
  useEffect(() => { if (focusPath) setOpen(focusPath); }, [focusPath]);
  useEffect(() => { setDiffs({}); }, [version]);

  const load = useCallback(async (path: string) => {
    setDiffs((d) => ({ ...d, [path]: "loading" }));
    try {
      const records = (await checkpointList(sessionId, path)).filter((r) => r.source !== "restore" && !r.skipped).sort((a, b) => a.at - b.at);
      const first = records[0];
      // A deleted (or reverted-away) file has no current content: diff against empty without asking for it.
      const exists = artifacts.find((a) => a.path === path)?.exists !== false;
      const current = exists ? await invoke<string>("read_text_file", { path, maxBytes: 2 * 1024 * 1024 }).catch(() => "") : "";
      const before = first ? (first.before ? (await checkpointRead(sessionId, first.before)).text ?? "" : null) : null;
      setDiffs((d) => ({ ...d, [path]: { before, current, baseHash: first?.before ?? null, hasSnapshot: !!first } }));
    } catch (e) {
      setDiffs((d) => ({ ...d, [path]: { error: friendlyError(e) } }));
    }
  }, [sessionId, artifacts]);
  useEffect(() => { if (open && !diffs[open] && isTextKind(benchKind(open))) void load(open); }, [open, diffs, load]);

  const restoreOne = async (path: string, diff: FileDiff) => {
    const ok = await appConfirm({
      title: diff.baseHash ? "把这个文件还原到 Buddy 修改之前？" : "这个文件是 Buddy 新建的，还原会把它移到废纸篓",
      message: "当前内容会先留存为一个版本。",
      confirmLabel: "还原",
    });
    if (!ok) return;
    try { await checkpointRestore(sessionId, path, diff.baseHash); onToast("已还原"); onChanged(); } catch (e) { onToast(`还原失败：${friendlyError(e)}`); }
  };
  const restoreAll = async () => {
    const ids = [...new Set(artifacts.flatMap((a) => a.toolCallIds))];
    if (!ids.length) return;
    const ok = await appConfirm({ title: `还原本任务改过的 ${artifacts.length} 个文件？`, message: "每个文件当前的内容都会先留存为一个版本。之后又被改过的文件会单独询问。", confirmLabel: "全部还原" });
    if (ok) await revertToolCalls(sessionId, ids, { onToast, onChanged });
  };

  if (!artifacts.length) {
    return <div className="bench-empty"><div className="bench-empty__title">这个任务还没有改动文件</div><div className="bench-empty__hint">Buddy 新建或修改的文件会出现在这里，可以逐个查看差异并还原。</div></div>;
  }
  return (
    <div className="bench-changes">
      <div className="bench-changes__head">
        <span>{artifacts.length} 个文件有变更</span>
        <button type="button" className="bench-btn" onClick={() => void restoreAll()}>全部还原</button>
      </div>
      <ul className="bench-changes__list">
        {artifacts.map((a) => {
          const name = a.path.split(/[\\/]/).pop() ?? a.path;
          const diff = diffs[a.path];
          const expanded = open === a.path;
          return (
            <li key={a.path} className={"bench-change" + (expanded ? " bench-change--open" : "")}>
              <div className="bench-change__row">
                <button type="button" className="bench-change__main" onClick={() => setOpen(expanded ? null : a.path)} aria-expanded={expanded} title={a.path}>
                  <span className={"bench-chip bench-chip--" + a.status}>{a.status === "created" ? "新建" : "修改"}</span>
                  <span className="bench-change__name">{name}</span>
                  {a.added > 0 || a.removed > 0 ? <span className="bench-change__stats"><span className="diff__stats-add">+{a.added}</span> <span className="diff__stats-del">−{a.removed}</span></span> : a.applied ? <span className="bench-change__stats">从回答应用</span> : null}
                </button>
                <button type="button" className="bench-btn" onClick={() => onOpen(a.path)}>打开</button>
                {diff && typeof diff === "object" && "current" in diff && diff.hasSnapshot && (
                  <button type="button" className="bench-btn" onClick={() => void restoreOne(a.path, diff)}>还原</button>
                )}
              </div>
              {expanded && (
                !isTextKind(benchKind(a.path)) ? <div className="bench-diff__empty">二进制文件，无法显示差异</div>
                : !diff || diff === "loading" ? <div className="bench-skeleton"><span /><span /></div>
                : "error" in diff ? <div className="bench-diff__empty">{diff.error}</div>
                : !diff.hasSnapshot ? <div className="bench-diff__empty">没有修改前的快照（这次修改发生在启用快照之前），无法显示差异或还原。</div>
                : <DiffBlock before={diff.before ?? ""} after={diff.current} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
