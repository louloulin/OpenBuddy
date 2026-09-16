import { describe, expect, it } from "vitest";

import { parseChangelog } from "../parse-changelog";

const SAMPLE = `# 更新日志 (Changelog) / Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

### v0.15.0 (2026-09-01) — Enterprise Casdoor × NewAPI × OpenBuddy integration

#### 🎯 Commercial architecture

- **End-to-end enterprise agent workbench**: Casdoor (OIDC IdP) + NewAPI.
- **Dual-path NewAPI integration**:
  - **Path A · BYOK**: user-supplied \`sk-…\`, renderer-direct.

#### ✅ Quality

- Full test suite: **1,171 passed + 3 skipped = 1,174** (103 test files).

### v0.14.0 (2026-08-20) — Theme system v2

- \`src/themes/index.ts\` — 19 OKLCh themes.
- Match system mode.
`;

describe("parseChangelog", () => {
  it("拆出版本 / 日期 / 标题", () => {
    const [first] = parseChangelog(SAMPLE);
    expect(first.version).toBe("0.15.0");
    expect(first.date).toBe("2026-09-01");
    expect(first.headline).toBe("Enterprise Casdoor × NewAPI × OpenBuddy integration");
  });

  it("只收顶层 bullet(嵌套细节不进摘要)", () => {
    const [first] = parseChangelog(SAMPLE);
    const titles = first.items.map((i) => i.title);
    expect(titles).toContain("End-to-end enterprise agent workbench");
    expect(titles).toContain("Dual-path NewAPI integration");
    expect(titles).toContain("Full test suite");
    // 嵌套项 "Path A · BYOK" 不该出现
    expect(titles.join("|")).not.toContain("Path A");
  });

  it("加粗标签后的正文进 description", () => {
    const [first] = parseChangelog(SAMPLE);
    const item = first.items.find((i) => i.title === "End-to-end enterprise agent workbench");
    expect(item?.description).toBe("Casdoor (OIDC IdP) + NewAPI.");
  });

  it("破折号写法拆成「路径 + 说明」", () => {
    const second = parseChangelog(SAMPLE)[1];
    const item = second.items.find((i) => i.title.includes("themes"));
    expect(item?.description).toBe("19 OKLCh themes.");
  });

  it("没有标签的普通 bullet 整行作标题", () => {
    const second = parseChangelog(SAMPLE)[1];
    const plain = second.items.find((i) => i.title === "Match system mode.");
    expect(plain?.description).toBeUndefined();
  });

  it("maxItems / maxReleases 生效", () => {
    const releases = parseChangelog(SAMPLE, { maxReleases: 1, maxItems: 1 });
    expect(releases).toHaveLength(1);
    expect(releases[0].items).toHaveLength(1);
  });

  it("没有 release 段落时返回空数组(不抛)", () => {
    expect(parseChangelog("# 只有标题\n\n正文")).toEqual([]);
  });

  it("空条目版本被丢弃", () => {
    const releases = parseChangelog("### v1.0.0 (2026)\n\n#### 只有小标题\n");
    expect(releases).toEqual([]);
  });
});
