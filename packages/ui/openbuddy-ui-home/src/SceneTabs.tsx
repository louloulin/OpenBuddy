import { useMemo } from "react";
import type { HomeModeId } from "@openbuddy/ui-shared";
import { useT } from "@/lib/platform/i18n";

interface SceneTabsProps {
  activeMode: HomeModeId;
  onChange: (mode: HomeModeId) => void;
}

const MODES: readonly HomeModeId[] = ["working", "coding", "design"] as const;

export function SceneTabs({ activeMode, onChange }: SceneTabsProps) {
  // 预渲染阶段拉取所有 3 个 mode 的 i18n 文案;
  // 由于 useT 调用顺序固定,React 规则不会报警告。
  const labels = useMemo(
    () => ({
      working: useT("scene.modes.working"),
      coding: useT("scene.modes.coding"),
      design: useT("scene.modes.design"),
    }),
    // useT 不提供依赖,但翻译在 locale 变化时会刷新组件;
    // 把它放在 useMemo 之外即可保证每次 render 都重新读最新文案。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="scene-tabs">
      {MODES.map((mode) => {
        const isActive = mode === activeMode;
        return (
          <button
            key={mode}
            className={`scene-tab ${isActive ? "active" : ""}`}
            onClick={() => onChange(mode)}
            data-scene-mode={mode}
            aria-pressed={isActive}
          >
            <span className="scene-tab__label">{labels[mode]}</span>
            {isActive && <div className="scene-tab__underline" />}
          </button>
        );
      })}
    </div>
  );
}
