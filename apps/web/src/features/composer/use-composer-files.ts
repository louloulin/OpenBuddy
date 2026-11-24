import { useCallback, useState } from "react";
import { open as openDialog, getPathForFile } from "@openbuddy/client/ipc";
import { collectDroppedPaths } from "@/shared/lib/files/drop-utils";

/**
 * 输入区的附件：系统对话框选文件 + 拖拽落文件。
 *
 * 抽成 hook 是为了不让 Composer 再长（它已经到体量上限），行为一字未改。
 */
export function useComposerFiles({
  disabled,
  apiReady,
  streaming,
  canEnqueue,
  onToast,
}: {
  disabled?: boolean;
  apiReady: boolean;
  streaming: boolean;
  /** 流式中仍可入队时，拖拽也允许加附件。 */
  canEnqueue: boolean;
  onToast?: (message: string) => void;
}) {
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const pickFiles = useCallback(async () => {
    try {
      const selected = await openDialog({ multiple: true });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setAttachments((prev) => {
        const set = new Set(prev);
        paths.forEach((path) => set.add(path));
        return [...set];
      });
    } catch {
      /* the dialog failed: nothing to add */
    }
  }, []);

  /** DOM drop keeps File objects; the preload resolves their native paths. */
  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    if (disabled || !apiReady || (streaming && !canEnqueue)) return;
    try {
      const incoming = collectDroppedPaths(Array.from(event.dataTransfer.files, getPathForFile));
      setAttachments((prev) => Array.from(new Set([...prev, ...incoming])));
    } catch (error) {
      onToast?.(`无法添加文件：${String(error)}`);
    }
  }, [disabled, apiReady, streaming, canEnqueue, onToast]);

  return { attachments, setAttachments, dragActive, setDragActive, pickFiles, handleDrop };
}
