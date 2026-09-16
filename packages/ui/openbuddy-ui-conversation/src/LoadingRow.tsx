import { useEffect, useRef, useState } from "react";
import { LOADING_TIPS } from "@/lib/platform/loading-tips";
import { phaseLabel, type AgentPhase } from "@/lib/stream/agent-phase";
import { useSessionStore } from "@/stores/session-store";

/**
 * 助手消息的「等待中」行：头像/名字由 MessageItem 的 header 渲染，本组件
 * 只负责 body 里的 loading 行，视觉对齐 WorkBuddy。
 *
 * Phase R3.0 (pi-web-alignment):
 *   - 主文案改读 `useSessionStore((s) => s.phase)` + `phaseLabel()`，
 *     不再依赖本地 1200ms timer。
 *   - running_tools 时在主文案里附加工具名列表（节流到前 3 个），与
 *     StatusPill 一致。
 *
 * R8.0 (verb-animation):
 *   - 学习 cabinet turn-block 的 `PendingIndicator`：在 phase 标签基础上
 *     引入 THINKING_VERBS 轮换（2.4s 一次），形成"思考中 → 梳理中 → 织网中"
 *     的动词感，避免长时间等待时的视觉静止。
 *   - 右侧追加 3 个 bounce dots，错位 -0.3s / -0.15s / 0s，沿用 Tailwind 的
 *     bounce 动画曲线，等价于现有 `ob-tip-fade-in` 的轻盈观感。
 *   - 显示 1Hz elapsed counter（`12s`），但用 tabular-nums 避免宽度跳变；
 *     前 2s 不显示以避免闪。
 *   - LOADING_TIPS 轮播保持不变（节奏与 cabinet 一致：3500ms 延迟 + 9s 间隔）。
 */

const PREPARING_TEXT = "准备中";
const PREPARING_DURATION_MS = 1200;
const TIP_INITIAL_DELAY_MS = 3500;
const TIP_ROTATION_INTERVAL_MS = 9000;

/**
 * 中文 THINKING_VERBS：仿 cabinet turn-block 的 `PendingIndicator` 模式。
 * 选词原则：
 *   - 语义偏轻（不承诺"已完成 X 步"等具体进度，仅传达"正在处理"）
 *   - 单字/双字节奏均匀（与 phase 标签拼接时不显臃肿）
 *   - 不暗示具体能力（不写"联网" / "搜索"等 OpenBuddy 不一定有的功能）
 * 词序每 4 个一档做轻微语义梯度（信息/思维/状态），循环时不单调。
 */
const THINKING_VERBS: readonly string[] = [
  "梳理信息",
  "理清思路",
  "抽丝剥茧",
  "提炼要点",
  "整理素材",
  "打磨措辞",
  "组织语言",
  "编织答复",
  "核对细节",
  "校准结论",
  "斟酌用词",
  "润色表达",
  "梳理脉络",
  "梳理结构",
];

/**
 * 把 phaseLabel 文本（来自 `phaseLabel()`，通常是"等待模型响应" / "运行 3 个工具: foo, bar"
 * 等）映射到 THINKING_VERBS 风格的短动词前缀：
 *   - waiting_model     → "梳理信息" / "理清思路" …
 *   - running_command   → "打磨措辞"
 *   - running_tools     → "核对细节" + 工具名
 *   - 其他 / idle        → 返回 null，由调用者 fallback。
 * 关键词义保留 phase 的语义（在做什么），动词则传达"现在处于思考态"。
 */
function verbForPhase(phase: AgentPhase): string | null {
  if (!phase || phase.kind === "idle") return null;
  switch (phase.kind) {
    case "waiting_model":
      return null; // 走 THINKING_VERBS 轮换
    case "running_command":
      return "打磨措辞";
    case "running_tools":
      return null;
    default:
      return null;
  }
}

function usePreparingTransition(): boolean {
  const streaming = useSessionStore((s) => s.streaming);
  const [requesting, setRequesting] = useState(false);
  useEffect(() => {
    if (!streaming) {
      setRequesting(false);
      return;
    }
    const t = setTimeout(() => setRequesting(true), PREPARING_DURATION_MS);
    return () => clearTimeout(t);
  }, [streaming]);
  return requesting;
}

function useRotatingVerb(streaming: boolean, intervalMs: number): { text: string; key: number } {
  const [verb, setVerb] = useState<{ text: string; key: number }>(() => ({
    text: THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)],
    key: 0,
  }));
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => {
      setVerb((v) => {
        const nextIdx =
          (THINKING_VERBS.indexOf(v.text) + 1 + Math.floor(Math.random() * 3)) %
          THINKING_VERBS.length;
        return { text: THINKING_VERBS[nextIdx], key: v.key + 1 };
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [streaming, intervalMs]);
  return verb;
}

/**
 * 取 phase 的可见标签。idle 时不显示（交给 MessageItem）。
 * running_tools 展开工具名（对齐 StatusPill）。其他状态原样返回 phaseLabel。
 */
function derivePhaseLabel(phase: AgentPhase): string | null {
  if (!phase || phase.kind === "idle") return null;
  if (phase.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return phaseLabel(phase);
    const visible = names.slice(0, 3);
    const suffix = names.length > 3 ? ` 等 ${names.length} 个` : "";
    return `运行 ${names.length} 个工具: ${visible.join(", ")}${suffix}`;
  }
  return phaseLabel(phase);
}

function useRotatingTip(
  tips: string[],
  initialDelay: number,
  interval: number
): { text: string; key: number } | null {
  const [tip, setTip] = useState<{ text: string; key: number } | null>(null);
  const prevRef = useRef<string | null>(null);
  const tipsRef = useRef(tips);
  tipsRef.current = tips;

  useEffect(() => {
    let rotation: ReturnType<typeof setInterval> | undefined;
    const pick = () => {
      const pool = tipsRef.current;
      if (pool.length === 0) return;
      let next = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1 && next === prevRef.current) {
        next = pool[(pool.indexOf(next) + 1) % pool.length];
      }
      prevRef.current = next;
      setTip((t) => ({ text: next, key: (t?.key ?? 0) + 1 }));
    };
    const start = setTimeout(() => {
      pick();
      rotation = setInterval(pick, interval);
    }, initialDelay);
    return () => {
      clearTimeout(start);
      if (rotation) clearInterval(rotation);
    };
  }, [initialDelay, interval]);

  return tip;
}

/** 1Hz 计时器（streaming 期间每秒 +1），返回从 streaming 起算的秒数。 */
function useElapsedSeconds(streaming: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!streaming) {
      startedAtRef.current = null;
      setElapsed(0);
      return;
    }
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    const tick = () => {
      const startedAt = startedAtRef.current;
      if (startedAt !== null) setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [streaming]);
  return elapsed;
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

export function LoadingRow() {
  const phase = useSessionStore((s) => s.phase);
  const streaming = useSessionStore((s) => s.streaming);
  const phaseLabelText = derivePhaseLabel(phase);
  const showPreparing = usePreparingTransition();
  const rotatingVerb = useRotatingVerb(streaming, 2400);
  const tip = useRotatingTip(LOADING_TIPS, TIP_INITIAL_DELAY_MS, TIP_ROTATION_INTERVAL_MS);
  const elapsed = useElapsedSeconds(streaming);

  // 文案优先级：
  //   1. phase 驱动的具体标签（如 "运行 3 个工具"）—— 这是最准确的，告诉用户
  //      当前正在做什么；
  //   2. THINKING_VERBS 轮换 —— phase 进入 waiting_model / idle 时的视觉填充；
  //   3. 准备中过渡文案 —— 用户按下回车后最初的 1.2s，给 streaming flag 一段
  //      "已经触发" 的明确反馈。
  // running_tools 阶段我们仍展示 phase label（更准确），不切换动词；
  // 但动词 2400ms 仍在背后轮换，避免 running_tools 长时间时静止。
  const verbOverride = verbForPhase(phase);
  const verbText = verbOverride ?? rotatingVerb.text;
  const mainText = phaseLabelText ?? verbText ?? (showPreparing ? PREPARING_TEXT : "等待中");

  // 任何 loading 文案右侧都跟 dots + elapsed，对齐 cabinet PendingIndicator。
  // elapsed 前 2s 不显示，避免"闪一下 1s 又消失"的视觉噪音。
  const showElapsed = elapsed > 2;

  return (
    <div className="msg__loading">
      <span className="msg__loading-main ob-shining-text" key={phaseLabelText ? "phase" : rotatingVerb.key}>
        {mainText}
      </span>
      <span className="msg__loading-dots" aria-hidden="true">
        <span className="msg__loading-dot msg__loading-dot--1" />
        <span className="msg__loading-dot msg__loading-dot--2" />
        <span className="msg__loading-dot msg__loading-dot--3" />
      </span>
      {showElapsed && (
        <span className="msg__loading-elapsed" aria-live="polite">
          {formatElapsed(elapsed)}
        </span>
      )}
      {tip && (
        <span className="msg__loading-tip">
          <span className="msg__loading-sep" aria-hidden="true">·</span>
          <span className="msg__loading-tip-text" key={tip.key}>{tip.text}</span>
        </span>
      )}
    </div>
  );
}
