import { useEffect, useMemo, useState } from "react";
import { MermaidView } from "./MermaidView";

/**
 * 报告规格预览 (P2-2): renders an UpUp `DeckSpec` (schemaVersion 1, `*.deck.json`) as 16:9 slides — the same
 * spec `ob_pptx` exports to PPTX. The file is untrusted data: it is shape-checked, every string is rendered as
 * text, and charts are drawn as inline SVG from the numbers in the file only (empty data → an empty state).
 */

type Cell = string | number;
type Tone = "assumption" | "inference" | "disclaimer";
export type DeckBlock =
  | { kind: "bullets"; items: string[] }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; headers: string[]; rows: Cell[][]; caption?: string; sourceId?: string }
  | { kind: "chart"; chartType: "column" | "line" | "pie"; title: string; categories: string[]; series: Array<{ name: string; values: number[] }>; unit?: string; sourceId?: string }
  | { kind: "kpi"; items: Array<{ label: string; value: string; delta?: string }> }
  | { kind: "image"; path: string; alt?: string }
  | { kind: "note"; text: string; tone: Tone }
  | { kind: "mermaid"; source: string; caption?: string };
export interface DeckSlide { title: string; kicker?: string; layout: string; blocks: DeckBlock[] }
export interface DeckSource { id: string; name: string; url?: string; asOf: string }
export interface DeckSpec { schemaVersion: 1; title: string; subtitle?: string; asOf: string; sources: DeckSource[]; slides: DeckSlide[] }

const MAX_SLIDES = 100;
const MAX_BLOCKS = 24;
const str = (value: unknown, max = 2000): string => (typeof value === "string" ? value.slice(0, max) : typeof value === "number" && Number.isFinite(value) ? String(value) : "");
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const cell = (value: unknown): Cell => (typeof value === "number" && Number.isFinite(value) ? value : str(value, 400));

function parseBlock(raw: unknown): DeckBlock | null {
  const b = rec(raw);
  switch (b.kind) {
    case "bullets": return { kind: "bullets", items: arr(b.items).map((item) => str(item, 600)).filter(Boolean).slice(0, 40) };
    case "paragraph": return { kind: "paragraph", text: str(b.text) };
    case "note": return { kind: "note", text: str(b.text), tone: b.tone === "assumption" || b.tone === "inference" ? b.tone : "disclaimer" };
    case "table": {
      const headers = arr(b.headers).map((h) => str(h, 120)).slice(0, 16);
      const rows = arr(b.rows).slice(0, 200).map((row) => arr(row).slice(0, 16).map(cell));
      return { kind: "table", headers, rows, ...(str(b.caption) ? { caption: str(b.caption, 300) } : {}), ...(str(b.sourceId) ? { sourceId: str(b.sourceId, 80) } : {}) };
    }
    case "chart": {
      const categories = arr(b.categories).map((c) => str(c, 60)).slice(0, 24);
      const series = arr(b.series).slice(0, 6).map((s) => ({ name: str(rec(s).name, 60), values: arr(rec(s).values).slice(0, categories.length).map((v) => (typeof v === "number" ? v : Number.NaN)) }));
      const chartType = b.chartType === "pie" || b.chartType === "line" ? b.chartType : "column";
      return { kind: "chart", chartType, title: str(b.title, 120), categories, series, ...(str(b.unit) ? { unit: str(b.unit, 16) } : {}), ...(str(b.sourceId) ? { sourceId: str(b.sourceId, 80) } : {}) };
    }
    case "kpi": return { kind: "kpi", items: arr(b.items).slice(0, 6).map((i) => ({ label: str(rec(i).label, 60), value: str(rec(i).value, 40), ...(str(rec(i).delta) ? { delta: str(rec(i).delta, 80) } : {}) })) };
    case "image": return { kind: "image", path: str(b.path, 400), ...(str(b.alt) ? { alt: str(b.alt, 200) } : {}) };
    case "mermaid": return { kind: "mermaid", source: str(b.source, 8000), ...(str(b.caption) ? { caption: str(b.caption, 200) } : {}) };
    default: return null;
  }
}

/** Shape-checks untrusted JSON; returns null plus a reason when it is not a DeckSpec. */
export function parseDeckSpec(text: string): { spec: DeckSpec | null; error?: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { spec: null, error: "不是有效的 JSON" }; }
  const value = rec(raw);
  if (value.schemaVersion !== 1) return { spec: null, error: "不是 schemaVersion 1 的报告规格（DeckSpec）" };
  const slides = arr(value.slides).slice(0, MAX_SLIDES).map((s) => {
    const slide = rec(s);
    return {
      title: str(slide.title, 200) || "（无标题）",
      ...(str(slide.kicker) ? { kicker: str(slide.kicker, 60) } : {}),
      layout: str(slide.layout, 20) || "content",
      blocks: arr(slide.blocks).slice(0, MAX_BLOCKS).map(parseBlock).filter((block): block is DeckBlock => block !== null),
    };
  });
  if (!slides.length) return { spec: null, error: "报告规格里没有幻灯片" };
  const sources = arr(value.sources).map((s) => ({ id: str(rec(s).id, 80), name: str(rec(s).name, 200), asOf: str(rec(s).asOf, 20), ...(str(rec(s).url) ? { url: str(rec(s).url, 400) } : {}) })).filter((s) => s.id);
  return { spec: { schemaVersion: 1, title: str(value.title, 200), ...(str(value.subtitle) ? { subtitle: str(value.subtitle, 200) } : {}), asOf: str(value.asOf, 20), sources, slides } };
}

const PALETTE = ["var(--deck-c1)", "var(--deck-c2)", "var(--deck-c3)", "var(--deck-c4)", "var(--deck-c5)", "var(--deck-c6)"];
const NOTE_LABEL: Record<Tone, string> = { assumption: "假设", inference: "推断", disclaimer: "声明" };
const fmt = (value: number) => (Math.abs(value) >= 1000 ? value.toLocaleString("zh-CN", { maximumFractionDigits: 1 }) : String(Number(value.toFixed(2))));

function ChartView({ block }: { block: Extract<DeckBlock, { kind: "chart" }> }) {
  const series = block.series.filter((s) => s.values.length === block.categories.length && s.values.every(Number.isFinite));
  if (!block.categories.length || !series.length) return <div className="deck-empty">缺少证据：图表没有可绘制的数据</div>;
  const W = 640;
  const H = 300;
  if (block.chartType === "pie") {
    const values = series[0]!.values.map((v) => Math.max(0, v));
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= 0) return <div className="deck-empty">缺少证据：图表数据合计为 0</div>;
    let angle = -Math.PI / 2;
    const cx = 150, cy = 150, r = 120;
    return (
      <svg className="deck-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={block.title}>
        {values.map((value, index) => {
          const start = angle;
          const sweep = (value / total) * Math.PI * 2;
          angle += sweep;
          if (value === 0) return null;
          const full = sweep >= Math.PI * 2 - 1e-6;
          const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start), x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle);
          return full
            ? <circle key={index} cx={cx} cy={cy} r={r} fill={PALETTE[index % PALETTE.length]} />
            : <path key={index} d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2},${y2} Z`} fill={PALETTE[index % PALETTE.length]} />;
        })}
        {block.categories.map((category, index) => (
          <g key={index} transform={`translate(310, ${30 + index * 24})`}>
            <rect width="14" height="14" fill={PALETTE[index % PALETTE.length]} />
            <text x="22" y="12" className="deck-chart__label">{`${category} ${((values[index]! / total) * 100).toFixed(1)}%`}</text>
          </g>
        ))}
      </svg>
    );
  }
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const left = 56, right = 16, top = 16, bottom = 40;
  const plotW = W - left - right, plotH = H - top - bottom;
  const y = (v: number) => top + ((max - v) / span) * plotH;
  const step = plotW / block.categories.length;
  const barW = (step * 0.7) / series.length;
  return (
    <svg className="deck-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={block.title}>
      <line x1={left} x2={W - right} y1={y(0)} y2={y(0)} className="deck-chart__axis" />
      <text x={left - 6} y={y(max) + 4} textAnchor="end" className="deck-chart__tick">{fmt(max)}</text>
      {min < 0 && <text x={left - 6} y={y(min) + 4} textAnchor="end" className="deck-chart__tick">{fmt(min)}</text>}
      {block.categories.map((category, index) => (
        <text key={index} x={left + step * index + step / 2} y={H - bottom + 18} textAnchor="middle" className="deck-chart__tick">{category.length > 8 ? `${category.slice(0, 8)}…` : category}</text>
      ))}
      {series.map((s, si) => block.chartType === "line"
        ? (
          <g key={si}>
            <polyline fill="none" stroke={PALETTE[si % PALETTE.length]} strokeWidth="3" points={s.values.map((v, i) => `${left + step * i + step / 2},${y(v)}`).join(" ")} />
            {s.values.map((v, i) => <circle key={i} cx={left + step * i + step / 2} cy={y(v)} r="4" fill={PALETTE[si % PALETTE.length]}><title>{`${block.categories[i]}：${fmt(v)}`}</title></circle>)}
          </g>
        )
        : s.values.map((v, i) => (
          <rect key={`${si}-${i}`} x={left + step * i + step * 0.15 + barW * si} y={Math.min(y(v), y(0))} width={barW} height={Math.abs(y(v) - y(0))} fill={PALETTE[si % PALETTE.length]}>
            <title>{`${s.name} · ${block.categories[i]}：${fmt(v)}`}</title>
          </rect>
        )))}
      {series.length > 1 && series.map((s, si) => (
        <g key={`legend-${si}`} transform={`translate(${left + si * 120}, ${H - 12})`}>
          <rect width="10" height="10" y="-9" fill={PALETTE[si % PALETTE.length]} />
          <text x="14" className="deck-chart__tick">{s.name}</text>
        </g>
      ))}
    </svg>
  );
}

function BlockView({ block, sources }: { block: DeckBlock; sources: Map<string, DeckSource> }) {
  switch (block.kind) {
    case "bullets": return <ul className="deck-bullets">{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
    case "paragraph": return <p className="deck-paragraph">{block.text}</p>;
    case "note": return <div className={`deck-note deck-note--${block.tone}`}><b>{NOTE_LABEL[block.tone]}</b>{block.text}</div>;
    case "kpi": return (
      <div className="deck-kpis">
        {block.items.map((item, i) => <div key={i} className="deck-kpi"><div className="deck-kpi__value">{item.value || "—"}</div><div className="deck-kpi__label">{item.label}</div>{item.delta && <div className="deck-kpi__delta">{item.delta}</div>}</div>)}
      </div>
    );
    case "table": {
      const source = block.sourceId ? sources.get(block.sourceId) : undefined;
      return (
        <figure className="deck-figure">
          <table className="deck-table">
            {block.headers.length > 0 && <thead><tr>{block.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>}
            <tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className={typeof c === "number" ? "deck-num" : undefined}>{c}</td>)}</tr>)}</tbody>
          </table>
          {(block.caption || source) && <figcaption>{[block.caption, source && `来源：${source.name}（${source.asOf}）`].filter(Boolean).join(" ｜ ")}</figcaption>}
        </figure>
      );
    }
    case "chart": {
      const source = block.sourceId ? sources.get(block.sourceId) : undefined;
      return (
        <figure className="deck-figure">
          <div className="deck-chart__title">{block.title}{block.unit ? `（${block.unit}）` : ""}</div>
          <ChartView block={block} />
          {source && <figcaption>来源：{source.name}（{source.asOf}）</figcaption>}
        </figure>
      );
    }
    case "mermaid": return <figure className="deck-figure"><MermaidView source={block.source} />{block.caption && <figcaption>{block.caption}</figcaption>}</figure>;
    case "image": return <div className="deck-empty">图片 {block.alt ?? block.path}（导出 PPTX 时嵌入）</div>;
    default: return null;
  }
}

function SlideView({ slide, spec, index }: { slide: DeckSlide; spec: DeckSpec; index: number }) {
  const sources = useMemo(() => new Map(spec.sources.map((s) => [s.id, s])), [spec.sources]);
  const cover = slide.layout === "cover";
  const section = slide.layout === "section";
  return (
    <article className={`deck-slide deck-slide--${cover ? "cover" : section ? "section" : "content"}`} aria-label={`第 ${index + 1} 页：${slide.title}`}>
      {slide.kicker && <div className="deck-slide__kicker">{slide.kicker}</div>}
      <h2 className="deck-slide__title">{slide.title}</h2>
      {cover && spec.subtitle && <div className="deck-slide__subtitle">{spec.subtitle}</div>}
      <div className="deck-slide__body">{slide.blocks.map((block, i) => <BlockView key={i} block={block} sources={sources} />)}</div>
      <div className="deck-slide__page">{index + 1}</div>
    </article>
  );
}

export function DeckPreview({ text }: { text: string }) {
  const { spec, error } = useMemo(() => parseDeckSpec(text), [text]);
  const [current, setCurrent] = useState(0);
  useEffect(() => { setCurrent(0); }, [text]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!spec || (event.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") setCurrent((i) => Math.min(spec.slides.length - 1, i + 1));
      if (event.key === "ArrowLeft" || event.key === "PageUp") setCurrent((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spec]);
  if (!spec) return <div className="bench-empty"><div className="bench-empty__title">无法预览这份报告规格</div><div className="bench-empty__hint">{error}</div></div>;
  const slide = spec.slides[Math.min(current, spec.slides.length - 1)]!;
  const stats = spec.slides.flatMap((s) => s.blocks);
  return (
    <div className="deck-preview">
      <div className="deck-preview__bar">
        <span className="deck-preview__meta">{spec.title} · {spec.slides.length} 页 · {stats.filter((b) => b.kind === "table").length} 表 · {stats.filter((b) => b.kind === "chart").length} 图{spec.asOf ? ` · 数据截止 ${spec.asOf}` : ""}</span>
        <div className="bench-seg">
          <button type="button" className="bench-seg__opt" disabled={current === 0} onClick={() => setCurrent((i) => Math.max(0, i - 1))} aria-label="上一页">‹</button>
          <span className="deck-preview__count">{current + 1} / {spec.slides.length}</span>
          <button type="button" className="bench-seg__opt" disabled={current >= spec.slides.length - 1} onClick={() => setCurrent((i) => Math.min(spec.slides.length - 1, i + 1))} aria-label="下一页">›</button>
        </div>
      </div>
      <div className="deck-preview__main">
        <nav className="deck-thumbs" aria-label="幻灯片">
          {spec.slides.map((s, i) => (
            <button key={i} type="button" className={"deck-thumb" + (i === current ? " deck-thumb--on" : "")} aria-current={i === current} onClick={() => setCurrent(i)}>
              <span className="deck-thumb__no">{i + 1}</span>
              <span className="deck-thumb__title">{s.title}</span>
            </button>
          ))}
        </nav>
        <div className="deck-stage"><SlideView slide={slide} spec={spec} index={current} /></div>
      </div>
    </div>
  );
}
