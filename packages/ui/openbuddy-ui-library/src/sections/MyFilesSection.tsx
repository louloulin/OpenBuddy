/**
 * 我的文件分区 —— 直接复用 `@openbuddy/ui-files` 的 `MyFilesPanel`。
 *
 * 这里不做任何包装逻辑:面板自带标题 / 标签页 / 筛选,分区只负责把它接到
 * 资料库的 props 上。同一份面板在「更多 → 我的文件」路由下逐字一致。
 */
import { MyFilesPanel } from "@openbuddy/ui-files";
import { defineLibrarySection, type LibrarySectionProps } from "../section-contract";
import { LIBRARY_SECTION_IDS } from "../section-contract";

export const MyFilesSection = defineLibrarySection(
  {
    id: LIBRARY_SECTION_IDS.files,
    label: "我的文件",
    icon: "files",
    order: 10,
    hint: "任务成果与本地文件",
  },
  function MyFilesSection({ cwd, onToast }: LibrarySectionProps) {
    return <MyFilesPanel cwd={cwd} onToast={onToast} />;
  },
);
