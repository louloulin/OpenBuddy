// B2b: the office builders produce real OOXML packages (officegen) that unzip and parse.
import { describe, expect, it } from "vitest";
import { readWorkBuddyZip } from "../src/agents/workbuddy";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDocx, buildPptx, buildXlsx, deckSpecToDocx, deckSpecToXlsx, mermaidTable, type PptxSpec } from "../src/office/index";

// Same DeckSpec the UpUp industry pipeline produces (upup: packages/pi-investment-analysis/test/fixtures/industry-deck.json).
const industryDeck = JSON.parse(readFileSync(join(__dirname, "fixtures", "industry-deck.json"), "utf8")) as PptxSpec;

const text = (files: Map<string, Uint8Array>, name: string): string => {
  const bytes = files.get(name);
  if (!bytes) throw new Error(`missing ${name}`);
  return new TextDecoder().decode(bytes);
};

const xmlNames = (files: Map<string, Uint8Array>) => [...files.keys()].filter((name) => name.endsWith(".xml"));

describe("办公产物 (B2b)", () => {
  it("builds a Word document with a title, paragraphs, bullets and a table", async () => {
    const bytes = await buildDocx({
      title: "季度经营报告",
      blocks: [
        { type: "heading", text: "一、概览", level: 1 },
        { type: "paragraph", text: "本季度收入同比增长 18%。" },
        { type: "bullets", items: ["华东增长最快", "西部库存周转偏低"] },
        { type: "table", headers: ["区域", "收入"], rows: [["华东", 120], ["西部", 80]] },
      ],
    });
    expect(bytes.length).toBeGreaterThan(1000);
    const files = readWorkBuddyZip(Buffer.from(bytes));
    expect(files.has("word/document.xml")).toBe(true);
    const document = text(files, "word/document.xml");
    expect(document).toContain("季度经营报告");
    expect(document).toContain("华东");
    expect(document).toContain("120");
  });

  it("builds an Excel workbook with two sheets, headers and numeric cells", async () => {
    const bytes = await buildXlsx({
      sheets: [
        { name: "销售", columns: ["月份", "销量"], rows: [["1月", 10], ["2月", 20]] },
        { name: "库存", columns: ["SKU", "数量"], rows: [["A-1", 5]] },
      ],
    });
    const files = readWorkBuddyZip(Buffer.from(bytes));
    const workbook = text(files, "xl/workbook.xml");
    expect(workbook).toContain("销售");
    expect(workbook).toContain("库存");
    const all = [...files.entries()].map(([, value]) => new TextDecoder().decode(value)).join("\n");
    expect(all).toContain("1月");
    expect(all).toContain("A-1");
    // The second sheet exists as a separate part.
    expect([...files.keys()].some((name) => /^xl\/worksheets\/sheet2\.xml$/.test(name))).toBe(true);
  });

  it("builds a PowerPoint deck with a cover and bullet slides", async () => {
    const bytes = await buildPptx({
      title: "季度复盘",
      slides: [{ title: "增长", bullets: ["华东 +18%", "西部 -4%"] }, { title: "下一步", bullets: ["补库存"] }],
    });
    const files = readWorkBuddyZip(Buffer.from(bytes));
    expect(files.has("ppt/presentation.xml")).toBe(true);
    const all = [...files.entries()].map(([, value]) => new TextDecoder().decode(value)).join("\n");
    expect(all).toContain("季度复盘");
    expect(all).toContain("华东 +18%");
    expect(all).toContain("下一步");
  });

  it("every XML part is well-formed", async () => {
    const [docx, xlsx, pptx] = await Promise.all([
      buildDocx({ blocks: [{ type: "paragraph", text: "hello & <world>" }] }),
      buildXlsx({ sheets: [{ rows: [["a & b"]] }] }),
      buildPptx({ slides: [{ title: "a & b" }] }),
    ]);
    for (const bytes of [docx, xlsx, pptx]) {
      const files = readWorkBuddyZip(Buffer.from(bytes));
      for (const name of xmlNames(files)) {
        const parsed = new DOMParser().parseFromString(text(files, name), "application/xml");
        expect(parsed.getElementsByTagName("parsererror").length, name).toBe(0);
      }
    }
  });

  it("rejects empty or oversized descriptions", async () => {
    await expect(buildDocx({ blocks: [] })).rejects.toThrow(/至少需要一个内容块/);
    await expect(buildXlsx({ sheets: [] })).rejects.toThrow(/至少需要一个工作表/);
    await expect(buildPptx({ slides: [] })).rejects.toThrow(/至少需要一页/);
  });
});

describe("PPTX 版式块 (P2-1)", () => {
  const slideNames = (files: Map<string, Uint8Array>) => [...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));

  it("renders tables, native charts, KPI cards and source footers", async () => {
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith("ob-pptx-")).length;
    const bytes = await buildPptx({
      title: "产业分析",
      sources: [{ id: "s1", name: "行业协会", asOf: "2026-11-27" }],
      slides: [
        { title: "区域规模", layout: "table", blocks: [{ kind: "table", headers: ["区域", "规模"], rows: [["华东", 120], ["华南", 80]], sourceId: "s1" }] },
        { title: "走势", layout: "chart", blocks: [{ kind: "chart", chartType: "column", title: "规模", categories: ["2023", "2024"], series: [{ name: "规模", values: [100, 120] }], sourceId: "s1" }] },
        { title: "份额", layout: "chart", blocks: [{ kind: "chart", chartType: "pie", title: "份额", categories: ["A", "B"], series: [{ name: "份额", values: [60, 40] }] }, { kind: "note", text: "份额为输入值", tone: "assumption" }] },
        { title: "指标", layout: "kpi", blocks: [{ kind: "kpi", items: [{ label: "CAGR", value: "9.5%" }, { label: "CR4", value: "95%" }] }] },
      ],
    });
    const files = readWorkBuddyZip(Buffer.from(bytes));
    expect(slideNames(files)).toHaveLength(5);
    const all = [...files.entries()].map(([, value]) => new TextDecoder().decode(value)).join("\n");
    expect(all).toContain("<a:tbl>");
    expect(all).toContain("华东");
    expect(all).toContain("来源：行业协会（2026-11-27）");
    expect(all).toContain("假设｜份额为输入值");
    expect([...files.keys()].filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))).toHaveLength(2);
    expect(all).toContain("<c:pieChart>");
    expect(all).toContain("<c:barChart>");
    expect([...files.keys()].some((name) => name.startsWith("ppt/embeddings/"))).toBe(true);
    // 16:9 and the chart temp dir is cleaned up.
    expect(text(files, "ppt/presentation.xml")).toContain('cx="12192000"');
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith("ob-pptx-")).length).toBe(before);
  });

  it("flows long tables and second charts onto continuation slides", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => [`行${index + 1}`, index]);
    const bytes = await buildPptx({
      slides: [
        { title: "长表", blocks: [{ kind: "table", headers: ["名称", "值"], rows }] },
        { title: "两张图", blocks: [
          { kind: "chart", chartType: "column", title: "a", categories: ["x"], series: [{ name: "s", values: [1] }] },
          { kind: "chart", chartType: "line", title: "b", categories: ["x", "y"], series: [{ name: "s", values: [1, 2] }] },
        ] },
      ],
    });
    const files = readWorkBuddyZip(Buffer.from(bytes));
    const all = [...files.entries()].map(([, value]) => new TextDecoder().decode(value)).join("\n");
    expect(slideNames(files).length).toBe(5);
    expect(all).toContain("长表（续）");
    expect(all).toContain("行30");
    // Line charts are native c:lineChart parts, not columns relabelled as a trend.
    const chartXml = [...files.keys()].filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name)).map((name) => text(files, name));
    expect(chartXml.filter((xml) => xml.includes("<c:lineChart"))).toHaveLength(1);
    expect(chartXml.filter((xml) => xml.includes("<c:barChart"))).toHaveLength(1);
    // Vertical charts need the category axis at the bottom and the value axis on the left (Keynote rejects the swap).
    for (const xml of chartXml) {
      expect(xml).toMatch(/<c:catAx>[\s\S]*?<c:axPos val="b"\/>[\s\S]*?<\/c:catAx>/);
      expect(xml).toMatch(/<c:valAx>[\s\S]*?<c:axPos val="l"\/>[\s\S]*?<\/c:valAx>/);
    }
    expect(all).not.toContain("b · 走势");
  });

  it("cuts tables with wrapped Chinese cells by estimated height so no frame runs off the slide", async () => {
    const long = "生猪养殖由散户向规模化集中，环保政策推动产能向优势区域转移，龙头企业资本开支扩张。".repeat(2);
    const rows = Array.from({ length: 8 }, (_, index) => [`政策${index + 1}`, long, "转引未核验"]);
    const bytes = await buildPptx({ slides: [{ title: "政策矩阵", blocks: [{ kind: "table", headers: ["阶段", "要点", "来源"], rows, caption: "表注" }] }] });
    const files = readWorkBuddyZip(Buffer.from(bytes));
    const slides = slideNames(files).map((name) => text(files, name));
    expect(slides.length).toBeGreaterThan(1);
    expect(slides.join("\n")).toContain("政策8");
    const frames = slides.flatMap((xml) => xml.match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g) ?? []);
    expect(frames.length).toBe(slides.length);
    for (const frame of frames) {
      const y = Number(/<a:off x="\d+" y="(\d+)"/.exec(frame)?.[1]);
      const cy = Number(/<a:ext cx="\d+" cy="(\d+)"/.exec(frame)?.[1]);
      expect(y + cy).toBeLessThanOrEqual(6_858_000 - 502_920);
    }
  });

  it("wraps Latin runs as whole words when estimating cell height, not as averaged glyph widths", async () => {
    const tableHeight = async (cell: string) => {
      const files = readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "表", blocks: [{ kind: "table", headers: ["甲", "乙", "丙"], rows: [["一", cell, "三"]] }] }] })));
      return Number(/<p:graphicFrame>[\s\S]*?<a:ext cx="\d+" cy="(\d+)"/.exec(text(files, slideNames(files)[0]!))?.[1]);
    };
    // A Latin run cannot split, so near a line end it moves down whole and leaves the slack unused: the mixed
    // cell can need more lines than an all-CJK cell of the same average width. Averaging never shows that.
    let pushed = false;
    for (const run of ["2022-09-30", "Pre-B-round-2024"]) {
      for (let count = 1; count <= 40 && !pushed; count += 1) {
        const mixed = `${"产".repeat(count)}${run}${"产".repeat(count)}`;
        const average = "产".repeat(Math.ceil(2 * count + run.length * 0.55));
        pushed = (await tableHeight(mixed)) > (await tableHeight(average));
      }
    }
    expect(pushed).toBe(true);
  });

  it("skips charts without data and images outside the workspace instead of inventing content", async () => {
    const bytes = await buildPptx({
      slides: [{ title: "空", blocks: [
        { kind: "chart", chartType: "column", title: "空图", categories: [], series: [] },
        { kind: "image", path: "../secret.png", alt: "外部图片" },
        { kind: "mermaid", source: "erDiagram\n A ||--o{ B : has", caption: "产业链" },
      ] }],
    }, { resolveImage: () => null });
    const files = readWorkBuddyZip(Buffer.from(bytes));
    const all = [...files.entries()].map(([, value]) => new TextDecoder().decode(value)).join("\n");
    expect([...files.keys()].some((name) => name.startsWith("ppt/charts/"))).toBe(false);
    expect(all).toContain("缺少可绘制的数据");
    expect(all).toContain("未导出");
    expect(all).toContain("产业链：流程图在工作台预览");
  });

  it("exports sankey / timeline / flowchart diagrams as data tables in PPTX, Word and Excel", async () => {
    const sankey = "sankey-beta\n\n营业收入,营业成本,1284639.23\n营业收入,毛利,624185.78\n\"毛利,含逗号\",经营利润,395591\n";
    const timeline = "timeline\n  title 示例 发展历程\n  2020 : 成立\n  2023 : 首店 : 融资\n  · : 未注明时间";
    const flowchart = 'flowchart LR\n  S0["上游<br/>原料"]\n  S1["中游"]\n  S0 --> S1';
    expect(mermaidTable(sankey)).toEqual({ headers: ["来源", "去向", "数值"], rows: [["营业收入", "营业成本", 1284639.23], ["营业收入", "毛利", 624185.78], ["毛利,含逗号", "经营利润", 395591]] });
    expect(mermaidTable(timeline)).toEqual({ headers: ["时间", "事件"], rows: [["2020", "成立"], ["2023", "首店；融资"], ["", "未注明时间"]] });
    expect(mermaidTable(flowchart)).toEqual({ headers: ["上游", "下游"], rows: [["上游 · 原料", "中游"]] });
    expect(mermaidTable("erDiagram\n A ||--o{ B : has")).toBeNull();
    const spec: PptxSpec = { slides: [{ title: "利润流向（2024）", blocks: [{ kind: "mermaid", source: sankey, caption: "桑基图" }] }, { title: "发展历程", blocks: [{ kind: "mermaid", source: timeline, caption: "里程碑" }] }] };
    const files = readWorkBuddyZip(Buffer.from(await buildPptx(spec)));
    const all = [...files.entries()].map(([, value]) => new TextDecoder().decode(value)).join("\n");
    expect(all).toContain("<a:tbl>");
    expect(all).toContain("1284639.23");
    expect(all).toContain("首店；融资");
    // PPTX draws the sankey and keeps its exact figures in a following table.
    expect(all).toContain("桑基图数据");
    for (const name of xmlNames(files)) expect(new DOMParser().parseFromString(text(files, name), "application/xml").getElementsByTagName("parsererror").length, name).toBe(0);
    const docx = deckSpecToDocx(spec);
    expect(docx.blocks.some((block) => block.type === "table" && block.headers?.[0] === "来源")).toBe(true);
    expect(deckSpecToXlsx(spec).sheets.map((sheet) => sheet.name)).toEqual(["图-利润流向（2024）", "图-发展历程"]);
  });

  const slideXml = (files: Map<string, Uint8Array>) => slideNames(files).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])).map((name) => text(files, name));
  const wellFormed = (files: Map<string, Uint8Array>) => {
    for (const name of xmlNames(files)) expect(new DOMParser().parseFromString(text(files, name), "application/xml").getElementsByTagName("parsererror").length, name).toBe(0);
  };
  const shapes = (xml: string, prst: string) => xml.split(`prst="${prst}"`).length - 1;
  /** Positions (EMU) of every shape on a slide, in drawing order. */
  const boxes = (xml: string) => [...xml.matchAll(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), cx: Number(m[3]), cy: Number(m[4]) }));

  it("draws a mermaid timeline as a native axis with rounded milestones, dates above and events below", async () => {
    const timeline = "timeline\n  title 发展历程\n  2019 : 成立\n  2021 : 首店 : 融资\n  2023 : 出海 & <扩张>\n  · : 未注明时间";
    const files = readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "历程", blocks: [{ kind: "paragraph", text: "导语" }, { kind: "mermaid", source: timeline, caption: "里程碑" }] }] })));
    const [xml] = slideXml(files);
    expect(xml).toContain("<p:sp>");
    expect(shapes(xml!, "line")).toBe(1);
    expect(shapes(xml!, "roundRect")).toBe(4);
    for (const value of ["2019", "成立", "2021", "首店；融资", "出海 &amp; &lt;扩张&gt;", "未注明时间", "里程碑；图形在工作台预览中可交互"]) expect(xml).toContain(value);
    expect(xml).not.toContain("<a:tbl>");
    // Title, paragraph, then the diagram below the paragraph.
    const [, paragraph, ...diagram] = boxes(xml!);
    expect(Math.min(...diagram.map((box) => box.y))).toBeGreaterThanOrEqual(paragraph!.y + paragraph!.cy);
    wellFormed(files);
  });

  it("keeps the first 8 milestones as shapes and continues the rest as a table", async () => {
    const timeline = `timeline\n${Array.from({ length: 11 }, (_, index) => `  ${2010 + index} : 事件${index + 1}`).join("\n")}`;
    const files = readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "长历程", blocks: [{ kind: "mermaid", source: timeline }] }] })));
    const all = slideXml(files).join("\n");
    expect(shapes(all, "roundRect")).toBe(8);
    expect(all).toContain("事件8");
    expect(all).toContain("<a:tbl>");
    expect(all).toContain("事件11");
    expect(all).toContain("时间轴其余 3 项");
    wellFormed(files);
  });

  it("draws a left-to-right chain flowchart as boxes and right arrows, with <br/> as line breaks", async () => {
    const flowchart = 'flowchart LR\n  S0["上游<br/>材料"]\n  S1["中游<br/>制造"]\n  S2["下游"]\n  S0 --> S1\n  S1 --> S2';
    const files = readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "产业链", blocks: [{ kind: "mermaid", source: flowchart, caption: "上中下游" }, { kind: "paragraph", text: "结尾说明" }] }] })));
    const [xml] = slideXml(files);
    expect(xml).toContain("<p:sp>");
    expect(shapes(xml!, "roundRect")).toBe(3);
    expect(shapes(xml!, "rightArrow")).toBe(2);
    expect(xml).not.toContain("<a:tbl>");
    // `<br/>` splits a label into paragraphs.
    expect(xml).toMatch(/上游<\/a:t>[\s\S]*?<\/a:p><a:p>[\s\S]*?材料<\/a:t>/);
    for (const value of ["中游", "制造", "下游", "上中下游；图形在工作台预览中可交互", "结尾说明"]) expect(xml).toContain(value);
    expect(xml).not.toContain("&lt;br");
    // Boxes stay inside the margins and the following paragraph starts below the diagram.
    const [, ...rest] = boxes(xml!);
    const after = rest.pop()!;
    expect(after.y).toBeGreaterThanOrEqual(Math.max(...rest.map((box) => box.y + box.cy)));
    expect(Math.max(...rest.map((box) => box.x + box.cx))).toBeLessThanOrEqual(12_192_000 - 457_200);
    wellFormed(files);
  });

  /** Every drawn object on a slide: preset geometry, box and, for lines, the start / end implied by the flips. */
  const drawn = (xml: string) => {
    const chunks = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>|<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g)].map((match) => match[0]);
    return chunks.map((chunk) => {
      const m = chunk.match(/<(?:a|p):xfrm([^>]*)>\s*<a:off x="(\d+)" y="(\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/)!;
      const [x, y, cx, cy] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
      const flipH = m[1]!.includes('flipH="1"');
      const flipV = m[1]!.includes('flipV="1"');
      const prst = chunk.match(/prst="(\w+)"/)?.[1] ?? (chunk.includes("<a:tbl>") ? "table" : "frame");
      const text = [...chunk.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("|");
      return { prst, x, y, cx, cy, text, arrow: chunk.includes('<a:tailEnd type="triangle"/>'), x1: flipH ? x + cx : x, y1: flipV ? y + cy : y, x2: flipH ? x : x + cx, y2: flipV ? y : y + cy };
    });
  };
  const hitsInterior = (line: { x1: number; y1: number; x2: number; y2: number }, box: { x: number; y: number; cx: number; cy: number }) => {
    let low = 0;
    let high = 1;
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    for (const [p, q] of [[-dx, line.x1 - (box.x + 2)], [dx, box.x + box.cx - 2 - line.x1], [-dy, line.y1 - (box.y + 2)], [dy, box.y + box.cy - 2 - line.y1]]) {
      if (p === 0) { if (q! < 0) return false; continue; }
      const t = q! / p!;
      if (p! < 0) low = Math.max(low, t); else high = Math.min(high, t);
      if (low > high) return false;
    }
    return true;
  };
  const touches = (px: number, py: number, box: { x: number; y: number; cx: number; cy: number }) => px >= box.x - 2 && px <= box.x + box.cx + 2 && py >= box.y - 2 && py <= box.y + box.cy + 2;
  /**
   * Layout problems on one slide: objects outside the margins (x within 457_200, y within 228_600 of the
   * top / 137_160 of the bottom) and overlapping pairs. A line may touch the boxes its ends sit on; the
   * timeline axis (a full-width horizontal line) runs through its markers by design.
   */
  const layoutProblems = (xml: string): string[] => {
    const items = drawn(xml);
    const problems: string[] = [];
    for (const item of items) {
      if (item.x < 457_200 || item.x + item.cx > 12_192_000 - 457_200 || item.y < 228_600 || item.y + item.cy > 6_858_000 - 137_160) problems.push(`outside margins: ${item.prst} ${item.text} ${JSON.stringify([item.x, item.y, item.cx, item.cy])}`);
    }
    const solids = items.filter((item) => item.prst !== "line");
    solids.forEach((a, index) => {
      for (const b of solids.slice(index + 1)) {
        if (a.x < b.x + b.cx && b.x < a.x + a.cx && a.y < b.y + b.cy && b.y < a.y + a.cy) problems.push(`overlap: ${a.prst} "${a.text}" × ${b.prst} "${b.text}"`);
      }
    });
    for (const line of items.filter((item) => item.prst === "line" && !(item.cy <= 1 && item.cx === 11_277_600))) {
      for (const box of solids) {
        if (touches(line.x1, line.y1, box) || touches(line.x2, line.y2, box)) continue;
        if (hitsInterior(line, box)) problems.push(`line crosses ${box.prst} "${box.text}"`);
      }
    }
    return problems;
  };

  it("draws branching / merging LR and top-down flowcharts as layered boxes joined by arrow lines", async () => {
    const branching = 'flowchart LR\n  A["原料"] --> B["电池"]\n  A --> C["电机"]\n  B --> D["整车"]\n  C --> D';
    const topDown = 'flowchart TD\n  A["研发"] --> B["生产"]\n  A --> C["采购"]\n  C --> B';
    for (const [source, boxCount, arrows] of [[branching, 4, 4], [topDown, 3, 3]] as const) {
      const files = readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "链", kicker: "产业链", blocks: [{ kind: "mermaid", source, caption: "分支" }, { kind: "paragraph", text: "结尾" }] }] })));
      const [xml] = slideXml(files);
      expect(xml, source).not.toContain("<a:tbl>");
      expect(shapes(xml!, "rightArrow"), source).toBe(0);
      const items = drawn(xml!);
      const boxesOf = (label: string) => items.find((item) => item.prst === "roundRect" && item.text === label)!;
      expect(items.filter((item) => item.prst === "roundRect"), source).toHaveLength(boxCount);
      expect(items.filter((item) => item.prst === "line" && item.arrow), source).toHaveLength(arrows);
      expect(xml).toContain("分支；图形在工作台预览中可交互");
      // Every arrow ends on the left (LR) / top (TD) edge of a box.
      for (const line of items.filter((item) => item.arrow)) {
        const target = items.find((item) => item.prst === "roundRect" && (source === branching ? Math.abs(item.x - line.x2) <= 1 && line.y2 > item.y && line.y2 < item.y + item.cy : Math.abs(item.y - line.y2) <= 1 && line.x2 > item.x && line.x2 < item.x + item.cx));
        expect(target, `${source}: ${JSON.stringify(line)}`).toBeDefined();
      }
      if (source === branching) {
        expect(boxesOf("电池").x).toBeGreaterThan(boxesOf("原料").x);
        expect(boxesOf("电池").x).toBe(boxesOf("电机").x);
        expect(boxesOf("整车").x).toBeGreaterThan(boxesOf("电池").x);
        // One of the two fan-out arrows goes up: encoded as flipV.
        expect(xml).toContain('flipV="1"');
      } else {
        // 采购 sits one row above 生产 (longest path), 研发 on top.
        expect(boxesOf("采购").y).toBeGreaterThan(boxesOf("研发").y);
        expect(boxesOf("生产").y).toBeGreaterThan(boxesOf("采购").y);
      }
      expect(layoutProblems(xml!), source).toEqual([]);
      wellFormed(files);
    }
  });

  it("routes an edge that skips a layer through a bend instead of across the middle box", async () => {
    const source = 'flowchart LR\n  A["上游"] --> B["中游"]\n  B --> C["下游"]\n  A --> C';
    const [xml] = slideXml(readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "跨层", blocks: [{ kind: "mermaid", source }] }] }))));
    const items = drawn(xml!);
    expect(items.filter((item) => item.prst === "roundRect")).toHaveLength(3);
    // A→B, B→C, and A→bend, bend pass, bend→C; arrows only where a line meets a real box.
    expect(items.filter((item) => item.prst === "line")).toHaveLength(5);
    expect(items.filter((item) => item.arrow)).toHaveLength(3);
    expect(layoutProblems(xml!)).toEqual([]);
  });

  it("falls back to the data table for cyclic, oversized or unsupported-direction flowcharts", async () => {
    const cyclic = "flowchart LR\n  A --> B\n  B --> C\n  C --> A";
    const oversized = `flowchart LR\n  ${Array.from({ length: 11 }, (_, index) => `N${index}`).join(" --> ")}`;
    const rightToLeft = "flowchart RL\n  A --> B\n  A --> C";
    for (const source of [cyclic, oversized, rightToLeft]) {
      const files = readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "链", blocks: [{ kind: "mermaid", source }] }] })));
      const all = slideXml(files).join("\n");
      expect(all, source).toContain("<a:tbl>");
      expect(shapes(all, "rightArrow") + shapes(all, "roundRect") + shapes(all, "line"), source).toBe(0);
      expect(all, source).toContain("PPTX 以数据表呈现");
      wellFormed(files);
    }
    // A 7-node chain is beyond the arrow-chain limit but still drawn as a layered graph.
    const seven = `flowchart LR\n  ${Array.from({ length: 7 }, (_, index) => `N${index}`).join(" --> ")}`;
    const [xml] = slideXml(readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "链", blocks: [{ kind: "mermaid", source: seven }] }] }))));
    expect(shapes(xml!, "roundRect")).toBe(7);
    expect(xml).not.toContain("<a:tbl>");
    expect(layoutProblems(xml!)).toEqual([]);
  });

  it("draws a sankey as proportional node columns joined by flow lines, followed by its exact data table", async () => {
    const sankey = "sankey-beta\n营业收入,营业成本,1284639.23\n营业收入,毛利,624185.78\n毛利,期间费用,228594.78\n毛利,经营利润,395591\n经营利润,净利润,300000.10";
    const files = readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "利润流向", kicker: "财务", blocks: [{ kind: "mermaid", source: sankey, caption: "桑基图" }] }] })));
    const xmls = slideXml(files);
    const all = xmls.join("\n");
    const items = xmls.flatMap(drawn);
    const names = ["营业收入", "营业成本", "毛利", "期间费用", "经营利润", "净利润"];
    const nodes = items.filter((item) => item.prst === "rect" && names.includes(item.text.split("|")[0]!));
    const node = (name: string) => nodes.find((item) => item.text.split("|")[0] === name)!;
    expect(nodes).toHaveLength(6);
    // Values as written; a node whose only figure would be a sum of several links shows its name only.
    expect(node("营业收入").text).toBe("营业收入");
    expect(node("毛利").text).toBe("毛利|624185.78");
    expect(all).not.toContain("1908825.01");
    expect(node("营业成本").text).toBe("营业成本|1284639.23");
    expect(node("净利润").text).toBe("净利润|300000.10");
    // Columns follow the flow; heights share one scale (above the readable minimum).
    expect(node("营业成本").x).toBe(node("毛利").x);
    expect(node("经营利润").x).toBeGreaterThan(node("毛利").x);
    expect(node("营业成本").cy / node("毛利").cy).toBeCloseTo(1284639.23 / 624185.78, 1);
    expect(node("营业收入").cy).toBeGreaterThan(node("营业成本").cy);
    // One line per link, from the source's right edge to the target's left edge, no arrows.
    const lines = items.filter((item) => item.prst === "line");
    expect(lines).toHaveLength(5);
    expect(lines.every((line) => !line.arrow)).toBe(true);
    expect(lines.some((line) => line.x1 === node("营业收入").x + node("营业收入").cx && line.x2 === node("毛利").x)).toBe(true);
    expect(all).toContain("桑基图；图形在工作台预览中可交互");
    expect(all).toContain("<a:tbl>");
    expect(all).toContain("桑基图数据");
    expect(all).toContain("300000.10");
    expect(all).not.toContain("PPTX 以数据表呈现");
    for (const xml of xmls) expect(layoutProblems(xml)).toEqual([]);
    wellFormed(files);
  });

  /** Text of every sankey node rectangle (name|value) on the first slide of a one-diagram deck. */
  const sankeyLabels = async (source: string) => {
    const [xml] = slideXml(readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "流向", blocks: [{ kind: "mermaid", source }] }] }))));
    return { xml: xml!, labels: drawn(xml!).filter((item) => item.prst === "rect" && item.text && !["流向", "桑基图数据"].includes(item.text) && !item.text.includes("图形在工作台")).map((item) => item.text) };
  };

  it("parses quoted thousands and exponent values; unparseable rows keep their text and the sankey stays a table", async () => {
    const quoted = 'sankey-beta\nA,B,"1,000"\nA,C,500';
    expect(mermaidTable(quoted)).toEqual({ headers: ["来源", "去向", "数值"], rows: [["A", "B", 1000], ["A", "C", 500]] });
    const drawnQuoted = await sankeyLabels(quoted);
    expect(drawnQuoted.labels.sort()).toEqual(["A", "B|1,000", "C|500"]);
    expect(drawnQuoted.xml).not.toContain("PPTX 以数据表呈现");
    const exponent = await sankeyLabels("sankey-beta\nA,B,1e3\nA,C,500");
    expect(exponent.labels.sort()).toEqual(["A", "B|1e3", "C|500"]);
    expect(exponent.xml).not.toContain(" + ");
    expect(exponent.xml).not.toContain("1500");
    // Inflow 1e3 equals outflow 400 + 600 exactly: the single written value.
    expect((await sankeyLabels("sankey-beta\nA,M,1e3\nM,X,400\nM,Y,600")).labels).toContain("M|1e3");
    for (const [source, kept] of [["sankey-beta\nA,B,abc\nA,C,500", ["A", "B", "abc"]], ["sankey-beta\nA,B,1,000\nA,C,500", ["A", "B", "1,000"]], ["sankey-beta\nA,B\nA,C,500", ["A", "B", ""]]] as const) {
      expect(mermaidTable(source)!.rows, source).toEqual([kept, ["A", "C", 500]]);
      const all = slideXml(readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "流向", blocks: [{ kind: "mermaid", source }] }] })))).join("\n");
      expect(shapes(all, "line"), source).toBe(0);
      expect(all, source).toContain("PPTX 以数据表呈现");
      if (kept[2]) expect(all, source).toContain(`<a:t>${kept[2]}</a:t>`);
    }
    expect(deckSpecToXlsx({ slides: [{ title: "流向", blocks: [{ kind: "mermaid", source: "sankey-beta\nA,B,abc" }] }] }).sheets[0]!.rows).toEqual([["A", "B", "abc"]]);
  });

  it("labels a sankey node with a value from the source, never a sum that is not in the source", async () => {
    // Inflow 100 ≠ outflow 30 + 50: the larger side's own value.
    expect((await sankeyLabels("sankey-beta\n收入,毛利,100\n毛利,费用,30\n毛利,利润,50")).labels).toContain("毛利|100");
    // Outflow 30 + 40 > inflow 10 and is itself a sum: name only.
    expect((await sankeyLabels("sankey-beta\nA,M,10\nM,X,30\nM,Y,40")).labels).toContain("M");
    // Both sides agree but each is a sum (10 + 20.5 = 15.25 + 15.25): name only, no figure absent from the source.
    const both = await sankeyLabels("sankey-beta\nA,M,10\nB,M,20.5\nM,X,15.25\nM,Y,15.25");
    expect(both.labels).toContain("M");
    expect(both.xml).not.toContain("30.5");
    // A source node with several outflows: name only; the data table keeps the exact values.
    const source = await sankeyLabels("sankey-beta\n收入,成本,60.1\n收入,毛利,39.9");
    expect(source.labels).toContain("收入");
    expect(source.xml).not.toContain(">100<");
  });

  it("keeps sankeys with more than 12 nodes or non-positive values as a data table", async () => {
    const many = `sankey-beta\n${Array.from({ length: 12 }, (_, index) => `源,去向${index + 1},${index + 1}`).join("\n")}`;
    const negative = "sankey-beta\n收入,成本,100\n收入,亏损,-20";
    const zero = "sankey-beta\n收入,成本,0";
    for (const source of [many, negative, zero]) {
      const all = slideXml(readWorkBuddyZip(Buffer.from(await buildPptx({ slides: [{ title: "流向", blocks: [{ kind: "mermaid", source }] }] })))).join("\n");
      expect(all, source).toContain("<a:tbl>");
      expect(shapes(all, "line"), source).toBe(0);
      expect(all, source).toContain("PPTX 以数据表呈现");
    }
  });

  it("keeps the kicker, title and body apart and every object inside the margins", async () => {
    const spec: PptxSpec = {
      slides: [
        { title: "页眉", kicker: "第一章", blocks: [{ kind: "paragraph", text: "正文" }, { kind: "table", headers: ["a", "b"], rows: [["1", "2"]], caption: "表注" }, { kind: "note", text: "说明", tone: "assumption" }] },
        { title: "时间轴", kicker: "历程", blocks: [{ kind: "mermaid", source: "timeline\n  2019 : 成立\n  2021 : 首店", caption: "里程碑" }] },
      ],
    };
    const xmls = slideXml(readWorkBuddyZip(Buffer.from(await buildPptx(spec))));
    const [first] = xmls;
    const kicker = drawn(first!).find((item) => item.text === "第一章")!;
    const title = drawn(first!).find((item) => item.text === "页眉")!;
    expect(kicker.y + kicker.cy).toBeLessThanOrEqual(title.y);
    expect(title.y + title.cy).toBeLessThanOrEqual(1_325_880);
    for (const xml of xmls) expect(layoutProblems(xml)).toEqual([]);
    const deck = slideXml(readWorkBuddyZip(Buffer.from(await buildPptx(industryDeck))));
    for (const xml of deck) expect(layoutProblems(xml)).toEqual([]);
  });

  it("merges tables beyond the xlsx sheet limit into one sheet instead of dropping them", async () => {
    const spec: PptxSpec = { slides: Array.from({ length: 24 }, (_, index) => ({ title: `表${index + 1}`, blocks: [{ kind: "table" as const, headers: ["a", "b"], rows: [[`r${index + 1}`, index + 1]] }] })) };
    const sheets = deckSpecToXlsx(spec).sheets;
    expect(sheets).toHaveLength(20);
    expect(sheets[18]!.name).toBe("表19");
    const merged = sheets[19]!;
    expect(merged.name).toBe("其他表格与图表数据");
    expect(merged.rows.map((row) => row[0]).filter(Boolean)).toEqual(["表20", "表21", "表22", "表23", "表24"]);
    expect(merged.rows).toContainEqual(["", "r24", 24]);
    const files = readWorkBuddyZip(Buffer.from(await buildXlsx({ sheets })));
    expect(text(files, "xl/workbook.xml")).toContain("其他表格与图表数据");
  });

  it("exports the UpUp industry DeckSpec fixture as a well-formed deck", async () => {
    const bytes = await buildPptx(industryDeck);
    const files = readWorkBuddyZip(Buffer.from(bytes));
    const slides = slideNames(files);
    expect(slides.length).toBeGreaterThanOrEqual(industryDeck.slides.length);
    const charts = industryDeck.slides.flatMap((slide) => slide.blocks ?? []).filter((block) => block.kind === "chart").length;
    expect([...files.keys()].filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))).toHaveLength(charts);
    for (const name of xmlNames(files)) {
      const parsed = new DOMParser().parseFromString(text(files, name), "application/xml");
      expect(parsed.getElementsByTagName("parsererror").length, name).toBe(0);
    }
    const all = [...files.entries()].map(([, value]) => new TextDecoder().decode(value)).join("\n");
    expect(all).toContain(industryDeck.slides[0]!.title);
    expect(all).toContain("环节毛利率");
    // The 上中下游 industry chain flowchart is drawn as native boxes and arrows, not a table.
    const chain = slides.map((name) => text(files, name)).find((xml) => xml.includes("设备制造与打印服务"))!;
    expect(chain).toBeDefined();
    expect(chain.split('prst="rightArrow"').length - 1).toBe(2);
    expect(chain).toContain("材料与核心零部件");
    expect(chain).toContain("产业链上中下游；图形在工作台预览中可交互");
  });

  it("exports the same DeckSpec as an xlsx: tables merged across continuation pages, chart data and sources", async () => {
    const spec = deckSpecToXlsx(industryDeck);
    const names = spec.sheets.map((sheet) => sheet.name);
    expect(names).toContain("政策矩阵");
    expect(names).toContain("来源");
    expect(names.some((name) => name?.startsWith("图-"))).toBe(true);
    expect(names.some((name) => /续/.test(name ?? ""))).toBe(false);
    const policyRows = industryDeck.slides.filter((slide) => slide.title.startsWith("政策矩阵") && !slide.title.includes("密度")).flatMap((slide) => slide.blocks ?? []).flatMap((block) => (block.kind === "table" ? block.rows : []));
    expect(spec.sheets.find((sheet) => sheet.name === "政策矩阵")!.rows).toHaveLength(policyRows.length);
    expect(spec.sheets.length).toBeLessThanOrEqual(20);
    const files = readWorkBuddyZip(Buffer.from(await buildXlsx(spec)));
    expect(text(files, "xl/workbook.xml")).toContain("来源");
    expect(() => deckSpecToXlsx({ slides: [{ title: "空", blocks: [{ kind: "paragraph", text: "x" }] }] })).toThrow("没有可导出");
  });

  it("exports the same DeckSpec as a Word report with merged tables and labelled notes", async () => {
    const spec = deckSpecToDocx(industryDeck);
    expect(spec.title).toBe(industryDeck.title);
    const headings = spec.blocks.filter((block) => block.type === "heading").map((block) => (block.type === "heading" ? block.text : ""));
    expect(headings).toContain("一、产业事实与数据");
    expect(headings.some((text) => /续/.test(text))).toBe(false);
    const paragraphs = spec.blocks.flatMap((block) => (block.type === "paragraph" ? [block.text] : []));
    expect(paragraphs.some((text) => text.startsWith("【假设】"))).toBe(true);
    expect(paragraphs.some((text) => text.startsWith("图："))).toBe(true);
    const files = readWorkBuddyZip(Buffer.from(await buildDocx(spec)));
    const xml = text(files, "word/document.xml");
    expect(new DOMParser().parseFromString(xml, "application/xml").getElementsByTagName("parsererror").length).toBe(0);
    expect(xml).toContain("政策矩阵");
  });
});
