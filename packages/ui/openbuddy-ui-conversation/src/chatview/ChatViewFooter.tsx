/**
 * ChatViewFooter — 底部固定栏(审批/暂停/重发条/输入区)。
 *
 * 与改造前 `chatview__footer` div 等价:
 *   - 内联审批 / 问题卡(`PermissionInlineCard` + `QuestionInlineCard`)
 *   - Plan Mode 审批 list 追加槽(`ConversationApprovals`)
 *   - yield 横幅(暂停时显示)
 *   - 流式暂停按钮
 *   - Rewind / Fork(`RewindBar`)
 *   - 消息队列(`QueuePanel`)
 *   - Pi reload 失败横幅
 *   - Composer(走 `ConversationComposer` 槽)
 */
import type { ReactNode } from "react";
import { PermissionInlineCard } from "@openbuddy/ui-dialogs";
import { PauseIcon } from "@openbuddy/ui-primitives/icons";
import { ConversationApprovals } from "../conversation-approvals";
import { ConversationComposer } from "../conversation-slots";
import { PiReloadFailureBanner } from "../PiReloadFailureBanner";
import { QuestionInlineCard } from "../QuestionInlineCard";
import { QueuePanel } from "@openbuddy/ui-automation";
import { RewindBar } from "../RewindBar";
import { Composer, type ComposerProps } from "../Composer";

export type ChatViewFooterProps = {
  sessionId: string | null;
  streaming: boolean;
  readOnlySubagent: boolean;
  yielded: boolean;
  /** yield 横幅按钮。 */
  onResume: () => void;
  onResumeAndContinue: () => void;
  /** 暂停按钮(流式时)。 */
  onPause: () => void;
  /** 审批计数与 blocked 状态。 */
  pendingApprovalCount: number;
  blockedOnApproval: boolean;
  /** Composer。 */
  composerProps: ComposerProps;
  /** Composer fallback(核心引用)。 */
  composerFallback?: ReactNode;
  cwd?: string;
  onRewound?: () => void;
  onForked?: (newSessionId: string) => void;
  onToast?: (msg: string) => void;
  onSend: (text: string) => void;
};

export function ChatViewFooter(props: ChatViewFooterProps) {
  const composerFallback = props.composerFallback ?? (
    <Composer {...props.composerProps} />
  );
  return (
    <div className="chatview__footer">
      <PermissionInlineCard sessionId={props.sessionId} />
      <QuestionInlineCard sessionId={props.sessionId} />
      <ConversationApprovals
        sessionId={props.sessionId ?? undefined}
        pendingCount={props.pendingApprovalCount}
        blocked={props.blockedOnApproval}
      />
      {props.yielded && (
        <div className="yield-banner" role="status">
          <span>已暂停(会话上下文已保留)</span>
          <div className="yield-banner__actions">
            <button
              type="button"
              className="yield-banner__resume"
              onClick={props.onResume}
              title="仅恢复,不触发新回复(可继续输入)"
            >
              恢复
            </button>
            <button
              type="button"
              className="yield-banner__resume yield-banner__resume--primary"
              onClick={props.onResumeAndContinue}
              title="恢复并发送「请继续」让 agent 接着生成"
            >
              恢复并继续
            </button>
          </div>
        </div>
      )}
      {props.sessionId && props.streaming && !props.yielded && (
        <button
          type="button"
          className="chatview__pause-btn"
          onClick={props.onPause}
          title="暂停生成(保留会话,可继续)"
        >
          <PauseIcon size="sm" style={{ verticalAlign: "text-bottom" }} /> 暂停
        </button>
      )}
      {props.sessionId && !props.streaming && !props.readOnlySubagent && (
        <RewindBar
          sessionId={props.sessionId}
          cwd={props.cwd}
          onRewound={props.onRewound}
          onForked={props.onForked}
          onToast={props.onToast}
        />
      )}
      {props.sessionId && !props.readOnlySubagent && (
        <QueuePanel sessionId={props.sessionId} onSendNow={props.onSend} />
      )}
      <PiReloadFailureBanner />
      <ConversationComposer {...props.composerProps} fallback={composerFallback} />
    </div>
  );
}
