import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseCssTokenDefinitions,
  validateTokensConsistency,
  WB_TOKEN_FALLBACK,
} from "../ai-tokens";

// vitest workspace 是 packages/ui/openbuddy-ui-email/,绝对路径从仓库根重新定位。
const HERE = resolve(__dirname);
const PACKAGES = resolve(HERE, "..", "..", "..");
const MONOREPO = resolve(PACKAGES, "..", "..");

function findRepoRoot(): string {
  let cur = HERE;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cur, "package.json")) && existsSync(join(cur, "src/styles/tokens.css"))) return cur;
    cur = resolve(cur, "..");
  }
  return MONOREPO; // fallback
}

const ROOT = findRepoRoot();
const TOKENS_CSS = join(ROOT, "src/styles/tokens.css");
const AI_CSS = join(ROOT, "packages/ui/openbuddy-ui-email/src/ai/ai.css");

function extractTokens(file: string): string[] {
  const css = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /var\((--wb-[a-z][a-z0-9-]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.push(m[1]);
  return Array.from(new Set(out));
}

describe("ai-tokens 实战校验 — 真实 CSS 文件", () => {
  it("ai.css 在 [fallback U tokens.css] 覆盖下零缺失", () => {
    const globalTokens = parseCssTokenDefinitions(readFileSync(TOKENS_CSS, "utf8"));
    const aiRefs = extractTokens(AI_CSS);
    const { missing } = validateTokensConsistency(aiRefs, globalTokens);
    expect(missing).toEqual([]);
  });

  it("ai.css 引用的所有 token 都能在 fallback 里找到(--wb-font-mono 已对齐)", () => {
    const aiRefs = new Set(extractTokens(AI_CSS));
    const fallbackSet = new Set(Object.keys(WB_TOKEN_FALLBACK));
    const refsNotInFallback = [...aiRefs].filter((t) => !fallbackSet.has(t));
    expect(refsNotInFallback).toEqual([]);
  });

  it("tokens.css 解析出有效 token 表(> 100 个)", () => {
    const tokens = parseCssTokenDefinitions(readFileSync(TOKENS_CSS, "utf8"));
    expect(Object.keys(tokens).length).toBeGreaterThan(100);
  });
});
