const PERSONA = /<!--EXPERT_PERSONA_BEGIN-->[\s\S]*?<!--EXPERT_PERSONA_END-->/g;
/** First-turn title shown in the sidebar: the user's own words, without injected context. */
export function deriveTitle(raw: string): string | undefined {
  let text = raw.replace(PERSONA, "").replace(/\s*<openbuddy-(plan|ask)-mode>[\s\S]*?<\/openbuddy-\1-mode>\s*/, "");
  let skill: string | undefined;
  const block = text.match(/^\s*<skill name="([^"]+)"[^>]*>[\s\S]*?<\/skill>\s*/);
  if (block) {
    skill = block[1];
    text = text.slice(block[0].length);
  }
  const attachments = [...text.matchAll(/<attachment name="([^"]*)">/g)].map((m) => m[1]);
  text = text
    .replace(/<attachment name=[^>]*>[\s\S]*?<\/attachment>/g, "")
    .replace(/\n*相关文件:\n(?:- .*(?:\n|$))+/g, "")
    .replace(/^请查看以下文件:\n(?:- .*(?:\n|$))+/, "")
    .replace(/^\[项目「[^」]*」背景与规范\][\s\S]*?\[用户消息\]\n/, "")
    .replace(/^【角色设定 — [^】]*】[\s\S]*?用户的第一个问题：\s*/, "")
    .replace(/^【[^】]{1,12}】/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    if (skill) return `技能：${skill}`;
    if (attachments.length) return `查看 ${attachments[0]}`;
    return undefined;
  }
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}
export function messageText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => !!part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}
