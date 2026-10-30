/**
 * scanCss.mjs — 视觉契约测试的共享扫描逻辑（plan1030 批 1）。
 *
 * 设计约束：
 *   - 测试与基线生成脚本必须用同一份扫描逻辑，避免口径漂移。
 *     generate-baseline.mjs 与所有 *.test.ts 都 import 本文件。
 *   - 扫描是「不完美启发式」：hex 用值上下文定界以排除 id 选择器，
 *     伪元素/字符串场景可能有极少数误报——快照模式下只要求口径稳定。
 *   - 扫描前剥离 /* ... *​/ 注释，注释里的示例色值不计入。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 双环境取目录：plain node 下 import.meta.url 是 file://；
 * vitest/vite 转换后是普通绝对路径字符串。
 */
function moduleDir() {
  const u = import.meta.url;
  return u.startsWith("file:") ? dirname(fileURLToPath(u)) : dirname(u);
}

const CONTRACTS_DIR = moduleDir();
export const STYLES_DIR = join(CONTRACTS_DIR, "..");

export function listStyleFiles() {
  return readdirSync(STYLES_DIR).filter((f) => f.endsWith(".css")).sort();
}

export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 数「声明值不含 var(」的裸值声明数。 */
function countBareDecl(text, prop) {
  let n = 0;
  for (const m of text.matchAll(new RegExp(`${prop}\\s*:\\s*([^;]+);`, "gi"))) {
    if (!m[1].includes("var(")) n += 1;
  }
  return n;
}

/**
 * 扫描单个 CSS 文本，返回五个契约维度的违规计数：
 *   hex          — 值上下文中的硬编码颜色（#rgb/#rrggbb/#rrggbbaa）
 *   radiusBare   — border-radius 裸值（未走 --radius-* / var()）
 *   fontSizeBare — font-size 裸值
 *   zIndexBare   — z-index 裸值（未走 --z-* 刻度）
 *   heavyWeight  — font-weight > 600（含 bold 关键字，合成加粗风险）
 */
export function scanFile(cssText) {
  const t = stripComments(cssText);

  let hex = 0;
  for (const _ of t.matchAll(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])(?=[\s;,})]|$)/g)) hex += 1;

  let heavyWeight = 0;
  for (const m of t.matchAll(/font-weight\s*:\s*([^;]+);/gi)) {
    const v = m[1].trim();
    if (/^bold\b/i.test(v)) heavyWeight += 1;
    else {
      const num = v.match(/^(\d{3,4})\b/);
      if (num && Number(num[1]) >= 700) heavyWeight += 1;
    }
  }

  return {
    hex,
    radiusBare: countBareDecl(t, "border-radius"),
    fontSizeBare: countBareDecl(t, "font-size"),
    zIndexBare: countBareDecl(t, "z-index"),
    heavyWeight,
  };
}

/** 扫描 styles 目录全部文件，返回 { 文件名: {维度: 计数} }（零值文件省略）。 */
export function scanAllStyles() {
  const result = {};
  for (const file of listStyleFiles()) {
    const counts = scanFile(readFileSync(join(STYLES_DIR, file), "utf8"));
    const nonzero = Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0));
    if (Object.keys(nonzero).length > 0) result[file] = nonzero;
  }
  return result;
}

export const METRICS = ["hex", "radiusBare", "fontSizeBare", "zIndexBare", "heavyWeight"];
