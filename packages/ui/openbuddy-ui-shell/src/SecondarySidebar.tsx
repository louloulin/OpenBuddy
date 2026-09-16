/**
 * 辅助侧边栏（Secondary Sidebar）— 对齐 WorkBuddy 的 peek-assistant 面板。
 *
 * 功能：
 *  - 右侧垂直触发条（收起态），hover 浮出助理列表
 *  - 点击助理 → 预览其能力描述 + 快速开始新会话
 *  - 支持 hover-peek 时序（100ms 进入延迟 / 300ms 离开缓冲），避免误触
 *  - Escape 关闭浮层
 *
 * 数据来自 agentsList（~/.pi/agents/*.md 专家定义）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentsList } from "@/lib/agent/pi-client";
import type { AgentEntry } from "@openbuddy/shared-types";
import { WbAssistantNavIcon, ChevronRightIcon } from "@openbuddy/ui-primitives/icons";

// ---- hover-peek timing (mirrors WorkBuddy use-hover-peek) ----
const ENTER_DELAY_MS = 100;
const TRIGGER_LEAVE_DELAY_MS = 300;
const FLOATING_LEAVE_DELAY_MS = 300;

function useHoverPeek(disabled: boolean) {
  const [hoverPeek, setHoverPeek] = useState(false);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEnterTimer = useCallback(() => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
  }, []);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const closePeek = useCallback(() => {
    clearEnterTimer();
    clearLeaveTimer();
    setHoverPeek(false);
  }, [clearEnterTimer, clearLeaveTimer]);

  const handleTriggerEnter = useCallback(() => {
    if (disabled) return;
    clearLeaveTimer();
    clearEnterTimer();
    enterTimerRef.current = setTimeout(() => {
      setHoverPeek(true);
      enterTimerRef.current = null;
    }, ENTER_DELAY_MS);
  }, [clearEnterTimer, clearLeaveTimer, disabled]);

  const handleFloatingEnter = useCallback(() => {
    if (disabled) return;
    clearEnterTimer();
    clearLeaveTimer();
    setHoverPeek(true);
  }, [clearEnterTimer, clearLeaveTimer, disabled]);

  const scheduleClose = useCallback(
    (delay: number) => {
      clearEnterTimer();
      clearLeaveTimer();
      leaveTimerRef.current = setTimeout(() => {
        setHoverPeek(false);
        leaveTimerRef.current = null;
      }, delay);
    },
    [clearEnterTimer, clearLeaveTimer],
  );

  const handleTriggerLeave = useCallback(() => {
    scheduleClose(TRIGGER_LEAVE_DELAY_MS);
  }, [scheduleClose]);

  const handleFloatingLeave = useCallback(() => {
    scheduleClose(FLOATING_LEAVE_DELAY_MS);
  }, [scheduleClose]);

  useEffect(() => {
    if (disabled) closePeek();
  }, [closePeek, disabled]);

  // Escape closes the floating panel.
  useEffect(() => {
    if (!hoverPeek) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePeek();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePeek, hoverPeek]);

  useEffect(
    () => () => {
      clearEnterTimer();
      clearLeaveTimer();
    },
    [clearEnterTimer, clearLeaveTimer],
  );

  return {
    hoverPeek,
    closePeek,
    triggerBindings: useMemo(
      () => ({ onMouseEnter: handleTriggerEnter, onMouseLeave: handleTriggerLeave }),
      [handleTriggerEnter, handleTriggerLeave],
    ),
    floatingBindings: useMemo(
      () => ({ onMouseEnter: handleFloatingEnter, onMouseLeave: handleFloatingLeave }),
      [handleFloatingEnter, handleFloatingLeave],
    ),
  };
}

export interface SecondarySidebarProps {
  /** Start a new session guided by the selected agent. */
  onSelectExpert?: (agent: AgentEntry) => void;
  onToast?: (msg: string) => void;
  /**
   * 打开「专家·技能·连接器」页(导轨为空时的出口)。
   *
   * 为什么需要:专家来自 `~/.pi/agents/*.md`,全新安装下一个都没有。导轨
   * hover 出来却是一片空白(实测 items=0),看起来就像坏了 —— 给它一个
   * 明确的空状态 + 一条"去哪儿建"的路,比空列表有用得多。
   */
  onOpenExperts?: () => void;
  /** Show the contextual assistant picker only while a chat session is active. */
  visible?: boolean;
}

export function SecondarySidebar({
  onSelectExpert,
  onToast,
  onOpenExperts,
  visible = true,
}: SecondarySidebarProps) {
  // Hooks must be called unconditionally in a stable order, otherwise React
  // throws #310 ("Rendered more hooks than during the previous render") when
  // `visible` flips. The early return lives AFTER every hook.
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewAgent, setPreviewAgent] = useState<AgentEntry | null>(null);
  const { hoverPeek, triggerBindings, floatingBindings, closePeek } = useHoverPeek(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await agentsList();
        if (!cancelled) setAgents(list);
      } catch {
        if (!cancelled) setAgents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePick = useCallback(
    (agent: AgentEntry) => {
      onSelectExpert?.(agent);
      onToast?.(`已选择专家：${agent.name}`);
      closePeek();
    },
    [onSelectExpert, onToast, closePeek],
  );

  if (!visible) return null;

  return (
    <>
      {/* Trigger rail — always visible on the right edge */}
      <div className="secondary-sidebar__trigger" {...triggerBindings}>
        <div className="secondary-sidebar__trigger-icon">
          <WbAssistantNavIcon size="md" />
        </div>
        <div className="secondary-sidebar__trigger-label">助理</div>
        <ChevronRightIcon size="sm" className="secondary-sidebar__trigger-chevron" />
      </div>

      {/* Floating peek panel */}
      {hoverPeek && (
        <div className="secondary-sidebar__floating" {...floatingBindings}>
          {loading && <div className="secondary-sidebar__loading">加载中…</div>}

          {!loading && agents.length === 0 && (
            <div className="secondary-sidebar__empty">
              <div className="secondary-sidebar__empty-title">还没有专家</div>
              <div className="secondary-sidebar__empty-desc">
                专家来自 <code>~/.pi/agents/</code> 下的 markdown 定义。
              </div>
              {onOpenExperts && (
                <button
                  type="button"
                  className="secondary-sidebar__empty-action"
                  onClick={() => {
                    onOpenExperts();
                    closePeek();
                  }}
                >
                  去创建专家
                </button>
              )}
            </div>
          )}

          <ul className="secondary-sidebar__list">
            {agents.map((agent) => (
              <li key={agent.name} className="secondary-sidebar__item">
                <button
                  className="secondary-sidebar__item-btn"
                  onClick={() => handlePick(agent)}
                  onMouseEnter={() => setPreviewAgent(agent)}
                  onMouseLeave={() => setPreviewAgent(null)}
                >
                  <span className="secondary-sidebar__item-avatar">
                    {(agent.name ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="secondary-sidebar__item-info">
                    <span className="secondary-sidebar__item-name">{agent.name}</span>
                    {agent.description && (
                      <span className="secondary-sidebar__item-desc">
                        {agent.description.length > 40
                          ? agent.description.slice(0, 40) + "…"
                          : agent.description}
                      </span>
                    )}
                  </span>
                  <ChevronRightIcon size="sm" />
                </button>
              </li>
            ))}
          </ul>

          {/* Hover preview card */}
          {previewAgent && (
            <div className="secondary-sidebar__preview">
              <div className="secondary-sidebar__preview-name">{previewAgent.name}</div>
              {previewAgent.description && (
                <div className="secondary-sidebar__preview-desc">
                  {previewAgent.description}
                </div>
              )}
              <div className="secondary-sidebar__preview-meta">
                {previewAgent.scope && <span>来源：{previewAgent.scope === "user" ? "用户" : "项目"}</span>}
                {previewAgent.modelTags && previewAgent.modelTags.length > 0 && (
                  <span>能力：{previewAgent.modelTags.join(", ")}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
