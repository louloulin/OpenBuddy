/**
 * SceneTabs — 场景切换 tabs
 * Phase 4 — 升级为 @openbuddy/ui-primitives/AnimatedTabs
 * (下划线滑动 + spring 动画，对齐 React Bits 风格)
 */
import { useMemo } from "react";
import type { HomeModeId } from "@openbuddy/ui-shared";
import { useT } from "@/lib/platform/i18n";
import { AnimatedTabs } from "@openbuddy/ui-primitives";

interface SceneTabsProps {
  activeMode: HomeModeId;
  onChange: (mode: HomeModeId) => void;
}

const MODES: readonly HomeModeId[] = ["working", "coding", "design"] as const;

export function SceneTabs({ activeMode, onChange }: SceneTabsProps) {
  // useT 是 hook,必须在组件顶层调用。之前它们被塞进 useMemo 的回调里:首次渲染
  // 会记进 hook 列表,命中缓存的那次渲染又不会 → 违反 Hooks 规则,重渲染时抛
  // "Rendered fewer hooks than expected"(2026-10-12 真实启动复查时由资料库
  // Inspiration 分区复用 SceneTabs 暴露:LibraryPage 测试直接崩在这一层)。
  const working = useT("scene.modes.working");
  const coding = useT("scene.modes.coding");
  const design = useT("scene.modes.design");
  const labels = useMemo(() => ({ working, coding, design }), [working, coding, design]);

  return (
    <div className="scene-tabs-wrap">
      <AnimatedTabs
        items={MODES.map((mode) => ({
          id: mode,
          label: labels[mode],
        }))}
        activeId={activeMode}
        onChange={onChange}
      />
    </div>
  );
}
