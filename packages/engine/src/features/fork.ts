import { SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import type { EngineContext } from "../engine-context.js";

export async function fork(engine: EngineContext, id: string) {
  const slot = engine.slot(id);
  if (slot.busy) throw Error("会话忙碌");
  const file = slot.session.sessionManager.getSessionFile();
  if (!file || !existsSync(file))
    throw Error("fork_requires_history: 请先发送消息");
  const forked = await engine.open(
    SessionManager.forkFrom(
      file,
      slot.session.sessionManager.getCwd(),
      engine.sessionDir,
    ),
  );
  engine.focus(forked.id);
  return forked.id;
}
