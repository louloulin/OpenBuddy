import { useEffect, useRef, useState } from "react";
import { LOADING_TIPS } from "@/lib/platform/loading-tips";
import { phaseLabel, type AgentPhase } from "@/lib/stream/agent-phase";
import { useSessionStore } from "@/stores/session-store";

/**
 * 助手消息的「等待中」行:头像/名字由 MessageItem 的 header 渲染,本组件
 * 只负责 body 里的 loading 行,视觉对齐 WorkBuddy:
 *
 *   [扫光主文案]  ·  [轮播小贴士]
 *
 * Phase R3.0 (pi-web-alignment):
 *   - 主文案改读 `useSessionStore((s) => s.phase)` + `phaseLabel()`,
 *     不再依赖本地 1200ms timer。Phase state machine 已经有 `idle` /
 *     `waiting_model` / `running_command` / `running_tools` 四态,原实现
 *     在 `running_command` 跑 npm test 时仍然显示「等待模型响应」误导用户。
 *   - 保留 LOADING_TIPS 轮播,但初始延迟从「先让主文案单独亮相」改为
 *     「phase 变化后 3500ms 再开始」,让 phase 切换有节奏感。
 *   - running_tools 时在主文案里附加工具名列表(节流到前 3 个),与
 *     StatusPill 一致。
 */

const PREPARING_TEXT = "准备中";
/** 「准备中」展示多久后推进到 phase 驱动文案。 */
const PREPARING_DURATION_MS = 1200;
/** 首条 tip 出现前的延迟(让主文案先单独亮相)。 */
const TIP_INITIAL_DELAY_MS = 3500;
/** tip 轮播间隔。 */
const TIP_ROTATION_INTERVAL_MS = 9000;

/** 在 phase 进入 idle/waiting_model 前的本地"准备中"过渡文案。 */
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

/**
 * 取 phase 的可见标签。idle 时不显示(交给 MessageItem)。其他状态用
 * `phaseLabel`,但 running_tools 展开工具名(对齐 StatusPill)。
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

/** 随机不重复地轮播 tip,initialDelay 后启动。返回 null 表示尚未开始。 */
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

export function LoadingRow() {
  // Phase R3.0 — pull the canonical phase from the store instead of a hardcoded
  // 1200 ms timer. The phase reducer is referentially stable, so this
  // subscription re-renders only when the phase actually changes.
  const phase = useSessionStore((s) => s.phase);
  const phaseLabelText = derivePhaseLabel(phase);
  const showPreparing = usePreparingTransition();
  // Main text: prefer the phase label, fall back to the preparing transition
  // text only while the user hasn't waited long enough to see the phase
  // label settle (covers the brief window before phaseReducer emits
  // waiting_model).
  const mainText = phaseLabelText ?? (showPreparing ? PREPARING_TEXT : "等待中");
  const tip = useRotatingTip(
    LOADING_TIPS,
    TIP_INITIAL_DELAY_MS,
    TIP_ROTATION_INTERVAL_MS
  );

  return (
    <div className="msg__loading">
      <span className="msg__loading-main ob-shining-text">{mainText}</span>
      {tip && (
        <span className="msg__loading-tip">
          <span className="msg__loading-sep" aria-hidden="true">
            ·
          </span>
          <span className="msg__loading-tip-text" key={tip.key}>
            {tip.text}
          </span>
        </span>
      )}
    </div>
  );
}
