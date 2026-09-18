/**
 * 生成一份「参考图同构」的专家目录 fixture(仅用于视觉/行为验证,不随包发布)。
 * 结构对齐 electron/main/agent/pi-resources/agents.ts 的 listExpertCatalog 期望:
 *   <root>/_meta/_expert_center.json  (categories + experts[])
 *   <root>/_meta/featuredScenes.json  (scenes[])
 *   <root>/<plugin>/agents/<agent>.md
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CATS = [
  ["opc", "OPC 一人公司"], ["school", "开学季"], ["tencent", "腾讯专家"],
  ["product", "产品设计"], ["tech", "技术工程"], ["invest", "金融投资"],
  ["edu", "教育学习"], ["game", "游戏空间"], ["data", "数据智能"],
  ["market", "营销增长"], ["content", "内容创作"], ["sales", "销售商务"],
  ["ops", "运营人力"], ["quality", "项目质量"], ["legal", "法务安全"], ["industry", "行业顾问"],
];

const EXPERTS = [
  { id: "teaching-design", cat: "edu", plugin: "teaching-design", agent: "lead",
    zh: "教学设计总顾问-企鹅教师助手", sub: "企鹅教师助手",
    desc: "由腾讯 SSV 与北京大学联合打造的教学设计与备课的智能统筹。智能匹配备课专家团与教法专家,规划协作顺序,统筹制定教案与课件。",
    tags: ["教学设计", "课件与动画", "教案与提问"], pos: 0 },
  { id: "senior-dev", cat: "tech", plugin: "senior-dev", agent: "lead",
    zh: "高级开发工程师", sub: "吴八哥",
    desc: "10 年以上全栈经验,精通多种语言和框架,以严谨的工程纪律交付可运行的高质量代码。",
    tags: ["全栈开发", "架构设计", "代码质量"], pos: 1 },
  { id: "meituan-helper", cat: "sales", plugin: "meituan-helper", agent: "lead",
    zh: "美团生活助手", sub: "40-20 外卖券",
    desc: "帮您一键领取美团优惠券(前 3 天必得 40-20、每日必得 38-16 外卖券),搜索附近团购美食下单。",
    tags: ["美团优惠", "团购下单", "生活服务"], pos: 2 },
  { id: "miniprogram-dev", cat: "tech", plugin: "miniprogram-dev", agent: "lead",
    zh: "微信小程序开发者", sub: "小程达",
    desc: "精通微信小程序开发框架和生态,打造流畅微信原生体验应用。",
    tags: ["小程序开发", "微信生态", "WXML开发"], pos: 3 },
  { id: "adaptive-delivery", cat: "industry", plugin: "adaptive-delivery", agent: "lead",
    zh: "自适应成果交付专家", sub: "超级合伙人",
    desc: "作为一个靠谱的 AI 合伙人,我的责任是把你的想法和素材,变成看得见、用得起的高价值产出。",
    tags: ["成果交付", "经营决策", "研究创作"], pos: 4 },
  { id: "news-dispatch", cat: "market", plugin: "news-dispatch", agent: "lead",
    zh: "资讯速递专家", sub: "数字生命卡兹克", ribbon: "特邀专家",
    desc: "一句话查到每天精选的 AI 模型/产品/行业/论文动态,自动整理成中文简报,免配置免登录。",
    tags: ["AI 资讯", "每日简报", "AI 行业动态"], pos: 5 },
  { id: "godot-engineer", cat: "game", plugin: "godot-engineer", agent: "lead",
    zh: "Godot游戏脚本工程师", sub: "节点通",
    desc: "精通 GDScript 2.0 和 Godot 4 节点架构。",
    tags: ["脚本工程", "游戏逻辑", "GDScript"], pos: 6 },
  { id: "embedded-engineer", cat: "tech", plugin: "embedded-engineer", agent: "lead",
    zh: "嵌入式固件工程师", sub: "固件通",
    desc: "精通微控制器编程,在资源受限的硬件上编写高效可靠的固件代码。",
    tags: ["嵌入式固件", "RTOS开发", "物联网硬件"], pos: 7 },
  { id: "startup-partner", cat: "opc", plugin: "startup-partner", agent: "lead",
    zh: "创业伙伴", sub: "林正刚",
    desc: "林老师分身+读书伙伴。送《创业可以学》,陪创业者读书,从读书中听痛点,痛点匹配时自然引出课程咨询。",
    tags: ["创业判断", "GTM落地", "客户心法"], pos: 8, opc: true },
  { id: "workbench-builder", cat: "product", plugin: "workbench-builder", agent: "lead",
    zh: "工作台搭建师", sub: "小台",
    desc: "为不同人群定制专属数字工作台,覆盖学习备考、职场效率、自媒体创作、宝妈育儿、生活管理五大场景。",
    tags: ["工作台搭建", "响应式网页", "个人效率工具"], pos: 9 },
  { id: "longform-editor", cat: "content", plugin: "longform-editor", agent: "lead",
    zh: "长文档写作与改稿专家", sub: "福帮手",
    desc: "把混杂文档、扫描件、图片、表格与旧稿整理为可续接、可追溯、可审阅、可交付的长文档成果。",
    tags: ["长文档工程", "多场景创作", "证据与审校"], pos: 10 },
  { id: "strategy-partner", cat: "industry", plugin: "strategy-partner", agent: "lead",
    zh: "战略咨询合伙人", sub: "战略咨询顾问",
    desc: "假设驱动的战略顾问,按需破题、取证、测算与撰写,产出证据扎实的决策报告与专业级 PPT。",
    tags: ["战略分析", "决策备忘录", "PPT/测算交付"], pos: 11 },
  { id: "fullstack-dev", cat: "tech", plugin: "fullstack-dev", agent: "lead",
    zh: "全栈开发专家", sub: "鹏城信息AI专家",
    desc: "全栈开发专家,精通前后端架构与接口集成,覆盖需求澄清、代码实现、测试验证到生产加固,一站式交付。",
    tags: ["全栈开发", "前后端连", "接口集成"], pos: 12 },
  { id: "task-organizer", cat: "ops", plugin: "task-organizer", agent: "lead",
    zh: "项目来了,先把路理清", sub: "MAI Lab并购Agent",
    desc: "材料可以乱,交易不能乱:先看清阶段、缺口和下一步,再画结构、核数字、整理报告。",
    tags: ["项目拆解", "交易结构图", "买方与资金对接"], pos: 13 },
  { id: "intern-coach", cat: "edu", plugin: "intern-coach", agent: "lead",
    zh: "实习任务与成长协作专家", sub: "实习易",
    desc: "帮助学生、社会导师、单位和教师完成实习任务,提炼可复用方法,核验个人贡献与成长证据并做好交接。",
    tags: ["实习任务", "成果收纳", "能力成长"], pos: 14 },
  { id: "python-dev", cat: "tech", plugin: "python-dev", agent: "lead",
    zh: "Python 全栈工程师", sub: "自动化与爬虫专家",
    desc: "精通后端 API、数据分析、AI 工程与自动化爬虫,坚持类型安全与工程化,交付测试齐全的生产级代码。",
    tags: ["后端开发", "数据与 AI 工程", "自动化与爬虫"], pos: 15 },
  // 专家团
  { id: "aigc-team", cat: "content", plugin: "aigc-team", agent: "lead", type: "team",
    zh: "AIGC 内容创作团", sub: "CodeBuddy Teams",
    desc: "编导 + 文案 + 分镜 + 配音四角色串行协作,从一句主题产出可直接发布的短视频脚本与素材清单。",
    tags: ["短视频", "分镜脚本", "多人协作"], pos: 0 },
  { id: "equity-team", cat: "invest", plugin: "equity-team", agent: "lead", type: "team",
    zh: "股票研究专家团", sub: "证券研究所",
    desc: "宏观 → 行业 → 个股三层递进,输出带估值锚与风险清单的研究简报。",
    tags: ["个股研究", "估值建模", "风险清单"], pos: 1 },
  { id: "legal-team", cat: "legal", plugin: "legal-team", agent: "lead", type: "team",
    zh: "合同审查专家团", sub: "法务中心",
    desc: "条款抽取 + 风险分级 + 修订建议三阶段,产出可发对方法务的红线对照表。",
    tags: ["合同审查", "风险分级", "红线对照"], pos: 2 },
];

export function buildExpertCatalogFixture(root) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "_meta"), { recursive: true });
  writeFileSync(join(root, "_meta", "_expert_center.json"), JSON.stringify({
    categories: CATS.map(([id, zh]) => ({ id, name: { zh, en: zh } })),
    experts: EXPERTS.map((e) => ({
      id: e.id,
      categoryId: e.cat,
      plugin: e.plugin,
      displayName: { zh: e.zh, en: e.zh },
      profession: { zh: e.zh, en: e.zh },
      author: { zh: e.sub, en: e.sub },
      displayDescription: { zh: e.desc, en: e.desc },
      operationalTag: e.ribbon ? { zh: e.ribbon, en: e.ribbon } : undefined,
      tags: e.tags.map((t) => ({ zh: t, en: t })),
      expertType: e.type ?? "agent",
      isOPC: e.opc === true,
      displayPosition: e.pos,
      updatedAt: `2026-01-${String((e.pos ?? 0) + 1).padStart(2, "0")}T00:00:00Z`,
    })),
  }, null, 2), "utf8");

  writeFileSync(join(root, "_meta", "featuredScenes.json"), JSON.stringify({
    scenes: [
      { id: "school", displayName: { zh: "开学季" }, expertIds: ["teaching-design", "intern-coach", "longform-editor"], image: "" },
      { id: "content", displayName: { zh: "内容创作" }, expertIds: ["longform-editor", "aigc-team", "news-dispatch"], image: "" },
      { id: "invest", displayName: { zh: "投资分析" }, expertIds: ["equity-team", "strategy-partner", "news-dispatch"], image: "" },
      { id: "legal", displayName: { zh: "法律咨询" }, expertIds: ["legal-team", "strategy-partner", "longform-editor"], image: "" },
      { id: "smb", displayName: { zh: "小微企业" }, expertIds: ["startup-partner", "meituan-helper", "strategy-partner"], image: "" },
      { id: "ecom", displayName: { zh: "电商运营" }, expertIds: ["meituan-helper", "miniprogram-dev", "aigc-team"], image: "" },
      { id: "data", displayName: { zh: "数据分析" }, expertIds: ["python-dev", "adaptive-delivery", "fullstack-dev"], image: "" },
      { id: "product", displayName: { zh: "产品设计" }, expertIds: ["workbench-builder", "miniprogram-dev", "fullstack-dev"], image: "" },
      { id: "eng", displayName: { zh: "工程开发" }, expertIds: ["senior-dev", "embedded-engineer", "godot-engineer"], image: "" },
    ],
  }, null, 2), "utf8");

  for (const e of EXPERTS) {
    mkdirSync(join(root, e.plugin, "agents"), { recursive: true });
    mkdirSync(join(root, e.plugin, ".aily-plugin"), { recursive: true });
    writeFileSync(join(root, e.plugin, ".aily-plugin", "plugin.json"), JSON.stringify({
      name: e.plugin, displayName: { zh: e.zh, en: e.zh }, version: "1.0.0",
    }, null, 2), "utf8");
    writeFileSync(join(root, e.plugin, "agents", `${e.agent}.md`),
      `---\nname: ${e.zh}\ndescription: ${e.desc}\n---\n\n你是 ${e.zh}。${e.desc}\n`, "utf8");
  }
  return { root, experts: EXPERTS.length, categories: CATS.length };
}
