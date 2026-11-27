import { BUILTIN_APP_ID } from "./builtin.js";
import type { AppEntry } from "./manifest.js";

/**
 * 会话内应用推荐 (20261126-upup UP-6.1 / 20261127-upup U5)。
 *
 * 只在**已安装**的应用里挑（输入是 `collectApps()` 的真实列表），最多 3 个；判别规则：
 * - 内置应用与当前应用不推（已在用）；
 * - 用户点过「不用了」的应用不再推（`dismissed`）；
 * - 停用的应用可以推，卡片上给「启用」；
 * - 没有任何关键词命中就不推（宁可不出卡，也不硬凑）。
 *
 * 关键词来自应用自己的名称 / 一句话定位 / 场景名与场景 prompt，再加分类的常用词。
 */
export interface AppRecommendation {
  appId: string;
  name: string;
  tagline?: string;
  category?: string;
  packageSource?: string;
  enabled: boolean;
  /** 命中的关键词（卡片上展示「为什么推荐」）。 */
  matched: string[];
  /** 应用自带的第一个场景，「试试」直接填进输入框。 */
  scene?: { name: string; prompt: string };
}

export const MAX_RECOMMENDATIONS = 3;

/** 分类常用词：应用 manifest 只写了 `category` 时也能命中用户的说法。 */
const CATEGORY_WORDS: Record<string, string[]> = {
  finance: ["股票", "股价", "行情", "大盘", "指数", "板块", "基金", "财报", "估值", "市盈率", "市净率", "投研", "研报", "证券", "A股", "港股", "美股", "北向资金", "K线", "涨停", "分红", "回撤", "持仓", "量化", "stock", "quote", "valuation", "portfolio"],
  dev: ["代码", "编程", "bug", "调试", "重构", "测试", "部署", "code", "debug"],
  design: ["设计", "海报", "配色", "排版", "原型", "logo", "design"],
  data: ["数据分析", "图表", "可视化", "报表", "透视", "dashboard", "chart"],
  office: ["周报", "会议纪要", "邮件", "日程", "汇报", "PPT", "文档"],
};

const words = (text: string | undefined): string[] =>
  (text ?? "")
    .split(/[\s,，、。.;；:：/|·()（）【】"'“”]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && word.length <= 12);

function keywordsOf(app: AppEntry): string[] {
  const own = [app.name, app.id, ...words(app.tagline), ...(app.sceneList ?? []).flatMap((scene) => [scene.name, ...words(scene.group)])];
  const category = app.category ? CATEGORY_WORDS[app.category.toLowerCase()] ?? [app.category] : [];
  return [...new Set([...own, ...category].filter((word) => word && word.length >= 2))];
}

export function recommendApps(
  apps: AppEntry[],
  query: string,
  options: { currentAppId?: string; dismissed?: string[]; enabled?: (app: AppEntry) => boolean } = {},
): AppRecommendation[] {
  const text = query.toLowerCase();
  if (!text.trim()) return [];
  const dismissed = new Set(options.dismissed ?? []);
  const scored: Array<{ app: AppEntry; matched: string[] }> = [];
  for (const app of apps) {
    if (app.id === BUILTIN_APP_ID || app.id === options.currentAppId || dismissed.has(app.id)) continue;
    if (app.kind === "extension") continue;
    const matched = keywordsOf(app).filter((word) => text.includes(word.toLowerCase()));
    if (matched.length) scored.push({ app, matched });
  }
  return scored
    .sort((a, b) => b.matched.length - a.matched.length)
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ app, matched }) => {
      const first = app.sceneList?.[0];
      return {
        appId: app.id,
        name: app.name,
        ...(app.tagline ? { tagline: app.tagline } : {}),
        ...(app.category ? { category: app.category } : {}),
        ...(app.packageSource ? { packageSource: app.packageSource } : {}),
        enabled: options.enabled ? options.enabled(app) : true,
        matched: matched.slice(0, 5),
        ...(first ? { scene: { name: first.name, prompt: first.prompt } } : {}),
      };
    });
}
