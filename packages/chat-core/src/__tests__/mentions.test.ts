import { describe, expect, it } from "vitest";
import { assemblePrompt, blockLabel, blocks, blocksFromText, fileMentions, formatFileMention, insertFileMention, mentionToken } from "../content-blocks";

describe("`@` file mentions (W1.3)", () => {
  it("finds the @query at the caret, never inside words or e-mail addresses", () => {
    expect(mentionToken("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionToken("look at @src/ap", 15)).toEqual({ start: 8, query: "src/ap" });
    expect(mentionToken("mail me@example.com", 19)).toBeNull();
    expect(mentionToken("@done ", 6)).toBeNull();
    expect(mentionToken("a @x b", 4)).toEqual({ start: 2, query: "x" });
  });

  it("inserts a reference in place of the token, quoting paths with spaces", () => {
    expect(formatFileMention("docs/report.md")).toBe("@docs/report.md");
    expect(formatFileMention("my docs/a b.md")).toBe('@"my docs/a b.md"');
    expect(formatFileMention("win\\path.txt")).toBe("@win/path.txt");
    const text = "see @rep and more";
    const token = mentionToken(text, 8)!;
    expect(insertFileMention(text, token, 8, "docs/report.md")).toEqual({ text: "see @docs/report.md and more", cursor: 20 });
    expect(insertFileMention("@", { start: 0 }, 1, "a.ts")).toEqual({ text: "@a.ts ", cursor: 6 });
  });

  it("reads file references back out of a prompt without taking @names for files", () => {
    expect(fileMentions('compare @docs/a.md with @"my file.txt", ask @Alice and @b.ts.')).toEqual(["docs/a.md", "my file.txt", "b.ts"]);
    const parts = blocksFromText("fix @src/app.ts please");
    expect(parts.map((b) => (b.kind === "text" ? b.text : b.kind === "file" ? `[${b.path}]` : b.kind))).toEqual(["fix ", "[src/app.ts]", " please"]);
    expect(assemblePrompt(parts)).toBe("fix\n\nplease\n\n相关文件:\n- src/app.ts");
  });

  it("keeps skill and expert blocks unchanged", () => {
    expect(blockLabel(blocks.skill("pdf"))).toBe("@pdf");
    expect(assemblePrompt([blocks.skill("pdf"), blocks.text("hi")])).toBe("skill://pdf\n\nhi");
  });
});
