/**
 * src/features/app/RoutePending.tsx
 *
 * Phase 1 — 微内核激活
 * Suspense 边界回退组件。当 ChatSurface / SettingsPage / PullRequestsPage 等
 * lazy 加载时渲染，避免阻塞主 UI。
 *
 * 注意：保持轻量；动画用 CSS 而非 JS，避免重渲染链。
 */
import { memo } from "react";

export const RoutePending = memo(function RoutePending({
  label = "加载中",
}: {
  label?: string;
}) {
  return (
    <div
      className="route-pending"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="route-pending__dot" aria-hidden />
      <span className="route-pending__label">{label}</span>
    </div>
  );
});
