/**
 * 回答后的「下一步」建议 —— 不调用模型，只用 Pi 已经产出的事实
 * （工具调用、产物、回答文本形状）生成 2–3 个可点击动作。
 *
 * 这样建议始终与当前回合相关，也不会为每条回答额外烧一次模型调用；
 * 外部仍可注册更强的建议 provider（见 voice/telemetry 的做法）。
 */
export interface FollowUpContext {
  /** The assistant's final answer for this turn. */
  answer: string;
  /** Artifacts created or changed in this turn. */
  artifactCount?: number;
  /** Tool kinds used in this turn (e.g. read, bash, grep, mcp__...). */
  toolKinds?: string[];
  /** A tool failed in this turn (the error card already offers retry). */
  hadError?: boolean;
}

export interface FollowUpSuggestion {
  id: string;
  label: string;
  prompt: string;
}

function hasCodeBlock(answer: string): boolean {
  return /```[\s\S]*?```/.test(answer);
}

function hasTable(answer: string): boolean {
  return /^\s*\|.+\|\s*$/m.test(answer);
}

function hasList(answer: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+\S/m.test(answer);
}

function hasUrls(answer: string): boolean {
  return /https?:\/\/[^\s)]+/i.test(answer);
}

/** Derive 2–3 next-step suggestions; deterministic and cheap. */
export function suggestFollowUps(context: FollowUpContext, limit = 3): FollowUpSuggestion[] {
  const answer = context.answer.trim();
  if (!answer) return [];
  const tools = new Set(context.toolKinds ?? []);
  const suggestions: FollowUpSuggestion[] = [];
  const push = (s: FollowUpSuggestion) => {
    if (suggestions.length < limit && !suggestions.some((x) => x.id === s.id)) suggestions.push(s);
  };

  if ((context.artifactCount ?? 0) > 0) {
    push({ id: "explain-artifacts", label: "解释产物改动", prompt: "请解释本轮产物的主要改动、用途和需要我注意的风险。" });
    push({ id: "optimize-artifacts", label: "给下一步优化", prompt: "基于这些产物，给出下一步可执行的优化建议，按优先级排列。" });
  }

  if (hasCodeBlock(answer)) {
    push({ id: "explain-code", label: "逐段解释代码", prompt: "请逐段解释上面的代码，说明关键设计和不明显的边界情况。" });
    push({ id: "add-tests", label: "补测试", prompt: "请为上面的代码补充关键测试，覆盖失败路径和边界条件。" });
  }

  if (hasTable(answer)) {
    push({ id: "summarize-table", label: "总结三条", prompt: "请把上面的表格总结成三条最重要的结论，并说明依据。" });
  } else if (hasList(answer)) {
    push({ id: "pick-first", label: "先做第一项", prompt: "请先执行上面列表的第一项，并告诉我需要什么信息。" });
  }

  if (hasUrls(answer) || tools.has("grep") || tools.has("find")) {
    push({ id: "sources", label: "补充来源", prompt: "请为上面的关键结论补充可核实的来源链接，并标出不确定的部分。" });
  }

  if (tools.has("bash") || tools.has("write") || tools.has("edit")) {
    push({ id: "verify", label: "再验证一次", prompt: "请重新验证刚才的改动：运行相关测试或命令，并汇报结果。" });
  }

  push({ id: "go-deeper", label: "再深入一点", prompt: "请再深入分析这个问题，补充边界情况、反例和仍不确定的地方。" });
  push({ id: "other-angle", label: "换个角度", prompt: "请从相反或替代方案的角度重新分析这个问题，并说明取舍。" });

  return suggestions.slice(0, limit);
}
