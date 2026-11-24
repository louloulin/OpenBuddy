/**
 * Turn the prompt text that reached the engine back into what the user typed.
 *
 * The host injects context into user prompts (attachment bodies, a file list,
 * skill expansions, expert personas, project briefs). Pi records the expanded
 * text, so replayed history must be reduced to the user's own words plus
 * structured chips for display and titles.
 */
export interface UserDisplay {
  /** The user's own words. */
  text: string;
  /** Attached file paths (or names when only the inlined body is known). */
  attachments: string[];
  /** Skill invoked through `/skill:name`. */
  skill?: string;
  /** Expert persona injected ahead of the message. */
  expert?: string;
  /** Sent in 想一想 (plan) or 问一问 (ask) mode. */
  mode?: "plan" | "ask";
}

export const EXPERT_PERSONA_BEGIN = "<!--EXPERT_PERSONA_BEGIN-->";
export const EXPERT_PERSONA_END = "<!--EXPERT_PERSONA_END-->";
const PERSONA = /<!--EXPERT_PERSONA_BEGIN-->[\s\S]*?<!--EXPERT_PERSONA_END-->\s*/g;
const FILE_LIST = /\n*相关文件:\n((?:- .*(?:\n|$))+)/;
const FILE_LIST_ONLY = /^请查看以下文件:\n((?:- .*(?:\n|$))+)/;

function listPaths(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean);
}

/**
 * 想一想 / 问一问 (20261115-ui §5.3, D6): the engine also restricts tools to
 * read-only ones; this hidden block tells the model what is expected. It is
 * stripped from the bubble and the title.
 */
const MODE_BLOCK = /\s*<openbuddy-(plan|ask)-mode>[\s\S]*?<\/openbuddy-\1-mode>\s*/;
const MODE_TEXT: Record<"plan" | "ask", string> = {
  // ob_todo is a built-in that can be switched off (设置 · 智能体), so it is only asked for when present.
  plan: "本条消息处于「想一想」模式：先调研（只能读取，不能修改文件或执行命令），然后给出执行计划：如果有 ob_todo 工具，用它把计划逐条记录为步骤（action add）；没有就在回答里逐条列出步骤。并在回答里说明要改动的文件和风险。不要开始执行，等用户确认。",
  ask: "本条消息处于「问一问」模式：只回答问题或解释，可以读取文件，不要修改任何文件或执行命令。",
};
export function withModeInstruction(text: string, mode: "craft" | "plan" | "ask"): string {
  if (mode === "craft") return text;
  return `<openbuddy-${mode}-mode>\n${MODE_TEXT[mode]}\n</openbuddy-${mode}-mode>\n${text}`;
}

/**
 * 状态 chip 的 prompt 前缀（G1-17）：`【风格：专业严谨】` / `【风格：… · 补图：…】`。
 * 它是给模型看的上下文，不该出现在用户气泡里，所以显示前剥掉。
 */
const STATUS_PREFIX = /^\s*【风格：[^】]*(?: · 补图：[^】]*)?】/;

export function parseUserText(raw: string): UserDisplay {
  let text = raw;
  const status = text.match(STATUS_PREFIX);
  if (status) text = text.slice(status[0].length);
  let mode: "plan" | "ask" | undefined;
  const modeBlock = text.match(MODE_BLOCK);
  if (modeBlock) {
    mode = modeBlock[1] as "plan" | "ask";
    text = modeBlock.index === 0 ? text.slice(modeBlock[0].length) : text.replace(modeBlock[0], "\n");
  }
  let expert: string | undefined;
  if (text.includes(EXPERT_PERSONA_BEGIN)) {
    expert = "persona";
    text = text.replace(PERSONA, "");
  }
  const role = text.match(/^【角色设定 — ([^】]*)】[\s\S]*?用户的第一个问题：\s*/);
  if (role) {
    expert = role[1];
    text = text.slice(role[0].length);
  }
  text = text.replace(/^\[项目「[^」]*」背景与规范\][\s\S]*?\[用户消息\]\n/, "");
  let skill: string | undefined;
  const block = text.match(/^\s*<skill name="([^"]+)"[^>]*>[\s\S]*?<\/skill>\s*/);
  if (block) {
    skill = block[1];
    text = text.slice(block[0].length);
  }
  const inlined = [...text.matchAll(/<attachment name="([^"]*)">/g)].map((m) => m[1]);
  text = text.replace(/\s*<attachment name=[^>]*>[\s\S]*?<\/attachment>/g, "");
  let attachments: string[] = [];
  const listed = text.match(FILE_LIST) ?? text.match(FILE_LIST_ONLY);
  if (listed) {
    attachments = listPaths(listed[1]);
    text = text.replace(listed[0], "");
  }
  if (!attachments.length) attachments = inlined;
  return { text: text.trim(), attachments, ...(skill ? { skill } : {}), ...(expert ? { expert } : {}), ...(mode ? { mode } : {}) };
}

/** File name for an attachment chip. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
