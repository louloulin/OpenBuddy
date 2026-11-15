import { useState, useRef, useEffect } from "react";
import { WbMoreNavIcon } from "@openbuddy/ui/icon/icons/index";

/**
 * "更多" 侧栏按钮的弹出菜单 — 对齐 WorkBuddy：
 * - hover 打开，向右浮出（不向下盖住会话列表）
 * - 菜单项由 FeatureRegistry 给出（pii W0.2）：只列宿主真正提供的入口，不再有只弹 toast 的项。
 *   以前写死的列表（我的文件 / 知识库 / 用量统计 / 通知渠道 / 策略设置 …）现在是注册表里 slot "more" 的条目。
 */
export function MoreDropdown({
  items,
  onNavigate,
  activeNav,
}: {
  items: { id: string; label: string; icon: typeof WbMoreNavIcon }[];
  onNavigate: (label: string) => void;
  activeNav: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    // Small grace so the cursor can move from trigger → popover without flicker.
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  const openMenu = () => {
    clearCloseTimer();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  useEffect(() => () => clearCloseTimer(), []);

  const isActive = activeNav === "更多" || items.some((item) => item.label === activeNav);

  return (
    <div
      className={"sidebar__more-wrap" + (open ? " sidebar__more-wrap--open" : "")}
      ref={containerRef}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={
          "sidebar__nav-item" +
          (isActive || open ? " sidebar__nav-item--active" : "")
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={openMenu}
      >
        <WbMoreNavIcon size="md" />
        <span>更多</span>
        <span className="sidebar__nav-sub">文件·通知</span>
      </button>
      {open && (
        <div className="sidebar__more-popover" role="menu">
          {items.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-feature={id}
              className={
                "sidebar__more-item" +
                (activeNav === label ? " sidebar__more-item--active" : "")
              }
              role="menuitem"
              onClick={() => { setOpen(false); onNavigate(label); }}
            >
              <span className="sidebar__more-item-icon"><Icon size="md" /></span>
              <span className="sidebar__more-item-label">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
