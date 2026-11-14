import { useState, useRef, useEffect } from "react";
import {
  WbMoreNavIcon,
  MyFilesIconV2,
  MoreMenuImaKnowledgeIcon,
  MoreMenuInspirationIcon,
  MoreMenuTencentDocsIcon,
  MoreMenuTencentLexiangIcon,
} from "@openbuddy/ui/icon/icons/index";

/**
 * "更多" 侧栏按钮的弹出菜单 — 对齐 WorkBuddy：
 * - hover 打开，向右浮出（不向下盖住会话列表）
 * - 菜单项：我的文件 / 腾讯文档 / ima知识库 / 乐享知识库 / 灵感
 *
 * 腾讯系三项在 OpenBuddy 暂无完整对接，点击给 toast；可导航项走 onNavigate。
 */
export function MoreDropdown({
  onNavigate,
  onToast,
  activeNav,
}: {
  onNavigate: (label: string) => void;
  onToast?: (message: string) => void;
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

  const isActive =
    activeNav === "更多" ||
    activeNav === "资料库" ||
    activeNav === "灵感" ||
    activeNav === "我的文件" ||
    activeNav === "腾讯文档" ||
    activeNav === "ima知识库" ||
    activeNav === "乐享知识库";

  const ITEMS: {
    id: string;
    label: string;
    icon: React.ReactNode;
    action: () => void;
  }[] = [
    {
      id: "my_files",
      label: "我的文件",
      icon: <MyFilesIconV2 size="md" />,
      action: () => {
        setOpen(false);
        onNavigate("我的文件");
      },
    },
    {
      id: "tencent_docs",
      label: "腾讯文档",
      icon: <MoreMenuTencentDocsIcon size="md" />,
      action: () => {
        setOpen(false);
        onToast?.("腾讯文档：企业版功能，需腾讯内网环境");
      },
    },
    {
      id: "knowledge_base",
      label: "知识库",
      icon: <MoreMenuImaKnowledgeIcon size="md" />,
      action: () => {
        setOpen(false);
        onNavigate("知识库");
      },
    },
    {
      id: "lexiang_kb",
      label: "乐享知识库",
      icon: <MoreMenuTencentLexiangIcon size="md" />,
      action: () => {
        setOpen(false);
        onToast?.("乐享知识库：企业版功能，需腾讯内网环境");
      },
    },
    {
      id: "browser_preview",
      label: "网页预览",
      icon: <MoreMenuInspirationIcon size="md" />,
      action: () => {
        setOpen(false);
        onNavigate("网页预览");
      },
    },
    {
      id: "inspiration",
      label: "灵感",
      icon: <MoreMenuInspirationIcon size="md" />,
      action: () => {
        setOpen(false);
        onNavigate("灵感");
      },
    },
    {
      id: "usage_quota",
      label: "用量统计",
      icon: <MoreMenuInspirationIcon size="md" />,
      action: () => {
        setOpen(false);
        onNavigate("用量统计");
      },
    },
    {
      id: "notify_channels",
      label: "通知渠道",
      icon: <MoreMenuInspirationIcon size="md" />,
      action: () => {
        setOpen(false);
        onNavigate("通知渠道");
      },
    },
    {
      id: "policy_settings",
      label: "策略设置",
      icon: <MoreMenuInspirationIcon size="md" />,
      action: () => {
        setOpen(false);
        onNavigate("策略设置");
      },
    },
    {
      id: "cloud_storage",
      label: "云存储",
      icon: <MoreMenuInspirationIcon size="md" />,
      action: () => {
        setOpen(false);
        onNavigate("云存储");
      },
    },
  ];

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
          {ITEMS.filter(item => ["my_files", "knowledge_base", "usage_quota", "notify_channels", "policy_settings"].includes(item.id)).map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                "sidebar__more-item" +
                (activeNav === item.label ? " sidebar__more-item--active" : "")
              }
              role="menuitem"
              onClick={item.action}
            >
              <span className="sidebar__more-item-icon">{item.icon}</span>
              <span className="sidebar__more-item-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
