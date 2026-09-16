/** 云存储分区 —— 复用 `@openbuddy/ui-files` 的 `CloudStoragePanel`。 */
import { CloudStoragePanel } from "@openbuddy/ui-files";
import {
  LIBRARY_SECTION_IDS,
  defineLibrarySection,
  type LibrarySectionProps,
} from "../section-contract";

export const CloudStorageSection = defineLibrarySection(
  {
    id: LIBRARY_SECTION_IDS.cloud,
    label: "云存储",
    icon: "cloud",
    order: 30,
    hint: "本地目录 / 对象存储源",
  },
  function CloudStorageSection({ onToast }: LibrarySectionProps) {
    return <CloudStoragePanel onToast={onToast} />;
  },
);
