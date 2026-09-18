/**
 * expert-starter/catalog — 内置「起步专家」目录的数据定义。
 *
 * 背景(为什么需要这份内置目录):
 *   专家页此前**完全**依赖外部 WorkBuddy 数据目录(`_meta/_expert_center.json`)。
 *   开源用户第一次打开「专家·技能·连接器」看到的是一张空状态卡 +
 *   "请选择包含 _meta/_expert_center.json 的 WorkBuddy 数据目录(如 E:\Pi\agents)" ——
 *   一个 Windows 路径。这既不是开源产品该有的首启体验,也让精选场景 / 专家团
 *   这两个页面结构永远没有数据可渲染。
 *
 * 设计:
 *   - 这份目录是**只读模板**。首次启动时物化到 `<agentHome>/experts/`,之后
 *     用户/第三方导入的专家都落在同一个 root 下的独立 plugin 目录里,
 *     内置条目与用户条目共用一套 manifest 契约。
 *   - 每个条目都自带一个真实的 `agents/<agent>.md`(可被召唤、可被 pi 子代理
 *     发现),不是纯展示占位。
 *   - 与 WorkBuddy 导入走同一条 `_meta/_expert_center.json` 线格式,所以
 *     `listExpertCatalog()` 不需要为内置条目写第二条解析路径。
 *   - 内置条目的 `plugin` 名统一加 `starter-` 前缀,避免与用户导入的插件重名;
 *     `builtin: true` 标记让 UI 可以区分"内置"与"我的"。
 */

/** 与 WorkBuddy manifest 同构的本地化字符串。 */
interface Localized {
  zh: string;
  en: string;
}

interface StarterMember {
  /** agent 文件名 stem,也是 pi-subagents 的 runtime agent name(必须 slug)。 */
  id: string;
  /** 人类可读的成员名(中文显示用,frontmatter 不必带)。 */
  title: Localized;
  /** 该成员的系统提示词。 */
  prompt: string;
  /** 暴露给父会话的简短描述(用于 advertise 列表)。 */
  role: Localized;
  /** pi-subagents frontmatter 的 tools 字段;省略则 inherit。 */
  tools?: string;
}

interface StarterExpert {
  /** manifest 里的 id(稳定,用作 featuredScenes 的 expertIds)。 */
  id: string;
  plugin: string;
  agent: string;
  cat: string;
  title: Localized;
  author: Localized;
  desc: Localized;
  tags: Localized[];
  type: "agent" | "team";
  ribbon?: Localized;
  opc?: boolean;
  pos: number;
  /**
   * Optional pi.dev npm-style slug (e.g. "@openbuddy/code-reviewer"). When set,
   * the expert card surfaces a small "在 pi.dev 查看" link pointing to
   * https://pi.dev/packages/<slug>. Built-in starters ship without a slug so
   * the UI stays quiet by default; the slug is only populated for entries
   * that have an actual upstream pi.dev counterpart to bridge to.
   */
  piDevSlug?: string;
  /** 写入 agents/<agent>.md 的系统提示词主体。 */
  prompt: string;
  /**
   * Team members — each becomes a real `agents/<member>.md` file in the plugin
   * dir, so `expertsLinkAgents()` links them into `<agentHome>/agents/` and
   * pi-subagents can dispatch to them by name. The lead prompt should
   * mention `subagent({ agent: "<member.id>" })` so the model actually
   * delegates. Members stay optional for single-agent entries.
   */
  members?: readonly StarterMember[];
}

interface StarterCategory {
  id: string;
  zh: string;
  en: string;
}

export const STARTER_CATEGORIES: readonly StarterCategory[] = [
  { id: "engineering", zh: "工程开发", en: "Engineering" },
  { id: "content", zh: "内容创作", en: "Content" },
  { id: "research", zh: "研究分析", en: "Research" },
  { id: "office", zh: "办公效能", en: "Office" },
  { id: "growth", zh: "经营增长", en: "Growth" },
];

const P = {
  engineer:
    "你是一名资深全栈工程师。工作纪律:\n" +
    "1. 先读代码再改代码 —— 用搜索/阅读确认现状,不做基于猜测的修改。\n" +
    "2. 改动最小化,只解决被要求的问题,不顺带重构无关代码。\n" +
    "3. 改完必须验证:跑相关测试 / 类型检查 / 构建,把真实输出作为证据。\n" +
    "4. 报告时区分「已验证」与「未验证」,不把没跑过的结论说成通过。\n" +
    "输出用中文,先给结论,再给证据(命令 + 输出摘要),最后列出未完成项。",
  reviewer:
    "你是一名严格的代码审查者。只报告能指出具体位置、且能说明后果的问题:\n" +
    "- 每条结论给出 `文件:行` 与触发条件;\n" +
    "- 区分「必然出错」与「可能出错」,不堆砌风格意见;\n" +
    "- 如果没发现问题,直接说没发现,不要为凑数编造。\n" +
    "按严重度排序输出,最高三条优先。",
  writer:
    "你是一名中文长文档写作与改稿专家。原则:\n" +
    "1. 先确认读者与目的,再动笔;不清楚就先问一句,不硬写。\n" +
    "2. 事实与观点分开表述;引用到的数据必须标出来源,没有来源就标注「待核实」。\n" +
    "3. 结构先于辞藻:先给大纲,得到确认后再展开。\n" +
    "4. 改稿时保留原意,只动表达;每处实质修改说明理由。\n" +
    "交付物默认 Markdown,必要时补一份摘要。",
  analyst:
    "你是一名研究分析顾问。工作方式:\n" +
    "1. 结论先行,再给支撑;每条支撑都要能追溯到具体数据或材料。\n" +
    "2. 明确区分「已知事实」「推算」「假设」三类信息。\n" +
    "3. 主动指出反面证据与结论的边界条件,不做单边论证。\n" +
    "4. 数据不足时说明缺什么、怎么补,而不是用模糊措辞糊过去。\n" +
    "输出结构:结论 / 依据 / 风险与不确定性 / 建议下一步。",
  ops:
    "你是一名办公效能助手。目标是把杂乱的输入整理成可直接使用的产出。\n" +
    "1. 先归纳用户真正要的交付物(表格 / 清单 / 邮件 / 汇报),一句话确认。\n" +
    "2. 输出结构化、可直接复制使用,不要写「以下是…」这类开场。\n" +
    "3. 涉及日期、金额、人名时逐项核对,不确定的标出来。\n" +
    "4. 收尾给一句「还差什么才能直接用」的提示。",
};

export const STARTER_EXPERTS: readonly StarterExpert[] = [
  {
    id: "starter-software-engineer",
    plugin: "starter-software-engineer",
    agent: "lead",
    cat: "engineering",
    title: { zh: "软件工程师", en: "Software Engineer" },
    author: { zh: "OpenBuddy 内置", en: "OpenBuddy built-in" },
    desc: {
      zh: "从读代码、定位问题到改完并跑通验证的完整闭环。改前先确认现状,改后给可复现的证据。",
      en: "A full loop from reading the code and locating the problem to shipping a verified fix. Confirm the current state first, then show reproducible evidence.",
    },
    tags: [
      { zh: "功能开发", en: "Feature work" },
      { zh: "问题修复", en: "Bug fix" },
      { zh: "真实验证", en: "Verification" },
    ],
    type: "agent",
    pos: 0,
    prompt: P.engineer,
  },
  {
    id: "starter-code-reviewer",
    plugin: "starter-code-reviewer",
    agent: "lead",
    cat: "engineering",
    title: { zh: "代码审查专家", en: "Code Reviewer" },
    author: { zh: "OpenBuddy 内置", en: "OpenBuddy built-in" },
    desc: {
      zh: "只报可定位、可复现的风险,按严重度排序。不堆风格意见,没发现问题就说没发现。",
      en: "Reports only locatable, reproducible risks, ordered by severity. No style padding — if nothing is wrong, it says so.",
    },
    tags: [
      { zh: "代码审查", en: "Review" },
      { zh: "风险定位", en: "Risk" },
      { zh: "回归防护", en: "Regression" },
    ],
    type: "agent",
    pos: 1,
    prompt: P.reviewer,
  },
  {
    id: "starter-longform-writer",
    plugin: "starter-longform-writer",
    agent: "lead",
    cat: "content",
    title: { zh: "长文档写作专家", en: "Long-form Writer" },
    author: { zh: "OpenBuddy 内置", en: "OpenBuddy built-in" },
    desc: {
      zh: "把零散材料整理成结构清晰、来源可追溯、可以直接交付的长文档与改稿。",
      en: "Turns scattered material into well-structured, source-traceable, delivery-ready long documents and revisions.",
    },
    tags: [
      { zh: "长文写作", en: "Long-form" },
      { zh: "改稿润色", en: "Editing" },
      { zh: "来源标注", en: "Citations" },
    ],
    type: "agent",
    pos: 2,
    prompt: P.writer,
  },
  {
    id: "starter-research-analyst",
    plugin: "starter-research-analyst",
    agent: "lead",
    cat: "research",
    title: { zh: "研究分析顾问", en: "Research Analyst" },
    author: { zh: "OpenBuddy 内置", en: "OpenBuddy built-in" },
    desc: {
      zh: "结论先行、证据可追溯,区分事实/推算/假设,并主动给出反面证据与边界条件。",
      en: "Conclusion first, evidence traceable. Separates fact, inference and assumption, and proactively surfaces counter-evidence and boundary conditions.",
    },
    tags: [
      { zh: "研究分析", en: "Research" },
      { zh: "证据链", en: "Evidence" },
      { zh: "风险边界", en: "Risk" },
    ],
    type: "agent",
    pos: 3,
    prompt: P.analyst,
  },
  {
    id: "starter-office-copilot",
    plugin: "starter-office-copilot",
    agent: "lead",
    cat: "office",
    title: { zh: "办公效能助手", en: "Office Copilot" },
    author: { zh: "OpenBuddy 内置", en: "OpenBuddy built-in" },
    desc: {
      zh: "把杂乱输入整理成可直接使用的表格、清单、邮件与汇报,并提示还差什么。",
      en: "Turns messy input into ready-to-use tables, checklists, emails and reports, and flags what is still missing.",
    },
    tags: [
      { zh: "文档整理", en: "Docs" },
      { zh: "表格清单", en: "Tables" },
      { zh: "汇报邮件", en: "Reports" },
    ],
    type: "agent",
    pos: 4,
    prompt: P.ops,
  },
  {
    id: "starter-delivery-team",
    plugin: "starter-delivery-team",
    agent: "lead",
    cat: "growth",
    title: { zh: "成果交付专家团", en: "Delivery Team" },
    author: { zh: "OpenBuddy 内置", en: "OpenBuddy built-in" },
    desc: {
      zh: "澄清需求 → 产出草稿 → 交叉审查 → 交付定稿的四段式协作,适合需要多轮打磨的交付物。",
      en: "A four-stage collaboration — clarify, draft, cross-review, finalize — for deliverables that need multiple rounds of polish.",
    },
    tags: [
      { zh: "多角色协作", en: "Multi-role" },
      { zh: "成果交付", en: "Delivery" },
      { zh: "质量把关", en: "Quality" },
    ],
    type: "team",
    pos: 5,
    ribbon: { zh: "内置专家团", en: "Built-in team" },
    // Lead prompt now drives real delegation through pi-subagents'
    // `subagent` tool — no hand-rolled coordinator semantics.
    prompt:
      "你是一支交付专家团的协调者。团队按四段推进,每段都要留下可检查的产物,并通过 pi-subagents 的 `subagent` 工具真实派发:\n" +
      "1. **澄清** — 调用 `subagent({ agent: \"starter-clarifier\", task: <需求复述> })`,把澄清稿写回对话。\n" +
      "2. **起草** — 调用 `subagent({ agent: \"starter-drafter\", task: <第一版需求> })`,收集完整草稿。\n" +
      "3. **审查** — 调用 `subagent({ agent: \"starter-reviewer\", task: <草稿全文> })`,只采纳 reviewer 标注为「事实错误 / 逻辑漏洞 / 缺失项」的内容。\n" +
      "4. **定稿** — 调用 `subagent({ agent: \"starter-finalizer\", task: <修订清单> })`,只保留经得起检查的结论,并把仍未核实之处显式标注。\n" +
      "每段结束时,用一句话告诉用户「现在处于哪个阶段、下一步是什么」。不要替成员直接产出他们的内容。",
    members: [
      {
        id: "starter-clarifier",
        title: { zh: "需求澄清员", en: "Clarifier" },
        role: { zh: "复述需求、列出不确定项、对齐用户", en: "Restate the brief and surface unknowns" },
        prompt:
          "你是需求澄清员。任务是把含糊的用户输入变成可执行的需求复述:\n" +
          "1. 用一段话复述用户的真实目标、产出物形态、关键约束。\n" +
          "2. 列出**至多 5 条**不确定项,每条都要给出推荐默认。\n" +
          "3. 输出一份「可立即开工的版本」,作为下一阶段的输入。\n" +
          "只产出澄清稿,不进入起草。",
      },
      {
        id: "starter-drafter",
        title: { zh: "起草员", en: "Drafter" },
        role: { zh: "产出第一版完整成果", en: "Produce a complete first pass" },
        prompt:
          "你是成果起草员。任务是把澄清稿变成第一版完整成果:\n" +
          "1. 先给大纲,确认结构后再展开(除非澄清稿已要求直接产出)。\n" +
          "2. 宁可粗糙也要**完整** —— 不留「待补充」空段。\n" +
          "3. 引用到的数据必须标出来源,无来源则标「待核实」。\n" +
          "4. 收尾给一句「还有哪些问题需要在审查阶段被检查」。",
      },
      {
        id: "starter-reviewer",
        title: { zh: "审查员", en: "Reviewer" },
        role: { zh: "只报可定位、可复现的问题", en: "Report only locatable, reproducible issues" },
        prompt:
          "你是审查员。任务是对草稿做独立审查,只输出能指明位置、可复现的问题:\n" +
          "1. 每条结论给出 `段落 / 行号`(找不到就说明「全文级」)与触发条件。\n" +
          "2. 严格分「事实错误 / 逻辑漏洞 / 缺失项」三类,**不堆风格意见**。\n" +
          "3. 没发现问题就直接说没发现,不要为凑数编造。\n" +
          "按严重度排序,最高 8 条优先。",
      },
      {
        id: "starter-finalizer",
        title: { zh: "定稿员", en: "Finalizer" },
        role: { zh: "只保留经得起检查的内容,标注未核实项", en: "Keep only defensible content, flag unverified items" },
        prompt:
          "你是定稿员。任务是把修订清单转成终稿:\n" +
          "1. 只采纳 reviewer 标注为「事实错误 / 逻辑漏洞 / 缺失项」且有定位的修订。\n" +
          "2. 仍未核实之处(数据来源、引用、时间、人物、金额)显式标注「待核实: …」。\n" +
          "3. 收尾给一段「该交付物的局限与下一步建议」。",
      },
    ],
  },
];

/** 精选场景(内置版)。全部引用上面的 starter id,保证一定解析得出来。 */
export const STARTER_SCENES: readonly {
  id: string;
  zh: string;
  en: string;
  expertIds: readonly string[];
}[] = [
  { id: "starter-engineering", zh: "工程开发", en: "Engineering", expertIds: ["starter-software-engineer", "starter-code-reviewer"] },
  { id: "starter-content", zh: "内容创作", en: "Content", expertIds: ["starter-longform-writer", "starter-delivery-team"] },
  { id: "starter-research", zh: "研究分析", en: "Research", expertIds: ["starter-research-analyst", "starter-longform-writer"] },
  { id: "starter-office", zh: "办公效能", en: "Office", expertIds: ["starter-office-copilot", "starter-longform-writer"] },
  { id: "starter-delivery", zh: "成果交付", en: "Delivery", expertIds: ["starter-delivery-team", "starter-research-analyst"] },
];

/** manifest 里的 experts[] 行(与 WorkBuddy `_expert_center.json` 同构)。 */
export function starterManifestExperts(): unknown[] {
  return STARTER_EXPERTS.map((e) => ({
    id: e.id,
    categoryId: e.cat,
    plugin: e.plugin,
    displayName: e.title,
    profession: e.title,
    author: e.author,
    displayDescription: e.desc,
    operationalTag: e.ribbon ?? null,
    tags: e.tags,
    expertType: e.type,
    isOPC: e.opc === true,
    displayPosition: e.pos,
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "builtin",
    // R97 — only forward the slug when set so built-in starters without an
    // upstream pi.dev counterpart don't ship a misleading empty link.
    piDevSlug: e.piDevSlug,
  }));
}

export function starterManifest(): Record<string, unknown> {
  return {
    version: 1,
    source: "builtin",
    categories: STARTER_CATEGORIES.map((c) => ({ id: c.id, name: { zh: c.zh, en: c.en } })),
    experts: starterManifestExperts(),
  };
}

export function starterScenesManifest(): Record<string, unknown> {
  return {
    source: "builtin",
    scenes: STARTER_SCENES.map((s) => ({
      id: s.id,
      displayName: { zh: s.zh, en: s.en },
      expertIds: [...s.expertIds],
      image: "",
    })),
  };
}

/**
 * Frontmatter layout that pi-subagents consumes natively:
 *   - `name` must be a slug matching the file stem (the runtime agent name
 *     used by `subagent({ agent: "..." })`).
 *   - `advertise: true` enrolls the agent in the parent session's
 *     `subagent({ action: "list" })` catalog so the model picks it.
 *   - `description` is the routing label the parent reads.
 *   - `systemPromptMode: append` keeps Pi's normal base prompt in scope, so
 *     the agent stays disciplined with project context.
 *
 * The human-readable Chinese title is moved into the body (`# <title>`) so
 * we keep display parity with the WorkBuddy catalog card without polluting
 * the agent runtime name.
 */
export function starterAgentMarkdown(
  e: Pick<StarterExpert, "plugin" | "title" | "desc" | "prompt">,
  memberId?: string,
): string {
  const slug = memberId ?? e.plugin;
  const description = e.desc.zh.replace(/\n/g, " ");
  return [
    "---",
    `name: ${slug}`,
    `description: ${description}`,
    "advertise: true",
    "tools: inherit",
    "systemPromptMode: append",
    "---",
    "",
    `# ${e.title.zh}`,
    "",
    e.prompt,
    "",
  ].join("\n");
}

/** Member-agent markdown for a team. Keeps the same frontmatter contract. */
export function starterMemberMarkdown(
  expert: Pick<StarterExpert, "plugin" | "desc">,
  member: StarterMember,
): string {
  const description = `${member.role.zh} · ${expert.desc.zh}`.replace(/\n/g, " ");
  return [
    "---",
    `name: ${member.id}`,
    `description: ${description}`,
    "advertise: true",
    "tools: inherit",
    "systemPromptMode: append",
    "---",
    "",
    `# ${member.title.zh} — ${member.role.zh}`,
    "",
    member.prompt,
    "",
  ].join("\n");
}

export type { StarterExpert, StarterCategory, StarterMember };
