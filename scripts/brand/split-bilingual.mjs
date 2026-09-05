#!/usr/bin/env node
// ---------------------------------------------------------------------------
// One-shot: split anchor-style bilingual docs into sibling-file pairs.
//
// The old pattern kept English and Chinese in ONE file, reachable via
// `#english` / `#简体中文` anchor jumps. That is exactly what top OSS projects
// avoid: a reader scrolls through an entire copy in a language they can't read,
// and neither half can be reviewed or diffed independently.
//
// New pattern (Vite / Tauri / Zustand style): X.md is English-only, X.zh-CN.md
// is Chinese-only, and each carries a one-line plain-text switcher at the top
// with the CURRENT language shown bold (not linked).
//
// Structure every input is known to share (verified before running):
//   # Title
//   > 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)
//   <a id="english"></a>
//   ## 🇬🇧 English
//   …english body…
//   ---
//   <a id="简体中文"></a>
//   ## 🇨🇳 简体中文
//   …chinese body…
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const FILES = [
  "BRAND.md", "CHANGELOG.md", "CODE_OF_CONDUCT.md", "GOVERNANCE.md",
  "MAINTAINERS.md", "SECURITY.md", "SPONSORS.md", "SUPPORT.md", "TODO.md",
  "docs/PERFORMANCE.md", ".github/LABEL_GUIDE.md",
];

const trim = (s) => s.replace(/^\n+/, "").replace(/\n+$/, "") + "\n";

for (const path of FILES) {
  const src = readFileSync(path, "utf8");
  const lines = src.split("\n");

  const title = lines.find((l) => /^#\s/.test(l))?.trim() ?? `# ${basename(path)}`;
  const enIdx = lines.findIndex((l) => l.includes('<a id="english"></a>'));
  const zhAnchorIdx = lines.findIndex((l) => l.includes('<a id="简体中文"></a>'));
  if (enIdx < 0 || zhAnchorIdx < 0) {
    console.error(`! ${path}: expected anchors not found — skipped`);
    continue;
  }

  // English body: from just after "## 🇬🇧 English" to the "---" that precedes
  // the Chinese anchor. Chinese body: from just after "## 🇨🇳 简体中文" to EOF.
  const enHeadIdx = lines.findIndex((l, i) => i > enIdx && /^##\s/.test(l));
  let enEnd = zhAnchorIdx;
  while (enEnd > enHeadIdx && (lines[enEnd].trim() === "" || lines[enEnd].trim() === "---" || lines[enEnd].includes('<a id="简体中文"></a>'))) enEnd--;
  const enBody = lines.slice(enHeadIdx + 1, enEnd + 1).join("\n");

  const zhHeadIdx = lines.findIndex((l, i) => i > zhAnchorIdx && /^##\s/.test(l));
  const zhBody = lines.slice(zhHeadIdx + 1).join("\n");

  const zhName = basename(path).replace(/\.md$/, ".zh-CN.md");
  const zhPath = path.replace(/\.md$/, ".zh-CN.md");

  const enNav = `**English** · [简体中文](${zhName})`;
  const zhNav = `[English](${basename(path)}) · **简体中文**`;

  writeFileSync(path, `${title}\n\n${enNav}\n\n${trim(enBody)}`);
  writeFileSync(zhPath, `${title.replace(/^#\s.*/, title)}\n\n${zhNav}\n\n${trim(zhBody)}`);
  console.log(`✓ ${path}  →  ${path} + ${zhPath}`);
}
