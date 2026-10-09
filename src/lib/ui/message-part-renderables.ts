/**
 * message-part-renderables — 把一个 assistant 消息的 `MessagePart[]` 展开成
 * "直接渲染项"序列(Plan5 B.9)。
 *
 * 唯一职责:把 **连续且可证明并行** 的 tool_call 合并成一个 cluster,其余 part
 * 原样透传。这样 `MessagePartRegistry` 只需要按序渲染,不必自己维护窗口状态;
 * 插件接管 `conversation.body` 时也能复用同一套分组语义。
 *
 * 为什么独立成模块(而不是内联在 MessagePartRegistry.tsx):
 *   - `MessagePartRegistry.tsx` 的 import 链会拖进 `electron-api`(vitest 下
 *     解析失败),纯函数放这里才能被单测直接覆盖;
 *   - 分组是渲染层最容易被改坏的逻辑(见下面 "legacy" 注释),值得独立测试。
 *
 * 关键不变式:**没有 `startedAt` 的 tool_call 绝不判定为并行**。早期实现用
 * `startedAt ?? 0` 兜底,导致一串无时间戳的历史工具调用全部落进同一个窗口,
 * 渲染出错误的 "N 个工具并行" 摘要。
 */
import type { MessagePart, ToolCallView } from "@openbuddy/ui-state/session-store";

export type ToolCallCluster =
  | { kind: "parallel"; toolCallIds: string[]; toolCalls: ToolCallView[] }
  | { kind: "single"; toolCallId: string; toolCall: ToolCallView };

export type PartRenderable =
  | { type: "part"; part: MessagePart }
  | { type: "cluster"; cluster: Extract<ToolCallCluster, { kind: "parallel" }> };

/** 两个相邻 tool_call 视为并行的默认时间窗口(毫秒)。 */
export const DEFAULT_PARALLEL_WINDOW_MS = 3000;

/**
 * 从 parts 数组抽出 tool_call clusters。
 *
 * 并行条件:同一条消息内、相邻、且 `startedAt` 差值 ≤ `windowMs`。
 * 非 tool_call 的 part 会断开窗口(文本/思考插在中间时不合并)。
 */
export function clusterToolCalls(
  parts: readonly MessagePart[],
  windowMs: number = DEFAULT_PARALLEL_WINDOW_MS,
): ToolCallCluster[] {
  const clusters: ToolCallCluster[] = [];
  let buffer: { id: string; tc: ToolCallView; startedAt: number }[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      clusters.push({ kind: "single", toolCallId: buffer[0].id, toolCall: buffer[0].tc });
    } else {
      clusters.push({
        kind: "parallel",
        toolCallIds: buffer.map((b) => b.id),
        toolCalls: buffer.map((b) => b.tc),
      });
    }
    buffer = [];
  };

  let prevStart: number | null = null;
  for (const p of parts) {
    if (p.kind !== "tool_call") {
      flushBuffer();
      prevStart = null;
      continue;
    }
    const tc = p.toolCall;
    const startedAt = tc.startedAt;
    // 无时间戳 → 无法证明重叠,单独成组并断开窗口。
    if (typeof startedAt !== "number") {
      flushBuffer();
      clusters.push({ kind: "single", toolCallId: tc.toolCallId, toolCall: tc });
      prevStart = null;
      continue;
    }
    if (prevStart !== null && Math.abs(startedAt - prevStart) > windowMs) {
      flushBuffer();
    }
    buffer.push({ id: tc.toolCallId, tc, startedAt });
    prevStart = startedAt;
  }
  flushBuffer();
  return clusters;
}

/**
 * 把 parts 展开成渲染项:普通 part 逐条保留,并行的 tool_call 组只产出**一个**
 * cluster(组内成员不再单独渲染,避免同一张卡出现两次)。
 */
export function buildPartRenderables(parts: readonly MessagePart[]): PartRenderable[] {
  const clusters = clusterToolCalls(parts);
  const byFirstId = new Map<string, Extract<ToolCallCluster, { kind: "parallel" }>>();
  const consumed = new Set<string>();
  for (const cluster of clusters) {
    if (cluster.kind !== "parallel") continue;
    byFirstId.set(cluster.toolCallIds[0], cluster);
    for (const id of cluster.toolCallIds) consumed.add(id);
  }
  const out: PartRenderable[] = [];
  for (const part of parts) {
    if (part.kind !== "tool_call") {
      out.push({ type: "part", part });
      continue;
    }
    const id = part.toolCall.toolCallId;
    const cluster = byFirstId.get(id);
    if (cluster) {
      out.push({ type: "cluster", cluster });
      continue;
    }
    if (consumed.has(id)) continue;
    out.push({ type: "part", part });
  }
  return out;
}
