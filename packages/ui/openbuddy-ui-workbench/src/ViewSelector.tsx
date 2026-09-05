/**
 * 视图选择器（下拉 pill）—— 对齐 WorkBuddy `view-selector-pill`。
 *
 * 显示当前视图图标 + 名称，点击展开菜单切换。水平 pill 形态（非垂直图标栏）。
 * 可用视图按条件过滤（如「变更」仅在有 diff 时显示）。
 */
import { useEffect, useRef, useState } from "react";
import type { WorkspaceView } from "@/lib/ui/use-unified-tabs";
import {
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  ChevronDownIcon,
} from "@openbuddy/ui-primitives/icons";

export interface ViewDef {
  value: WorkspaceView;
  label: string;
  /** 取图标元素。 */
  icon: () => React.ReactNode;
  /** 是否隐藏该视图（如无数据时）。 */
  hidden?: boolean;
}

export function ViewSelector({
  view,
  views,
  onChange,
}: {
  view: WorkspaceView;
  views: ViewDef[];
  onChange: (v: WorkspaceView) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visible = views.filter((v) => !v.hidden);
  const current = visible.find((v) => v.value === view) ?? visible[0];

  if (!current) return null;

  return (
    <div className="view-selector" ref={rootRef}>
      <button
        type="button"
        className={"view-selector__pill" + (open ? " view-selector__pill--open" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="view-selector__icon">{current.icon()}</span>
        <span className="view-selector__label">{current.label}</span>
        <ChevronDownIcon
          size="sm"
          className={"view-selector__chevron" + (open ? " view-selector__chevron--up" : "")}
        />
      </button>
      {open && (
        <ul className="view-selector__menu" role="listbox">
          {visible.map((v) => (
            <li key={v.value}>
              <button
                type="button"
                role="option"
                aria-selected={v.value === view}
                className={
                  "view-selector__option" +
                  (v.value === view ? " view-selector__option--active" : "")
                }
                onClick={() => {
                  onChange(v.value);
                  setOpen(false);
                }}
              >
                <span className="view-selector__icon">{v.icon()}</span>
                <span className="view-selector__label">{v.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 便捷工厂：默认四视图集合（调用方可覆盖 hidden）。 */
export function defaultViews(opts: {
  hasChanges: boolean;
}): ViewDef[] {
  return [
    {
      value: "artifacts",
      label: "产物",
      icon: () => <FileTextIcon size="sm" />,
    },
    {
      value: "fileTree",
      label: "文件树",
      icon: () => <FolderIcon size="sm" />,
    },
    {
      value: "preview",
      label: "浏览器",
      icon: () => <GlobeIcon size="sm" />,
    },
    {
      value: "changes",
      label: "变更",
      icon: () => <FileTextIcon size="sm" />,
      hidden: !opts.hasChanges,
    },
  ];
}
