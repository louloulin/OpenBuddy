/**
 * R1 — Plan mode banner (Codex / Claude Code-style persistent banner).
 *
 * When `planMode` is true, this banner renders at the top of the chat column
 * showing the current plan steps (if any) and a one-click exit affordance.
 * Sits above the message list so the user can always see the plan context
 * without having to open the side panel.
 *
 * The component is purely presentational; the parent owns `planMode` state
 * and the toggle handler. The plan steps come from the existing `plan` field
 * in the session transcript store, which the agent populates as the model
 * emits plan_update events.
 */
import { memo } from "react";
import { CheckIcon, CloseIcon, TaskListIcon } from "@openbuddy/ui-primitives/icons";
import type { Plan, PlanEntry, PlanEntryStatus } from "@openbuddy/shared-types";

interface PlanModeBannerProps {
  plan: Plan | null | undefined;
  /** When true, the banner is visible. Parent reads this from session state. */
  visible: boolean;
  onExit?: () => void;
  /** Approve / reject a single step. The argument is the array index in
   *  plan.entries — PlanEntry itself has no id field in the current schema. */
  onApproveStep?: (stepIdx: number) => void;
  onRejectStep?: (stepIdx: number) => void;
  onToast?: (msg: string) => void;
}

export const PlanModeBanner = memo(function PlanModeBanner({
  plan,
  visible,
  onExit,
  onApproveStep,
  onRejectStep,
  onToast,
}: PlanModeBannerProps) {
  if (!visible) return null;

  const steps: PlanEntry[] = plan?.entries ?? [];
  const completed = steps.filter((s) => s.status === "completed").length;
  const total = steps.length;

  return (
    <div className="plan-banner" role="region" aria-label="计划模式">
      <div className="plan-banner__head">
        <span className="plan-banner__icon" aria-hidden="true">
          <TaskListIcon size="sm" />
        </span>
        <span className="plan-banner__title">计划模式</span>
        {total > 0 && (
          <span className="plan-banner__progress">
            {completed}/{total} 已完成
          </span>
        )}
        {onExit && (
          <button
            type="button"
            className="plan-banner__exit"
            onClick={() => {
              onExit();
              onToast?.("已退出计划模式");
            }}
            aria-label="退出计划模式"
            title="退出计划模式"
          >
            <CloseIcon size="sm" />
          </button>
        )}
      </div>
      {total > 0 && (
        <ol className="plan-banner__steps">
          {steps.map((step, idx) => {
            const status: PlanEntryStatus = step.status ?? "pending";
            return (
              <li
                key={idx}
                className={"plan-banner__step plan-banner__step--" + status}
              >
                <span className="plan-banner__step-mark" aria-hidden="true">
                  {status === "completed" ? (
                    <CheckIcon size={10} strokeWidth={3} />
                  ) : status === "in_progress" ? (
                    "…"
                  ) : (
                    "○"
                  )}
                </span>
                <span className="plan-banner__step-title">{step.content}</span>
                {status === "pending" && (onApproveStep || onRejectStep) && (
                  <span className="plan-banner__step-actions">
                    {onApproveStep && (
                      <button
                        type="button"
                        className="plan-banner__step-btn"
                        onClick={() => onApproveStep(idx)}
                        title="批准"
                      >
                        批准
                      </button>
                    )}
                    {onRejectStep && (
                      <button
                        type="button"
                        className="plan-banner__step-btn plan-banner__step-btn--reject"
                        onClick={() => onRejectStep(idx)}
                        title="驳回"
                      >
                        驳回
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
});
