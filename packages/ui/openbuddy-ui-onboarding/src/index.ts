/**
 * @openbuddy/ui-onboarding — 统一对外入口
 *
 * 首启引导层。承载"用户第一次打开 OpenBuddy 到第一次真正干活"这段路上的
 * 全部界面:分步向导、锚定式漫游、数据目录确认、反馈卡、更新摘要。
 *
 * 与 `@openbuddy/ui-shell` 的关系:shell 里的 `OnboardingChecklist` 是常驻的
 * "还剩几步"清单(可随时回看),`StartupSplash` 是启动画面;本包是**一次性的
 * 首启流程**,两者互补 —— 本包的向导走完后通常会把 checklist 当作回访入口。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染
 *   - 公共工具 (Utilities)    → 纯函数 / 状态机(hooks 与 reducer),无 JSX 输出
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client                → apply() 槽位注册入口(由 ui-runtime 调用)
 *   - ./invariant             → 不变式同伴(debug 模式下激活)
 *   - ./components            → 组件聚合
 *   - ./lib/onboarding-reducer → 向导纯状态机
 *   - ./tour/tour-steps       → 漫游纯定位逻辑与默认步骤
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
import type { SlotMap } from "@openbuddy/ui-slots";

export type { SlotMap };

// ── 组件 ────────────────────────────────────────────────────────────────
export { OnboardingWizard } from "./components/OnboardingWizard";
export type {
  OnboardingStep,
  OnboardingStepApi,
  OnboardingWizardProps,
} from "./components/OnboardingWizard";
export { DataDirPrompt } from "./components/DataDirPrompt";
export type { DataDirPromptProps } from "./components/DataDirPrompt";
export { FeedbackPopup } from "./components/FeedbackPopup";
export type {
  FeedbackPopupProps,
  FeedbackPayload,
  FeedbackSentiment,
} from "./components/FeedbackPopup";
export { WhatsNewCard } from "./components/WhatsNewCard";
export type { WhatsNewCardProps, WhatsNewItem } from "./components/WhatsNewCard";
export { TourModal, useTourController } from "./tour/TourModal";
export type { TourModalProps, TourController, UseTourControllerOptions } from "./tour/TourModal";
export { TourSpotlight } from "./tour/TourSpotlight";
export type { TourSpotlightProps } from "./tour/TourSpotlight";

// ── 向导状态机 ──────────────────────────────────────────────────────────
export {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_STATE_VERSION,
  activeOnboardingStep,
  clearOnboardingState,
  completeOnboardingStep,
  createInitialOnboardingState,
  defaultOnboardingStorage,
  dismissOnboarding,
  gotoOnboardingStep,
  isOnboardingComplete,
  isOnboardingResumable,
  nextOnboardingStep,
  onboardingProgress,
  prevOnboardingStep,
  readOnboardingState,
  resetOnboarding,
  skipOnboardingStep,
  syncOnboardingSteps,
  writeOnboardingState,
} from "./lib/onboarding-reducer";
export type {
  OnboardingState,
  OnboardingStatus,
  OnboardingStepRecord,
  OnboardingStepStatus,
  OnboardingStorageLike,
} from "./lib/onboarding-reducer";

// ── 漫游纯逻辑 ──────────────────────────────────────────────────────────
export {
  DEFAULT_TOUR_STEPS,
  TOUR_STORAGE_KEY,
  computeCardPosition,
  findAvailableTourIndex,
  inflateTourRect,
  isTourTargetSelector,
  markTourSeen,
  probeTourStep,
  resetTour,
  resolveTourTarget,
  shouldAutoOpenTour,
  toTourRect,
} from "./tour/tour-steps";
export type {
  TourPlacement,
  TourProbe,
  TourRect,
  TourSize,
  TourStep,
  TourStorageLike,
} from "./tour/tour-steps";

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /** 首启分步向导(一次性,步骤由宿主注入)。 */
    "onboarding.wizard": {
      kind: "single";
      scope: "root";
      owner: Record<string, never>;
    };
    /** 锚定式漫游(spotlight tour)。 */
    "onboarding.tour": {
      kind: "single";
      scope: "root";
      owner: Record<string, never>;
    };
    /** 首次启动确认数据目录(需要宿主提供 onSubmit,故为 session-maybe)。 */
    "onboarding.data-dir": {
      kind: "single";
      scope: "session-maybe";
      owner: Record<string, never>;
    };
    /** 轻量反馈卡(赞 / 踩 + 备注)。 */
    "onboarding.feedback": {
      kind: "single";
      scope: "root";
      owner: Record<string, never>;
    };
    /** 版本更新摘要。 */
    "onboarding.whats-new": {
      kind: "single";
      scope: "root";
      owner: Record<string, never>;
    };
  }
}
