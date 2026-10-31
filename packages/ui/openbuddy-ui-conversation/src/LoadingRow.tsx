import { useEffect, useRef, useState } from "react";
import { WorkingDot } from "./chatview/WorkingDot";
import { useLocale } from "@openbuddy/ui-locale/client";
import { LOADING_TIPS } from "@/lib/platform/loading-tips";
import type { TurnPhase } from "@openbuddy/shared-types";
import { useSessionStore } from "@/stores/session-store";

/**
 * 助手消息的「等待中」行：头像/名字由 MessageItem 的 header 渲染，本组件
 * 只负责 body 里的 loading 行，视觉对齐 WorkBuddy。
 *
 * 计划 1.1：主文案读主进程回合状态机投影的 `turnPhase` —— 调用工具 / 等待
 *   你确认时给出确切说法，思考与生成时走动词轮换。
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

const PREPARING_KEY = "chat.loading.preparing";
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
/** 动词键位(chat.loading.verb1..14),文案在词表(批D i18n 迁移)。 */
const THINKING_VERB_KEYS: readonly string[] = Array.from({ length: 14 }, (_, i) => `chat.loading.verb${i + 1}`);

/** 有确切说法的阶段(其余阶段走动词轮换)。 */
const PHASE_LABEL_KEYS: Partial<Record<TurnPhase, string>> = {
  tool_running: "chat.turn.toolRunning",
  awaiting_approval: "chat.turn.awaitingApproval",
};

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

function useRotatingVerb(streaming: boolean, intervalMs: number): { keyName: string; key: number } {
  const [verb, setVerb] = useState<{ keyName: string; key: number }>(() => ({
    keyName: THINKING_VERB_KEYS[Math.floor(Math.random() * THINKING_VERB_KEYS.length)],
    key: 0,
  }));
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => {
      setVerb((v) => {
        const nextIdx =
          (THINKING_VERB_KEYS.indexOf(v.keyName) + 1 + Math.floor(Math.random() * 3)) %
          THINKING_VERB_KEYS.length;
        return { keyName: THINKING_VERB_KEYS[nextIdx], key: v.key + 1 };
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [streaming, intervalMs]);
  return verb;
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
  const turnPhase = useSessionStore((s) => s.turnPhase);
  const streaming = useSessionStore((s) => s.streaming);
  const showPreparing = usePreparingTransition();
  const rotatingVerb = useRotatingVerb(streaming, 2400);
  const tip = useRotatingTip(LOADING_TIPS, TIP_INITIAL_DELAY_MS, TIP_ROTATION_INTERVAL_MS);
  const elapsed = useElapsedSeconds(streaming);
  const locale = useLocale();

  // 文案优先级：
  //   1. 有确切说法的阶段（调用工具 / 等待你确认）—— 告诉用户此刻在做什么；
  //   2. THINKING_VERBS 轮换 —— 思考、生成时的视觉填充；
  //   3. 准备中过渡文案 —— 回车后最初的 1.2s，给"已经触发"的明确反馈。
  const phaseKey = PHASE_LABEL_KEYS[turnPhase];
  const phaseLabelText = phaseKey ? locale.t(phaseKey) : null;
  const verbText = locale.t(rotatingVerb.keyName);
  const mainText = phaseLabelText ?? verbText ?? (showPreparing ? locale.t(PREPARING_KEY) : locale.t("chat.loading.waiting"));

  // 任何 loading 文案右侧都跟 dots + elapsed，对齐 cabinet PendingIndicator。
  // elapsed 前 2s 不显示，避免"闪一下 1s 又消失"的视觉噪音。
  const showElapsed = elapsed > 2;

  return (
    /* plan1030 批 4b — role="status"（隐含 aria-live=polite）：加载状态插入/
     * 变化时对读屏播报一次。内层 elapsed 不再单独 aria-live（此前每秒
     * 播报一次计时，属噪音；lumos 同款做法是容器级单一 live region）。 */
    <div className="msg__loading" role="status">
      <span className="msg__loading-main ob-shining-text" key={phaseLabelText ? "phase" : rotatingVerb.key}>
        {mainText}
      </span>
      {/* Claude 对齐(2026-10-14):三点 bounce 换成单一呼吸点 —— 它是全局
          唯一的"正在工作"指示源(对齐 cds-working-dot-halo)。 */}
      <WorkingDot />
      {showElapsed && (
        <span className="msg__loading-elapsed">
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
