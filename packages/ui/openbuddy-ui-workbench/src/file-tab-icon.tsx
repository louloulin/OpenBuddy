/**
 * 文件类型 → emoji 图标选择（workspace-panel 标签 / 文件树共用）。
 *
 * 复用 `@/lib/files/file-changes` 的 `fileIcon` 映射，保证与「文件变更」面板一致。
 */
import { fileIcon } from "@/lib/files/file-changes";

/** 按扩展名取一个 emoji 字符（无扩展名返回通用文件图标）。 */
export function pickFileEmoji(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "📄";
  const ext = fileName.slice(dot).toLowerCase();
  return fileIcon(ext);
}
