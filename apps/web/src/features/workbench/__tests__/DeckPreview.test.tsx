import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeckPreview, parseDeckSpec } from "../DeckPreview";
import { benchKind, isTextKind } from "../bench-kind";

vi.mock("../MermaidView", () => ({ MermaidView: ({ source }: { source: string }) => <pre data-testid="mermaid">{source}</pre> }));

// Same DeckSpec the UpUp pipeline produces and ob_pptx exports (cross-repo fixture).
const fixture = readFileSync(join(__dirname, "../../../../../../packages/services/test/fixtures/industry-deck.json"), "utf8");

describe("报告规格预览 DeckPreview (P2-2)", () => {
  it("*.deck.json 走报告规格预览，按文本读取", () => {
    expect(benchKind("/work/3d.deck.json")).toBe("deck");
    expect(benchKind("/work/3d.obdeck.json")).toBe("deck");
    expect(benchKind("/work/data.json")).toBe("json");
    expect(isTextKind("deck")).toBe(true);
  });

  it("翻页查看 fixture：封面、表格、SVG 图表与来源脚注", () => {
    render(<DeckPreview text={fixture} />);
    const spec = parseDeckSpec(fixture).spec!;
    expect(screen.getByText(`1 / ${spec.slides.length}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: spec.slides[0]!.title })).toBeInTheDocument();

    const tableIndex = spec.slides.findIndex((slide) => slide.title === "政策矩阵");
    fireEvent.click(screen.getAllByRole("button", { name: /政策矩阵/ })[0]!);
    expect(screen.getByText(`${tableIndex + 1} / ${spec.slides.length}`)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText(/来源：《3D打印产业分析报告》/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /环节毛利率曲线/ }));
    expect(screen.getByRole("img", { name: "环节毛利率（%）" })).toBeInTheDocument();
    expect(document.querySelector(".deck-chart polyline")).not.toBeNull();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "SCP 评分" })).toBeInTheDocument();
  });

  it("空数据图表显示缺少证据，不补造数据", () => {
    const spec = { schemaVersion: 1, title: "x", asOf: "2026-11-27", sources: [], slides: [{ title: "空图", layout: "chart", blocks: [{ kind: "chart", chartType: "column", title: "空", categories: [], series: [] }] }] };
    render(<DeckPreview text={JSON.stringify(spec)} />);
    expect(screen.getByText(/缺少证据/)).toBeInTheDocument();
    expect(document.querySelector(".deck-chart")).toBeNull();
  });

  it("非 DeckSpec 文件给出原因，文本不会被当作 HTML", () => {
    render(<DeckPreview text='{"schemaVersion":2}' />);
    expect(screen.getByText("无法预览这份报告规格")).toBeInTheDocument();
    const xss = { schemaVersion: 1, title: "x", asOf: "", sources: [], slides: [{ title: "<img src=x onerror=alert(1)>", layout: "content", blocks: [{ kind: "paragraph", text: "<b>raw</b>" }] }] };
    render(<DeckPreview text={JSON.stringify(xss)} />);
    expect(screen.getByText("<b>raw</b>")).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
