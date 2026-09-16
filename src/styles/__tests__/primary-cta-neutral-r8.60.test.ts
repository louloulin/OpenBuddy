/**
 * primary-cta-neutral-r8.60.test.ts — 防回归守卫:R8.60「中性实心主操作」契约。
 *
 * 背景(2026-09-16 用户反馈):
 *   「颜色不要改成绿色,还是参考这个正常的黑色」—— 参照 WorkBuddy 实测截图
 *   (分段控件选中态 = 黑底白字),主操作/选中态一律中性黑,不用品牌青绿铺满
 *   实心按钮;品牌青绿只保留在强调指示(状态点 / 进度条 / 聚焦环 / 左侧激活条)。
 *
 * 本文件替换旧的 primary-cta-brand-r8.59.test.ts(它断言的正是「实心按钮=品牌青绿」,
 * 与用户指令冲突)。
 *
 * 锁定不变量:
 *   1. 选中态实心填充(--wb-bg-pill-active / -hover)亮暗两套都是中性色
 *   2. 主操作按钮实心填充(--wb-button-primary-bg / -fg / -hover)亮暗两套都存在且中性
 *   3. 关键 CTA 选择器必须走 --wb-button-primary-bg 或 --wb-bg-pill-active,
 *      不得再出现 var(--wb-brand*) / var(--wb-accent) 实心填充
 *   4. --wb-border-soft 亮暗两套都定义
 *   5. --wb-toggle-knob 亮暗两套都定义(开关拨杆跟随主填充反转)
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(__dirname, "..");
const tokens = readFileSync(join(stylesDir, "tokens.css"), "utf8");

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

function ruleBody(css: string, selector: string): string | null {
  const idx = css.indexOf(selector + " {");
  if (idx < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = idx; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      depth++;
      if (start < 0) start = i + 1;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i);
    }
  }
  return null;
}

// tokens.css 结构: :root(亮调色板) → [data-theme=dark](暗调色板) →
// :root,body[IDE Light](亮 UI token) → [data-theme=dark],.dark(暗 UI token)。
// 用 maxsplit=2 的第三段锁定「暗 UI token」块,避免误命中排在后面的亮 UI 块。
const darkUi = tokens.split("[data-theme=dark],")[2] ?? "";

describe("R8.60 选中态实心填充 = 中性色", () => {
  it("亮色 --wb-bg-pill-active = rgba(0, 0, 0, 0.75)(WorkBuddy 分段控件实测值)", () => {
    expect(tokens).toMatch(/^ {2}--wb-bg-pill-active: rgba\(0, 0, 0, 0\.75\);\n/m);
    expect(tokens).toMatch(/^ {2}--wb-bg-pill-active-hover: rgba\(0, 0, 0, 0\.82\);\n/m);
  });

  it("暗色 --wb-bg-pill-active = rgba(255, 255, 255, 0.18)", () => {
    expect(darkUi).toMatch(/^ {2}--wb-bg-pill-active: rgba\(255, 255, 255, 0\.18\);\n/m);
    expect(darkUi).toMatch(/^ {2}--wb-bg-pill-active-hover: rgba\(255, 255, 255, 0\.22\);\n/m);
  });

  it("两个 token 都不再指向品牌色", () => {
    expect(tokens).not.toMatch(/--wb-bg-pill-active(-hover)?:\s*var\(--wb-brand/);
  });
});

describe("R8.60 主操作按钮实心填充 = 中性黑/白", () => {
  it("亮色 --wb-button-primary-bg 走 black-90,前景为白", () => {
    expect(tokens).toMatch(/^ {2}--wb-button-primary-bg: var\(--wb-palette-black-90\);\n/m);
    expect(tokens).toMatch(/^ {2}--wb-button-primary-fg: var\(--wb-palette-white-100\);\n/m);
  });

  it("暗色块里 --wb-button-primary-bg 反转为白,前景为 black-90", () => {
    expect(darkUi).toMatch(/^ {2}--wb-button-primary-bg: var\(--wb-palette-white-100\);\n/m);
    expect(darkUi).toMatch(/^ {2}--wb-button-primary-fg: var\(--wb-palette-black-90\);\n/m);
  });

  it("hover / active / disabled 三态都定义为 token(不是硬编码色)", () => {
    expect(countMatches(tokens, /^ {2}--wb-button-primary-bg-hover:/gm)).toBeGreaterThanOrEqual(2);
    expect(countMatches(tokens, /^ {2}--wb-button-primary-bg-active:/gm)).toBeGreaterThanOrEqual(2);
    expect(countMatches(tokens, /^ {2}--wb-button-primary-bg-disabled:/gm)).toBeGreaterThanOrEqual(2);
  });
});

describe("R8.60 关键 CTA 选择器不再用品牌色实心填充", () => {
  const cssFiles = readdirSync(stylesDir).filter((f) => f.endsWith(".css"));

  function ctaBodies(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const f of cssFiles) {
      const css = readFileSync(join(stylesDir, f), "utf8");
      const re = /^([.\w[\]=": >~,-]+?)\s*\{([^{}]*)\}/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(css))) {
        out.push([m[1].trim(), m[2]]);
      }
    }
    return out;
  }

  const CTAS = [
    ".tt-btn--primary",
    ".msg__action-btn--primary",
    ".btn--primary",
    ".wb-button--primary",
    ".modal-shell__primary",
    ".about-dialog__ok",
    ".um-btn--primary",
    ".plan-panel__add-btn",
    ".plan-panel__approve-btn",
    ".browser-preview__go",
    ".kb-panel__add-btn",
    ".feedback-dialog__btn--primary",
    ".sk-detail-install-btn",
    ".mp-plugin__btn--install",
    ".marketplace-panel__action-btn--primary",
    ".project-template-card__action",
    ".email-composer__btn--primary",
    ".discover-launcher__launch",
    ".composer-card__send-btn",
    ".wb-composer__send--enqueue",
    ".projects-panel__create-btn",
    ".automation-panel__create-btn",
    ".assistants-panel__create-btn",
  ];

  it("每个 CTA 的 background 都指向中性 token(button-primary-bg / pill-active)", () => {
    const bodies = ctaBodies();
    const offenders: string[] = [];
    for (const sel of CTAS) {
      const hits = bodies.filter(([s]) => s === sel);
      for (const [, body] of hits) {
        const bg = /background(-color)?:\s*([^;]+);/.exec(body)?.[2] ?? "";
        if (!bg) continue;
        if (
          /var\(--wb-brand|var\(--wb-accent|#00c29a|#00a884|#22cba8|#326bff|#2f6feb|#1554c0|#4cf0ce/i.test(
            bg,
          )
        ) {
          offenders.push(`${sel} => ${bg.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("选中态选择器走 --wb-bg-pill-active", () => {
    const bodies = ctaBodies();
    const selected = [
      ".model-tags__chip--on",
      ".create-colleague-tag--on",
      ".quota-panel__period-btn.active",
      ".proj-picker-check--on",
      ".question-inline__option--selected",
      ".email-action-center__filter-group button.is-active",
      ".email-action-center__sort button.is-active",
    ];
    for (const sel of selected) {
      const hits = bodies.filter(([s]) => s === sel);
      expect(hits.length, `未找到 ${sel}`).toBeGreaterThan(0);
      expect(hits[0][1]).toMatch(/--wb-bg-pill-active/);
    }
  });

  it("选中态文字色不再硬编码 #fff(暗色下 pill 是半透白,白字会糊)", () => {
    const bodies = ctaBodies();
    const selected = [
      ".model-tags__chip--on",
      ".create-colleague-tag--on",
      ".quota-panel__period-btn.active",
      ".email-action-center__filter-group button.is-active",
      ".email-action-center__sort button.is-active",
    ];
    for (const sel of selected) {
      const hits = bodies.filter(([s]) => s === sel);
      if (!hits.length) continue;
      expect(hits[0][1], sel).not.toMatch(/color:\s*#fff/);
    }
  });
});

describe("R8.60 主题感知 token", () => {
  it("--wb-border-soft 亮暗两套都定义", () => {
    expect(countMatches(tokens, /^ {2}--wb-border-soft:/gm)).toBeGreaterThanOrEqual(2);
    expect(tokens).toMatch(/^ {2}--wb-border-soft: rgba\(0, 0, 0, 0\.08\);\n/m);
    expect(tokens).toMatch(/^ {2}--wb-border-soft: rgba\(255, 255, 255, 0\.08\);\n/m);
  });

  it("--wb-toggle-knob 亮暗两套都定义且互相反转", () => {
    expect(tokens).toMatch(/^ {2}--wb-toggle-knob: var\(--wb-palette-white-100\);\n/m);
    expect(tokens).toMatch(/^ {2}--wb-toggle-knob: var\(--wb-palette-black-90\);\n/m);
  });

  it("开关轨道走中性主填充,拨杆用 bg-primary 而不是死白", () => {
    const home = readFileSync(join(stylesDir, "home.css"), "utf8");
    const plugins = readFileSync(join(stylesDir, "plugins.css"), "utf8");
    expect(ruleBody(home, ".skill-item-toggle input:checked + .skill-item-toggle-track")).toMatch(
      /--wb-button-primary-bg/,
    );
    expect(ruleBody(plugins, ".sk-toggle input:checked + .sk-toggle-track")).toMatch(
      /--wb-button-primary-bg/,
    );
    expect(ruleBody(plugins, ".sk-toggle-thumb")).toMatch(/background:\s*var\(--wb-bg-primary/);
  });
});
