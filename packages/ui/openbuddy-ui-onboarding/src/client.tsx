/**
 * @openbuddy/ui-onboarding/client — apply() 把首启引导层挂到槽位
 *
 * 每个槽位注册一个"自带默认值"的 surface:
 *   - 自带默认值的(wizard / tour):零配置即可渲染,宿主接上即用;
 *   - 依赖宿主回调的(data-dir / feedback / whats-new):宿主没给回调就渲染 null,
 *     避免注册后立刻把一个不能提交的空壳弹到用户脸上。
 *
 * 所有 surface 都是薄壳 —— 真正的交互逻辑在各自组件里,host 想换 UI 只需
 * 以更高优先级注册自己的组件。
 */
import { useEffect, useState } from "react";

import {
  DataDirPrompt,
  FeedbackPopup,
  OnboardingWizard,
  TourModal,
  WhatsNewCard,
  useTourController,
  type DataDirPromptProps,
  type FeedbackPopupProps,
  type OnboardingStep,
  type WhatsNewCardProps,
} from "./index";

import { ONBOARDING_STORAGE_KEY } from "./lib/onboarding-reducer";
import { markTourSeen, TOUR_STORAGE_KEY } from "./tour/tour-steps";

import type { UiRuntimeContext } from "@openbuddy/ui-slots";

/**
 * 首启向导是否已经走完 / 被跳过。
 * 漫游(tour)要等这一步结束才自动开始，否则首屏会同时压上两层浮层。
 */
function isOnboardingFinished(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { status?: string } | null;
    return parsed?.status === "done" || parsed?.status === "dismissed";
  } catch {
    return false;
  }
}

/**
 * 内置的向导步骤:欢迎 → 第一个任务 → 完成。
 *
 * 配置项(主题 / 模型服务 / 数据目录)不放进引导 —— 用户可能在引导之前
 * 就已经做完,或不想被打断;它们在「设置」面板里随时可改。这里只承担
 * "介绍 + 起步" 两件事。
 */
export const DEFAULT_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "欢迎来到 OpenBuddy",
    description: "本地优先的 AI 工作台:会话、文件、产物都在你自己的机器上。三步就能开始。",
  },
  {
    id: "first-task",
    title: "交办第一个任务",
    description: "在输入框里描述你想完成的事,OpenBuddy 会拆解成步骤并给出产物。",
  },
  {
    id: "done",
    title: "准备就绪",
    description: "主题、模型服务、数据目录都可以在设置里随时调整。",
  },
];

function OnboardingWizardSurface() {
  // 向导自身根据持久化状态决定显隐(已完成 / 已跳过就不再出现),
  // 这里的 open 只负责"本次会话内用户点了关闭"这一层。
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <OnboardingWizard
      steps={DEFAULT_ONBOARDING_STEPS}
      onComplete={() => setOpen(false)}
      onSkip={() => setOpen(false)}
      onDismiss={() => setOpen(false)}
    />
  );
}

function TourSurface() {
  const [armed, setArmed] = useState(() => isOnboardingFinished());
  // 向导还在屏幕上时不给漫游 autoOpen；向导落盘结束后（轮询很轻，1.2s 一次）
  // 再武装控制器，保证同一时刻只有一个引导浮层。
  useEffect(() => {
    if (armed) return;
    const id = window.setInterval(() => {
      if (isOnboardingFinished()) {
        // R10.3 — 向导刚走完时立刻把漫游标记为 "seen"，避免首屏在用户还没
        // 看清楚 home/composer 之前又被一片暗幕压上来阻塞点击。漫游在设置
        // 里可以随时通过「重新观看引导」入口手动触发,不需要 autoOpen。
        try {
          if (window.localStorage.getItem(TOUR_STORAGE_KEY) !== "seen") {
            markTourSeen();
          }
        } catch { /* localStorage 不可用时忽略,useTourController 内部会再判断 */ }
        setArmed(true);
      }
    }, 1200);
    return () => window.clearInterval(id);
  }, [armed]);
  // R10.4 — 当向导在首次挂载时就已经完成（回访用户 / 测试夹具 / 任何跳过向导的
  // 入口）,上面的轮询会因为 `armed === true` 提前 return,从来不会执行
  // markTourSeen。结果:useTourController 的 shouldAutoOpenTour() 仍返回 true,
  // 暗幕一加载就压在 home/composer 上面,拦截所有 pointer 事件,用户拿不到任何
  // 交互入口。把"标记 seen"这一步独立出来:armed === true 时在挂载时直接同步
  // 写一次 localStorage,然后让 useTourController 通过自己的 shouldAutoOpenTour
  // 判断不开。轮询路径不变,继续覆盖"向导在本会话内刚刚走完"的情况。
  useEffect(() => {
    if (!armed) return;
    try {
      if (window.localStorage.getItem(TOUR_STORAGE_KEY) !== "seen") {
        markTourSeen();
      }
    } catch { /* localStorage 不可用,useTourController 内部会再判断 */ }
  }, [armed]);
  const tour = useTourController({ autoOpen: armed });
  if (!tour.open) return null;
  return <TourModal open={tour.open} steps={tour.steps} onFinish={tour.stop} onClose={tour.stop} />;
}

function DataDirPromptSurface(props: Record<string, unknown>) {
  if (typeof props.onSubmit !== "function") return null;
  return <DataDirPrompt {...(props as unknown as DataDirPromptProps)} />;
}

function FeedbackPopupSurface(props: Record<string, unknown>) {
  if (typeof props.onSubmit !== "function") return null;
  return <FeedbackPopup {...(props as unknown as FeedbackPopupProps)} />;
}

function WhatsNewCardSurface(props: Record<string, unknown>) {
  if (typeof props.onDismiss !== "function" || typeof props.version !== "string") return null;
  if (!Array.isArray(props.items)) return null;
  return <WhatsNewCard {...(props as unknown as WhatsNewCardProps)} />;
}

export function apply(ctx: UiRuntimeContext): () => void {
  const registrant = "@openbuddy/ui-onboarding";
  const disposers: Array<() => void> = [
    ctx.slots.register(
      { name: "onboarding.wizard", kind: "single", scope: "root", registrant },
      OnboardingWizardSurface as never,
    ),
    ctx.slots.register(
      { name: "onboarding.tour", kind: "single", scope: "root", registrant },
      TourSurface as never,
    ),
    ctx.slots.register(
      { name: "onboarding.data-dir", kind: "single", scope: "session-maybe", registrant },
      DataDirPromptSurface as never,
    ),
    ctx.slots.register(
      { name: "onboarding.feedback", kind: "single", scope: "root", registrant },
      FeedbackPopupSurface as never,
    ),
    ctx.slots.register(
      { name: "onboarding.whats-new", kind: "single", scope: "root", registrant },
      WhatsNewCardSurface as never,
    ),
  ];

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* 单个槽位卸载失败不应阻断其余槽位的清理 */
      }
    }
  };
}
