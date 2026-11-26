import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Paperclip, ChevronRight, Wand2, Blocks } from "lucide-react";
import {
  AddIcon,
  ExpertTabIcon,
  McpIcon,
  SkillTabIcon,
} from "@openbuddy/ui/icon/icons/index";
import { artifactsList, expertsLoad, listDir, skillsList, sessionMcpGet, sessionMcpSet, type AgentMode } from "@openbuddy/client/agent-client";
import { HOME_MODES, type HomeModeId } from "../../shared/content/scenes";
import { ApplicationPicker } from "./ApplicationPicker";
import type { AgentEntry, SkillInfo } from "@openbuddy/protocol/dto";

interface InputAddMenuProps {
  onPickFiles: () => void;
  onSelectMode?: (modeId: HomeModeId) => void;
  onSelectExpert?: (agent: AgentEntry) => void;
  onSelectSkill?: (skillName: string) => void;
  onNavigateConnectors?: (tab?: "experts" | "connectors") => void;
  /** G1-15: insert a file produced in this task as a composer reference. */
  onReferenceFile?: (path: string) => void;
  /** UP-4.1: 应用自带场景把 prompt 填进输入框（不直接发送）。 */
  onPickPrompt?: (prompt: string) => void;
  /** Workspace root, so 引用对话中的文件 can also offer top-level workspace files. */
  workspaceCwd?: string;
  /** Chat page: 做一做 / 想一想 / 问一问 lives in the menu instead of the footer (WorkBuddy layout). */
  agentMode?: AgentMode;
  onAgentModeChange?: (mode: AgentMode) => void;
  /** 本任务连接器开关 (pii W2.4 P2); omitted on the home page (no task yet). */
  sessionId?: string;
}

type MenuItemId = "add-files" | "session-files" | "mode" | "agent-mode" | "experts" | "skills" | "apps" | "connectors";

interface MenuItem {
  id: MenuItemId;
  label: string;
  icon: React.ReactNode;
}

const MENU_GROUPS: MenuItem[][] = [
  [
    { id: "add-files", label: "添加文件", icon: <Paperclip size={16} /> },
    { id: "session-files", label: "引用对话中的文件", icon: <AtSign size={16} /> },
  ],
  [
    { id: "mode", label: "模式", icon: <Wand2 size={16} /> },
    { id: "agent-mode", label: "工作方式", icon: <Wand2 size={16} /> },
    { id: "experts", label: "专家", icon: <ExpertTabIcon size="md" /> },
    { id: "skills", label: "技能", icon: <SkillTabIcon size="md" /> },
    { id: "apps", label: "应用", icon: <Blocks size={16} /> },
    { id: "connectors", label: "连接器", icon: <McpIcon size="md" /> },
  ],
];

export function InputAddMenu({
  onPickFiles,
  onSelectMode,
  onSelectExpert,
  onSelectSkill,
  onNavigateConnectors,
  onReferenceFile,
  onPickPrompt,
  workspaceCwd,
  agentMode,
  onAgentModeChange,
  sessionId,
}: InputAddMenuProps) {
  const [open, setOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<MenuItemId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [experts, setExperts] = useState<AgentEntry[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [sessionMcp, setSessionMcp] = useState<Array<{ name: string; enabled: boolean }>>([]);
  const [sessionFiles, setSessionFiles] = useState<Array<{ path: string; status: string }>>([]);
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

  // G1-15 引用对话中的文件：Pi 产物优先，其次工作区根目录的普通文件。
  useEffect(() => {
    if (!open || !sessionId || !onReferenceFile) return;
    let disposed = false;
    void Promise.all([
      artifactsList(sessionId).catch(() => []),
      workspaceCwd ? listDir(workspaceCwd, workspaceCwd, 80).catch(() => []) : Promise.resolve([]),
    ]).then(([artifacts, entries]) => {
      if (disposed) return;
      const known = new Set(artifacts.filter((item) => item.exists).map((item) => item.path));
      const files = [
        ...artifacts.filter((item) => item.exists).map((item) => ({ path: item.path, status: item.status })),
        ...entries
          .filter((entry) => entry.kind === "file" && !known.has(entry.path))
          .map((entry) => ({ path: entry.path, status: "workspace" })),
      ];
      setSessionFiles(files.slice(0, 20));
    });
    return () => { disposed = true; };
  }, [open, sessionId, onReferenceFile, workspaceCwd]);

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

  /** "会话文件" only exists inside a task and only when the composer can insert it. */
  const canReference = Boolean(sessionId && onReferenceFile);
  const groups = useMemo(
    () => MENU_GROUPS.map((group) => group.filter((item) =>
      (item.id !== "session-files" || canReference) &&
      // 聊天页用「工作方式」替代只对首页有意义的场景「模式」。
      (item.id !== "agent-mode" || Boolean(onAgentModeChange)) &&
      (item.id !== "mode" || !onAgentModeChange)
    )),
    [canReference, onAgentModeChange],
  );
  /** Keyboard parity for the “+” menu (B4 follow-up): hover-only submenus are unusable without a mouse. */
  const menuIds = useMemo(() => groups.flat().map((item) => item.id), [groups]);

  const focusItem = (id: MenuItemId) => {
    setHoveredItem(id);
    itemRefs.current[id]?.focus();
  };

  const moveFocus = (from: MenuItemId | null, delta: number) => {
    if (!menuIds.length) return;
    const index = from ? menuIds.indexOf(from) : -1;
    const next = menuIds[(index + delta + menuIds.length) % menuIds.length];
    focusItem(next);
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
  /** G1-16: 应用（能力包 / 扩展包）在「专家·技能·连接器」里安装与管理。 */
  const handleOpenAppCenter = () => {
    close();
    onNavigateConnectors?.("experts");
  };

  const renderSubmenu = () => {
    if (!hoveredItem) return null;

    let items: React.ReactNode = null;

    if (hoveredItem === "session-files") {
      items = sessionFiles.length > 0 ? (
        sessionFiles.map((file) => (
          <button
            key={file.path}
            type="button"
            className="iam-sub-item"
            title={file.path}
            onClick={() => { close(); onReferenceFile?.(file.path); }}
          >
            <AtSign size={14} />
            <span className="iam-sub-text">
              <span className="iam-sub-name">{file.path.split(/[\\/]/).pop() || file.path}</span>
              <span className="iam-sub-desc">{file.status === "created" ? "本任务创建" : file.status === "modified" ? "本任务修改" : "工作区文件"}</span>
            </span>
          </button>
        ))
      ) : (
        <div className="iam-sub-empty">本任务还没有产物文件</div>
      );
    }

    if (hoveredItem === "agent-mode") {
      const modes: ReadonlyArray<readonly [AgentMode, string, string]> = [
        ["craft", "做一做", "直接动手：可以读写文件、执行命令"],
        ["plan", "想一想", "先调研并给出计划，确认后再执行（只读）"],
        ["ask", "问一问", "只回答问题，不改文件（只读）"],
      ];
      items = modes.map(([mode, label, hint]) => (
        <button
          key={mode}
          type="button"
          className={"iam-sub-item" + ((agentMode ?? "craft") === mode ? " iam-sub-item--active" : "")}
          aria-pressed={(agentMode ?? "craft") === mode}
          onClick={() => { close(); onAgentModeChange?.(mode); }}
          data-tip={hint}
        >
          <span className="iam-sub-text">
            <span className="iam-sub-name">{label}</span>
            <span className="iam-sub-desc">{hint}</span>
          </span>
        </button>
      ));
    }

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

    if (hoveredItem === "apps") {
      items = (
        <ApplicationPicker
          cwd={workspaceCwd}
          onManage={handleOpenAppCenter}
          {...(onPickPrompt ? { onPickPrompt } : {})}
        />
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
        ref={triggerRef}
        className="wb-composer__add"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            // The menu mounts after this event, so focus on the next tick.
            setTimeout(() => moveFocus(null, e.key === "ArrowDown" ? 1 : -1), 0);
          }
        }}
        aria-label="添加"
        aria-haspopup="menu"
        aria-expanded={open}
        title="添加文件、模式、专家、技能、连接器"
      >
        <AddIcon size="md" />
      </button>

      {open && (
        <div
          className="iam-popover"
          role="menu"
          aria-label="添加到任务"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
              triggerRef.current?.focus();
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              moveFocus(hoveredItem, e.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (e.key === "Home" || e.key === "End") {
              e.preventDefault();
              focusItem(e.key === "Home" ? menuIds[0] : menuIds[menuIds.length - 1]);
            }
          }}
        >
          {groups.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && <div className="iam-divider" />}
              <div className="iam-group">
                {group.map((item) => (
                  <div
                    key={item.id}
                    ref={(el) => { itemRefs.current[item.id] = el; }}
                    tabIndex={-1}
                    className={
                      "iam-item" + (hoveredItem === item.id ? " iam-item--active" : "")
                    }
                    onMouseEnter={() => handleItemEnter(item.id)}
                    onMouseLeave={handleItemLeave}
                    onClick={() => handleItemClick(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleItemClick(item.id);
                      }
                    }}
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
