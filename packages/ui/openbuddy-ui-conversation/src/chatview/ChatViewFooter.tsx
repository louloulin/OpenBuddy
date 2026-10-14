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
import { RewindBar } from "../RewindBar";
import { QueuedMessages } from "../composer/QueuedMessages";
import { useLocale } from "@openbuddy/ui-locale/client";
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

  const locale = useLocale();  const composerFallback = props.composerFallback ?? (
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
      {/* C1 dock 外壳:Notices(RewindBar / 队列 / 桥失败横幅)与 Composer
          同住一个圆角容器 —— 对齐 Claude ChatComposerDock 的插槽结构。 */}
      <div className="chat-dock">
      {props.yielded && (
        <div className="yield-banner" role="status">
          <span>{locale.t("chat.footer.yieldBanner")}</span>
          <div className="yield-banner__actions">
            <button
              type="button"
              className="yield-banner__resume"
              onClick={props.onResume}
              title={locale.t("chat.footer.resumeTitle")}
            >
              {locale.t("chat.footer.resume")}
            </button>
            <button
              type="button"
              className="yield-banner__resume yield-banner__resume--primary"
              onClick={props.onResumeAndContinue}
              title={locale.t("chat.footer.resumeContinueTitle")}
            >
              {locale.t("chat.footer.resumeContinue")}
            </button>
          </div>
        </div>
      )}
      {props.sessionId && props.streaming && !props.yielded && (
        <button
          type="button"
          className="chatview__pause-btn"
          onClick={props.onPause}
          title={locale.t("chat.footer.pauseTitle")}
        >
          <PauseIcon size="sm" style={{ verticalAlign: "text-bottom" }} /> {locale.t("chat.footer.pause")}
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
        <QueuedMessages sessionId={props.sessionId} onSendNow={props.onSend} />
      )}
        <PiReloadFailureBanner />
        <ConversationComposer {...props.composerProps} fallback={composerFallback} />
      </div>
    </div>
  );
}
