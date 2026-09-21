/**
 * SceneTabs — 场景切换 tabs
 * Phase 4 — 升级为 @openbuddy/ui-primitives/AnimatedTabs
 * (下划线滑动 + spring 动画，对齐 React Bits 风格)
 */
import type { HomeModeId } from "@openbuddy/ui-shared";
import { useT } from "@/lib/platform/i18n";
import { AnimatedTabs } from "@openbuddy/ui-primitives";

interface SceneTabsProps {
  activeMode: HomeModeId;
  onChange: (mode: HomeModeId) => void;
}

const MODES: readonly HomeModeId[] = ["working", "coding", "design"] as const;

export function SceneTabs({ activeMode, onChange }: SceneTabsProps) {
  // LUM-1320: `useT` IS a hook, so it has to be called at the top level of the
  // component. It used to sit inside a `useMemo(() => ({...}), [])` callback,
  // which is a Rules-of-Hooks violation: the hook it registers lands after the
  // memo's own slot, so React tears the whole workbench down with error #300
  // ("Rendered fewer hooks than expected") the moment the 灵感 / 资料库 route
  // mounts SceneTabs. Three top-level calls cost nothing here and keep the
  // hook order stable across every render.
  const working = useT("scene.modes.working");
  const coding = useT("scene.modes.coding");
  const design = useT("scene.modes.design");
  const labels: Record<HomeModeId, string> = { working, coding, design };

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
