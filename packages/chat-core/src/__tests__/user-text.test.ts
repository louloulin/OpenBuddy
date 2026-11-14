import { describe, expect, it } from "vitest";
import { EXPERT_PERSONA_BEGIN, EXPERT_PERSONA_END, baseName, parseUserText } from "../user-text";

describe("parseUserText: replayed prompts show only what the user typed", () => {
  it("strips inlined attachment bodies and the file list, keeping attachment chips", () => {
    const raw = `总结一下\n<attachment name="notes.md">\n# secret body\n</attachment>\n\n相关文件:\n- /work/notes.md\n- /work/data.csv`;
    expect(parseUserText(raw)).toEqual({ text: "总结一下", attachments: ["/work/notes.md", "/work/data.csv"] });
  });

  it("falls back to inlined attachment names when there is no file list, and handles attachment-only prompts", () => {
    expect(parseUserText(`看看这个\n<attachment name="a.txt">body</attachment>`)).toEqual({ text: "看看这个", attachments: ["a.txt"] });
    expect(parseUserText("请查看以下文件:\n- /x/report.pdf")).toEqual({ text: "", attachments: ["/x/report.pdf"] });
  });

  it("strips an expanded skill block and records the skill", () => {
    const raw = `<skill name="commit" location="/skills/commit/SKILL.md">\nLong instructions…\n</skill>\n\n帮我提交`;
    expect(parseUserText(raw)).toEqual({ text: "帮我提交", attachments: [], skill: "commit" });
  });

  it("strips expert personas (marker and role-setting forms) and project briefs", () => {
    expect(parseUserText(`${EXPERT_PERSONA_BEGIN}You are a lawyer${EXPERT_PERSONA_END}\n合同要点`)).toMatchObject({ text: "合同要点", expert: "persona" });
    expect(parseUserText("【角色设定 — 财务专家】请扮演……\n用户的第一个问题：本月预算？")).toMatchObject({ text: "本月预算？", expert: "财务专家" });
    expect(parseUserText("[项目「官网」背景与规范]\n规范内容\n[用户消息]\n改首页")).toMatchObject({ text: "改首页" });
  });

  it("leaves ordinary text untouched", () => {
    expect(parseUserText("  见 https://a.com/b 和 src/app  ")).toEqual({ text: "见 https://a.com/b 和 src/app", attachments: [] });
    expect(baseName("C:\\work\\a.txt")).toBe("a.txt");
    expect(baseName("/work/dir/")).toBe("dir");
  });
});
