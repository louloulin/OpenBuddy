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
  const labels = useMemo(
    () => ({
      working: useT("scene.modes.working"),
      coding: useT("scene.modes.coding"),
      design: useT("scene.modes.design"),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
