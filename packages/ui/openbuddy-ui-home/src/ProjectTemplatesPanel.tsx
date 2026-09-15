/**
 * ProjectTemplatesPanel — Phase 7 项目模板入口
 *
 * WorkBuddy 实测 Tab 3「项目」含「从模版创建」+ 5 个项目模板：
 *   - 产品需求全流程
 *   - 市场调研与竞品分析
 *   - 团队知识库
 *   - 项目交付
 *   - Bug 跟踪/测试验收
 *
 * 每张卡片含标题 + 描述 + 1-2 个 chip + 「使用模板」button。
 */

const TEMPLATES = [
  {
    id: "product-requirements",
    title: "产品需求全流程",
    description: "从用户访谈 → 需求梳理 → PRD → 评审 → 跟踪，全流程模板。",
    chips: ["需求", "PRD"],
  },
  {
    id: "market-research",
    title: "市场调研与竞品分析",
    description: "竞品收集 → 卖点对比 → 差异化分析 → 战略建议。",
    chips: ["调研", "竞品"],
  },
  {
    id: "team-knowledge",
    title: "团队知识库",
    description: "沉淀团队经验、规范、决策记录，支持全文搜索。",
    chips: ["知识", "沉淀"],
  },
  {
    id: "project-delivery",
    title: "项目交付",
    description: "里程碑管理 + 交付物清单 + 验收流程。",
    chips: ["交付", "里程碑"],
  },
  {
    id: "bug-tracking",
    title: "Bug 跟踪/测试验收",
    description: "Bug 录入 → 复现 → 修复 → 回归 → 验收 闭环。",
    chips: ["Bug", "测试"],
  },
];

export interface ProjectTemplatesPanelProps {
  templates?: typeof TEMPLATES;
  onUseTemplate?: (id: string) => void;
}

export function ProjectTemplatesPanel({
  templates = TEMPLATES,
  onUseTemplate,
}: ProjectTemplatesPanelProps) {
  return (
    <div className="project-templates-panel" aria-label="项目模板">
      <header className="project-templates-panel__header">
        <h2 className="project-templates-panel__title">📦 从模版创建</h2>
        <p className="project-templates-panel__subtitle">5 个开箱即用的项目模板</p>
      </header>
      <div className="project-templates-panel__grid">
        {templates.map((tpl) => (
          <article key={tpl.id} className="project-template-card" data-template-id={tpl.id}>
            <h3 className="project-template-card__title">{tpl.title}</h3>
            <p className="project-template-card__description">{tpl.description}</p>
            <div className="project-template-card__chips">
              {tpl.chips.map((chip) => (
                <span key={chip} className="project-template-card__chip">
                  {chip}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="project-template-card__action"
              onClick={() => onUseTemplate?.(tpl.id)}
            >
              使用模板
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
