/**
 * 灵感分区 —— 把「灵感」这个一直空着的入口变成真内容,且**零新数据**。
 *
 * 复用 `@openbuddy/ui-home` 的两个既有组件:
 *   - `SceneTabs`:三个场景(日常办公 / 代码开发 / 设计创意)的切换条;
 *   - `PracticeCases`:场景下的能力分类 + 模板卡片(点击即用该 prompt 起会话)。
 *
 * 数据来自 `@openbuddy/ui-shared` 的 `HOME_MODES`(首页同一份),
 * 所以首页与灵感页永远讲同一套话术,不会各自漂移。
 */
import { useState } from "react";
import { PracticeCases, SceneTabs } from "@openbuddy/ui-home";
import type { HomeModeId } from "@openbuddy/ui-shared";
import {
  LIBRARY_SECTION_IDS,
  defineLibrarySection,
  type LibrarySectionProps,
} from "../section-contract";

export const InspirationSection = defineLibrarySection(
  {
    id: LIBRARY_SECTION_IDS.inspiration,
    label: "灵感",
    icon: "inspiration",
    order: 40,
    hint: "从模板开始你的第一步",
  },
  function InspirationSection({ onLaunch, onToast }: LibrarySectionProps) {
    const [mode, setMode] = useState<HomeModeId>("working");
    return (
      <div data-testid="library-inspiration">
        <SceneTabs activeMode={mode} onChange={setMode} />
        <PracticeCases
          activeMode={mode}
          onSelectTemplate={(prompt) => {
            if (onLaunch) onLaunch(prompt);
            else onToast?.("当前入口不支持直接发起会话,请从首页开始。");
          }}
        />
      </div>
    );
  },
);
