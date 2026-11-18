import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, ChevronRight, Wand2 } from "lucide-react";
import {
  AddIcon,
  ExpertTabIcon,
  McpIcon,
  SkillTabIcon,
} from "@openbuddy/ui/icon/icons/index";
import { expertsLoad, skillsList, sessionMcpGet, sessionMcpSet } from "@openbuddy/client/agent-client";
import { HOME_MODES, type HomeModeId } from "../../shared/content/scenes";
import type { AgentEntry, SkillInfo } from "@openbuddy/protocol/dto";

interface InputAddMenuProps {
  onPickFiles: () => void;
  onSelectMode?: (modeId: HomeModeId) => void;
  onSelectExpert?: (agent: AgentEntry) => void;
  onSelectSkill?: (skillName: string) => void;
  onNavigateConnectors?: (tab?: "experts" | "connectors") => void;
  /** 本任务连接器开关 (pii W2.4 P2); omitted on the home page (no task yet). */
  sessionId?: string;
}

type MenuItemId = "add-files" | "mode" | "experts" | "skills" | "connectors";

interface MenuItem {
  id: MenuItemId;
  label: string;
  icon: React.ReactNode;
}

const MENU_GROUPS: MenuItem[][] = [
  [
    { id: "add-files", label: "添加文件", icon: <Paperclip size={16} /> },
  ],
  [
    { id: "mode", label: "模式", icon: <Wand2 size={16} /> },
    { id: "experts", label: "专家", icon: <ExpertTabIcon size="md" /> },
    { id: "skills", label: "技能", icon: <SkillTabIcon size="md" /> },
    { id: "connectors", label: "连接器", icon: <McpIcon size="md" /> },
  ],
];

export function InputAddMenu({
  onPickFiles,
  onSelectMode,
  onSelectExpert,
  onSelectSkill,
  onNavigateConnectors,
  sessionId,
}: InputAddMenuProps) {
  const [open, setOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<MenuItemId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [experts, setExperts] = useState<AgentEntry[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [sessionMcp, setSessionMcp] = useState<Array<{ name: string; enabled: boolean }>>([]);
  const [mcpBusy, setMcpBusy] = useState("");
  const [dataLoaded, setDataLoaded] = useState(false);

  const loadData = useCallback(async () => {
    if (dataLoaded) return;
    setDataLoaded(true);
    try {
      const [e, s] = await Promise.all([
        // 专家中心 catalog (pii W2.3): 我的专家 first, then built-in / library / project experts.
        expertsLoad().then((c) => c.experts as AgentEntry[]).catch(() => [] as AgentEntry[]),
        skillsList().catch(() => [] as SkillInfo[]),
      ]);
      setExperts(e);
      setSkills(s.filter((sk) => sk.enabled));
    } catch {
      /* best-effort */
    }
  }, [dataLoaded]);

  useEffect(() => {
    if (open && !dataLoaded) loadData();
  }, [open, dataLoaded, loadData]);

  // 本任务连接器开关 (W2.4 P2): read the session's enabled list when the menu opens.
  useEffect(() => {
    if (!open || !sessionId) return;
    let disposed = false;
    void sessionMcpGet(sessionId)
      .then((state) => { if (!disposed) setSessionMcp(state.servers); })
      .catch(() => { /* menu stays usable without connectors */ });
    return () => { disposed = true; };
  }, [open, sessionId]);

  const toggleConnector = async (name: string, enabled: boolean) => {
    if (!sessionId || mcpBusy) return;
    setMcpBusy(name);
    try {
      const next = await sessionMcpSet(sessionId, name, enabled);
      setSessionMcp(next.servers);
    } catch { /* keep the previous state */ }
    finally { setMcpBusy(""); }
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setHoveredItem(null);
      }
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
    if (id === "add-files") { setHoveredItem(null); return; }
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
    if (id === "add-files") { close(); onPickFiles(); }
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
    onNavigateConnectors?.("connectors");
  };
  const handleOpenExpertCenter = () => {
    close();
    onNavigateConnectors?.("experts");
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
      items = (<>{experts.length > 0 ? (
        experts.slice(0, 12).map((e) => (
          <button
            key={e.path || e.name}
            type="button"
            className="iam-sub-item"
            onClick={() => handleSelectExpert(e)}
          >
            <span className="iam-sub-avatar">{"emoji" in e && typeof e.emoji === "string" ? e.emoji : Array.from(e.name || "?")[0]}</span>
            <span className="iam-sub-text">
              <span className="iam-sub-name">{e.name}</span>
              {e.description && <span className="iam-sub-desc">{e.description.slice(0, 40)}</span>}
            </span>
          </button>
        ))
      ) : (
        <div className="iam-sub-empty">暂无专家</div>
      )}
      <div className="iam-sub-footer" onClick={handleOpenExpertCenter}>专家中心 →</div></>);
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
          <div className="iam-sub-heading">本任务连接器</div>
          {!sessionId ? (
            <div className="iam-sub-empty">打开任务后可切换本任务连接器</div>
          ) : sessionMcp.length === 0 ? (
            <div className="iam-sub-empty">还没有配置连接器</div>
          ) : (
            sessionMcp.map((server) => (
              <button
                key={server.name}
                type="button"
                className="iam-sub-item"
                disabled={mcpBusy === server.name}
                onClick={() => { void toggleConnector(server.name, !server.enabled); }}
                aria-pressed={server.enabled}
              >
                <span className="iam-sub-text"><span className="iam-sub-name">{server.name}</span></span>
                <span className={"iam-switch" + (server.enabled ? " iam-switch--on" : "")} aria-hidden="true">
                  <span className="iam-switch__dot" />
                </span>
              </button>
            ))
          )}
          <div className="iam-sub-footer" onClick={handleSelectConnector}>
            管理连接器 →
          </div>
        </>
      );
    }

    if (!items) return null;

    return (
      <div
        className="iam-submenu"
        onMouseEnter={handleSubmenuEnter}
        onMouseLeave={handleSubmenuLeave}
      >
        <div className="iam-submenu__scroll">{items}</div>
      </div>
    );
  };

  return (
    <div className="iam-wrap" ref={containerRef}>
      <button
        className="wb-composer__add"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="添加"
        title="添加文件、模式、专家、技能、连接器"
      >
        <AddIcon size="md" />
      </button>

      {open && (
        <div className="iam-popover">
          {MENU_GROUPS.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && <div className="iam-divider" />}
              <div className="iam-group">
                {group.map((item) => (
                  <div
                    key={item.id}
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
          {renderSubmenu()}
        </div>
      )}
    </div>
  );
}
