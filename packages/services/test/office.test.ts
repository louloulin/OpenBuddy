// @vitest-environment node
// B2b: the office builders produce real OOXML packages (officegen) that unzip and parse.
import { describe, expect, it } from "vitest";
import { readWorkBuddyZip } from "../src/agents/workbuddy";
import { buildDocx, buildPptx, buildXlsx } from "../src/office/index";

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
