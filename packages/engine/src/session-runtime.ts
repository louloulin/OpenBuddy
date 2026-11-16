import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "./engine-context.js";
import type { PromptImages, SessionRunStatus, Slot } from "./types.js";

export function emitStatus(engine: EngineContext, slot: Slot) {
  engine.flushDelta(slot);
  // 子代理 (W3.4) are not sidebar rows: their progress comes from agent://subagent, not session-status.
  if (slot.subagent) return;
  engine.emit("agent://session-status", {
    sessionId: slot.id,
    status: engine.runStatus(slot),
  });
}
export function runStatus(slot?: Slot): SessionRunStatus {
  if (!slot) return "idle";
  if (slot.busy) return "running";
  return slot.failed ? "failed" : "idle";
}
export function validateImages(session: AgentSession, images?: PromptImages) {
  if (images?.length && !session.model?.input.includes("image"))
    throw Error("model_does_not_support_images: 当前模型不支持图片输入");
}
export async function send(engine: EngineContext, id: string, prompt: string, images?: PromptImages) {
  const slot = engine.slot(id),
    session = slot.session;
  if (slot.busy) throw Error("会话忙碌");
  const running = [...engine.slots.values()].filter((s) => s.busy).length;
  if (running >= engine.limits.maxRunning)
    throw Error(`too_many_running: 最多同时运行 ${engine.limits.maxRunning} 个任务，请等待其中一个完成`);
  if (
    !session.model ||
    !engine.providers.model(session.model.id, session.model.provider)
  )
    throw Error("model_not_found: 当前模型已删除，请重新选择");
  engine.validateImages(session, images);
  slot.busy = true;
  slot.failed = false;
  slot.commandError = undefined;
  slot.lastActive = Date.now();
  const generation = ++slot.generation;
  engine.emitStatus(slot);
  session.extensionRunner.setUIContext(engine.ui.context(id), "rpc");
  try {
    let disposition: string | undefined;
    await session.prompt(prompt, {
      images,
      preflightResult: (value) => {
        disposition = value;
      },
    });
    if (
      disposition === "handled" &&
      generation === slot.generation &&
      slot.commandError
    )
      throw Error(slot.commandError);
    // Extension commands are truly handled without an agent run, so Pi emits no settled.
    // Complete the host's send lifecycle only after the command handler has finished.
    if (disposition === "handled" && generation === slot.generation)
      engine.emitEvent(slot, {
        type: "agent_settled",
        aborted: slot.cancelledGeneration === generation,
        commandHandled: true,
      });
  } catch (error) {
    if (generation === slot.generation) slot.failed = true;
    throw error;
  } finally {
    if (generation === slot.generation) {
      engine.permissions.cancel(id);
      if (slot.busy) {
        slot.busy = false;
        engine.emitStatus(slot);
      }
      if (slot.stale && engine.slots.get(id) === slot) void engine.rebuild(slot).catch(() => {});
    }
  }
}
export function abortRetry(engine: EngineContext, id: string) { engine.live(id).abortRetry(); }
export function queueState(engine: EngineContext, id: string) {
  const s = engine.live(id);
  return {
    steering: [...s.getSteeringMessages()],
    followUp: [...s.getFollowUpMessages()],
  };
}
export function clearQueue(engine: EngineContext, id: string) {
  return engine.live(id).clearQueue();
}
/**
 * Replace the pending queue (撤回一条 / 改成插话 / 调整顺序, 20261115-ui U4.5). Pi only offers
 * clear + append, so the new order is re-queued; queued images are not kept.
 */
export async function setQueue(engine: EngineContext, id: string, steering: string[], followUp: string[]) {
  const slot = engine.slot(id),
    session = slot.session;
  session.clearQueue();
  if (slot.busy) {
    for (const text of steering) await session.steer(text);
    for (const text of followUp) await session.followUp(text);
  }
  return engine.queueState(id);
}
export async function queue(
  engine: EngineContext,
  id: string,
  kind: "steer" | "followUp",
  prompt: string,
  images?: PromptImages,
) {
  const slot = engine.slot(id),
    session = slot.session;
  if (!slot.busy)
    throw Error("queue_unavailable: 当前没有运行中的会话");
  engine.validateImages(session, images);
  const disposition =
    kind === "steer"
      ? await session.steer(prompt, images)
      : await session.followUp(prompt, images);
  return { ...engine.queueState(id), disposition };
}
export async function cancel(engine: EngineContext, id: string) {
  const slot = engine.slot(id);
  // 子代理 (W3.4): stopping the parent stops every child it spawned (depth-first).
  for (const child of [...engine.slots.values()].filter((candidate) => candidate.parentId === id))
    await cancel(engine, child.id).catch(() => {});
  slot.cancelledGeneration = slot.generation;
  engine.ui.cancel(id, "cancelled");
  engine.mcp.auth.cancel(id);
  await engine.mcp.auth.settle();
  engine.permissions.cancel(id);
  if (slot.session.isCompacting) slot.session.abortCompaction();
  // 停止 also stops a `!command` (W1.2) and a branch summary (W1.1) in progress.
  if (slot.session.isBashRunning) slot.session.abortBash();
  slot.session.abortBranchSummary();
  await slot.session.abort();
}
