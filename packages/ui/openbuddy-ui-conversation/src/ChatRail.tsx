import { useCallback, useEffect, useState } from "react";
import { Paperclip, Wand2, Plus, X } from "lucide-react";
import {
  ConnectorTabIcon,
  PlanToolIcon,
} from "@openbuddy/ui-primitives/icons";
import { open as openDialog } from "@/lib/platform/electron-api";
import { useSessionsStore } from "@/stores/sessions-store";
import type { HomeModeId } from "@openbuddy/ui-shared";
import type { AgentEntry } from "@openbuddy/shared-types";

interface ChatRailProps {
  /** Show the rail only after the conversation has any message; the empty
   *  state already invites the user to start typing via the composer. */
  visible?: boolean;
  onToast?: (msg: string) => void;
  onSelectMode?: (modeId: HomeModeId) => void;
  onSelectExpert?: (agent: AgentEntry) => void;
  onNavigateConnectors?: () => void;
}

/**
 * ChatRail — compact floating action menu anchored to the right edge of
 * the chat column (mirrors WorkBuddy's 添加文件 / 模式 / 技能 / 连接器
 * chip rail). Renders as a single trigger button that opens a dropdown
 * panel of four actions; closing on outside-click, Escape, or item pick
 * keeps the chat surface uncluttered while still keeping every action
 * one click away.
 */
export function ChatRail({
  visible = true,
  onToast,
  onSelectMode,
  onSelectExpert,
  onNavigateConnectors,
}: ChatRailProps) {
  const [open, setOpen] = useState(false);
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".chat-rail")) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pickFiles = useCallback(async () => {
    try {
      const selected = await openDialog({ multiple: true });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      onToast?.(`已选择 ${paths.length} 个文件,正在粘贴到输入框…`);
    } catch {
      /* dialog plugin not available in non-Electron environments. */
    }
  }, [onToast]);

  if (!visible || !currentSessionId) return null;

  const closeAnd = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <aside
      className={"chat-rail" + (open ? " chat-rail--open" : "")}
      aria-label="聊天快捷操作"
    >
      <button
        type="button"
        className="chat-rail__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "关闭快捷操作" : "打开快捷操作"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="快捷操作"
        data-testid="chat-rail-trigger"
      >
        {open ? <X size={16} strokeWidth={2} /> : <Plus size={16} strokeWidth={2} />}
        <span className="chat-rail__trigger-label">{open ? "关闭" : "快捷操作"}</span>
      </button>
      {open && (
        <div className="chat-rail__menu" role="menu" data-testid="chat-rail-menu">
          <button
            type="button"
            role="menuitem"
            className="chat-rail__menu-item"
            onClick={closeAnd(() => void pickFiles())}
            title="添加文件（attach）"
          >
            <Paperclip size={15} strokeWidth={2} />
            <span>添加文件</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="chat-rail__menu-item"
            onClick={closeAnd(() => onSelectMode?.("working"))}
            title="切换模式"
          >
            <PlanToolIcon size="md" />
            <span>切换模式</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="chat-rail__menu-item"
            onClick={closeAnd(() =>
              onSelectExpert?.({ id: "open", name: "expert" } as unknown as AgentEntry),
            )}
            title="调用技能与指令"
          >
            <Wand2 size={15} strokeWidth={2} />
            <span>技能与指令</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="chat-rail__menu-item"
            onClick={closeAnd(() => onNavigateConnectors?.())}
            title="查看连接器"
          >
            <ConnectorTabIcon size="md" />
            <span>连接器</span>
          </button>
        </div>
      )}
    </aside>
  );
}
