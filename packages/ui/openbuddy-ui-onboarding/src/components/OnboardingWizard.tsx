/**
 * @openbuddy/ui-onboarding/OnboardingWizard — 首启引导向导
 *
 * 设计取舍(对标 cabinet 的 `onboarding-wizard.tsx`,但去掉了它的 12 步硬编码):
 *   - **步骤是数据,不是代码**。宿主传 `steps: { id, title, render }[]`,组件
 *     只负责游标 / 进度点 / 前进后退 / 恢复,不 import 任何业务组件。
 *   - **可恢复**。状态走 `onboarding-reducer` 的纯函数并落 localStorage
 *     (storage 可注入),重开应用回到中断的那一步。
 *   - **两种受控级别**。默认自持状态;传 `index` + `onIndexChange` 即可完全受控。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  activeOnboardingStep,
  completeOnboardingStep,
  defaultOnboardingStorage,
  dismissOnboarding,
  gotoOnboardingStep,
  nextOnboardingStep,
  onboardingProgress,
  prevOnboardingStep,
  readOnboardingState,
  skipOnboardingStep,
  syncOnboardingSteps,
  writeOnboardingState,
  type OnboardingState,
  type OnboardingStorageLike,
} from "../lib/onboarding-reducer";

import styles from "./OnboardingWizard.module.css";

/** 一步的声明。`render` 由宿主注入内容,组件本身不感知任何业务。 */
export interface OnboardingStep {
  id: string;
  title: string;
  description?: string;
  /** 可选步骤 —— 显示"跳过"而非强推。 */
  optional?: boolean;
  /** 覆盖最后一步之前的按钮文案(最后一步恒为"完成")。 */
  nextLabel?: string;
  /** 该步是否还不可继续(例如必填项未完成)。 */
  blocked?: boolean;
  render?(api: OnboardingStepApi): ReactNode;
}

/** 注入给 `render` 的上下文 —— 步骤内容可以自己驱动前进。 */
export interface OnboardingStepApi {
  step: OnboardingStep;
  index: number;
  total: number;
  state: OnboardingState;
  next(): void;
  back(): void;
  skip(): void;
  complete(): void;
}

export interface OnboardingWizardProps {
  steps: OnboardingStep[];
  /** 显式控制显隐;缺省时由持久化状态决定(已完成 / 已跳过则隐藏)。 */
  open?: boolean;
  /** 受控步骤下标。给定后组件不再自持游标。 */
  index?: number;
  onIndexChange?(index: number, step: OnboardingStep): void;
  /** 注入的持久化实现;传 `null` 退化为纯内存。 */
  storage?: OnboardingStorageLike | null;
  onStepChange?(step: OnboardingStep, index: number): void;
  onComplete?(): void;
  /**
   * 跳过整段引导(与逐步跳过不同,不会走完剩余步骤)。
   * 组件会先把状态落盘为 `dismissed`,宿主不需要自己写 storage。
   */
  onSkip?(): void;
  /**
   * 关闭按钮 / Esc;不传则不渲染关闭按钮。
   * 同样会先落盘 `dismissed`,否则下次启动会再弹一遍。
   */
  onDismiss?(): void;
  busy?: boolean;
  title?: string;
  className?: string;
}

const EMPTY_STEP: OnboardingStep = { id: "__empty__", title: "" };

export function OnboardingWizard({
  steps,
  open,
  index,
  onIndexChange,
  storage,
  onStepChange,
  onComplete,
  onSkip,
  onDismiss,
  busy = false,
  title = "开始使用 OpenBuddy",
  className,
}: OnboardingWizardProps) {
  // 步骤 id 序列的稳定指纹:宿主每次渲染都新建 `steps` 数组字面量是常态,
  // 若直接用数组身份做 effect 依赖,重渲染 → setState(新对象)→ 重渲染
  // 会立刻演变成 "Maximum update depth exceeded"。用内容指纹当依赖,
  // 再配一个 ref 守卫,reconcile 每次真正变化最多跑一次。
  const stepIdsKey = steps.map((entry) => entry.id).join("\u0000");
  const stepIds = useMemo(
    () => (stepIdsKey.length === 0 ? [] : stepIdsKey.split("\u0000")),
    [stepIdsKey],
  );
  const resolvedStorage = useMemo(
    () => (storage === undefined ? defaultOnboardingStorage() : storage),
    [storage],
  );

  const [state, setState] = useState<OnboardingState>(() =>
    readOnboardingState(resolvedStorage, stepIds),
  );
  const completedRef = useRef(false);
  const syncedKeyRef = useRef(stepIdsKey);

  // 步骤列表变化(宿主增删步骤 / HMR)时按 id 对齐历史进度。
  useEffect(() => {
    if (syncedKeyRef.current === stepIdsKey) return;
    syncedKeyRef.current = stepIdsKey;
    setState((prev) => {
      const persisted = readOnboardingState(resolvedStorage, stepIds);
      const persistedHasProgress = persisted.steps.some(
        (entry) => entry.status === "done" || entry.status === "skipped",
      );
      // 持久化里确实有进度且步骤数量一致 → 采信它(冷启动恢复);
      // 否则保留内存中更"新"的那一份,只把 id 序列对齐(宿主改步骤)。
      if (persistedHasProgress && persisted.steps.length === stepIds.length) return persisted;
      return syncOnboardingSteps(prev, stepIds);
    });
    completedRef.current = false;
  }, [resolvedStorage, stepIds, stepIdsKey]);

  // 受控模式:把外部 index 同步进内部状态,这样"上一步/下一步"这类操作
  // 仍然走同一套 reducer(否则受控时游标会从内部默认值 0 开始算)。
  useEffect(() => {
    if (index === undefined) return;
    setState((prev) => (prev.index === index ? prev : gotoOnboardingStep(prev, index, stepIds)));
  }, [index, stepIds]);

  const current = index ?? state.index;
  const step: OnboardingStep = steps[current] ?? steps[0] ?? EMPTY_STEP;
  const total = steps.length;
  const isLast = total === 0 || current >= total - 1;
  const progress = onboardingProgress(state);
  const visible = open ?? (state.status !== "done" && state.status !== "dismissed");

  const commit = useCallback(
    (next: OnboardingState) => {
      setState(next);
      writeOnboardingState(resolvedStorage, next);
    },
    [resolvedStorage],
  );

  /**
   * R62 —— 关闭 / 跳过整段引导时必须落盘,否则每次启动都会重弹。
   *
   * 曾经的实现里,「×」和 Esc 只调用宿主的 `onDismiss`,组件自己不写 storage;
   * 宿主把 `open` 置 false 只是**本次会话**的显隐。于是用户关掉向导后重启,
   * `openbuddy.onboarding.state` 仍是 `idle`,向导原样再弹一遍 —— 这就是
   * "引导过了还弹"的根因(只有一路点「完成」到底才会经 `commit` 落盘)。
   *
   * 现在把"关闭"也当成一次终结态(`dismissed`),与 `done` 同等对待:
   * 组件自己负责持久化,宿主只需处理 UI 副作用。
   */
  const dismissWhole = useCallback(
    (notify?: () => void) => {
      const next = dismissOnboarding(state);
      commit(next);
      notify?.();
    },
    [state, commit],
  );

  const goNext = useCallback(() => {
    const next = nextOnboardingStep(state, stepIds);
    commit(next);
    if (next.status === "done") {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
      return;
    }
    onIndexChange?.(next.index, steps[next.index] ?? step);
    onStepChange?.(steps[next.index] ?? step, next.index);
  }, [state, stepIds, commit, onComplete, onIndexChange, onStepChange, steps, step]);

  const goBack = useCallback(() => {
    const next = prevOnboardingStep(state, stepIds);
    commit(next);
    onIndexChange?.(next.index, steps[next.index] ?? step);
    onStepChange?.(steps[next.index] ?? step, next.index);
  }, [state, stepIds, commit, onIndexChange, onStepChange, steps, step]);

  const goSkip = useCallback(() => {
    const next = skipOnboardingStep(state, stepIds);
    commit(next);
    if (next.status === "done") {
      onComplete?.();
      return;
    }
    onIndexChange?.(next.index, steps[next.index] ?? step);
    onStepChange?.(steps[next.index] ?? step, next.index);
  }, [state, stepIds, commit, onComplete, onIndexChange, onStepChange, steps, step]);

  const api = useMemo<OnboardingStepApi>(
    () => ({
      step,
      index: current,
      total,
      state,
      next: goNext,
      back: goBack,
      skip: goSkip,
      // 异步步骤(校验通过等)只落状态、不移动游标。
      complete: () => commit(completeOnboardingStep(state, stepIds)),
    }),
    [step, current, total, state, goNext, goBack, goSkip, stepIds, commit, onComplete],
  );

  // 键盘:Esc 交给宿主关闭,←/→ 翻页(输入框内不劫持)。
  useEffect(() => {
    if (!visible) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.key === "Escape" && (onDismiss || onSkip)) {
        event.preventDefault();
        dismissWhole(onDismiss ?? onSkip);
        return;
      }
      if (event.key === "ArrowRight" && !busy && !step.blocked) {
        event.preventDefault();
        goNext();
      }
      if (event.key === "ArrowLeft" && current > 0) {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, busy, step.blocked, current, goNext, goBack, onDismiss, onSkip, dismissWhole]);

  if (!visible || total === 0) return null;

  const activeRecord = activeOnboardingStep(state);
  const canSkipStep = Boolean(step.optional);
  const nextDisabled = busy || Boolean(step.blocked);

  return (
    <div
      className={className ? `${styles.root} ${className}` : styles.root}
      data-testid="onboarding-wizard"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-step-id={step.id}
      data-step-index={current}
    >
      <div className={styles.card}>
        <header className={styles.header}>
          <div className={styles.dots} role="tablist" aria-label="引导进度">
            {steps.map((entry, i) => {
              const record = state.steps.find((item) => item.id === entry.id);
              const stateKind = record?.status ?? "pending";
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={i === current}
                  aria-label={`第 ${i + 1} 步:${entry.title}`}
                  className={`${styles.dot} ${i === current ? styles.dotActive : ""} ${
                    stateKind === "done" ? styles.dotDone : ""
                  } ${stateKind === "skipped" ? styles.dotSkipped : ""}`}
                  data-testid="onboarding-dot"
                  data-state={stateKind}
                  disabled={i > current}
                  onClick={() => {
                    if (i === current) return;
                    commit(gotoOnboardingStep(state, i, stepIds));
                    onIndexChange?.(i, steps[i]);
                    onStepChange?.(steps[i], i);
                  }}
                />
              );
            })}
          </div>
          <div className={styles.headerMeta}>
            <span className={styles.counter} data-testid="onboarding-counter">
              {current + 1} / {total}
            </span>
            {onDismiss && (
              <button
                type="button"
                className={styles.close}
                onClick={() => dismissWhole(onDismiss)}
                aria-label="关闭引导"
                data-testid="onboarding-close"
              >
                ×
              </button>
            )}
          </div>
        </header>

        <div className={styles.body}>
          <h2 className={styles.title} data-testid="onboarding-title">
            {step.title}
          </h2>
          {step.description && (
            <p className={styles.description} data-testid="onboarding-description">
              {step.description}
            </p>
          )}
          <div className={styles.content} data-testid="onboarding-content">
            {step.render ? step.render(api) : null}
          </div>
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.ghost}
            onClick={goBack}
            disabled={current === 0}
            data-testid="onboarding-back"
          >
            上一步
          </button>
          <div className={styles.footerRight}>
            {canSkipStep && (
              <button
                type="button"
                className={styles.ghost}
                onClick={goSkip}
                disabled={busy}
                data-testid="onboarding-skip"
              >
                跳过此步
              </button>
            )}
            <button
              type="button"
              className={styles.primary}
              onClick={goNext}
              disabled={nextDisabled}
              data-testid="onboarding-next"
              data-last={isLast ? "true" : "false"}
            >
              {isLast ? "完成" : (step.nextLabel ?? "下一步")}
            </button>
          </div>
        </footer>

        <div className={styles.progressBar} aria-hidden="true">
          <span style={{ width: `${progress.percent}%` }} />
        </div>
        <span className={styles.srOnly} data-testid="onboarding-progress">
          {progress.percent}%
        </span>
        <span className={styles.srOnly} data-testid="onboarding-status">
          {activeRecord?.status ?? "pending"}
        </span>
      </div>
    </div>
  );
}
