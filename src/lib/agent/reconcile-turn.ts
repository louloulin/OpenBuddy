/**
 * reconcile-turn.ts — 加载会话后,按主进程回合状态机校正渲染层(计划 1.1)。
 *
 * 渲染层的 `streaming` 平时由发送 / complete / 停止驱动;但窗口重新加载、
 * 启动时恢复上次会话这类路径会丢掉内存里的状态。此时主进程可能仍在跑这个
 * 会话的回合:以前界面显示空闲、没有停止按钮,用户再发消息只会撞上
 * "Agent is already processing"。这里以主进程为准把运行态接回来,后续增量
 * 照常落进新开的气泡。
 *
 * 切回仍在后台生成的会话(计划 0.3)走同一条路,并补回正在生成的那条回复。
 *
 * 只做"接回运行中",不做反向收尾:主进程空闲而渲染层仍在流式的情况由
 * complete / watchdog 处理,这里不重复判断。
 */
import { piTurnState } from "@/lib/agent/pi-client";
import { useSessionStore } from "@/stores/session-store";

export async function reconcileTurnState(sessionId: string): Promise<void> {
  let turn;
  try {
    turn = await piTurnState(sessionId);
  } catch {
    return; // 旧宿主没有这个通道,或会话尚未加载:保持现状。
  }
  const store = useSessionStore.getState();
  if (store.sessionId !== sessionId) return;
  store.setTurnPhase(turn.phase);
  if (turn.phase === "idle" || store.streaming) return;
  store.setStreaming(true);
  if (!store.streamingMessageId) store.beginStreamingMessage();
  // 切回后台跑着的会话:历史里只有已完成的消息,正在生成的那条从主进程补回,
  // 后续增量接着往后写。
  if (turn.partial?.thinking) store.appendStreamingDelta(turn.partial.thinking, "thought");
  if (turn.partial?.text) store.appendStreamingDelta(turn.partial.text, "text");
}
