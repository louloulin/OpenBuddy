/**
 * ai-tokens — 邮件 AI 模块的 CSS 变量集中定义(P3-收尾 第 4 项)。
 *
 * 设计动机:
 *   - ai.css 历史上散落了若干 inline `oklch(...)` 颜色(ai-chip / ai-action-strip /
 *     ai-inbox-shell 各处的 tone),改色 / 主题化时需要全文搜索。
 *   - 集中到 ai-tokens.ts 后,EmailAiStyles 在挂载时把这些变量注入 :root,
 *     后续 ai.css 应该改成 var(--ai-...) 引用(本期先收集,不强制迁移)。
 *   - 同时把 `wb-*`(来自全局 tokens)再 export 一次 — 消费者不再需要关心
 *     theme/index.css 是否已加载,EmailAiStyles 自带 fallback。
 *
 * 用法:
 *   // EmailAiStyles.tsx 自动 inject 这套变量到 :root。
 *   // CSS 里:
 *   .ai-chip--priority { background: var(--ai-chip-priority-bg); }
 */

/** AI 模块私有色板(不依赖全局 tokens)。 */
export const AI_TOKEN_PALETTE = {
  "--ai-chip-priority-bg": "oklch(0.6 0.2 25 / 0.18)",
  "--ai-chip-priority-fg": "oklch(0.65 0.2 25)",
  "--ai-chip-reply-bg": "oklch(0.7 0.18 230 / 0.18)",
  "--ai-chip-reply-fg": "oklch(0.7 0.18 230)",
  "--ai-chip-action-bg": "oklch(0.78 0.16 75 / 0.18)",
  "--ai-chip-action-fg": "oklch(0.6 0.16 75)",
  "--ai-chip-muted-bg": "oklch(0.7 0.02 270 / 0.16)",
  "--ai-chip-muted-fg": "oklch(0.65 0.02 270)",
  "--ai-strip-pending-bg": "oklch(0.78 0.16 75 / 0.16)",
  "--ai-strip-pending-border": "oklch(0.78 0.16 75 / 0.4)",
  "--ai-strip-success-bg": "oklch(0.6 0.15 145 / 0.16)",
  "--ai-strip-success-border": "oklch(0.6 0.15 145 / 0.4)",
  "--ai-strip-error-bg": "oklch(0.55 0.2 25 / 0.16)",
  "--ai-strip-error-border": "oklch(0.55 0.2 25 / 0.4)",
  "--ai-row-multi-selected-bg": "oklch(0.7 0.18 230 / 0.12)",
  "--ai-overlay-scrim": "oklch(0.16 0 0 / 0.45)",
} as const;

/**
 * `--wb-*` 全局 token 的 fallback(theme 未加载时使用)。
 * 仅 EmailAiStyles 注入 — 全局主题已定义则会被覆盖。
 *
 * 收集范围:
 *   - ai.css 实际引用的 19 个 token(用 validateTokensConsistency() 校验一致性)
 *   - 间距 / 阴影 / 半径系列(留给后续 ui 复用)
 *
 * 未来 SSoT 路线:
 *   - 把 tokens.css / theme/index.css 的核心 token 也搬到这里
 *   - CSS 端用 var(--wb-*) 直接引用,token 定义由 EmailAiStyles 注入
 *   - 替换时机:主题切换 / 暗色模式支持时
 */
export const WB_TOKEN_FALLBACK = {
  // accent / 品牌色
  "--wb-accent": "oklch(0.7246 0.142 171)",
  "--wb-accent-fg": "oklch(0.97 0.02 171)",
  "--wb-accent-soft": "oklch(0.95 0.04 171)",
  // 背景层级
  "--wb-bg-primary": "oklch(1 0 0)",
  "--wb-bg-secondary": "oklch(0.97 0 0)",
  "--wb-bg-tertiary": "oklch(0.94 0 0)",
  "--wb-bg-elevated": "oklch(0.99 0 0)",
  // 边框
  "--wb-border": "oklch(0.88 0 0)",
  "--wb-border-soft": "oklch(0.93 0 0)",
  // 文字
  "--wb-fg-primary": "oklch(0.18 0 0)",
  "--wb-fg-secondary": "oklch(0.42 0 0)",
  "--wb-fg-tertiary": "oklch(0.58 0 0)",
  // 字体
  "--wb-font": 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  "--wb-font-mono": 'ui-monospace, "SF Mono", Monaco, "Cascadia Mono", "Courier New", monospace',
  // 状态色
  "--wb-success": "oklch(0.65 0.18 145)",
  "--wb-warning": "oklch(0.78 0.16 75)",
  "--wb-danger": "oklch(0.55 0.2 25)",
  // 圆角
  "--wb-radius-sm": "4px",
  "--wb-radius-md": "8px",
  "--wb-radius-lg": "12px",
  "--wb-radius-xl": "16px",
  // 阴影
  "--wb-shadow-md": "0 4px 12px oklch(0 0 0 / 0.08)",
  "--wb-shadow-lg": "0 8px 24px oklch(0 0 0 / 0.12)",
  // 间距
  "--wb-spacing-1": "4px",
  "--wb-spacing-2": "8px",
  "--wb-spacing-3": "12px",
  "--wb-spacing-4": "16px",
  "--wb-spacing-5": "20px",
  "--wb-spacing-6": "24px",
} as const;

export type AiTokenName = keyof typeof AI_TOKEN_PALETTE;
export type WbTokenName = keyof typeof WB_TOKEN_FALLBACK;

/**
 * 拼出注入 :root 的 CSS 文本 — EmailAiStyles 渲染时挂到 <head>。
 * 重复调用会覆盖(浏览器对同名 <style> 标签的处理是后写的覆盖先写的)。
 */
export function buildTokenStyleSheet(): string {
  const lines: string[] = [":root {"];
  for (const [name, value] of Object.entries(WB_TOKEN_FALLBACK)) {
    lines.push(`  ${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(AI_TOKEN_PALETTE)) {
    lines.push(`  ${name}: ${value};`);
  }
  lines.push("}");
  return lines.join("\n");
}


/**
 * parseCssTokenDefinitions — 从 CSS 文本里抽取 `--name: value` 声明。
 *
 * 使用场景:
 *   - 校验时,把 tokens.css 的全集当作"权威来源"传入,
 *     允许 ai-tokens 只声明 AI 模块真正需要的子集(subset)。
 *   - 不依赖文件 I/O(测试可注入字符串)。
 *
 * 实现:
 *   - 跳过注释(避免 style 注释里的示例被误识别)
 *   - 跳过 var() 引用 — 这些是 alias 不是定义
 */
export function parseCssTokenDefinitions(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const regex = /--([a-z][a-z0-9-]*)\s*:\s*([^;]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    const name = `--${match[1].toLowerCase()}`;
    const value = match[2].trim();
    if (/^var\(/i.test(value)) continue;
    // 第一次出现的非 var() 值就是 base:root 的定义。
    if (typeof out[name] !== "string") {
      out[name] = value;
    }
  }
  return out;
}

/**
 * validateTokensConsistency — 测试 / CI 工具。
 * 校验引用的所有 var(--wb-*) token 都能被解析:
 *   1. 在 WB_TOKEN_FALLBACK 声明(AI 模块私有 fallback)
 *   2. 或者在传入的 globalTokenSource 中声明(tokens.css 等权威来源)
 *
 * 任意一条命中即视为 OK。这样 AI 模块可以只声明子集,
 * 全局 token 提供兜底,EmailAiStyles 也不需要重复注入整套 global tokens。
 *
 * @returns { missing: string[];  unused: string[] }
 *   - missing: 引用但 fallback 和 globalSource 都未声明
 *   - unused:  fallback 声明但 ai.css 没引用(可清理;不消费 globalSource)
 */
export function validateTokensConsistency(
  referencedTokens: ReadonlyArray<string>,
  globalTokenSource?: Readonly<Record<string, string>>,
): {
  missing: string[];
  unused: string[];
} {
  const fallbackSet = new Set(Object.keys(WB_TOKEN_FALLBACK));
  const refSet = new Set(
    referencedTokens.map((t) => (t.startsWith("--") ? t : `--${t}`)),
  );
  const missing: string[] = [];
  for (const t of refSet) {
    if (fallbackSet.has(t)) continue;
    if (globalTokenSource && Object.prototype.hasOwnProperty.call(globalTokenSource, t)) continue;
    missing.push(t);
  }
  const unused: string[] = [];
  for (const t of fallbackSet) {
    if (!refSet.has(t)) unused.push(t);
  }
  return { missing, unused };
}
