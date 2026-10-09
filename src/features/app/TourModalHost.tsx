/**
 * TourModalHost — host 层漫游弹窗的懒加载岛。
 *
 * R64 的 host 层 tour 岛原本内联在 AppShell 里,导致
 * `@openbuddy/ui-onboarding` 的整张 index 图(TourModal/OnboardingWizard/
 * persistence graph)被静态拖进首屏 entry。把 useTourController + TourModal
 * 收进这个独立模块并让 AppShell 懒挂载后,onboarding 图只在漫游弹窗真正
 * 挂载时才加载。
 *
 * 与 ui-onboarding 注册的 <TourSurface /> 槽位的关系(见 AppShell 内 R64
 * 注释):host 岛与槽位侧 surface 走的是两套 controller —— 岛里的
 * controller 只服务 host 顶层重播入口(设置 → 关于 → 重新观看引导),
 * 不影响槽位侧的自动弹出逻辑。
 */
import { forwardRef, useImperativeHandle } from "react";
import { TourModal, useTourController } from "@openbuddy/ui-onboarding";

export interface TourModalHostHandle {
  /** 打开漫游(等价于原 AppShell 内 tour.start(0))。 */
  start: (index?: number) => void;
  /** 关闭并标记看完(等价于原 tour.stop())。 */
  stop: () => void;
}

export const TourModalHost = forwardRef<TourModalHostHandle>(function TourModalHost(_props, ref) {
  const tour = useTourController({ autoOpen: false });
  useImperativeHandle(
    ref,
    () => ({
      start: (index?: number) => tour.start(index ?? 0),
      stop: () => tour.stop(),
    }),
  );
  return <TourModal open={tour.open} steps={tour.steps} onFinish={tour.stop} onClose={tour.stop} />;
});
