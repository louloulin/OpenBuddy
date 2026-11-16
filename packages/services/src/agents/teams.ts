import type { TeamStage, TeamTemplate } from "@openbuddy/protocol/teams";

/**
 * 专家团 (20261116-pii W3.5): preset pipelines of built-in experts.
 *
 * A team is not a runtime: it is a 我的指令 prompt template whose body tells the model to run the
 * stages with `ob_subagent` in `chain` mode (each child is a real sub-agent bound to that expert).
 * Installing it writes a normal prompt template, so `/team-...` works in any task and the user can
 * edit it like any other instruction.
 */
interface TeamSeed {
  id: string;
  name: string;
  description: string;
  command: string;
  stages: TeamStage[];
}

export const TEAM_SEEDS: TeamSeed[] = [
  {
    id: "research-write-review",
    name: "调研 → 写作 → 审阅",
    description: "先查清事实与出处，再写成稿子，最后从读者和风险角度审一遍。适合报告、方案、深度文章。",
    command: "team-research-write-review",
    stages: [
      { expertId: "deep-researcher", expertName: "深度研究员", role: "调研", instruction: "查清关键事实、数据与出处；列出不确定项。只交付调研结论，不写正文。" },
      { expertId: "writing-polisher", expertName: "写作润色", role: "成稿", instruction: "依据上一阶段的调研结论写出完整初稿，结构清晰、结论先行。" },
      { expertId: "product-strategist", expertName: "产品策略", role: "审阅", instruction: "从读者、风险与可执行性三方面审阅初稿，指出问题并给出修改后的定稿。" },
    ],
  },
  {
    id: "data-report",
    name: "数据洞察",
    description: "分析数据、提炼业务结论，再排成可汇报的结构。适合周报、复盘、经营分析。",
    command: "team-data-report",
    stages: [
      { expertId: "data-analyst", expertName: "数据分析师", role: "分析", instruction: "核对数据口径，算出关键指标与同比环比，列出异常点。" },
      { expertId: "product-strategist", expertName: "产品策略", role: "结论", instruction: "把数据转成业务结论与建议，说明依据与风险。" },
      { expertId: "presentation-planner", expertName: "演示策划", role: "成稿", instruction: "把结论排成可汇报的提纲：每页一个观点，配一句要点。" },
    ],
  },
  {
    id: "ship-check",
    name: "上线检查",
    description: "改完代码先自查，再做一次独立评审，最后写清发版说明与风险。",
    command: "team-ship-check",
    stages: [
      { expertId: "code-assistant", expertName: "代码助手", role: "自查", instruction: "复述改动范围，跑通构建与测试，列出没覆盖到的边界。" },
      { expertId: "code-reviewer", expertName: "代码评审", role: "评审", instruction: "独立评审改动：正确性、安全、兼容与回滚方案；给出必须修改项。" },
      { expertId: "office-assistant", expertName: "办公助理", role: "发版说明", instruction: "写一段发版说明：改了什么、影响谁、如何验证与回滚。" },
    ],
  },
];

/** The prompt-template body for one team: how the model should run the chain. */
export function teamPrompt(team: Pick<TeamSeed, "name" | "stages">): string {
  const steps = team.stages
    .map((stage, index) => `${index + 1}. ${stage.role}（专家 ${stage.expertId}，name=${stage.expertName}）：${stage.instruction}`)
    .join("\n");
  return [
    `请按「${team.name}」这条流水线完成任务。`,
    "",
    "执行方式：调用一次 ob_subagent，参数 mode=chain，按下面顺序给出 tasks；每一步指定对应的 agent，并让后一步带上一步的结论。",
    "",
    steps,
    "",
    "要求：",
    "- 每个子代理只做自己那一步，不要越界；",
    "- 最后把各阶段的关键结论汇总给我，并说明每步由谁完成；",
    "- 如果某一步失败，停下来告诉我原因，不要跳过继续。",
    "",
    "任务内容（替换为你真正要做的事）：$ARGUMENTS",
  ].join("\n");
}

/** The teams as the UI shows them, optionally with their installed state. */
export function teamTemplates(installed: (command: string) => boolean): TeamTemplate[] {
  return TEAM_SEEDS.map((team) => ({
    id: team.id,
    name: team.name,
    description: team.description,
    command: team.command,
    stages: team.stages,
    installed: installed(team.command),
  }));
}

export function teamSeed(id: string): TeamSeed | undefined {
  return TEAM_SEEDS.find((team) => team.id === id);
}
