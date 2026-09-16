/**
 * @openbuddy/ui-onboarding/TourModal — 锚定式漫游(spotlight tour)
 *
 * 与 cabinet 的 `tour-modal.tsx` 不同的地方:它是"全屏幻灯片叙事",这里是
 * "就地锚定真实控件"。理由是桌面端引导的目标是教会用户"点哪里",而不是
 * 看一套精心设计的幻灯片;锚定真实节点天然随主题 / 语言 / 布局走。
 *
 * 三种退化路径(全部有测试覆盖):
 *   1. 目标节点不存在 → 自动跳到下一个可达步骤,而不是留一个飘在空中的卡片;
 *   2. 剩余步骤全不可达 → 直接结束(调用 `onFinish`);
 *   3. 没有视口信息(jsdom / SSR)→ 用固定回退尺寸跑同一套定位函数。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_TOUR_STEPS,
  computeCardPosition,
  findAvailableTourIndex,
  markTourSeen,
  probeTourStep,
  shouldAutoOpenTour,
  type TourProbe,
  type TourRect,
  type TourSize,
  type TourStep,
  type TourStorageLike,
} from "./tour-steps";
import styles from "./TourModal.module.css";
import { TourSpotlight } from "./TourSpotlight";

const CARD_FALLBACK: TourSize = { width: 340, height: 168 };

export interface TourModalProps {
  open: boolean;
  steps?: TourStep[];
  initialIndex?: number;
  /** 注入的持久化实现;`undefined` → localStorage,`null` → 纯内存。 */
  storage?: TourStorageLike | null;
  zIndex?: number;
  onClose?(): void;
  onFinish?(): void;
  onStepChange?(step: TourStep, index: number): void;
  /** 自定义卡片主体(默认渲染 `title` / `body`)。 */
  renderBody?(step: TourStep, index: number): ReactNode;
  className?: string;
}

function viewportSize(): TourSize {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  return {
    width: window.innerWidth || 1024,
    height: window.innerHeight || 768,
  };
}

function sameRect(a: TourRect | null, b: TourRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

export function TourModal({
  open,
  steps = DEFAULT_TOUR_STEPS,
  initialIndex = 0,
  storage,
  zIndex = 1810,
  onClose,
  onFinish,
  onStepChange,
  renderBody,
  className,
}: TourModalProps) {
  const [index, setIndex] = useState(() => Math.max(0, initialIndex));
  const [probe, setProbe] = useState<TourProbe | null>(null);
  const [cardSize, setCardSize] = useState<TourSize>(CARD_FALLBACK);
  const [viewport, setViewport] = useState<TourSize>(viewportSize);
  const [closed, setClosed] = useState(false);
  const [measureTick, setMeasureTick] = useState(0);
  const finishedRef = useRef(false);
  const reportedRef = useRef<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // 回调用 ref 兜住:宿主传内联箭头函数是常态,若让它进入 effect / callback
  // 依赖,测量 → setState → 重渲染 → 新回调 → 再测量的循环就跑出去了。
  const onFinishRef = useRef(onFinish);
  const onCloseRef = useRef(onClose);
  const onStepChangeRef = useRef(onStepChange);
  const storageRef = useRef(storage);
  useEffect(() => {
    onFinishRef.current = onFinish;
    onCloseRef.current = onClose;
    onStepChangeRef.current = onStepChange;
    storageRef.current = storage;
  });

  const total = steps.length;
  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1);
  const step = steps[safeIndex];

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    markTourSeen(storageRef.current);
    setClosed(true);
    onFinishRef.current?.();
  }, []);

  const close = useCallback(() => {
    markTourSeen(storageRef.current);
    onCloseRef.current?.();
  }, []);

  /**
   * 同步当前步骤:测量目标 → 缺失就跳到下一个可达步骤,全不可达就结束。
   *
   * 这里刻意不读 `probe` 状态:上一次提交的 probe 可能是"上一步"的测量结果,
   * 用它做决策会在跳步后立刻误判成"全不可达"直接结束(有测试覆盖这个回归)。
   */
  const syncStep = useCallback(() => {
    const current = steps[safeIndex];
    if (!current) {
      setProbe((prev) => (prev && !prev.found ? prev : { found: false, rect: null }));
      return;
    }
    const result = probeTourStep(current);
    if (!result.found && current.whenMissing !== "wait") {
      const nextIndex = findAvailableTourIndex(steps, safeIndex + 1);
      if (nextIndex === -1) {
        finish();
        return;
      }
      setIndex(nextIndex);
      return;
    }
    // rect 相同就不写 state —— 否则每次提交都产生新对象,配合
    // 每次提交都测量会变成无限渲染。
    setProbe((prev) =>
      prev && prev.found === result.found && sameRect(prev.rect, result.rect) ? prev : result,
    );
  }, [steps, safeIndex, finish]);

  // 首帧前测量,并(通过 measureTick)在 resize / scroll 后重新测量。
  useLayoutEffect(() => {
    if (!open) return;
    syncStep();
  }, [open, syncStep, measureTick]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const remeasure = () => {
      setViewport(viewportSize());
      setMeasureTick((tick) => tick + 1);
    };
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [open]);

  // 卡片真实尺寸回填(jsdom 里为 0,保留估算值)。
  useLayoutEffect(() => {
    if (!open) return;
    const node = cardRef.current;
    if (!node || typeof node.getBoundingClientRect !== "function") return;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setCardSize((prev) =>
      prev.width === rect.width && prev.height === rect.height
        ? prev
        : { width: rect.width, height: rect.height },
    );
  }, [open, safeIndex]);

  useEffect(() => {
    if (!open) {
      finishedRef.current = false;
      reportedRef.current = null;
      setClosed(false);
    }
  }, [open]);

  // 每步只上报一次 —— 宿主传内联回调也不会被反复触发。
  useEffect(() => {
    if (!open) return;
    const current = steps[safeIndex];
    if (!current || reportedRef.current === current.id) return;
    reportedRef.current = current.id;
    onStepChangeRef.current?.(current, safeIndex);
  }, [open, steps, safeIndex]);

  const next = useCallback(() => {
    if (safeIndex >= total - 1) {
      finish();
      close();
      return;
    }
    const candidate = findAvailableTourIndex(steps, safeIndex + 1);
    if (candidate === -1) {
      finish();
      close();
      return;
    }
    setIndex(candidate);
  }, [safeIndex, total, steps, finish, close]);

  const prev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close, next, prev]);

  if (!open || total === 0 || closed || !step) return null;

  const rect = probe?.rect ?? null;
  const position = computeCardPosition(rect, step.placement, cardSize, viewport);
  const isLast = safeIndex >= total - 1;

  return (
    <>
      <TourSpotlight rect={rect} zIndex={zIndex} />
      <div
        ref={cardRef}
        className={className ? `${styles.card} ${className}` : styles.card}
        style={{ top: position.top, left: position.left, zIndex: zIndex + 1 }}
        role="dialog"
        aria-modal="false"
        aria-label={step.title}
        data-testid="tour-modal"
        data-placement={position.placement}
        data-step-id={step.id}
      >
        <div className={styles.head}>
          <span className={styles.stepCount} data-testid="tour-counter">
            {safeIndex + 1} / {total}
          </span>
          <button
            type="button"
            className={styles.close}
            onClick={close}
            aria-label="关闭漫游"
            data-testid="tour-close"
          >
            ×
          </button>
        </div>
        <div className={styles.body} data-testid="tour-body">
          {renderBody ? (
            renderBody(step, safeIndex)
          ) : (
            <>
              <h3 className={styles.title} data-testid="tour-title">
                {step.title}
              </h3>
              {step.body && (
                <p className={styles.text} data-testid="tour-text">
                  {step.body}
                </p>
              )}
            </>
          )}
        </div>
        <div className={styles.dots}>
          {steps.map((entry, i) => (
            <span
              key={entry.id}
              className={`${styles.dot} ${i === safeIndex ? styles.dotActive : ""}`}
              data-testid="tour-dot"
              data-active={i === safeIndex ? "true" : "false"}
            />
          ))}
        </div>
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => {
              finish();
              close();
            }}
            data-testid="tour-skip"
          >
            跳过漫游
          </button>
          <div className={styles.footerRight}>
            <button
              type="button"
              className={styles.ghost}
              onClick={prev}
              disabled={safeIndex === 0}
              data-testid="tour-prev"
            >
              上一步
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={next}
              data-testid="tour-next"
              data-last={isLast ? "true" : "false"}
            >
              {isLast ? "开始使用" : "下一步"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export interface TourController {
  open: boolean;
  index: number;
  steps: TourStep[];
  /** 是否已经看过(persist 在 storage 里)。 */
  hasSeen: boolean;
  start(index?: number): void;
  /** 关闭但不标记看完(用户下次启动还会看到)。 */
  setOpen(open: boolean): void;
  /** 关闭并标记看完。 */
  stop(): void;
  next(): void;
  prev(): void;
  setIndex(index: number): void;
}

export interface UseTourControllerOptions {
  steps?: TourStep[];
  storage?: TourStorageLike | null;
  /** 首次挂载时若未看过则自动打开。 */
  autoOpen?: boolean;
  onFinish?(): void;
}

/**
 * 漫游控制器 —— 宿主(或本包的 surface)用它把"漫游"接到自己的入口上:
 *
 * ```tsx
 * const tour = useTourController({ autoOpen: true });
 * return <><button onClick={() => tour.start()}>重新观看</button>
 *   <TourModal open={tour.open} steps={tour.steps} onFinish={tour.stop} onClose={tour.stop} /></>;
 * ```
 */
export function useTourController(opts: UseTourControllerOptions = {}): TourController {
  const { autoOpen = false, storage, onFinish } = opts;
  const steps = useMemo(() => opts.steps ?? DEFAULT_TOUR_STEPS, [opts.steps]);
  const [open, setOpenState] = useState(false);
  const [index, setIndex] = useState(0);
  const [hasSeen, setHasSeen] = useState(() => !shouldAutoOpenTour(storage));
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (!autoOpen || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    if (!shouldAutoOpenTour(storage)) return;
    setOpenState(true);
  }, [autoOpen, storage]);

  const start = useCallback((startIndex = 0) => {
    setIndex(Math.max(0, startIndex));
    setOpenState(true);
  }, []);

  const stop = useCallback(() => {
    setOpenState(false);
    markTourSeen(storage);
    setHasSeen(true);
    onFinish?.();
  }, [storage, onFinish]);

  return useMemo<TourController>(
    () => ({
      open,
      index,
      steps,
      hasSeen,
      start,
      stop,
      setOpen: setOpenState,
      next: () => setIndex((i) => Math.min(i + 1, Math.max(0, steps.length - 1))),
      prev: () => setIndex((i) => Math.max(0, i - 1)),
      setIndex,
    }),
    [open, index, steps, hasSeen, start, stop],
  );
}
