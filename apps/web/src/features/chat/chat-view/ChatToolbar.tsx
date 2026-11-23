/**
 * 对话页顶栏工具条 —— 从 ChatView 抽出，保持 ChatView 在边界门禁的行数上限内。
 * 只负责工作区、搜索、历史、分享与右侧产物栏的开关，不持有会话状态。
 */
import { invoke } from "@openbuddy/client/ipc";
import { FolderIcon, PanelIcon, SearchIcon } from "@openbuddy/ui/icon/icons/index";
import type { ChatMessage } from "@/features/chat/state/session-store";
import { PromptHistory } from "../PromptHistory";
import { ShareMenu } from "../ShareMenu";

export function ChatToolbar({
  workspaceLabel,
  cwd,
  findOpen,
  onToggleFind,
  messages,
  title,
  sessionId,
  onToast,
  panelActive,
  onTogglePanel,
  artifactCount,
  onJumpToMessage,
}: {
  workspaceLabel: string;
  cwd?: string;
  findOpen: boolean;
  onToggleFind: () => void;
  messages: ChatMessage[];
  title?: string;
  sessionId?: string;
  onToast?: (message: string) => void;
  panelActive: boolean;
  onTogglePanel: () => void;
  artifactCount: number;
  onJumpToMessage: (id: string) => void;
}) {
  return (
    <div className="chat-toolbar">
      {workspaceLabel && (
        <button
          type="button"
          className="chat-toolbar__workspace"
          onClick={() => { if (cwd) void invoke("reveal_in_folder", { path: cwd, cwd }).catch(() => onToast?.("无法打开文件夹")); }}
          data-tip={cwd}
          aria-label={`工作空间：${workspaceLabel}（在文件夹中显示）`}
        >
          <FolderIcon size={14} />
          <span>{workspaceLabel}</span>
        </button>
      )}
      <button type="button" className={"main-topbar__btn" + (findOpen ? " main-topbar__btn--active" : "")} onClick={onToggleFind} aria-label="在对话中搜索" data-tip="搜索 (Ctrl/Cmd+F)" disabled={!messages.length}>
        <SearchIcon size="md" />
      </button>
      <PromptHistory messages={messages} onJump={onJumpToMessage} />
      {messages.length > 0 && <ShareMenu messages={messages} title={title} onDone={onToast} sessionId={sessionId} />}
      <button
        type="button"
        className={"main-topbar__btn" + (panelActive ? " main-topbar__btn--active" : "")}
        onClick={onTogglePanel}
        aria-label={panelActive ? "收起右侧栏" : "展开右侧栏"}
        data-tip={panelActive ? "收起工作台 (Ctrl/Cmd+\\)" : `产物与文件${artifactCount ? `（${artifactCount}）` : ""} (Ctrl/Cmd+\\)`}
      >
        <PanelIcon size="md" />
        {!panelActive && artifactCount > 0 && <span className="main-topbar__count">{artifactCount}</span>}
      </button>
    </div>
  );
}
