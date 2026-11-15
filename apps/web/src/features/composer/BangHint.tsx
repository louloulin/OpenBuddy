import { riskLabel, type CommandRiskResult } from "@openbuddy/chat-core/command-risk";
import type { BangCommand } from "./useBangCommand";

/** The "命令模式" strip shown while the input starts with `!` (20261116-pii W1.2). */
export function BangHint({ bang, risk, available }: { bang: BangCommand | null; risk?: CommandRiskResult; available: boolean }) {
  if (!bang) return null;
  return (
    <div className="bang-hint" role="status" aria-live="polite">
      <span className="bang-hint__tag">命令模式</span>
      <span className="bang-hint__text">
        {!available
          ? "在任务里可以用 ! 直接运行命令"
          : bang.excluded
            ? "!! 运行：输出只给你看，不发给 Buddy"
            : "! 运行：输出会随下一条消息发给 Buddy（用 !! 不发送）"}
      </span>
      {risk && risk.level !== "low" && (
        <span className={`bang-hint__risk bang-hint__risk--${risk.level}`} title={risk.reasons.join("；")}>
          {riskLabel(risk.level)} · {risk.reasons[0]}，执行前会请你确认
        </span>
      )}
    </div>
  );
}
