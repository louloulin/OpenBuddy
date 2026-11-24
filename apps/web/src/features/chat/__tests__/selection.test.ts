import { describe, expect, it, afterEach } from "vitest";
import { quoteLines } from "../chat-view/annotation";
import { appendDraft, answerSelection, quotedAnswerBlock } from "../chat-view/selection";

const setup = (html: string) => {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root") as HTMLElement;
};
const select = (startNode: Node, startOffset: number, endNode: Node, endOffset: number) => {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};
afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.innerHTML = ""; });

describe("answerSelection (G1-22)", () => {
  it("returns the text selected inside an assistant answer", () => {
    const root = setup(`<div class="turn__answer">Hello <b>world</b></div>`);
    const answer = root.querySelector(".turn__answer")!;
    const plain = answer.firstChild!;
    const bold = answer.querySelector("b")!.firstChild!;
    select(plain, 0, bold, bold.textContent!.length);
    expect(answerSelection(root)).toMatchObject({ text: "Hello world" });
  });

  it("ignores collapsed selections and text outside answers", () => {
    const root = setup(`<div class="turn__answer">answer</div><div class="tool">tool output</div>`);
    const answerText = root.querySelector(".turn__answer")!.firstChild!;
    select(answerText, 0, answerText, 0);
    expect(answerSelection(root)).toBeNull();
    const toolText = root.querySelector(".tool")!.firstChild!;
    select(toolText, 0, toolText, toolText.textContent!.length);
    expect(answerSelection(root)).toBeNull();
  });

  it("caps very long selections at 4000 characters", () => {
    const root = setup(`<div class="turn__answer"></div>`);
    const answer = root.querySelector(".turn__answer")!;
    const node = document.createTextNode("x".repeat(5000));
    answer.appendChild(node);
    select(node, 0, node, 5000);
    expect(answerSelection(root)?.text).toHaveLength(4000);
  });

  it("keeps the toolbar horizontally on screen", () => {
    const root = setup(`<div class="turn__answer">short</div>`);
    const node = root.querySelector(".turn__answer")!.firstChild!;
    select(node, 0, node, 5);
    const pick = answerSelection(root)!;
    expect(pick.left).toBeGreaterThanOrEqual(24);
    expect(pick.top).toBeGreaterThanOrEqual(8);
  });
});

describe("quote helpers", () => {
  it("quotes lines and names the source", () => {
    expect(quotedAnswerBlock("a\nb", quoteLines, "「会话」")).toBe("> a\n> b\n\n—— 来自「会话」");
  });
  it("appends without dropping the existing draft", () => {
    expect(appendDraft("", "block")).toBe("block");
    expect(appendDraft("draft\n", "block")).toBe("draft\n\nblock");
  });
});
