/**
 * docs-site-index.test.ts — 文档站点索引的守卫。
 *
 * `apps/openbuddy-website/src/lib/docs-meta.ts` 的 `DOC_INDEX` 是站点侧边栏 +
 * 静态路由的唯一来源:写进去一个不存在的文件名,页面就会在构建期或运行期 404,
 * 而**不会**有任何测试变红 —— 站点是独立 app,主仓的 vitest 不管它。
 *
 * 这里把索引读进来,对着 `docs/` 目录核一遍。R31 把 5 篇插件/主题文档上站时
 * 顺手补的这条守卫。
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DOC_INDEX } from "../../apps/openbuddy-website/src/lib/docs-meta";

const DOCS_ROOT = resolve(__dirname, "../../docs");

describe("文档站点 DOC_INDEX", () => {
  it("每个条目的 en/zh 文件都真实存在于 docs/", () => {
    const missing: string[] = [];
    for (const doc of DOC_INDEX) {
      for (const [locale, file] of Object.entries(doc.files)) {
        if (!file) continue;
        if (!existsSync(resolve(DOCS_ROOT, file))) missing.push(`${doc.slug}(${locale}) -> ${file}`);
      }
    }
    expect(missing, `DOC_INDEX 指向不存在的文件:${missing.join(", ")}`).toEqual([]);
  });

  it("slug 唯一(重复 slug 会让后一条在路由里静默覆盖前一条)", () => {
    const slugs = DOC_INDEX.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("插件 SDK v1 的入口文档都已上站", () => {
    const slugs = new Set(DOC_INDEX.map((d) => d.slug));
    for (const slug of ["extension-points", "extension-guide", "extension-recipes", "plugin-marketplace", "themes"]) {
      expect(slugs, `${slug} 没进 DOC_INDEX`).toContain(slug);
    }
  });

  it("每篇文档都有标题与一句话摘要(侧边栏与搜索都读它)", () => {
    for (const doc of DOC_INDEX) {
      expect(doc.title, `${doc.slug} 缺 title`).toBeTruthy();
      expect(doc.description, `${doc.slug} 缺 description`).toBeTruthy();
    }
  });
});
