import { describe, expect, it } from "vitest";
import { mermaidSourceForRender } from "../mermaid-source";

describe("mermaidSourceForRender", () => {
  it("leaves non-sankey diagrams and plain sankey values untouched", () => {
    const flow = "flowchart LR\nA-->B";
    expect(mermaidSourceForRender(flow)).toEqual({ source: flow });
    const plain = "sankey-beta\n营业收入,营业成本,1284639.23\n营业收入,毛利,624185.78";
    expect(mermaidSourceForRender(plain)).toEqual({ source: plain });
  });

  it("writes a quoted thousands-grouped value as a plain number, as the PPTX export reads it", () => {
    // mermaid parses "1,000" with parseFloat and would draw 1; PPTX reads 1000.
    expect(mermaidSourceForRender('sankey-beta\n"毛利,含逗号",经营利润,"1,284,639.23"\n甲,乙,"500"')).toEqual({
      source: 'sankey-beta\n"毛利,含逗号",经营利润,1284639.23\n甲,乙,500',
    });
  });

  it("refuses values mermaid would silently misread instead of drawing a wrong figure", () => {
    for (const value of ['"1,0000"', '"1 000"', '"12亿"', "12abc"]) {
      const result = mermaidSourceForRender(`sankey-beta\n甲,乙,${value}`);
      expect(result).toEqual({ error: expect.stringContaining("第 2 行") });
    }
  });
});
