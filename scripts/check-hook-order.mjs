#!/usr/bin/env node
//====================================================================
// scripts/check-hook-order.mjs — React hook 顺序静态门禁
//
// 背景(2026-10-14 生产事故):MessageItem / TextMessagePart /
// ThoughtMessagePart / MarkdownInlineCode 都存在「提前 return 之后还有
// hook」的写法。同一组件实例两次渲染之间 hook 数量变化,生产包直接抛
// React error #300(rendered fewer hooks),且 dev 模式不复现 —— 探针
// 在 production bundle 下才抓到。
//
// 门禁规则:对每个含 JSX 的函数组件,用 TypeScript AST 找出函数体
// 【顶层】的 hook 调用与 return 语句;任何 return 之后不允许再出现
// 顶层 hook 调用。
//====================================================================
import ts from "../node_modules/typescript/lib/typescript.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(import.meta.url), "../..");
const SCAN_ROOTS = ["packages/ui", "src", "electron"];
const HOOK_NAMES = new Set([
  "useState", "useEffect", "useMemo", "useCallback", "useRef", "useContext",
  "useLayoutEffect", "useReducer", "useSyncExternalStore", "useId",
  // 仓库内自定义 hook(渲染期调用的)
  "useT", "useLocale", "useLocaleName", "useTheme", "useThemeSnapshot",
  "useShortcut", "useSlotComponent", "useSlotComponents", "useAgentPaths",
  "useRendererContributions", "useRendererSlot", "useUnifiedTabs",
  "useNowTick", "useRowPanelNav", "useSessionStore",
]);

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const entry of entries) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (!/__tests__|node_modules|dist|_archive/.test(entry)) walk(p, acc);
      continue;
    }
    if (entry.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

/** 收集函数体顶层语句流里的 hook 调用与 return(不进入嵌套函数)。 */
function topLevelEvents(body, sf) {
  const events = [];
  const hookScan = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOK_NAMES.has(n.expression.text)) {
      events.push({ kind: "hook", pos: n.getStart(sf), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, name: n.expression.text });
    }
    if (!ts.isFunctionLike(n)) ts.forEachChild(n, hookScan);
  };
  const scanStmt = (stmt) => {
    if (ts.isReturnStatement(stmt) && stmt.expression !== undefined) {
      events.push({ kind: "return", pos: stmt.getStart(sf), line: sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1, text: stmt.getText(sf).replace(/\s+/g, " ").slice(0, 60) });
      return;
    }
    if (ts.isIfStatement(stmt)) {
      // if (cond) return X / else return X:只把【直接是 return 语句】的分支
      // 记为提前 return;分支是 Block 时交给 scanStmt 递归。
      for (const branch of [stmt.thenStatement, stmt.elseStatement]) {
        if (branch && ts.isReturnStatement(branch) && branch.expression !== undefined) {
          events.push({ kind: "return", pos: branch.getStart(sf), line: sf.getLineAndCharacterOfPosition(branch.getStart(sf)).line + 1, text: stmt.getText(sf).replace(/\s+/g, " ").slice(0, 60) });
        }
      }
      // 条件表达式/其他语句里的 hook 不属于组件顶层,不扫。
      if (stmt.thenStatement && ts.isBlock(stmt.thenStatement)) stmt.thenStatement.statements.forEach(scanStmt);
      if (stmt.elseStatement && ts.isBlock(stmt.elseStatement)) stmt.elseStatement.statements.forEach(scanStmt);
      return;
    }
    ts.forEachChild(stmt, hookScan);
  };
  if (ts.isBlock(body)) body.statements.forEach(scanStmt);
  return events.sort((a, b) => a.pos - b.pos);
}

const findings = [];
for (const root of SCAN_ROOTS) {
  for (const path of walk(join(repoRoot, root))) {
    const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isFunctionLike(node) && node.body && ts.isBlock(node.body)) {
        let hasJsx = false;
        const jsxCheck = (n) => {
          if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) hasJsx = true;
          if (!hasJsx) ts.forEachChild(n, jsxCheck);
        };
        node.forEachChild(jsxCheck);
        if (hasJsx) {
          const events = topLevelEvents(node.body, sf);
          for (let i = 0; i < events.length; i += 1) {
            if (events[i].kind !== "return") continue;
            const nextHook = events.slice(i + 1).find((e) => e.kind === "hook");
            if (nextHook) {
              findings.push({ path: relative(repoRoot, path), returnLine: events[i].line, hookLine: nextHook.line, hook: nextHook.name, ret: events[i].text });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

if (findings.length) {
  const seen = new Set();
  console.error("hook 顺序门禁失败:return 之后还有顶层 hook(生产包会抛 React #300):");
  for (const f of findings) {
    const key = `${f.path}:${f.returnLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`  ${f.path}:${f.returnLine} 「${f.ret}」 → hook ${f.hook}@${f.hookLine}`);
  }
  process.exit(1);
}
console.log("hook 顺序门禁通过:组件 return 之后无顶层 hook。");
