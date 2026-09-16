/**
 * ExpertsGrid — Phase 7 专家·技能·连接器 9 卡 3 列网格
 *
 * 参考 WorkBuddy v5.1.7 实测：左侧 tab 切换到「专家·技能·连接器」时,
 * 顶部展示 9 个 expert 卡片(3 列 CSS grid),每张卡片含:
 *   - 头像(圆形占位)
 *   - 名称(strong)
 *   - 角色描述(12px 灰色)
 *   - 3 个类别 chip
 *   - 「召唤」button
 *
 * 这里硬编码 9 个 expert 与 WorkBuddy 一致,后续如需数据驱动可改为
 * 通过 `experts` prop 注入(参考 D4 决策)。
 */

export interface ExpertCardModel {
  id: string;
  name: string;
  role: string;
  /** 类别 chip,固定 3 个;不足 3 个时填空字符以便对齐。 */
  chips: [string, string, string];
}

const DEFAULT_EXPERTS: readonly ExpertCardModel[] = [
  { id: "entrepreneurship-coach", name: "EntrepreneurshipCoach", role: "创业教练,从 0→1 拆解商业假设", chips: ["创业", "教练", "商业"] },
  { id: "data-analytics-reporter", name: "DataAnalyticsReporter", role: "数据分析师,自动化报表与异常检测", chips: ["数据分析", "报表", "可视化"] },
  { id: "long-manuscript-expert", name: "LongManuscriptExpert", role: "长文写手,深度文章与白皮书结构化输出", chips: ["写作", "长文", "结构化"] },
  { id: "ui-designer", name: "UiDesigner", role: "界面设计师,生成 token + 组件规范", chips: ["设计", "UI", "规范"] },
  { id: "frontend-developer", name: "FrontendDeveloper", role: "前端工程师,组件库与可访问性重构", chips: ["前端", "工程", "可访问性"] },
  { id: "xiaohongshu-operations", name: "XiaohongshuOperationsExpert", role: "小红书运营,爆款选题 + 笔记脚本", chips: ["运营", "小红书", "选题"] },
  { id: "equity-research", name: "EquityResearch", role: "权益研究,财报 + 估值 + 行业对比", chips: ["研究", "权益", "估值"] },
  { id: "wechat-official-account", name: "WechatOfficialAccountExpert", role: "公众号编辑,排版与分发优化", chips: ["公众号", "编辑", "分发"] },
  { id: "game-designer", name: "GameDesigner", role: "游戏设计师,系统拆解 + 数值平衡", chips: ["游戏", "设计", "数值"] },
];

export interface ExpertsGridProps {
  experts?: readonly ExpertCardModel[];
  onSummon?: (id: string) => void;
}

export function ExpertsGrid({ experts = DEFAULT_EXPERTS, onSummon }: ExpertsGridProps) {
  return (
    <section className="experts-grid" aria-label="推荐专家(WorkBuddy 风格 9 卡 3 列)">
      {experts.map((expert) => (
        <article key={expert.id} className="expert-card" data-expert-id={expert.id}>
          <div className="expert-card__avatar" aria-hidden="true">
            <span className="expert-card__avatar-initial">{expert.name.slice(0, 1).toUpperCase()}</span>
          </div>
          <h4 className="expert-card__name">{expert.name}</h4>
          <p className="expert-card__role">{expert.role}</p>
          <div className="expert-card__chips">
            {expert.chips.map((chip) => (
              <span key={chip} className="expert-card__chip">
                {chip}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="expert-card__summon"
            onClick={() => onSummon?.(expert.id)}
          >
            召唤
          </button>
        </article>
      ))}
    </section>
  );
}
