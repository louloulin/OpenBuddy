/**
 * 消息时间线分组纯函数 —— 对齐 WorkBuddy `cb-chat-ui/message-timeline`
 * (grouped messages / model-switch dividers / continue-cards / date separators)。
 *
 * OpenBuddy 的 ChatMessage 当前不带 model/timestamp,这里用可选字段做前向兼容:
 * 消息可携带 `modelId` / `createdAt`。无这些字段时退化为「无分隔符」(不影响渲染)。
 * 纯函数、无副作用,便于单测。
 */
import type { ChatMessage } from "@/stores/session-store";

/** 带可选元数据的消息(前向兼容:缺省字段视为不存在)。
 *  createdAt 用 Omit 重写:ChatMessage.createdAt 是 number,但 timeline-utils
 *  兼容 ISO 字符串时间戳(string),否则 Omit 后再 & 会把类型交叉退化为 number。
 */
export type TimelineMessage = Omit<ChatMessage, "createdAt"> & {
  modelId?: string;
  createdAt?: string | number;
};

/** 时间线节点:分隔符或消息引用。 */
export type TimelineNode =
  | { kind: "date-divider"; label: string; key: string }
  | { kind: "model-divider"; label: string; key: string }
  | { kind: "message"; message: TimelineMessage; index: number };

/**
 * 把消息序列展开成「分隔符 + 消息」的时间线节点序列。
 *
 *  - 日期分隔:相邻消息跨「天」(按 createdAt)时插入。
 *  - 模型分隔:相邻消息的 modelId 变化时插入(显示「已切换到 X」)。
 *  - 无 createdAt/modelId 时不插入对应分隔符。
 */
export function buildTimeline(messages: TimelineMessage[]): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  let prevDay: string | null = null;
  let prevModel: string | undefined;
  messages.forEach((m, i) => {
    // 日期分隔。
    if (m.createdAt != null) {
      const day = dayLabel(m.createdAt);
      if (day && day !== prevDay) {
        nodes.push({ kind: "date-divider", label: day, key: `date-${day}-${i}` });
        prevDay = day;
      }
    }
    // 模型切换分隔。
    if (m.modelId && m.modelId !== prevModel) {
      nodes.push({
        kind: "model-divider",
        label: `已切换到 ${m.modelId}`,
        key: `model-${m.modelId}-${i}`,
      });
      prevModel = m.modelId;
    }
    nodes.push({ kind: "message", message: m, index: i });
  });
  return nodes;
}

/** 把时间戳(ISO 字符串或毫秒)归一为「年月日」中文标签;无效返回 null。 */
export function dayLabel(ts: string | number): string | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 判断两条相邻消息是否构成「模型切换」。 */
export function isModelSwitch(a: TimelineMessage, b: TimelineMessage): boolean {
  return !!a.modelId && !!b.modelId && a.modelId !== b.modelId;
}

/** 统计时间线里的模型切换次数。 */
export function countModelSwitches(messages: TimelineMessage[]): number {
  let n = 0;
  let prev: string | undefined;
  for (const m of messages) {
    if (m.modelId && m.modelId !== prev) {
      if (prev !== undefined) n++;
      prev = m.modelId;
    }
  }
  return n;
}

// Plan5 B.9 — 工具并行 / 串行可视化。
//
// 聚类算法本体在 `./message-part-renderables`(零依赖、可直接单测);
// 这里只:
//   1. 重新导出,让既有的 `@/lib/ui/timeline-utils` 引用路径继续可用;
//   2. 提供"整段会话"维度的聚合 helper。
import {
  clusterToolCalls,
  type ToolCallCluster,
} from "./message-part-renderables";

export { clusterToolCalls, DEFAULT_PARALLEL_WINDOW_MS } from "./message-part-renderables";
export type { ToolCallCluster, PartRenderable } from "./message-part-renderables";

/**
 * 整段会话维度:把所有消息里的 tool_call 拉平再聚类,便于顶部 banner / minimap 用。
 */
export function groupParallelToolCalls(
  messages: Array<Pick<ChatMessage, "role" | "parts">>,
  windowMs: number = 3000,
): ToolCallCluster[] {
  const all: ToolCallCluster[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    all.push(...clusterToolCalls(m.parts, windowMs));
  }
  return all;
}

/**
 * 便利 helper:统计当前会话里同时运行的工具组数(= parallel/ ≥ 2 的 cluster 数)。
 * 给 ChatView / StatusIndicator 用,避免每次重渲染都做完整 cluster。
 */
export function countParallelClusters(clusters: readonly ToolCallCluster[]): number {
  return clusters.filter((c) => c.kind === "parallel").length;
}
