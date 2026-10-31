/** 计划 2.1 — 模板文本不再无声覆盖用户草稿。 */
import { describe, expect, it } from "vitest";

import { mergeInjectedText } from "../use-extension-text";

describe("mergeInjectedText", () => {
  it("输入框为空:直接填入", () => {
    expect(mergeInjectedText("", "模板 A", null)).toEqual({ next: "模板 A", caret: 4 });
  });

  it("仍是上一次模板原文:替换(连点模板只留最后一个)", () => {
    expect(mergeInjectedText("模板 A", "模板 B", "模板 A")).toEqual({ next: "模板 B", caret: 4 });
  });

  it("用户写过草稿:插到光标处,草稿保留", () => {
    expect(mergeInjectedText("前半后半", "模板", null, 2)).toEqual({ next: "前半\n\n模板\n\n后半", caret: 6 });
  });

  it("没有光标信息:接在末尾", () => {
    expect(mergeInjectedText("我的草稿", "模板", "别的模板")).toEqual({ next: "我的草稿\n\n模板", caret: 8 });
  });
});
