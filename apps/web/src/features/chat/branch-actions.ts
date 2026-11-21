import { agentNavigate } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import type { BranchTurn, NavigateResult } from "@openbuddy/protocol/branches";
import { appConfirmWithOption } from "../../shared/ui/AppDialog";
import { confirmOverwrite } from "../workbench";
import { useBranchStore } from "./state/branch-store";

/**
 * Switch a turn to another version (20261116-pii W1.1). When the two versions changed different
 * files, offer to put the files back to the target version's state too (checked by default, as
 * for 重新生成 · U2.4); files changed since are confirmed with the same 覆盖 / 跳过 prompt (U2.3).
 * The engine rebuilds the transcript (`session_rewound`); the tree is refreshed here.
 */
export async function switchVersion(sessionId: string, turn: BranchTurn, targetIndex: number, opts: { summarize?: boolean; onToast?: (msg: string) => void } = {}): Promise<boolean> {
  const current = turn.siblings[turn.index];
  const target = turn.siblings[targetIndex];
  if (!current || !target || targetIndex === turn.index) return false;
  const store = useBranchStore.getState();
  if (store.switching[sessionId]) return false;
  const files = [...new Set([...current.files, ...target.files])];
  let restoreFiles = false;
  if (files.length) {
    const choice = await appConfirmWithOption({
      title: `切换到第 ${targetIndex + 1} 版？`,
      message: opts.summarize ? "会先总结当前版本，再切换。两个版本修改过的文件不同。" : "两个版本修改过的文件不同。",
      confirmLabel: "切换",
      checkbox: { label: `同时把文件还原到第 ${targetIndex + 1} 版的状态（${files.length} 个文件）`, checked: true },
    });
    if (!choice.ok) return false;
    restoreFiles = choice.checked;
  }
  store.setSwitching(sessionId, opts.summarize ? "summarize" : "switch");
  try {
    let result: NavigateResult = await agentNavigate(sessionId, target.leafId, { summarize: opts.summarize, restoreFiles });
    if (!result.navigated && result.conflicts.some((c) => c.reason === "changed_since")) {
      const changed = result.conflicts.filter((c) => c.reason === "changed_since").map((c) => c.path);
      const overwrite = await confirmOverwrite(changed);
      result = await agentNavigate(sessionId, target.leafId, { summarize: opts.summarize, restoreFiles: overwrite ? { force: true } : { skip: changed } });
    }
    if (!result.navigated) { opts.onToast?.("没有切换版本"); return false; }
    const missing = result.conflicts.filter((c) => c.reason === "missing_snapshot").length;
    // Files written to while the old version was being summarized are left alone.
    const changed = result.conflicts.filter((c) => c.reason === "changed_since").length;
    const notes = [
      result.restored.length ? `还原了 ${result.restored.length} 个文件` : "",
      missing ? `${missing} 个文件没有快照无法还原` : "",
      changed ? `${changed} 个文件在切换期间被改动，未还原` : "",
      result.summarized ? "已总结原来的版本" : "",
      result.editorText !== undefined ? "这个版本还没有回答" : "",
    ].filter(Boolean);
    opts.onToast?.(`已切换到第 ${targetIndex + 1} 版${notes.length ? `，${notes.join("，")}` : ""}`);
    return true;
  } catch (e) {
    opts.onToast?.(`切换失败：${friendlyError(e)}`);
    return false;
  } finally {
    useBranchStore.getState().setSwitching(sessionId, undefined);
    void useBranchStore.getState().refresh(sessionId);
  }
}
