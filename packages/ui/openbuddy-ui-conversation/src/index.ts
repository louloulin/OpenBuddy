/**
 * @openbuddy/ui-conversation — 统一对外入口
 *
 * 会话对话层。承载对话流式渲染、消息操作、上下文压缩、引用附件等会话交互相关 UI。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染
 *   - 公共工具 (Utilities)    → 函数 / 常量 / hooks,无 JSX 输出
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client        → apply() 槽位注册入口(由 ui-runtime 在 SlotProvider 挂载时调用)
 *   - ./invariant     → 不变式同伴(debug 模式下激活)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
import type { SlotMap } from "@openbuddy/ui-slots";
// 仅供 `declare module` 里的 owner 类型使用(纯类型,编译后擦除,不会引入循环依赖)。
import type { ComposerProps as ComposerOwnProps } from "./Composer";
import type {
  ConversationBodyProps,
  ConversationMarkdownProps,
  ConversationToolSideProps,
} from "./conversation-slots";
import type { ConversationViewProps } from "./conversation-view";
import type { ConversationApprovalProps } from "./conversation-approvals";

export type { SlotMap };

export { ChatView } from "./ChatView";
export { ChatShortcutOverlay, CHAT_SHORTCUTS } from "./chatview/ChatShortcutOverlay";
export type { ChatShortcutOverlayProps } from "./chatview/ChatShortcutOverlay";
export { ChatRail } from "./ChatRail";
export { ChatMinimap, minimapColor } from "./ChatMinimap";
export type { ChatMinimapProps, ChatMinimapSegment, ChatMinimapSegmentKind } from "./ChatMinimap";
export { BranchNavigator, branchLabel } from "./BranchNavigator";
export type { BranchNavigatorProps, BranchNode } from "./BranchNavigator";
export { ExtensionStatusBar } from "./ExtensionStatusBar";
export type { ExtensionStatusBarProps, ExtensionStatus, ExtensionStatusEntry } from "./ExtensionStatusBar";
export { ExtensionWidgets, widgetBodyText } from "./ExtensionWidgets";
export type { ExtensionWidgetsProps, ExtensionWidget, ExtensionWidgetAction } from "./ExtensionWidgets";
export { Composer } from "./Composer";
export { PiReloadFailureBanner } from "./PiReloadFailureBanner";
export type { PiReloadFailureState } from "./PiReloadFailureBanner";
export { FileChangesPanel } from "./FileChangesPanel";
export { FindBar, isFindHit } from "./FindBar";
export { InputAddMenu } from "./InputAddMenu";
export { LoadingRow } from "./LoadingRow";
export { MessageItem } from "./MessageItem";
export { AnsiText } from "./AnsiText";
export { QuestionInlineCard } from "./QuestionInlineCard";
export { RewindBar } from "./RewindBar";
export { ToolCallCard, ToolCallDetailBody } from "./ToolCallCard";
export { TurnErrorCard } from "./TurnErrorCard";
export { TooltipButton } from "./TooltipButton";
export type { TooltipButtonProps } from "./TooltipButton";
export { ToolSidePanel } from "./ToolSidePanel";
export type { ToolSidePanelMode } from "./ToolSidePanel";
export {
  MAIN_MIN_WIDTH,
  NAV_COLLAPSED_WIDTH,
  NAV_DEFAULT_WIDTH,
  NAV_MAX_WIDTH,
  NAV_MIN_WIDTH,
  NAV_SASH_WIDTH,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_VIEWPORT_RATIO,
  PANEL_MIN_WIDTH,
  clampNavWidth,
  clampPanelWidth,
  maxPanelWidth,
  resolvePanelLayout,
  resolvePanelMode,
} from "./tool-side-panel-layout";
export type {
  PanelLayout,
  PanelLayoutInput,
  PanelLayoutMode,
} from "./tool-side-panel-layout";
export { useViewportWidth } from "./use-viewport-width";

export { StreamingCaret } from "./StreamingCaret";
export type { StreamingCaretProps } from "./StreamingCaret";
export {
  CitationChip,
  ChatCitationProvider,
  useCitationResolver,
} from "./parts/CitationChip";
export type { Citation, CitationResolver, ChatCitationProviderProps } from "./parts/CitationChip";
export {
  ArtifactChip,
  ChatArtifactProvider,
  useArtifactResolver,
} from "./parts/ArtifactChip";
export type {
  ArtifactMeta,
  ArtifactKind,
  ArtifactResolver,
  ChatArtifactProviderProps,
} from "./parts/ArtifactChip";
export {
  MessagePartRegistry,
} from "./MessagePartRegistry";
export type { MessagePartKind, MessagePartRenderProps } from "./parts/registry-defaults";
export { MessageRewindMenu } from "./parts/MessageRewindMenu";
export type { MessageRewindMenuProps } from "./parts/MessageRewindMenu";
export { ToolGroupSummary } from "./parts/ToolGroupSummary";
export type { ToolGroupSummaryProps } from "./parts/ToolGroupSummary";
export {
  clusterToolCalls,
  groupParallelToolCalls,
  countParallelClusters,
} from "@/lib/ui/timeline-utils";
export type { ToolCallCluster } from "@/lib/ui/timeline-utils";

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /** 转录区(空态 / 列表 / 虚拟列表)整块布局。消费者:`ChatView`。 */
    "conversation.body": {
      kind: "single";
      scope: "session-maybe";
      owner: ConversationBodyProps;
    };
    /** 输入区整块。消费者:`ChatView` —— props 与内置 `<Composer>` 完全一致。 */
    "conversation.composer": {
      kind: "single";
      scope: "session-maybe";
      owner: ComposerOwnProps;
    };
    /** 右侧工具面板的**追加**区(list:所有注册项都渲染)。消费者:`ToolSidePanel`。 */
    "conversation.toolside": {
      kind: "list";
      scope: "session";
      owner: ConversationToolSideProps;
    };
    /** 单条消息的 markdown 正文渲染。消费者:`MessageItem`。 */
    "conversation.message.markdown": {
      kind: "single";
      scope: "session";
      owner: ConversationMarkdownProps;
    };
    /**
     * 输入框工具栏的**追加**按钮(list)。消费者:`Composer`。
     *
     * 这条声明此前**缺失** —— `Composer.tsx` 一直在用 `useSlotPayloads` 读它、
     * 示例插件与真机探针也一直在往里注册,但 SlotMap 里没有它,所以插件作者
     * 在编辑器里拿不到任何类型提示(审计里也只显示"有人消费、没人声明")。
     */
    "composer.toolbar.action": {
      kind: "list";
      scope: "session";
      owner: ComposerToolbarAction;
    };
    /**
     * 会话转录区的**视图切换**(keyed,key = 视图 id)。消费者:`ChatView`。
     *
     * 用途:插件可以给转录区加一个完全不同的呈现方式(只看结果 / 只看正文 /
     * diff 视图 / 任务看板……),用户通过宿主渲染的视图切换器切换。
     *
     * 关键回退语义(见分册 05 R5):内置视图 `live` **刻意不注册实现**,
     * 它走 `ChatView` 现有的转录 JSX —— 所以不装插件时界面与改造前逐像素
     * 一致,也不会出现「内置视图与内核默认两套实现都在跑」。内置只注册
     * `result` / `content` 两个增量视图。
     *
     * 注册载荷:`payload: { label?: string }` 供切换器显示标签(本包不依赖
     * i18n,标签由注册方提供;不提供时退回 key)。
     */
    "conversation.view": {
      kind: "keyed";
      scope: "session";
      owner: ConversationViewProps;
    };
    /**
     * 会话内审批面的**追加**区(list,内置零注册)。消费者:`ChatView`。
     *
     * 内核默认审批面是 `PermissionInlineCard` + `QuestionInlineCard`,它们
     * **不被替换**(替换会破坏既有行为)。这个槽只提供「再加一块」的口子:
     * 不装插件 → 渲染 `null`(零占位);装了 → 按 `order` 追加在既有卡片旁。
     */
    "conversation.approvals": {
      kind: "list";
      scope: "session";
      owner: ConversationApprovalProps;
    };
  }
}

/** `composer.toolbar.action` 的贡献形状(数据型:宿主提供按钮外观,插件只给数据)。 */
export type ComposerToolbarAction = {
  id: string;
  label: string;
  title?: string;
  icon?: string;
  /** 点击回调;宿主已经确保它在会话上下文中被调用。 */
  onClick?: () => void;
  /** 需要时由宿主渲染的禁用态。 */
  disabled?: boolean;
};

export {
  ConversationBody,
  ConversationComposer,
  ConversationMarkdown,
  ConversationToolSide,
} from "./conversation-slots";
export type {
  ConversationBodyProps,
  ConversationMarkdownProps,
  ConversationToolSideProps,
} from "./conversation-slots";
export type { ComposerProps } from "./Composer";
export { MentionPicker } from "./MentionPicker";
export type { MentionPickerProps } from "./MentionPicker";

// ─── P0-4 / P0-5 新增槽位（见 docs/plan/06-roadmap.md） ──────────────
export {
  ConversationViewOutlet,
  ConversationViewTabs,
  ConversationResultView,
  ConversationContentView,
  useConversationViews,
} from "./conversation-view";
export type { ConversationViewProps, ConversationViewPayload } from "./conversation-view";
export { ConversationApprovals } from "./conversation-approvals";
export type {
  ConversationApprovalProps,
  ConversationApprovalImpl,
} from "./conversation-approvals";
