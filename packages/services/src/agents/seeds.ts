import type { ExpertCategoryInfo, ExpertDraft, ExpertSceneInfo } from "@openbuddy/protocol/experts";
import { WORK_SEEDS } from "./seeds-work.js";
import { KNOWLEDGE_SEEDS } from "./seeds-knowledge.js";

/**
 * The built-in expert catalog (20261116-pii W2.1, §9-D2): self-written seeds shipped as code, so
 * no packaging change is needed. Users add their own experts in `<pi>/agents` or point the catalog
 * at their own directories; nothing from other products is bundled.
 */
export const EXPERT_CATEGORIES: ExpertCategoryInfo[] = [
  { id: "office", label: "日常办公", emoji: "🗂️" },
  { id: "writing", label: "写作润色", emoji: "✍️" },
  { id: "data", label: "数据分析", emoji: "📊" },
  { id: "dev", label: "代码开发", emoji: "💻" },
  { id: "research", label: "深度调研", emoji: "🔭" },
  { id: "language", label: "语言翻译", emoji: "🌐" },
  { id: "product", label: "产品方案", emoji: "🧭" },
  { id: "learning", label: "学习成长", emoji: "🎓" },
  { id: "custom", label: "其他", emoji: "✨" },
];

export const EXPERT_SCENES: ExpertSceneInfo[] = [
  {
    id: "office-day",
    title: "高效办公",
    description: "邮件、纪要、汇报一站搞定",
    expertIds: ["office-assistant", "meeting-minutes", "presentation-planner"],
    from: "#dbe8ff",
    to: "#eef3fb",
  },
  {
    id: "content",
    title: "内容创作",
    description: "从选题到成稿再到传播",
    expertIds: ["copywriter", "writing-polisher", "translator"],
    from: "#ffe1e6",
    to: "#fff0e3",
  },
  {
    id: "insight",
    title: "数据与研究",
    description: "让结论有数据、有出处",
    expertIds: ["data-analyst", "deep-researcher", "product-strategist"],
    from: "#d9f2e7",
    to: "#eef7f2",
  },
  {
    id: "engineering",
    title: "工程开发",
    description: "写代码、查问题、做评审",
    expertIds: ["code-assistant", "code-reviewer", "learning-tutor"],
    from: "#e6e1f8",
    to: "#f1eefb",
  },
];

/** Every built-in expert, ids included. */
export const SEED_EXPERTS: ExpertDraft[] = [...WORK_SEEDS, ...KNOWLEDGE_SEEDS];
