import { describe, expect, it } from "vitest";
import { extractSources } from "../extract-sources";

describe("extractSources", () => {
  it("提取 markdown 链接与裸 URL 并去重", () => {
    const sources = extractSources([
      "参考 [OpenAI](https://openai.com/docs) 和 https://example.com/a。",
      "重复 https://example.com/a，以及 (https://foo.dev/x)",
    ]);
    expect(sources.map((s) => s.url)).toEqual(["https://openai.com/docs", "https://example.com/a", "https://foo.dev/x"]);
    expect(sources[0].title).toBe("OpenAI");
    expect(sources[1].title).toBe("example.com");
  });

  it("去掉尾部标点", () => {
    expect(extractSources(["见 https://example.com/a, 还有 https://b.dev/x."]).map((s) => s.url)).toEqual([
      "https://example.com/a",
      "https://b.dev/x",
    ]);
  });

  it("没有 URL 或超过上限时返回空/截断", () => {
    expect(extractSources(["普通文本", null, undefined])).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => `https://s${i}.dev`).join("\n");
    expect(extractSources([many], 3)).toHaveLength(3);
  });
});
