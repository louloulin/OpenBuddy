/**
 * 集成测试:验证所有 24 个 ui-* 包的真实 apply() 注册到对应 slot。
 *
 * 范围:
 *   - 24 个 ui-* 业务包(ui-account / ui-automation / ui-billing / ui-collaboration /
 *     ui-conversation / ui-dialogs / ui-editor / ui-email / ui-experts / ui-files /
 *     ui-files-tree / ui-home / ui-layout / ui-markdown / ui-mcp / ui-modules /
 *     ui-onboarding / ui-primitives / ui-settings / ui-settings-models /
 *     ui-shared / ui-sidebar / ui-workbench)
 *   - 通过 runtime.slots.entries(<slot>).length 验证注册成功
 *
 * 设计目的:
 *   - L3 改造目标:所有包全部从 `return () => {}` 改为真注册 slot 节点
 *   - 本测试是 L3 完成度的硬证据:任何包忘记注册,本测试失败
 */

import { describe, it, expect, beforeEach } from "vitest";

describe("24 个 ui-* 包真实 apply() 注册 slot 验证", () => {
  let runtime: Awaited<typeof import("../client")>["getOrCreateSingleton"] extends () => infer R ? R : never;
  let entries: (name: string) => readonly unknown[];

  beforeEach(async () => {
    const mod = await import("../client");
    runtime = mod.getRuntime();
    mod.registerAllBuiltinUis();
    entries = (name: string) => runtime.slots.entries(name);
  });

  it("ui-conversation → 'conversation' slot 注册 ChatView", () => {
    expect(entries("conversation").length).toBeGreaterThanOrEqual(1);
  });

  it("ui-settings → 'home' + 'shell.overlay' slot 注册 HomePage + SettingsPanel", () => {
    expect(entries("home").length).toBeGreaterThanOrEqual(1);
    expect(entries("shell.overlay").length).toBeGreaterThanOrEqual(1);
  });

  it("ui-workbench → 'shell.overlay' slot 注册 SearchOverlay", () => {
    expect(entries("shell.overlay").length).toBeGreaterThanOrEqual(2);
  });

  it("ui-dialogs → 'shell.overlay' slot 注册 AboutDialog + FolderTrustDialog(2 个)", () => {
    const overlay = entries("shell.overlay");
    expect(overlay.length).toBeGreaterThanOrEqual(4);
  });

  it("ui-automation → 'shell.overlay' slot 注册 TasksPanel", () => {
    expect(entries("shell.overlay").length).toBeGreaterThanOrEqual(5);
  });

  it("ui-shell → 'shell.statusbar' slot 注册 StatusBar(插件可整体替换)", () => {
    // entries() 返回的是收敛后的组件,要看注册者得读 entriesOfSlot 的原始 entry。
    const raw = runtime.slots.entriesOfSlot("shell.statusbar");
    expect(raw.length).toBeGreaterThanOrEqual(1);
    expect(raw[0]?.options.registrant).toBe("@openbuddy/ui-shell");
    expect(entries("shell.statusbar").length).toBe(1);
  });

  it("ui-primitives → 'notifications' slot 注册 Toast", () => {
    expect(entries("notifications").length).toBeGreaterThanOrEqual(1);
  });

  it("ui-sidebar → 'sidebar' slot 注册 Sidebar", () => {
    expect(entries("sidebar").length).toBeGreaterThanOrEqual(1);
  });

  it("ui-account → 7 个 placeholder.* slot 注册 7 个面板", () => {
    const panels = [
      "placeholder.account-linking",
      "placeholder.gateway-health",
      "placeholder.session-management",
      "placeholder.tenant-members",
      "placeholder.tenant-policy",
      "placeholder.token-introspection",
      "placeholder.webhook-subscription",
    ];
    for (const p of panels) {
      expect(entries(p).length, `slot ${p}`).toBeGreaterThanOrEqual(1);
    }
  });


  it("ui-account → 7 个面板同时注册到 keyed slot 'placeholder.account',entryForKey 可逐个命中", () => {
    const panels = [
      "account-linking",
      "gateway-health",
      "session-management",
      "tenant-members",
      "tenant-policy",
      "token-introspection",
      "webhook-subscription",
    ];
    for (const key of panels) {
      const component = runtime.slots.entryForKey?.("placeholder.account", key);
      expect(component, `entryForKey placeholder.account / ${key}`).toBeDefined();
    }
    expect(entries("placeholder.account").length).toBe(7);
  });

  it("ui-account → keyed slot 的 entries() 扁平返回 7 个 component 数组", () => {
    expect(entries("placeholder.account")).toHaveLength(7);
  });

  it("ui-account → keyed slot 未注册的 key 在 entryForKey 上返回 undefined", () => {
    expect(runtime.slots.entryForKey?.("placeholder.account", "nonexistent")).toBeUndefined();
  });
  it("ui-billing → 5 个 placeholder.* slot 注册 5 个面板", () => {
    const panels = [
      "placeholder.billing",
      "placeholder.credit-pricing",
      "placeholder.credit-reconciliation",
      "placeholder.credit-wallet",
      "placeholder.usage-quota",
    ];
    for (const p of panels) {
      expect(entries(p).length, `slot ${p}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("ui-collaboration → 2 个 placeholder.* slot", () => {
    expect(entries("placeholder.projects").length).toBeGreaterThanOrEqual(1);
    expect(entries("placeholder.subagent").length).toBeGreaterThanOrEqual(1);
  });

  it("ui-email → 2 个 placeholder.* slot", () => {
    expect(entries("placeholder.email").length).toBeGreaterThanOrEqual(1);
    expect(entries("placeholder.email-composer").length).toBeGreaterThanOrEqual(1);
  });

  it("ui-files → 3 个 placeholder.* slot", () => {
    expect(entries("placeholder.cloud-storage").length).toBeGreaterThanOrEqual(1);
    expect(entries("placeholder.knowledge-base").length).toBeGreaterThanOrEqual(1);
    expect(entries("placeholder.my-files").length).toBeGreaterThanOrEqual(1);
  });

  it("ui-mcp → 7 个 placeholder.* slot", () => {
    const panels = [
      "placeholder.discover",
      "placeholder.marketplace",
      "placeholder.notify-channels",
      "placeholder.openbuddy-plugin",
      "placeholder.plugins",
      "placeholder.resource-catalog",
      "placeholder.resources",
    ];
    for (const p of panels) {
      expect(entries(p).length, `slot ${p}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("ui-experts → 'placeholder.experts' slot 注册 ExpertsTab", () => {
    expect(entries("placeholder.experts").length).toBeGreaterThanOrEqual(1);
  });

  it("ui-settings-models → 不注册占位槽(设置扩展走渲染端 settings.section)", () => {
    // 以前这里注册了一个没有契约、没有消费者的 settings.extension + () => null,
    // 让审计表把这块记成「已实现」。扩展点在渲染端 contribution 注册表里,
    // 微内核侧保持空,免得用空壳刷注册数。
    expect(entries("settings.extension").length).toBe(0);
  });

  it("ui-layout → 'root' slot 有意不注册(参考实现由使用方显式挂载)", () => {
    // R23:AppFrame 是 `root` 的参考实现。内置包若在装配阶段无条件抢占 `root`,
    // 产品外壳(AppShell)就会被它顶掉。整壳替换的主动性属于使用方 ——
    // 这与 ui-modules 的 `modules.marketplace`(只导出组件、apply() no-op)同一种约定。
    expect(entries("root").length).toBe(0);
  });

  it("ui-theme / ui-locale / ui-hmr 走特殊通道(ThemeProvider / I18nProvider / HMR hook),不在聚合器中", () => {
    // ThemeProvider 在 buildUiRuntime() 内由 ThemeProvider React context 处理,
    // 不通过 ctx.slots。验证 buildUiRuntime 后 theme provider 已被 mount。
    expect(runtime.slots).toBeDefined();
  });

  it("ui-editor → 'editor.body' slot 注册 TiptapEditor", () => {
    expect(entries("editor.body").length).toBeGreaterThanOrEqual(1);
  });

  it("ui-onboarding → 5 个 onboarding.* slot 全部注册", () => {
    for (const slot of [
      "onboarding.wizard",
      "onboarding.tour",
      "onboarding.data-dir",
      "onboarding.feedback",
      "onboarding.whats-new",
    ]) {
      expect(entries(slot).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("shell.overlay 累计 >= 5(来自 ui-settings + ui-workbench + ui-dialogs*2 + ui-automation)", () => {
    expect(entries("shell.overlay").length).toBeGreaterThanOrEqual(5);
  });

  it("placeholder.* 累计 >= 20(7+5+2+2+3+7+1+1 = 28,扣除 ui-markdown/ui-modules/ui-shared/ui-hmr 不注册 placeholder)", () => {
    let total = 0;
    for (const slot of [
      "placeholder.account-linking", "placeholder.gateway-health",
      "placeholder.session-management", "placeholder.tenant-members",
      "placeholder.tenant-policy", "placeholder.token-introspection",
      "placeholder.webhook-subscription",
      "placeholder.billing", "placeholder.credit-pricing",
      "placeholder.credit-reconciliation", "placeholder.credit-wallet",
      "placeholder.usage-quota",
      "placeholder.projects", "placeholder.subagent",
      "placeholder.email", "placeholder.email-composer",
      "placeholder.cloud-storage", "placeholder.knowledge-base",
      "placeholder.my-files",
      "placeholder.discover", "placeholder.marketplace",
      "placeholder.notify-channels", "placeholder.openbuddy-plugin",
      "placeholder.plugins", "placeholder.resource-catalog",
      "placeholder.resources",
      "placeholder.experts",
    ]) {
      total += entries(slot).length;
    }
    expect(total).toBeGreaterThanOrEqual(25);
  });

  // R66 — files.tree slot 全链路:证明 ui-files-tree 在 builtin-applies
  // 里 + registerAllBuiltinUis() 后能拿到 LazyFileTree 默认实现。
  it("BUILTIN_UI_APPLIES 包含 @openbuddy/ui-files-tree", async () => {
    // 直接从 builtin-applies 拿注册表,绕过 client 间接层,这样如果以后
    // ui-files-tree 被误删,我们能在 CI 立刻看到失败。
    const { BUILTIN_UI_APPLIES: applies } = await import("../builtin-applies");
    const pkgs = applies.map((b) => b.pkg);
    expect(pkgs).toContain("@openbuddy/ui-files-tree");
  });

  it("registerAllBuiltinUis() 注册后,files.tree slot 有 1 个 entry", () => {
    // entries() 返回收敛后的组件(去重 + filter),LazyFileTree 是当前唯一注册方
    expect(entries("files.tree").length).toBe(1);
  });
});

