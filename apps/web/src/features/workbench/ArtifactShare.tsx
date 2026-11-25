/**
 * 分享前态 (B3d / G3-4): local-only export plus a read-only visibility row. Cloud links arrive with
 * the C2 collaboration service, so the entry is present but disabled instead of silently missing or
 * pretending to work. Visibility is shown as it really is — this file only exists on this machine.
 */
import { useEffect, useRef } from "react";
import { invoke } from "@openbuddy/client/ipc";
import { readTextFile, saveTextAs } from "@openbuddy/client/agent-client";
import { copyText } from "@openbuddy/platform/clipboard";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { useFocusTrap } from "@/shared/ui/use-focus-trap";

export function ArtifactShare({ path, available, onClose, onToast }: {
  path: string;
  /** False when the file is gone (only the path can be copied). */
  available: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyContent = async () => {
    try {
      const text = await readTextFile(path, 8 * 1024 * 1024);
      await copyText(text);
      onToast("已复制内容");
      onClose();
    } catch (error) {
      onToast(`复制失败：${friendlyError(error)}`);
    }
  };

  const saveAs = async () => {
    try {
      const name = path.split(/[\\/]/).pop() ?? "artifact";
      const text = await readTextFile(path, 16 * 1024 * 1024);
      const target = await saveTextAs(name, text);
      if (!target) return;
      onToast("已另存");
      onClose();
    } catch (error) {
      onToast(`另存失败：${friendlyError(error)}`);
    }
  };

  const copyPath = () => {
    void copyText(path).then(() => { onToast("已复制路径"); onClose(); }, () => onToast("复制失败"));
  };

  const openDefault = async () => {
    try {
      await invoke("open_path", { path });
      onClose();
    } catch (error) {
      onToast(`无法打开：${friendlyError(error)}`);
    }
  };

  const reveal = async () => {
    try {
      await invoke("reveal_in_folder", { path });
      onClose();
    } catch {
      onToast("无法在文件夹中定位这个文件");
    }
  };

  return (
    <div className="ec-modal-overlay" onClick={(event) => { if (event.target === ref.current) onClose(); }} ref={ref}>
      <div className="ec-modal bench-share" ref={dialogRef} role="dialog" aria-modal="true" aria-label="分享产物">
        <button type="button" className="ec-modal-close" onClick={onClose} aria-label="关闭">×</button>
        <div className="ec-modal-header">
          <div className="ec-modal-info">
            <div className="ec-modal-title">分享</div>
            <p className="ec-modal-desc">{available ? "本地导出；云端链接需要协作服务（C2）。" : "文件已删除，只能复制路径。"}</p>
          </div>
        </div>
        <div className="bench-share__list">
          <button type="button" className="bench-share__item" disabled={!available} onClick={() => void copyContent()}>
            <span>复制内容</span><span className="bench-share__hint">Markdown / 文本</span>
          </button>
          <button type="button" className="bench-share__item" disabled={!available} onClick={() => void saveAs()}>
            <span>另存为…</span><span className="bench-share__hint">保存到本机</span>
          </button>
          <button type="button" className="bench-share__item" disabled={!available} onClick={() => void openDefault()}>
            <span>用默认应用打开</span><span className="bench-share__hint">本机程序</span>
          </button>
          <button type="button" className="bench-share__item" disabled={!available} onClick={() => void reveal()}>
            <span>在文件夹中显示</span><span className="bench-share__hint">Finder / 资源管理器</span>
          </button>
          <button type="button" className="bench-share__item" onClick={copyPath}>
            <span>复制路径</span><span className="bench-share__hint">{path}</span>
          </button>
          <button type="button" className="bench-share__item bench-share__item--disabled" disabled aria-disabled="true" title="协作服务尚未接入（C2）">
            <span>云端链接</span><span className="bench-share__hint">C2 协作服务接入后提供</span>
          </button>
        </div>
        {/* 可见性 (G3-4)：只读展示真实状态，不提供假的「公开 / 私有」开关。 */}
        <div className="bench-share__visibility" role="note">
          <span className="bench-share__visibility-label">可见性</span>
          <span className="bench-share__visibility-value">仅本机</span>
          <span className="bench-share__hint">文件只在这台电脑的工作区里，不随账号同步；云端协作接入后再提供共享链接。</span>
        </div>
      </div>
    </div>
  );
}
