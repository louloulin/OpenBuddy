/**
 * ChatViewScrollStage — 滚动舞台。
 *
 * 包含:
 *   - 会话标题(若 sessionRecord.title 存在)
 *   - 只读子代理横幅(readOnlySubagent)
 *   - 文件变更面板(可折叠)
 *   - 子代理面板
 *   - 团队状态视图
 *   - 转录区(`conversation.view` 出口 → `conversation.body` 出口 → fallback)
 *   - 跳到底浮动按钮
 *
 * 关键点:`emptyState` / `timelineList` 由 ChatView 构造并传入(那里持有
 * `handleQuickPrompt` / `VirtualizedMessageList` / `renderTimelineNode`),
 * 本组件只负责布局层。这保持了 `conversation.body` 槽的 fallback 语义不变
 * (插件未注册时渲染结果与改造前逐字一致)。
 *
 * 滚动与未读计数由 `useChatViewStreaming` 提供;scrollRef 由父组件传入。
 */
import type { ReactNode } from "react";
import type { ChatMessage } from "@openbuddy/ui-state/session-store";
import type { TimelineNode } from "@/lib/ui/timeline-utils";
import { ConversationBody } from "../conversation-slots";
import { ConversationViewOutlet } from "../conversation-view";
import { FileChangesPanel } from "../FileChangesPanel";
import { TeamStatusView } from "@openbuddy/ui-workbench";
import { SubagentPanel } from "@openbuddy/ui-collaboration";

type SubagentPanelProps = {
  messages: ChatMessage[];
  cwd?: string;
  onOpenSession?: (sessionId: string, cwd?: string) => void | Promise<void>;
};

export type ChatViewScrollStageProps = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  sessionTitle?: string;
  readOnlySubagent: boolean;
  fileChangesOpen: boolean;
  subagentsOpen: boolean;
  teamsOpen: boolean;
  timeline: readonly TimelineNode[];
  renderNode: (args: { node: TimelineNode; index: number }) => ReactNode;
  sessionId?: string;
  streaming: boolean;
  useVirtualList: boolean;
  messages: readonly ChatMessage[];
  cwd?: string;
  onOpenSession?: (sessionId: string, cwd?: string) => void | Promise<void>;
  activeView: string;
  /** 空状态节点(由 ChatView 构造,保留 handleQuickPrompt 接线)。 */
  emptyState: ReactNode;
  /** 非空时的转录列表节点(普通列表或虚拟列表)。 */
  timelineList: ReactNode;
  unreadCount: number;
  onJumpToBottom: () => void;
  /**
   * 子代理面板实现。ChatView 解析 `placeholder.subagent` 槽后传入;
   * 未传时用内置 `SubagentPanel`。
   */
  SubagentPanelImpl?: React.ComponentType<SubagentPanelProps>;
};

export function ChatViewScrollStage(props: ChatViewScrollStageProps) {
  const hasMessages = props.messages.length > 0;
  const SubagentPanelResolved = props.SubagentPanelImpl ?? SubagentPanel;
  return (
    <div className="chatview__scroll" ref={props.scrollRef as unknown as React.Ref<HTMLDivElement>}>
      <div className="chatview__inner">
        {hasMessages && props.sessionTitle && (
          <h1 className="chatview__title" title={props.sessionTitle}>
            {props.sessionTitle}
          </h1>
        )}
        {props.readOnlySubagent && (
          <div className="subagent-readonly-banner" role="status">
            单次子代理仅支持查看历史记录
          </div>
        )}
        {props.fileChangesOpen && (
          <FileChangesPanel messages={[...props.messages]} />
        )}
        {props.subagentsOpen && (
          <SubagentPanelResolved
            messages={[...props.messages]}
            cwd={props.cwd}
            onOpenSession={props.onOpenSession}
          />
        )}
        {props.teamsOpen && (
          <TeamStatusView messages={[...props.messages]} />
        )}
        {/* 转录区走内核 `conversation.body` 槽(见 conversation-slots.tsx)。
            插件可以整体接管布局(分组 / 日期轴 / 自定义列表),`fallback` 就是
            接线前的那段 JSX —— 内核里没有实现时渲染结果逐字一致,所以卸载
            插件后视觉零变化。`renderNode` 一起交出去,插件只改布局时不必
            自己实现消息渲染。 */}
        <ConversationViewOutlet
          view={props.activeView}
          timeline={props.timeline}
          renderNode={props.renderNode}
          sessionId={props.sessionId}
          streaming={props.streaming}
          virtualized={props.useVirtualList}
          scrollRef={props.scrollRef as unknown as React.RefObject<HTMLElement | null>}
          fallback={
            <ConversationBody
              timeline={props.timeline}
              renderNode={props.renderNode}
              sessionId={props.sessionId}
              streaming={props.streaming}
              virtualized={props.useVirtualList}
              scrollRef={props.scrollRef as unknown as React.RefObject<HTMLElement | null>}
              fallback={props.timeline.length === 0 ? props.emptyState : props.timelineList}
            />
          }
        />
      </div>
      {/* R6.5 — Floating "jump to bottom" button. */}
      {props.unreadCount > 0 && (
        <button
          type="button"
          className="chatview__jump-bottom"
          onClick={props.onJumpToBottom}
          aria-label={`跳到末尾,有 ${props.unreadCount} 条新消息`}
          title="回到末尾"
        >
          <span aria-hidden="true">↓</span>
          <span className="chatview__jump-bottom-badge">{props.unreadCount}</span>
        </button>
      )}
    </div>
  );
}
