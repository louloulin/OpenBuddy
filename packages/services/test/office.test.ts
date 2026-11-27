// B2b: the office builders produce real OOXML packages (officegen) that unzip and parse.
import { describe, expect, it } from "vitest";
import { readWorkBuddyZip } from "../src/agents/workbuddy";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDocx, buildPptx, buildXlsx, deckSpecToDocx, deckSpecToXlsx, type PptxSpec } from "../src/office/index";

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
    expect(all).not.toContain("b · 走势");
  });

  it("skips charts without data and images outside the workspace instead of inventing content", async () => {
    const bytes = await buildPptx({
      slides: [{ title: "空", blocks: [
        { kind: "chart", chartType: "column", title: "空图", categories: [], series: [] },
        { kind: "image", path: "../secret.png", alt: "外部图片" },
        { kind: "mermaid", source: "flowchart LR\n A-->B", caption: "产业链" },
      ] }],
    }, { resolveImage: () => null });
    const files = readWorkBuddyZip(Buffer.from(bytes));
    const all = [...files.entries()].map(([, value]) => new TextDecoder().decode(value)).join("\n");
    expect([...files.keys()].some((name) => name.startsWith("ppt/charts/"))).toBe(false);
    expect(all).toContain("缺少可绘制的数据");
    expect(all).toContain("未导出");
    expect(all).toContain("产业链：流程图在工作台预览");
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
