/**
 * StartupSplash — Phase 6.4 启动 splash
 *
 * 渲染 OpenBuddy logo + 渐变光晕 + 进度条 + 进度文案。
 * fade-out 退出通过父组件控制 open prop。
 */
import { useEffect, useState } from "react";

const STAGES = [
  "正在初始化会话…",
  "正在加载模型…",
  "正在准备插件…",
  "正在同步工作空间…",
  "即将完成…",
];

export interface StartupSplashProps {
  open: boolean;
  onComplete?: () => void;
  /** 总持续时间（ms），默认 2400 */
  durationMs?: number;
}

export function StartupSplash({ open, onComplete, durationMs = 2400 }: StartupSplashProps) {
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) {
      setStage(0);
      setProgress(0);
      return;
    }
    const stageInterval = durationMs / STAGES.length;
    const tickMs = 60;
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += tickMs;
      const pct = Math.min(100, (elapsed / durationMs) * 100);
      setProgress(pct);
      const nextStage = Math.min(STAGES.length - 1, Math.floor(elapsed / stageInterval));
      setStage(nextStage);
      if (elapsed >= durationMs) {
        clearInterval(id);
        onComplete?.();
      }
    }, tickMs);
    return () => clearInterval(id);
  }, [open, durationMs, onComplete]);

  if (!open) return null;

  return (
    <div className="startup-splash" role="status" aria-live="polite" aria-busy="true">
      <div className="startup-splash__halo" aria-hidden="true" />
      <div className="startup-splash__content">
        <h1 className="startup-splash__brand">
          <span className="startup-splash__logo">●</span>
          OpenBuddy
        </h1>
        <div className="startup-splash__progress" aria-label={`启动进度 ${Math.round(progress)}%`}>
          <div className="startup-splash__progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <p className="startup-splash__stage">{STAGES[stage]}</p>
      </div>
    </div>
  );
}
