import { memo, useState } from "react";
import { agentBashAbort } from "@openbuddy/client/agent-client";
import { copyText } from "@openbuddy/platform/clipboard";
import { useSessionStore, type ChatMessage } from "@/features/chat/state/session-store";

const FOLDED_LINES = 14;

/**
 * A `!command` the user ran (20261116-pii W1.2): the command, its streamed output, how it
 * ended, and whether Buddy sees it (`!!` keeps the output out of the model's context).
 */
export const BashRow = memo(function BashRow({ message }: { message: ChatMessage }) {
  const sessionId = useSessionStore((s) => s.sessionId);
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const bash = message.meta?.bash ?? { command: "" };
  const output = message.parts[0]?.kind === "text" ? message.parts[0].text : "";
  const lines = output.split("\n");
  const folded = !open && lines.length > FOLDED_LINES;
  const shown = folded ? lines.slice(-FOLDED_LINES).join("\n") : output;
  const status = bash.running
    ? "运行中"
    : bash.cancelled
      ? "已停止"
      : bash.exitCode === undefined
        ? "已结束"
        : bash.exitCode === 0
          ? "完成"
          : `退出码 ${bash.exitCode}`;
  const tone = bash.running ? "running" : bash.cancelled || (bash.exitCode ?? 0) !== 0 ? "warn" : "ok";
  return (
    <div className={"bash-row" + (bash.running ? " bash-row--running" : "")} data-msg-ids={message.id} role="group" aria-label={`命令 ${bash.command}`}>
      <div className="bash-row__head">
        <span className="bash-row__prompt" aria-hidden="true">$</span>
        <code className="bash-row__command" title={bash.command}>{bash.command}</code>
        <span className={`bash-row__status bash-row__status--${tone}`} role={bash.running ? "status" : undefined}>
          <span className={bash.running ? "ob-shining-text" : ""}>{status}</span>
        </span>
        <span className="bash-row__context" title={bash.excluded ? "以 !! 运行：输出只给你看，不会发给 Buddy" : "以 ! 运行：输出会随下一条消息发给 Buddy"}>
          {bash.excluded ? "未发送给 Buddy" : "Buddy 可见"}
        </span>
        {bash.running && sessionId ? (
          <button type="button" className="bash-row__btn" disabled={stopping} onClick={() => { setStopping(true); void agentBashAbort(sessionId).catch(() => setStopping(false)); }}>
            {stopping ? "正在停止…" : "停止"}
          </button>
        ) : output ? (
          <button type="button" className="bash-row__btn" onClick={() => void copyText(output)} aria-label="复制输出">复制</button>
        ) : null}
      </div>
      {(output || bash.running) && (
        <pre className="bash-row__output" aria-live={bash.running ? "polite" : undefined}>
          {folded && <span className="bash-row__more-hint">… 前面还有 {lines.length - FOLDED_LINES} 行{"\n"}</span>}
          {shown || (bash.running ? " " : "")}
        </pre>
      )}
      {(lines.length > FOLDED_LINES || bash.truncated) && (
        <div className="bash-row__foot">
          {lines.length > FOLDED_LINES && <button type="button" className="bash-row__link" onClick={() => setOpen((v) => !v)}>{open ? "收起" : `展开全部（${lines.length} 行）`}</button>}
          {bash.truncated && <span className="bash-row__note">输出较长，只保留了末尾部分</span>}
        </div>
      )}
    </div>
  );
});
