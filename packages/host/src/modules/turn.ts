import { text } from "@openbuddy/services/settings/settings";
import { trustedImages, promptText, queueItems } from "../util.js";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `turn` module. One turn of a session: send, steer/follow-up queues, cancel. */
export function turnModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  const commands: Record<string, Handler> = {
    agent_send: (p) =>
      engine.send(text(p.sessionId), promptText(p), trustedImages(p.images)),
    agent_steer: (p) =>
      engine.queue(
        text(p.sessionId),
        "steer",
        promptText(p),
        trustedImages(p.images),
      ),
    agent_follow_up: (p) =>
      engine.queue(
        text(p.sessionId),
        "followUp",
        promptText(p),
        trustedImages(p.images),
      ),
    agent_get_queue: (p) => engine.queueState(text(p.sessionId)),
    agent_clear_queue: (p) => engine.clearQueue(text(p.sessionId)),
    agent_set_queue: (p) => engine.setQueue(text(p.sessionId), queueItems(p.steering), queueItems(p.followUp)),
    agent_cancel: (p) => engine.cancel(text(p.sessionId)),
    // 20261116-pii W1.2: `!cmd` (output joins the context) / `!!cmd` (excludeFromContext).
    agent_bash: (p) =>
      engine.bash(text(p.sessionId), text(p.command, "command"), {
        excludeFromContext: p.excludeFromContext === true,
        risk: p.risk === "medium" || p.risk === "high" ? p.risk : undefined,
      }),
    agent_bash_abort: (p) => engine.abortBash(text(p.sessionId)),
  };
  return { id: "turn", commands };
}
