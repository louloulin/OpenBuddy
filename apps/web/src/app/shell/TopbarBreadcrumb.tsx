import { FolderIcon } from "lucide-react";

/**
 * 聊天页顶栏的面包屑 (WorkBuddy 对齐)：WorkBuddy 聊天页顶部是
 * 「📁 项目 / 分组 / 会话名」的层级路径，OpenBuddy 对应「📁 空间 / 会话名」。
 * 只有一段时（没有空间）就不渲染，避免出现空的层级。
 */
export function TopbarBreadcrumb({ space }: { space?: string }) {
  if (!space) return null;
  return (
    <span className="main-topbar__crumb" title={space}>
      <FolderIcon size={14} aria-hidden className="main-topbar__crumb-icon" />
      <span className="main-topbar__crumb-text">{space}</span>
      <span className="main-topbar__crumb-sep" aria-hidden>/</span>
    </span>
  );
}
