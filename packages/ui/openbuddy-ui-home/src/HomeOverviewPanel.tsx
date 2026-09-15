/**
 * HomeOverviewPanel — Phase 7 右栏「概览 / 产物 / 待办」
 *
 * WorkBuddy 实测右侧面板含「概览 / 产物」两个标签。OpenBuddy 实现：
 *   - 「最近活动」section（3 行 demo 数据）
 *   - 「待办」section（3 条 todo）
 *   - 「常用工具」section（3 个 chip：📝 会议纪要 / 🚀 GTM / 📊 投资组合）
 *
 * 与 Phase 1-4 的 slot 系统对接：内容数据可通过 home.overview.activity /
 * home.overview.todo / home.overview.tools 三个 slot 注入；本组件提供 fallback 默认值。
 */
const DEFAULT_ACTIVITY = [
  "📝 完成「会议纪要」模板 2 小时前",
  "🚀 创建 GTM 发布计划项目 昨天",
  "📊 投资组合再平衡仪表盘 已生成",
];

const DEFAULT_TODO = [
  { id: "t1", text: "回复 OpenBuddy 关于集成问题", done: false },
  { id: "t2", text: "导出代码片段为 Markdown", done: false },
  { id: "t3", text: "邀请团队成员加入工作空间", done: true },
];

const DEFAULT_TOOLS = ["📝 会议纪要", "🚀 GTM 计划", "📊 投资组合"];

export interface HomeOverviewPanelProps {
  activity?: string[];
  todo?: { id: string; text: string; done: boolean }[];
  tools?: string[];
}

export function HomeOverviewPanel({
  activity = DEFAULT_ACTIVITY,
  todo = DEFAULT_TODO,
  tools = DEFAULT_TOOLS,
}: HomeOverviewPanelProps) {
  return (
    <aside className="home-overview-panel" aria-label="工作台概览">
      <section className="home-overview-section home-overview-section--activity">
        <h3 className="home-overview-section__title">📰 最近活动</h3>
        <ul className="home-overview-section__list">
          {activity.map((line, i) => (
            <li key={i} className="home-overview-section__item">
              {line}
            </li>
          ))}
        </ul>
      </section>
      <section className="home-overview-section home-overview-section--todo">
        <h3 className="home-overview-section__title">✅ 待办</h3>
        <ul className="home-overview-section__list">
          {todo.map((item) => (
            <li
              key={item.id}
              className={`home-overview-section__item ${item.done ? "is-done" : ""}`}
            >
              <span aria-hidden="true">{item.done ? "☑" : "☐"}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="home-overview-section home-overview-section--tools">
        <h3 className="home-overview-section__title">⚡ 常用工具</h3>
        <div className="home-overview-section__chips">
          {tools.map((chip) => (
            <span key={chip} className="home-overview-section__chip">
              {chip}
            </span>
          ))}
        </div>
      </section>
    </aside>
  );
}
