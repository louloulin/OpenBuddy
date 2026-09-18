import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip, ChevronRight, Wand2, Image as ImageIcon, Wrench } from "lucide-react";
import {
  AddIcon,
  ExpertTabIcon,
  SkillTabIcon,
  ConnectorTabIcon,
} from "@openbuddy/ui-primitives/icons";
import { skillsList, agentsList, agentToolsList, type AgentToolDescriptor } from "@/lib/agent/pi-client";
import { HOME_MODES, type HomeModeId } from "@openbuddy/ui-shared";
import { CONNECTOR_LIST } from "@openbuddy/ui-experts";
import type { AgentEntry, SkillInfo } from "@openbuddy/shared-types";

interface InputAddMenuProps {
  onPickFiles: () => void;
  /** R1 — open the OS file picker scoped to images. The composer handles
   *  base64 conversion + state so the menu only triggers the dialog. */
  onPickImages?: () => void;
  onSelectMode?: (modeId: HomeModeId) => void;
  onSelectExpert?: (agent: AgentEntry) => void;
  onSelectSkill?: (skillName: string) => void;
  onNavigateConnectors?: () => void;
}

type MenuItemId = "add-files" | "add-images" | "mode" | "experts" | "skills" | "connectors" | "tools";

interface MenuItem {
  id: MenuItemId;
  label: string;
  icon: React.ReactNode;
}

const MENU_GROUPS: MenuItem[][] = [
  [
    { id: "add-files", label: "添加文件", icon: <Paperclip size={16} /> },
    { id: "add-images", label: "添加图片", icon: <ImageIcon size={16} /> },
  ],
  [
    { id: "mode", label: "模式", icon: <Wand2 size={16} /> },
    { id: "experts", label: "专家", icon: <ExpertTabIcon size="md" /> },
    { id: "skills", label: "技能", icon: <SkillTabIcon size="md" /> },
    { id: "connectors", label: "连接器", icon: <ConnectorTabIcon size="md" /> },
  ],
  [
    { id: "tools", label: "工具", icon: <Wrench size={16} /> },
  ],
];

export function InputAddMenu({
  onPickFiles,
  onPickImages,
  onSelectMode,
  onSelectExpert,
  onSelectSkill,
  onNavigateConnectors,
}: InputAddMenuProps) {
  const [open, setOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<MenuItemId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** 触发按钮(锚点)—— 浮层定位全基于它的 viewport rect。 */
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** portal 出来的浮层本体(用于测量尺寸 / 判断 outside click)。 */
  const popoverRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  /** 每个菜单项节点 —— 二级菜单需要按 hover 行对齐。 */
  const itemRefs = useRef(new Map<MenuItemId, HTMLElement>());
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number; placement: "top" | "bottom" } | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ left: number; top: number } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [experts, setExperts] = useState<AgentEntry[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [tools, setTools] = useState<AgentToolDescriptor[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const loadData = useCallback(async () => {
    if (dataLoaded) return;
    setDataLoaded(true);
    try {
      const [e, s, t] = await Promise.all([
        agentsList().catch(() => [] as AgentEntry[]),
        skillsList().catch(() => [] as SkillInfo[]),
        agentToolsList().catch(() => [] as AgentToolDescriptor[]),
      ]);
      setExperts(e);
      setSkills(s.filter((sk) => sk.enabled));
      setTools(t);
    } catch {
      /* best-effort */
    }
  }, [dataLoaded]);

  useEffect(() => {
    if (open && !dataLoaded) loadData();
  }, [open, dataLoaded, loadData]);

  /**
   * 浮层定位 —— 菜单 portal 到 document.body 之后,position:absolute 的
   * containing block 不再是 `.iam-wrap`,因此必须自己算 viewport 坐标。
   *
   * 为什么必须 portal:`.wb-composer` 有 `overflow: hidden`(输入卡自带的
   * 圆角裁切),`.iam-popover` 一旦留在原地就会被裁掉一半 —— 真机截图里
   * 那半张浮层正是这个原因。MentionPicker / SlashCommands 早就走 portal,
   * 这里是同一约定的补齐。
   *
   * 规则:优先向上弹(输入卡贴在页面底部,向上才有空间);上方装不下就
   * 翻到下方;左右夹紧在视口内留 8px 边距。
   */
  const placePopover = useCallback(() => {
    const anchorEl = buttonRef.current;
    const pop = popoverRef.current;
    if (!anchorEl) return;
    const a = anchorEl.getBoundingClientRect();
    const width = pop?.offsetWidth || 200;
    const height = pop?.offsetHeight || 260;
    const GAP = 8;
    const MARGIN = 8;
    const spaceAbove = a.top;
    const spaceBelow = window.innerHeight - a.bottom;
    const placement: "top" | "bottom" =
      spaceAbove >= height + GAP || spaceAbove >= spaceBelow ? "top" : "bottom";
    const top = placement === "top" ? a.top - height - GAP : a.bottom + GAP;
    const left = Math.min(
      Math.max(MARGIN, a.left),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    );
    setPopoverPos((prev) =>
      prev && prev.left === left && prev.top === top && prev.placement === placement
        ? prev
        : { left, top, placement },
    );
  }, []);

  /** 二级菜单:贴着被 hover 的那一行右侧;右边装不下就翻到左侧。 */
  const placeSubmenu = useCallback(() => {
    const id = hoveredItem;
    if (!id) { setSubmenuPos(null); return; }
    const row = itemRefs.current.get(id);
    if (!row) { setSubmenuPos(null); return; }
    const r = row.getBoundingClientRect();
    const w = submenuRef.current?.offsetWidth || 240;
    const h = submenuRef.current?.offsetHeight || 220;
    const GAP = 4;
    const MARGIN = 8;
    const openRight = r.right + GAP + w <= window.innerWidth - MARGIN;
    const left = openRight ? r.right + GAP : Math.max(MARGIN, r.left - GAP - w);
    // 与 hover 行顶部对齐,但不越出视口下沿。
    const top = Math.min(Math.max(MARGIN, r.top), Math.max(MARGIN, window.innerHeight - h - MARGIN));
    setSubmenuPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [hoveredItem]);

  // 打开的第一帧 + 每次尺寸/视口变化都重新定位(useLayoutEffect → 首帧不闪)。
  useLayoutEffect(() => {
    if (!open) { setPopoverPos(null); return; }
    placePopover();
  }, [open, placePopover]);

  useLayoutEffect(() => {
    if (!open || !hoveredItem) { setSubmenuPos(null); return; }
    placeSubmenu();
  }, [open, hoveredItem, placeSubmenu]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => { placePopover(); if (hoveredItem) placeSubmenu(); };
    // capture:true —— 浮层挂在 body 上,但它锚定的输入卡会随内层容器滚动。
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (ro && popoverRef.current) ro.observe(popoverRef.current);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      ro?.disconnect();
    };
  }, [open, hoveredItem, placePopover, placeSubmenu]);

  // Close on outside click. 浮层 + 二级菜单都在 portal 里,不在 containerRef
  // 子树内,所以必须显式把它们也排除掉,否则点菜单项会先被判定为"外部点击"。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      if (submenuRef.current?.contains(target)) return;
      setOpen(false);
      setHoveredItem(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setHoveredItem(null); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  const handleItemEnter = (id: MenuItemId) => {
    if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    // Items without submenus show immediately
    if (id === "add-files" || id === "add-images") { setHoveredItem(null); return; }
    hoverTimerRef.current = setTimeout(() => setHoveredItem(id), 150);
  };

  const handleItemLeave = () => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    leaveTimerRef.current = setTimeout(() => setHoveredItem(null), 200);
  };

  const handleSubmenuEnter = () => {
    if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
  };

  const handleSubmenuLeave = () => {
    leaveTimerRef.current = setTimeout(() => setHoveredItem(null), 200);
  };

  const close = () => { setOpen(false); setHoveredItem(null); };

  const handleItemClick = (id: MenuItemId) => {
    if (id === "add-files") { close(); onPickFiles(); return; }
    if (id === "add-images") { close(); onPickImages?.(); }
  };

  const handleSelectMode = (modeId: HomeModeId) => {
    close();
    onSelectMode?.(modeId);
  };

  const handleSelectExpert = (agent: AgentEntry) => {
    close();
    onSelectExpert?.(agent);
  };

  const handleSelectSkill = (name: string) => {
    close();
    onSelectSkill?.(name);
  };

  const handleSelectConnector = () => {
    close();
    onNavigateConnectors?.();
  };

  const renderSubmenu = () => {
    if (!hoveredItem) return null;

    let items: React.ReactNode = null;

    if (hoveredItem === "mode") {
      items = HOME_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className="iam-sub-item"
          onClick={() => handleSelectMode(m.id)}
        >
          <m.icon size={14} />
          <span>{m.label}</span>
        </button>
      ));
    }

    if (hoveredItem === "experts") {
      items = experts.length > 0 ? (
        experts.map((e) => (
          <button
            key={e.path || e.name}
            type="button"
            className="iam-sub-item"
            onClick={() => handleSelectExpert(e)}
          >
            <span className="iam-sub-avatar">{(e.name || "?")[0]}</span>
            <span className="iam-sub-text">
              <span className="iam-sub-name">{e.name}</span>
              {e.description && <span className="iam-sub-desc">{e.description.slice(0, 40)}</span>}
            </span>
          </button>
        ))
      ) : (
        <div className="iam-sub-empty">暂无已安装专家</div>
      );
    }

    if (hoveredItem === "skills") {
      items = skills.length > 0 ? (
        skills.map((s) => (
          <button
            key={s.name}
            type="button"
            className="iam-sub-item"
            onClick={() => handleSelectSkill(s.name)}
          >
            <SkillTabIcon size="sm" />
            <span className="iam-sub-text">
              <span className="iam-sub-name">{s.displayName || s.name}</span>
              {s.description && <span className="iam-sub-desc">{s.description.slice(0, 40)}</span>}
            </span>
          </button>
        ))
      ) : (
        <div className="iam-sub-empty">暂无已启用技能</div>
      );
    }

    if (hoveredItem === "connectors") {
      items = (
        <>
          {CONNECTOR_LIST.slice(0, 8).map((c) => (
            <button
              key={c.id}
              type="button"
              className="iam-sub-item"
              onClick={handleSelectConnector}
            >
              <span className="iam-sub-avatar" style={{ background: c.color || "var(--wb-text-tertiary)" }}>
                {c.name[0]}
              </span>
              <span className="iam-sub-name">{c.name}</span>
            </button>
          ))}
          <div className="iam-sub-footer" onClick={handleSelectConnector}>
            管理连接器 →
          </div>
        </>
      );
    }

    if (hoveredItem === "tools") {
      // Surface every tool the active Pi runtime exposes so the user can
      // see G-1d adapter tools alongside built-in Pi tools. Pi-native tools
      // (source="pi") show their upstream package hint; OpenBuddy adapters
      // (source="openbuddy") show their friendly label. Click is a no-op
      // for now — wiring selection to the model is handled by the host
      // (see /goal in plan H-4 for the run-history wiring).
      items = tools.length > 0 ? (
        tools.map((t) => (
          <div
            key={t.name}
            className="iam-sub-item iam-sub-item--readonly"
            title={t.description}
          >
            <span className="iam-sub-avatar" style={{ background: t.source === "pi" ? "var(--wb-accent, #4f46e5)" : "var(--wb-text-tertiary)" }}>
              {t.source === "pi" ? "π" : "OB"}
            </span>
            <span className="iam-sub-text">
              <span className="iam-sub-name">{t.label || t.name}</span>
              <span className="iam-sub-desc">
                {t.piPackageHint ? `${t.piPackageHint}` : "openbuddy adapter"}
                {t.description ? ` · ${t.description.slice(0, 36)}` : ""}
              </span>
            </span>
          </div>
        ))
      ) : (
        <div className="iam-sub-empty">暂无工具</div>
      );
    }

    if (!items) return null;

    // 二级菜单同样 portal 到 body:它是浮层的子级,但浮层本身已经脱离
    // 输入卡的裁切上下文,子级若留在浮层内部又会随浮层一起被视口边缘裁掉。
    // 用 fixed + 手动坐标,保证"向右装不下就翻左"这条规则真的生效。
    return createPortal(
      <div
        ref={submenuRef}
        className="iam-submenu"
        style={
          submenuPos
            ? { position: "fixed", left: submenuPos.left, top: submenuPos.top, right: "auto", bottom: "auto" }
            : { position: "fixed", visibility: "hidden" }
        }
        data-placement={submenuPos ? "fixed" : "measuring"}
        onMouseEnter={handleSubmenuEnter}
        onMouseLeave={handleSubmenuLeave}
      >
        <div className="iam-submenu__scroll">{items}</div>
      </div>,
      document.body,
    );
  };

  return (
    <div className="iam-wrap" ref={containerRef}>
      <button
        ref={buttonRef}
        className="wb-composer__add"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="添加"
        aria-haspopup="menu"
        aria-expanded={open}
        title="添加文件、模式、专家、技能、连接器"
      >
        <AddIcon size="md" />
      </button>

      {/* R84 —— 浮层 portal 到 document.body。
          `.wb-composer` 带 `overflow: hidden`(输入卡圆角裁切),浮层留在
          输入卡内部时会被裁掉下半截(真机截图:菜单只露出上半部分,而且
          被上方「最佳实践案例」卡片压住)。移到 body 之后 acquire 顶层
          z-index,不再受任何祖先 overflow / transform 影响。 */}
      {open && createPortal(
        <div
          ref={popoverRef}
          className="iam-popover"
          role="menu"
          aria-label="添加"
          data-placement={popoverPos?.placement ?? "top"}
          style={
            popoverPos
              ? { position: "fixed", left: popoverPos.left, top: popoverPos.top, bottom: "auto" }
              : { position: "fixed", visibility: "hidden" }
          }
        >
          {MENU_GROUPS.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && <div className="iam-divider" />}
              <div className="iam-group">
                {group.map((item) => (
                  <div
                    key={item.id}
                    ref={(node) => {
                      if (node) itemRefs.current.set(item.id, node);
                      else itemRefs.current.delete(item.id);
                    }}
                    className={
                      "iam-item" + (hoveredItem === item.id ? " iam-item--active" : "")
                    }
                    onMouseEnter={() => handleItemEnter(item.id)}
                    onMouseLeave={handleItemLeave}
                    onClick={() => handleItemClick(item.id)}
                    role="menuitem"
                  >
                    <span className="iam-item__icon">{item.icon}</span>
                    <span className="iam-item__label">{item.label}</span>
                    {item.id !== "add-files" && (
                      <span className="iam-item__chevron">
                        <ChevronRight size={14} strokeWidth={1.5} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
      {open && renderSubmenu()}
    </div>
  );
}
