import { turnRevert, type ArtifactInfo } from "@openbuddy/client/agent-client";
import { friendlyError } from "@/lib/error-format";
import { appConfirm } from "../AppDialog";

const name = (p: string) => p.split(/[\\/]/).pop() || p;

/** Files (from the artifact index) that the given tool calls changed. */
export function filesTouchedBy(artifacts: ArtifactInfo[], toolCallIds: Iterable<string>): ArtifactInfo[] {
  const ids = new Set(toolCallIds);
  return artifacts.filter((a) => a.toolCallIds.some((id) => ids.has(id)));
}

/**
 * Put files back to before the given tool calls (20261115-ui §5.6). Files
 * changed again afterwards are listed once with 覆盖 / 跳过; files without a
 * snapshot are reported, never guessed at. Returns false when nothing ran.
 */
export async function revertToolCalls(sessionId: string, toolCallIds: string[], opts: { onToast?: (msg: string) => void; onChanged?: () => void }): Promise<boolean> {
  if (!toolCallIds.length) return false;
  try {
    const first = await turnRevert(sessionId, toolCallIds);
    let restored = first.restored;
    let conflicts = first.conflicts;
    const changed = conflicts.filter((c) => c.reason === "changed_since").map((c) => c.path);
    if (changed.length) {
      const overwrite = await appConfirm({
        title: `${changed.length} 个文件在之后又被修改过`,
        message: `${changed.map(name).join("、")}\n覆盖会丢掉之后的修改（覆盖前同样会留存一个版本，可以再还原回来）。`,
        confirmLabel: "覆盖",
        cancelLabel: "跳过",
        danger: true,
      });
      if (overwrite) {
        const again = await turnRevert(sessionId, toolCallIds, { force: true, skip: restored });
        restored = [...restored, ...again.restored];
        conflicts = again.conflicts;
      }
    }
    const missing = conflicts.filter((c) => c.reason === "missing_snapshot").length;
    const skipped = conflicts.length - missing;
    const notes = [skipped ? `跳过 ${skipped} 个` : "", missing ? `${missing} 个没有快照无法还原` : ""].filter(Boolean).join("，");
    opts.onToast?.(restored.length ? `已还原 ${restored.length} 个文件${notes ? `，${notes}` : ""}` : notes || "没有需要还原的文件");
    if (restored.length) opts.onChanged?.();
    return true;
  } catch (e) {
    opts.onToast?.(`还原失败：${friendlyError(e)}`);
    return false;
  }
}
