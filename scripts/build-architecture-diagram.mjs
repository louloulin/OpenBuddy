#!/usr/bin/env node
// Validate the architecture diagram Markdown source and emit an SVG fallback so
// that downstream docs (Markdown, HTML, PDF) can include the diagram even when
// `@mermaid-js/mermaid-cli` (mmdc) is unavailable.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const srcPath = "docs/casdoor-newapi-openbuddy-architecture-diagram.md";
const fallbackPath = "docs/casdoor-newapi-openbuddy-architecture-diagram.svg";
const renderedPath = "docs/casdoor-newapi-openbuddy-architecture-diagram.rendered.svg";
const source = readFileSync(srcPath, "utf8");

const mermaidBlocks = [...source.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m) => m[1].trim());
if (mermaidBlocks.length === 0) throw new Error("no ```mermaid blocks found in architecture diagram source");

const validHeadings = new Set(["flowchart", "sequenceDiagram", "graph", "classDiagram", "stateDiagram", "erDiagram", "gantt", "pie", "journey"]);
for (const [index, block] of mermaidBlocks.entries()) {
  const head = block.split(/\s+/)[0];
  if (!validHeadings.has(head)) throw new Error("mermaid block " + index + " starts with unsupported head: " + head);
}

const titles = mermaidBlocks.map((block) => {
  const firstLine = block.split("\n", 1)[0].trim();
  const titleMatch = firstLine.match(/^(?:flowchart|graph)\s+(?:LR|TB|RL|BT)\b(?:\s+(.+))?/);
  return titleMatch && titleMatch[1] ? titleMatch[1] : firstLine.slice(0, 80);
});

const palette = ["#38bdf8", "#a855f7", "#22c55e", "#f97316", "#facc15", "#ec4899", "#14b8a6", "#e11d48"];
const escapeXml = (value) => String(value).replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]);

const rects = titles.map((title, index) => {
  const x = 40 + (index % 2) * 440;
  const y = 60 + Math.floor(index / 2) * 160;
  const fill = palette[index % palette.length];
  return [
    "<g>",
    `<rect x="${x}" y="${y}" width="400" height="120" rx="14" fill="${fill}" fill-opacity="0.12" stroke="${fill}" stroke-width="2"/>`,
    `<text x="${x + 20}" y="${y + 36}" fill="${fill}" font-size="18" font-weight="700">#${index + 1} ${escapeXml(title)}</text>`,
    `<text x="${x + 20}" y="${y + 64}" fill="#cbd5f5" font-size="12">Source: docs/casdoor-newapi-openbuddy-architecture-diagram.md</text>`,
    `<text x="${x + 20}" y="${y + 88}" fill="#94a3b8" font-size="11">Render full Mermaid via @mermaid-js/mermaid-cli (mmdc).</text>`,
    "</g>",
  ].join("");
}).join("\n");

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 ${60 + Math.ceil(titles.length / 2) * 160 + 40}" font-family="ui-monospace,Menlo,monospace">`,
  `<rect width="100%" height="100%" fill="#0b1220"/>`,
  `<text x="40" y="36" fill="#f8fafc" font-size="22" font-weight="700">Casdoor + New API + OpenBuddy 集成架构</text>`,
  rects,
  "</svg>",
  "",
].join("\n");
writeFileSync(fallbackPath, svg);

let mermaidRendered = false;
if (existsSync("node_modules/.bin/mmdc")) {
  try {
    execFileSync("node_modules/.bin/mmdc", ["-i", srcPath, "-o", renderedPath, "-q"], { stdio: "inherit" });
    mermaidRendered = true;
  } catch (error) {
    console.warn("[build-architecture-diagram] mmdc failed; falling back to static SVG:", error.message);
  }
}

console.log(JSON.stringify({ mermaidBlocks: mermaidBlocks.length, titles, fallbackPath, mermaidRendered }));
