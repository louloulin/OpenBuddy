/**
 * OnboardingChecklist — Phase 6.4 首次启动 checklist
 *
 * 三步：设置工作空间 / 选择默认模型 / 安装首个技能。
 * 通过 localStorage 持久化 onClose 状态（不写 storage 组件）。
 */
import { useState } from "react";

const STORAGE_KEY = "openbuddy:onboarding-complete";

export interface OnboardingChecklistProps {
  /** 强制显示（即使已标记完成） */
  force?: boolean;
  onComplete?: () => void;
}

interface Step {
  id: string;
  label: string;
  description: string;
  action?: () => void;
  done?: boolean;
}

export function OnboardingChecklist({ force = false, onComplete }: OnboardingChecklistProps) {
  const [completed, setCompleted] = useState<Record<string, boolean>>(() => {
    if (force) return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  const steps: Step[] = [
    {
      id: "workspace",
      label: "设置工作空间",
      description: "选择一个本地目录用于存放项目和会话。",
    },
    {
      id: "model",
      label: "选择默认模型",
      description: "选择你常用的语言模型作为默认。",
    },
    {
      id: "skill",
      label: "安装首个技能",
      description: "从技能市场安装一个工作流，试试 OpenBuddy 的能力。",
    },
  ];

  function markDone(id: string) {
    const next = { ...completed, [id]: true };
    setCompleted(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (steps.every((s) => next[s.id])) {
      onComplete?.();
    }
  }

  const allDone = steps.every((s) => completed[s.id]);
  if (allDone && !force) return null;

  return (
    <section className="onboarding-checklist" aria-labelledby="onboarding-title">
      <h2 id="onboarding-title" className="onboarding-checklist__title">
        🎉 欢迎使用 OpenBuddy
      </h2>
      <p className="onboarding-checklist__subtitle">完成以下 3 步开始你的旅程：</p>
      <ol className="onboarding-checklist__list">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`onboarding-checklist__item ${completed[step.id] ? "is-done" : ""}`}
          >
            <button
              type="button"
              onClick={() => markDone(step.id)}
              disabled={completed[step.id]}
              aria-pressed={completed[step.id]}
            >
              <span className="onboarding-checklist__check">
                {completed[step.id] ? "✓" : "○"}
              </span>
              <span className="onboarding-checklist__label">{step.label}</span>
            </button>
            <span className="onboarding-checklist__desc">{step.description}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
