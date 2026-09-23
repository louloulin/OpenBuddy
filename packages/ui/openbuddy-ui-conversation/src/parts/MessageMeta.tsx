/**
 * MessageMeta — assistant 消息的"元信息脚注"部件(R8.14 / R8.15 / R58)。
 *
 * 职责单一:渲染 assistant 气泡底部的时间 / 时长 / 模型 / token 吞吐 chip。
 * 由 `MessageItem` 在 assistant 分支末尾挂载,不在 user 消息上出现(user
 * 消息自带一个轻量的 `msg__meta--user` 时间戳,见 `UserBubble.tsx`)。
 *
 * 显示内容:
 *   - 流式:`12s 正在生成…`(带 hourglass icon)
 *   - 已完成:`刚刚` / `X 分钟前`(绝对时钟回退);若 turn 已结束则追加 `· 12s`
 *   - 已完成 + modelId:`<model>` chip(neutral)
 *   - 已完成 + inputTokens / outputTokens:`1.2k in` / `42 out` chip
 *   - 已完成 + 输出 tokens + 时长 ≥ 1s:`42 tok/s` chip
 *
 * 视觉与无障碍:
 *   - 透明度 0.55,消息行 `:hover` 时自动变 1(继承 `.msg__meta` 基样式)
 *   - icon / chip 用 aria-hidden,整个 meta 用 `aria-label` + `title` 兜底
 *
 * 该组件是纯展示:不订阅 store、不调用 hook。所有数据来自 props。
 */
import Hourglass from "lucide-react/dist/esm/icons/hourglass";
import Clock3 from "lucide-react/dist/esm/icons/clock-3";
import Cpu from "lucide-react/dist/esm/icons/cpu";
import Hash from "lucide-react/dist/esm/icons/hash";
import Zap from "lucide-react/dist/esm/icons/zap";
import {
  formatDurationMs,
  formatRelativeTime,
  formatThroughput,
  formatTokenCount,
} from "@/lib/ui/duration";

export function MessageMeta({
  createdAt,
  durationMs,
  isStreaming,
  modelId,
  outputTokens,
  inputTokens,
}: {
  createdAt: number;
  durationMs: number | null;
  isStreaming: boolean;
  /** R8.15 — model id used to produce this turn. Drives the .msg__meta-chip--model
   *  pill rendered alongside the timestamp (PI-Desktop parity). */
  modelId?: string;
  /** R8.15 — completion token count. Combined with `durationMs` to derive
   *  a tok/s throughput chip. Only renders when both are present and the
   *  turn has actually finished streaming. */
  outputTokens?: number;
  /** R58 — prompt (input) token count for this turn. Renders as a
   *  "<formatted> in" chip before the throughput chip when present.
   *  Optional for backward compat with pre-R58 history. */
  inputTokens?: number;
}) {
  const label = isStreaming
    ? `${formatDurationMs(durationMs ?? 0)} 正在生成…`
    : formatRelativeTime(Date.now() - createdAt);
  const detail =
    !isStreaming && typeof durationMs === "number" && durationMs > 0
      ? formatDurationMs(durationMs)
      : null;
  // R8.15 — derive throughput from completed output tokens / duration.
  // Require ≥ 1s so we don't render "inf tok/s" on sub-second turns
  // (also matches PI-Desktop's `calculateTokenRate` floor).
  const throughput =
    !isStreaming &&
    typeof outputTokens === "number" &&
    outputTokens > 0 &&
    typeof durationMs === "number" &&
    durationMs >= 1000
      ? outputTokens / (durationMs / 1000)
      : null;
  const ariaLabel = isStreaming
    ? `正在生成, ${formatDurationMs(durationMs ?? 0)}`
    : detail
      ? `${label}, 用时 ${detail}`
      : label;
  const showModelChip = !isStreaming && typeof modelId === "string" && modelId.length > 0;
  return (
    <div
      className={
        "msg__meta" + (isStreaming ? " msg__meta--streaming" : "")
      }
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <span className="msg__meta-icon" aria-hidden="true">
        {isStreaming ? (
          <Hourglass size={10} strokeWidth={1.75} />
        ) : (
          <Clock3 size={10} strokeWidth={1.75} />
        )}
      </span>
      <span className="msg__meta-time">{label}</span>
      {detail && (
        <span className="msg__meta-detail" aria-hidden="true">
          · {detail}
        </span>
      )}
      {showModelChip && (
        <span className="msg__meta-chip msg__meta-chip--model" title={`model: ${modelId}`}>
          <Cpu size={9} strokeWidth={1.75} aria-hidden="true" />
          <span className="msg__meta-chip-text">{modelId}</span>
        </span>
      )}
      {/* R58 — input (prompt) token chip. Renders before the throughput
          chip so the "in" / "out" / "tok/s" reading order stays natural.
          Only shown when inputTokens is present (provider-reported) AND
          the turn has finished streaming (mirrors the throughput gate). */}
      {!isStreaming && typeof inputTokens === "number" && inputTokens > 0 && (
        <span
          className="msg__meta-chip msg__meta-chip--input"
          title={`${inputTokens} prompt tokens for this turn`}
        >
          <Hash size={9} strokeWidth={1.75} aria-hidden="true" />
          <span className="msg__meta-chip-text">{formatTokenCount(inputTokens)} in</span>
        </span>
      )}
      {/* R58 — output (completion) token chip. Rendered alongside the
          input chip so users can see in/out at a glance; the legacy
          throughput chip below carries the tok/s rate. */}
      {!isStreaming && typeof outputTokens === "number" && outputTokens > 0 && (
        <span
          className="msg__meta-chip msg__meta-chip--output"
          title={`${outputTokens} completion tokens for this turn`}
        >
          <Zap size={9} strokeWidth={1.75} aria-hidden="true" />
          <span className="msg__meta-chip-text">{formatTokenCount(outputTokens)} out</span>
        </span>
      )}
      {throughput !== null && (
        <span className="msg__meta-chip msg__meta-chip--throughput" title={`${outputTokens} completion tokens in ${formatDurationMs(durationMs!)}`}>
          <Zap size={9} strokeWidth={1.75} aria-hidden="true" />
          <span className="msg__meta-chip-text">{formatThroughput(throughput)} tok/s</span>
        </span>
      )}
    </div>
  );
}
