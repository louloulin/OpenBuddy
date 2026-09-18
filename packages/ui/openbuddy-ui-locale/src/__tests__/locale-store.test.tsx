/**
 * ui-locale 单例 store 的行为契约。
 *
 * 这里锁住的是"微内核 i18n 真的只有一个 store"这件事 —— 此前 I18nProvider 与
 * applyLocale(ctx) 各建一个,插件里改语言界面纹丝不动。所以最关键的断言不是
 * 词表查找(那部分很直白),而是**同一性**:ctx.locale / provider / hook 拿到的
 * 必须是同一个实例。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  I18nProvider,
  LanguagePicker,
  LOCALE_LABELS,
  LOCALE_STORAGE_KEY,
  __resetLocaleService,
  applyLocale,
  getOrCreateLocaleService,
  useLocale,
  useLocaleName,
  useT,
} from "../client";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "../index";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

beforeEach(() => {
  __resetLocaleService();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
  __resetLocaleService();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("getOrCreateLocaleService — 单例", () => {
  it("重复调用返回同一个实例", () => {
    const a = getOrCreateLocaleService();
    const b = getOrCreateLocaleService();
    expect(a).toBe(b);
  });

  it("applyLocale(ctx) 挂的是同一个 store(插件与 React 树不分叉)", () => {
    const ctx: Record<string, unknown> = {};
    const dispose = applyLocale(ctx);
    expect(ctx.locale).toBe(getOrCreateLocaleService());
    dispose();
    expect(ctx.locale).toBeUndefined();
  });

  it("__resetLocaleService 之后是新实例(测试隔离用)", () => {
    const before = getOrCreateLocaleService();
    __resetLocaleService();
    expect(getOrCreateLocaleService()).not.toBe(before);
  });

  it("默认语言是 DEFAULT_LOCALE,且 available() 覆盖 SUPPORTED_LOCALES", () => {
    const service = getOrCreateLocaleService();
    expect(service.current()).toBe(DEFAULT_LOCALE);
    expect([...service.available()]).toEqual([...SUPPORTED_LOCALES]);
  });
});

describe("语言切换与持久化", () => {
  it("set() 落 localStorage 并通知订阅者", () => {
    const service = getOrCreateLocaleService();
    let notified = 0;
    const off = service.subscribe(() => {
      notified += 1;
    });
    service.set("en-US");
    expect(service.current()).toBe("en-US");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en-US");
    expect(notified).toBe(1);
    off();
    // 退订之后不再收到通知。
    service.set("zh-CN");
    expect(notified).toBe(1);
  });

  it("切到当前语言是 no-op(不写盘、不通知)", () => {
    const service = getOrCreateLocaleService();
    let notified = 0;
    service.subscribe(() => {
      notified += 1;
    });
    service.set(service.current());
    expect(notified).toBe(0);
  });

  it("不支持的语言被忽略(不污染持久化)", () => {
    const service = getOrCreateLocaleService();
    service.set("fr-FR" as Locale);
    expect(service.current()).toBe(DEFAULT_LOCALE);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });
});

describe("词表分层", () => {
  it("内置词表在无任何注册时可用", () => {
    const service = getOrCreateLocaleService();
    expect(service.t("common.save")).toBe("保存");
    expect(service.tIn("en-US", "common.save")).toBe("Save");
  });

  it("merge 深度合并:只补一个 key 不会打掉整棵子树", () => {
    const service = getOrCreateLocaleService();
    service.merge("zh-CN", { common: { save: "存一下" } });
    expect(service.t("common.save")).toBe("存一下");
    // 同命名空间下的兄弟 key 必须还在 —— 浅合并会在这里塌掉。
    expect(service.t("common.cancel")).toBe("取消");
  });

  it("merge 可以新增命名空间,子表优先于合并层与内置", () => {
    const service = getOrCreateLocaleService();
    service.merge("zh-CN", { product: { title: "产品文案" } });
    expect(service.t("product.title")).toBe("产品文案");

    service.register("zh-CN", "sidebar", { common: { save: "子表保存" } });
    const bind = service.bind("sidebar");
    expect(bind("common.save")).toBe("子表保存");
    // 子表是作用域隔离的:不带 ns 的 t() 读不到它。
    expect(service.t("common.save")).toBe("保存");
  });

  it("register 返回的 disposer 摘掉子表并通知", () => {
    const service = getOrCreateLocaleService();
    const off = service.register("zh-CN", "ns", { common: { save: "NS" } });
    expect(service.hasNamespace("zh-CN", "ns")).toBe(true);
    let notified = 0;
    service.subscribe(() => {
      notified += 1;
    });
    off();
    expect(service.hasNamespace("zh-CN", "ns")).toBe(false);
    expect(notified).toBe(1);
  });

  it("插值:参数缺失时保留占位符,而不是渲染 undefined", () => {
    const service = getOrCreateLocaleService();
    service.merge("zh-CN", { tpl: { hi: "你好 {name}" } });
    expect(service.t("tpl.hi", { name: "阿豆" })).toBe("你好 阿豆");
    expect(service.t("tpl.hi")).toBe("你好 {name}");
  });

  it("缺 key 落到另一种语言;两边都缺才回退 key 本身", () => {
    const service = getOrCreateLocaleService();
    service.merge("en-US", { only: { en: "english only" } });
    // 语言是 zh-CN,key 只在 en-US 里有 → 用英文兜底。
    expect(service.t("only.en")).toBe("english only");
    // 两边都没有 → 原样返回 key(静默空串会把缺翻译藏起来)。
    expect(service.t("nope.missing")).toBe("nope.missing");
  });

  it("tIn 不读当前语言", () => {
    const service = getOrCreateLocaleService();
    service.set("en-US");
    expect(service.current()).toBe("en-US");
    expect(service.tIn("zh-CN", "common.save")).toBe("保存");
  });
});

describe("React 绑定", () => {
  function Probe() {
    const t = useT("common.save");
    const name = useLocaleName();
    const service = useLocale();
    return (
      <div>
        <span data-testid="t">{t}</span>
        <span data-testid="name">{name}</span>
        <button data-testid="to-en" onClick={() => service.set("en-US")}>
          en
        </button>
      </div>
    );
  }

  it("useT / useLocaleName 跟随内核语言变化重渲染", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("t").textContent).toBe("保存");
    expect(screen.getByTestId("name").textContent).toBe("zh-CN");
    act(() => {
      fireEvent.click(screen.getByTestId("to-en"));
    });
    expect(screen.getByTestId("t").textContent).toBe("Save");
    expect(screen.getByTestId("name").textContent).toBe("en-US");
  });

  it("没有 Provider 时回落到单例而不是抛错", () => {
    // 叶子组件(ui-* 包内)经常在 SlotProvider 之外被渲染 —— Storybook / 单测。
    render(<Probe />);
    expect(screen.getByTestId("name").textContent).toBe("zh-CN");
  });
});

describe("LanguagePicker", () => {
  it("列出全部支持语言,并用各自的语言书写标签", () => {
    render(<LanguagePicker />);
    const select = screen.getByLabelText("Language / 语言") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([...SUPPORTED_LOCALES]);
    expect([...select.options].map((o) => o.textContent)).toEqual(
      SUPPORTED_LOCALES.map((code) => LOCALE_LABELS[code]),
    );
    expect(select.value).toBe("zh-CN");
  });

  it("选择后写入内核 store(不是局部 state)", () => {
    render(<LanguagePicker />);
    const select = screen.getByLabelText("Language / 语言") as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: "en-US" } });
    });
    expect(getOrCreateLocaleService().current()).toBe("en-US");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en-US");
  });

  it("默认挂 --wb-* 主题化的类名,允许覆盖", () => {
    const { container, unmount } = render(<LanguagePicker />);
    expect(container.querySelector("select")?.className).toBe("settings-select");
    unmount();
    const second = render(<LanguagePicker className="custom" id="lang" />);
    const el = second.container.querySelector("select");
    expect(el?.className).toBe("custom");
    expect(el?.id).toBe("lang");
  });
});
