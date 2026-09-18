/** 资料库内置分区 —— 注册顺序即 apply 顺序,导航列顺序由 meta.order 决定。 */
export { MyFilesSection } from "./MyFilesSection";
export { KnowledgeSection } from "./KnowledgeSection";
export { CloudStorageSection } from "./CloudStorageSection";
export { InspirationSection } from "./InspirationSection";

import { MyFilesSection } from "./MyFilesSection";
import { KnowledgeSection } from "./KnowledgeSection";
import { CloudStorageSection } from "./CloudStorageSection";
import { InspirationSection } from "./InspirationSection";
import type { LibrarySectionComponent } from "../section-contract";

export const LIBRARY_SECTIONS: readonly LibrarySectionComponent[] = [
  MyFilesSection,
  KnowledgeSection,
  CloudStorageSection,
  InspirationSection,
];
