/**
 * conversation-approvals — `conversation.approvals`（list 槽）的实现。
 *
 * ## 为什么是「追加区」而不是「替换区」（P0-5）
 *
 * 改造前，会话内的审批面是 `ChatView` 里写死的两行：
 *
 *   - `PermissionInlineCard`（`@openbuddy/ui-dialogs`）
 *   - `QuestionInlineCard`（本包）
 *
 * 它们是**内核默认实现**，工作正常，因此这里**不去替换**它们 —— 那会破坏
 * 既有行为（见 `docs/plan/05-target-architecture.md` R5 回退语义）。真正的
 * 缺口是：插件没有任何地方能**再加一块**自己的待处理面（例如「本会话有 3 个
 * 工具调用等待确认」「企业审批流待批」），只能去改宿主源码。
 *
 * 所以这个槽是 **list 语义、内置零注册**：
 *
 *   - 一个插件都不装 → 渲染 `null`（**零占位、零视觉变化**）；
 *   - 装了插件 → 所有注册项按 `order` 依次追加在既有审批卡片旁边。
 *
 * ## 数据从哪来（不新建 store）
 *
 * 载荷里的 `pendingCount` 由宿主从**既有** store 计算后下发：
 * `src/stores/question-store.ts`（`selectQuestionForSession`）与
 * `src/stores/permission-store.ts`（`selectPermissionForSession`）。
 * 本包不引入任何新状态容器，也不反向依赖 app 的 store —— 它只接收一个数字。
 */

import { type ComponentType, type ReactNode } from "react";
import { renderSlotEntry, useSlotComponents } from "@openbuddy/ui-runtime/client";

/** `conversation.approvals` 的贡献契约。 */
export type ConversationApprovalProps = {
  /** 当前会话 id；未进入会话时为 `undefined`。 */
  sessionId?: string;
  /**
   * 当前会话的**待处理项数量**（提问 + 权限，由宿主汇总后下发）。
   *
   * 插件可以据此决定要不要把自己那块渲染出来（`pendingCount === 0` 时通常
   * 应该返回 `null`，避免常驻占位）。
   */
  pendingCount: number;
  /** 是否存在**被阻塞**的待处理项（宿主已判定无法自动继续）。 */
  blocked: boolean;
};

/**
 * 会话内审批面的**追加区**。内置不注册任何内容，因此默认完全不占位。
 *
 * 渲染顺序由注册项的 `order` 决定（内核 list 语义）。
 */
export function ConversationApprovals(props: ConversationApprovalProps): ReactNode {
  const impls = useSlotComponents("conversation.approvals");
  if (impls.length === 0) return null;
  return (
    <div
      className="conversation-approvals-extra"
      data-session={props.sessionId}
      data-pending={props.pendingCount}
      data-blocked={props.blocked ? "true" : "false"}
    >
      {impls.map((impl, index) => renderSlotEntry(impl, { ...props, key: index }))}
    </div>
  );
}

/** 供插件作者在实现里复用的组件类型别名。 */
export type ConversationApprovalImpl = ComponentType<ConversationApprovalProps>;
