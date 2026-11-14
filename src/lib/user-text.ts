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

export function parseUserText(raw: string): UserDisplay {
  let text = raw;
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
  return { text: text.trim(), attachments, ...(skill ? { skill } : {}), ...(expert ? { expert } : {}) };
}

/** File name for an attachment chip. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
