/**
 * reconcile-turn.ts — 加载会话后,按主进程回合状态机校正渲染层(计划 1.1)。
 *
 * 渲染层的 `streaming` 平时由发送 / complete / 停止驱动;但窗口重新加载、
 * 启动时恢复上次会话这类路径会丢掉内存里的状态。此时主进程可能仍在跑这个
 * 会话的回合:以前界面显示空闲、没有停止按钮,用户再发消息只会撞上
 * "Agent is already processing"。这里以主进程为准把运行态接回来,后续增量
 * 照常落进新开的气泡。
 *
 * 只做"接回运行中",不做反向收尾:主进程空闲而渲染层仍在流式的情况由
 * complete / watchdog 处理,这里不重复判断。
 */
import { piTurnState } from "@/lib/agent/pi-client";
import { useSessionStore } from "@/stores/session-store";

export async function reconcileTurnState(sessionId: string): Promise<void> {
  let phase;
  try {
    ({ phase } = await piTurnState(sessionId));
  } catch {
    return; // 旧宿主没有这个通道,或会话尚未加载:保持现状。
  }
  const store = useSessionStore.getState();
  if (store.sessionId !== sessionId) return;
  store.setTurnPhase(phase);
  if (phase === "idle" || store.streaming) return;
  store.setStreaming(true);
  if (!store.streamingMessageId) store.beginStreamingMessage();
}
