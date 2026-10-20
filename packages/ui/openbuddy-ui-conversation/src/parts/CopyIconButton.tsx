/**
 * R8.11 — CopyIconButton: 26×26 icon-only copy button that briefly swaps
 * to a checkmark on success (mirrors cabinet's CopyButton pattern).
 * Keeps the toast for screen-reader / non-visual confirmation.
 *
 * 被 `MessageItem` 与 `UserBubble` 共用,封装"复制 → 1.5s 内显示对勾"的
 * 状态机;父级只需要传 `onCopy` 即可,所有 UI 反馈由本组件自治。
 */
import { useCallback, useState, type ReactNode } from "react";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import { TooltipButton } from "../TooltipButton";

export function CopyIconButton({
  tooltip,
  copiedTooltip,
  onCopy,
  idleIcon,
  copiedIcon,
}: {
  tooltip: string;
  copiedTooltip: string;
  onCopy: () => void;
  idleIcon?: ReactNode;
  copiedIcon?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const handle = useCallback(() => {
    onCopy();
    setCopied(true);
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [onCopy]);
  const Icon = copied
    ? (copiedIcon ?? <Check size={14} strokeWidth={2} />)
    : (idleIcon ?? <Copy size={14} strokeWidth={1.75} />);
  return (
    <TooltipButton
      className="msg__action-btn"
      tooltip={copied ? copiedTooltip : tooltip}
      onClick={handle}
      aria-label={copied ? copiedTooltip : tooltip}
    >
      {Icon}
    </TooltipButton>
  );
}
