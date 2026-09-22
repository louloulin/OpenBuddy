/**
 * ChatViewToolbar — 工具按钮集群。
 *
 * 由 ChatView 透传一组开关状态(open/close)+ handler,
 * 这里只负责按钮的视觉与无障碍属性。
 *
 * Phase B B.6 之前,按钮 portal 到顶栏;未挂载时回退为正文图标行(保持改造前的视觉)。
 */
import { createPortal } from "react-dom";
import {
  Bot,
  FileDiff,
  FolderTree,
  Globe,
  ListTodo,
  Package,
  Search,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { ShareMenu } from "@openbuddy/ui-workbench";
import type { ChatMessage } from "@openbuddy/ui-state/session-store";

export type ToolButtonDescriptor = {
  id: string;
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  visible: boolean;
};

export type ChatViewToolbarProps = {
  /** 由 useChatViewTopbarHost 探测到的 portal host(顶栏右侧槽)。 */
  topbarHost: HTMLElement | null;
  buttons: ToolButtonDescriptor[];
  /** 当前会话的消息(给 ShareMenu 用)。 */
  messages: readonly ChatMessage[];
  onShareDone?: (msg: string) => void;
};

export function ChatViewToolbar({
  topbarHost,
  buttons,
  messages,
  onShareDone,
}: ChatViewToolbarProps) {
  const visibleButtons = buttons.filter((b) => b.visible);
  const buttonEls = visibleButtons.map((b) => (
    <ToolButton
      icon={b.icon}
      label={b.label}
      active={!!b.active}
      onClick={b.onClick}
      key={b.id}
    />
  ));
  if (messages.length > 0) {
    buttonEls.push(
      <ShareMenu messages={[...messages]} onDone={onShareDone ?? (() => {})} key="share" />,
    );
  }

  if (topbarHost) {
    return createPortal(
      <div className="chatview__toolbar" role="toolbar" aria-label="会话工具">
        {buttonEls}
      </div>,
      topbarHost,
    );
  }

  return (
    <div className="chatview__toolbar chatview__toolbar--fallback" role="toolbar" aria-label="会话工具">
      {buttonEls}
    </div>
  );
}

function ToolButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"chatview__tool-btn" + (active ? " chatview__tool-btn--active" : "")}
      aria-label={label}
      aria-pressed={active}
      data-tip={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

/** 给 ChatView 用的内置按钮集合(可选;由 ChatView 决定传什么)。 */
export function defaultPlanButton(props: {
  planCount: number;
  planCompleted: number;
  active: boolean;
  onClick: () => void;
}): ToolButtonDescriptor {
  return {
    id: "plan",
    active: props.active,
    visible: props.planCount > 0,
    onClick: props.onClick,
    label: `执行计划 ${props.planCompleted}/${props.planCount}`,
    icon: <ListTodo size={15} strokeWidth={1.75} />,
  };
}

export function defaultArtifactsButton(props: {
  artifactCount: number;
  active: boolean;
  onClick: () => void;
}): ToolButtonDescriptor {
  return {
    id: "artifacts",
    active: props.active,
    visible: props.artifactCount > 0,
    onClick: props.onClick,
    label: `本会话产物 (${props.artifactCount})`,
    icon: <Package size={15} strokeWidth={1.75} />,
  };
}

export function defaultFindButton(props: {
  active: boolean;
  hasMessages: boolean;
  onClick: () => void;
}): ToolButtonDescriptor {
  return {
    id: "find",
    active: props.active,
    visible: props.hasMessages,
    onClick: props.onClick,
    label: "在当前对话中查找 (Ctrl/Cmd+F)",
    icon: <Search size={15} strokeWidth={1.75} />,
  };
}

export function defaultFileChangesButton(props: {
  active: boolean;
  hasMessages: boolean;
  onClick: () => void;
}): ToolButtonDescriptor {
  return {
    id: "file-changes",
    active: props.active,
    visible: props.hasMessages,
    onClick: props.onClick,
    label: "本会话文件变更",
    icon: <FileDiff size={15} strokeWidth={1.75} />,
  };
}

export function defaultSubagentButton(props: {
  active: boolean;
  hasMessages: boolean;
  onClick: () => void;
}): ToolButtonDescriptor {
  return {
    id: "subagent",
    active: props.active,
    visible: props.hasMessages,
    onClick: props.onClick,
    label: "子代理运行时",
    icon: <Bot size={15} strokeWidth={1.75} />,
  };
}

export function defaultTeamStatusButton(props: {
  active: boolean;
  hasMessages: boolean;
  onClick: () => void;
}): ToolButtonDescriptor {
  return {
    id: "team-status",
    active: props.active,
    visible: props.hasMessages,
    onClick: props.onClick,
    label: "团队状态",
    icon: <Users size={15} strokeWidth={1.75} />,
  };
}

export function defaultFileTreeButton(props: {
  active: boolean;
  hasWorkspace: boolean;
  onClick: () => void;
}): ToolButtonDescriptor {
  return {
    id: "file-tree",
    active: props.active,
    visible: props.hasWorkspace,
    onClick: props.onClick,
    label: "工作区文件树",
    icon: <FolderTree size={15} strokeWidth={1.75} />,
  };
}

export function defaultBrowserButton(props: {
  active: boolean;
  onClick: () => void;
}): ToolButtonDescriptor {
  return {
    id: "browser",
    active: props.active,
    visible: true,
    onClick: props.onClick,
    label: "网页预览",
    icon: <Globe size={15} strokeWidth={1.75} />,
  };
}
