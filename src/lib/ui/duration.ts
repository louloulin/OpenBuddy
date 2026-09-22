/**
 * duration — 通用时间格式化工具。
 *
 * 与 `MessageItem.tsx` 中既有的 `formatDurationMs` 等价,搬到公共位置后便于:
 *   - 流式 caret / thought chip / meta chip / loading row 共用同一份实现
 *   - 单测集中维护
 */
export function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}
