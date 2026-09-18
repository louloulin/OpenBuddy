/** 知识库分区 —— 复用 `@openbuddy/ui-files` 的 `KnowledgeBasePanel`。 */
import { KnowledgeBasePanel } from "@openbuddy/ui-files";
import {
  LIBRARY_SECTION_IDS,
  defineLibrarySection,
  type LibrarySectionProps,
} from "../section-contract";

export const KnowledgeSection = defineLibrarySection(
  {
    id: LIBRARY_SECTION_IDS.knowledge,
    label: "知识库",
    icon: "knowledge",
    order: 20,
    hint: "可插拔的本地知识源",
  },
  function KnowledgeSection({ onOpenKnowledge, onToast }: LibrarySectionProps) {
    return <KnowledgeBasePanel onOpen={onOpenKnowledge} onToast={onToast} />;
  },
);
