/**
 * MessageMoreMenu — 助手消息操作栏的「⋯」(对齐 WorkBuddy:复制 / 重试 / 赞踩 /
 * ⋯)。不常用的动作(复制 Markdown、编辑、从此重发、分叉)收进这里,操作栏
 * 只留一眼能懂的几颗按钮。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";

export type MessageMoreItem = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  testId?: string;
};

export function MessageMoreMenu({ items }: { items: readonly MessageMoreItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div className="share-menu msg-more" ref={ref}>
      <button
        type="button"
        className="msg__action-btn"
        aria-label="更多操作"
        aria-expanded={open}
        title="更多操作"
        data-testid="message-more"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={14} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="share-menu__popover msg-more__popover" role="presentation">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              className="share-menu__item chatview__more-item"
              data-testid={item.testId}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
